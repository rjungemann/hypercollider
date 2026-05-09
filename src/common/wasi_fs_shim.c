/*
 * wasi_fs_shim.c — WASI filesystem syscall overrides for Emscripten
 * STANDALONE_WASM builds.
 *
 * Why this exists:
 *   Emscripten's STANDALONE_WASM mode ships weak stubs in standalone.c that
 *   return -EPERM for almost every file syscall. There is no built-in WASI
 *   path resolution: openat()/stat()/getdents64() all dead-end at the stub.
 *   For our WAMR host we need real file I/O, so this file provides non-weak
 *   overrides that translate the syscalls into __wasi_* calls and route them
 *   through WAMR's WASI implementation.
 *
 * Calling convention:
 *   musl wraps every __syscall_* call with __syscall_ret(), which interprets
 *   return values in (-4096, 0) as -errno and translates them into errno+(-1).
 *   We follow that convention: on error, return -ERRNO; on success, return
 *   the syscall's natural success value (fd, count, 0, ...).
 *
 * Compiled only into the WASI/WAMR variant of hclang.wasm.
 */

#define _GNU_SOURCE
#include <wasi/api.h>
#include <wasi/wasi-helpers.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <dirent.h>
#include <unistd.h>

// ============================================================================
// Preopen cache
// ============================================================================

#define MAX_PREOPENS 32

struct preopen {
    int wasi_fd;
    char* path;
    size_t path_len;
};

static struct preopen g_preopens[MAX_PREOPENS];
static int g_num_preopens = 0;
static int g_preopens_initialized = 0;

static void init_preopens(void) {
    if (g_preopens_initialized) return;
    g_preopens_initialized = 1;

    for (__wasi_fd_t fd = 3; fd < 3 + MAX_PREOPENS; fd++) {
        __wasi_prestat_t prestat;
        __wasi_errno_t err = __wasi_fd_prestat_get(fd, &prestat);
        if (err != 0) break;
        if (prestat.pr_type != __WASI_PREOPENTYPE_DIR) continue;

        size_t len = prestat.u.dir.pr_name_len;
        char* path = (char*)malloc(len + 1);
        if (!path) continue;
        err = __wasi_fd_prestat_dir_name(fd, (uint8_t*)path, len);
        if (err != 0) { free(path); continue; }
        path[len] = '\0';

        g_preopens[g_num_preopens].wasi_fd = (int)fd;
        g_preopens[g_num_preopens].path = path;
        g_preopens[g_num_preopens].path_len = len;
        g_num_preopens++;
    }
}

// Find the longest preopen that's a prefix of `abs_path`.
// On success, returns the preopen fd and sets *out_relpath to the relative
// path (a pointer into abs_path; "." if the path equals the preopen).
// Returns -1 if no preopen matches.
static int find_preopen(const char* abs_path, const char** out_relpath) {
    init_preopens();

    int best_fd = -1;
    size_t best_len = 0;
    for (int i = 0; i < g_num_preopens; i++) {
        size_t plen = g_preopens[i].path_len;
        if (plen >= best_len &&
            strncmp(abs_path, g_preopens[i].path, plen) == 0) {
            char next = abs_path[plen];
            if (next == '/' || next == '\0') {
                best_fd = g_preopens[i].wasi_fd;
                best_len = plen;
            }
        }
    }

    if (best_fd < 0) return -1;

    const char* rel = abs_path + best_len;
    while (*rel == '/') rel++;
    if (*rel == '\0') rel = ".";

    *out_relpath = rel;
    return best_fd;
}

// Resolve a (dirfd, path) pair into a (wasi_dirfd, relative_path) pair
// usable by __wasi_path_*. Returns 0 on success, a negative -errno otherwise.
static int resolve_at(int dirfd, const char* path,
                      int* out_wasi_dirfd, const char** out_relpath) {
    if (path && path[0] == '/') {
        int fd = find_preopen(path, out_relpath);
        if (fd < 0) return -ENOENT;
        *out_wasi_dirfd = fd;
        return 0;
    }
    if (dirfd == AT_FDCWD) return -ENOENT;
    *out_wasi_dirfd = dirfd;
    *out_relpath = (path && *path) ? path : ".";
    return 0;
}

// ============================================================================
// __syscall_openat
// ============================================================================

int __syscall_openat(int dirfd, intptr_t path_ptr, int flags, ...) {
    const char* path = (const char*)path_ptr;
    if (!path) return -EFAULT;

    int wasi_dirfd;
    const char* relpath;
    int rc = resolve_at(dirfd, path, &wasi_dirfd, &relpath);
    if (rc < 0) return rc;

    __wasi_oflags_t oflags = 0;
    if (flags & O_CREAT)     oflags |= __WASI_OFLAGS_CREAT;
    if (flags & O_DIRECTORY) oflags |= __WASI_OFLAGS_DIRECTORY;
    if (flags & O_EXCL)      oflags |= __WASI_OFLAGS_EXCL;
    if (flags & O_TRUNC)     oflags |= __WASI_OFLAGS_TRUNC;

    __wasi_lookupflags_t lookup_flags = (flags & O_NOFOLLOW)
        ? 0 : __WASI_LOOKUPFLAGS_SYMLINK_FOLLOW;

    __wasi_fdflags_t fdflags = 0;
    if (flags & O_APPEND)   fdflags |= __WASI_FDFLAGS_APPEND;
    if (flags & O_NONBLOCK) fdflags |= __WASI_FDFLAGS_NONBLOCK;

    __wasi_rights_t rights_base = 0;
    int access_mode = flags & O_ACCMODE;
    if (access_mode == O_RDONLY || access_mode == O_RDWR) {
        rights_base |= __WASI_RIGHTS_FD_READ;
        rights_base |= __WASI_RIGHTS_FD_READDIR;
    }
    if (access_mode == O_WRONLY || access_mode == O_RDWR) {
        rights_base |= __WASI_RIGHTS_FD_WRITE;
    }
    rights_base |= __WASI_RIGHTS_FD_SEEK;
    rights_base |= __WASI_RIGHTS_FD_TELL;
    rights_base |= __WASI_RIGHTS_FD_FILESTAT_GET;
    rights_base |= __WASI_RIGHTS_FD_FDSTAT_SET_FLAGS;
    rights_base |= __WASI_RIGHTS_PATH_OPEN;
    rights_base |= __WASI_RIGHTS_PATH_FILESTAT_GET;
    rights_base |= __WASI_RIGHTS_PATH_READLINK;
    rights_base |= __WASI_RIGHTS_POLL_FD_READWRITE;

    __wasi_rights_t rights_inheriting = rights_base;

    __wasi_fd_t result_fd = 0;
    __wasi_errno_t err = __wasi_path_open(
        (__wasi_fd_t)wasi_dirfd, lookup_flags,
        relpath, strlen(relpath),
        oflags,
        rights_base, rights_inheriting,
        fdflags, &result_fd);
    if (err != 0) return -(int)err;

    return (int)result_fd;
}

// ============================================================================
// fstat / stat / lstat / fstatat
// ============================================================================

static void filestat_to_stat(const __wasi_filestat_t* wasi, struct stat* st) {
    memset(st, 0, sizeof(*st));
    st->st_dev = (dev_t)wasi->dev;
    st->st_ino = (ino_t)wasi->ino;
    st->st_nlink = (nlink_t)wasi->nlink;
    st->st_size = (off_t)wasi->size;
    st->st_atim.tv_sec  = (time_t)(wasi->atim / 1000000000);
    st->st_atim.tv_nsec = (long)  (wasi->atim % 1000000000);
    st->st_mtim.tv_sec  = (time_t)(wasi->mtim / 1000000000);
    st->st_mtim.tv_nsec = (long)  (wasi->mtim % 1000000000);
    st->st_ctim.tv_sec  = (time_t)(wasi->ctim / 1000000000);
    st->st_ctim.tv_nsec = (long)  (wasi->ctim % 1000000000);

    mode_t mode;
    switch (wasi->filetype) {
        case __WASI_FILETYPE_BLOCK_DEVICE:     mode = S_IFBLK | 0644; break;
        case __WASI_FILETYPE_CHARACTER_DEVICE: mode = S_IFCHR | 0644; break;
        case __WASI_FILETYPE_DIRECTORY:        mode = S_IFDIR | 0755; break;
        case __WASI_FILETYPE_REGULAR_FILE:     mode = S_IFREG | 0644; break;
        case __WASI_FILETYPE_SYMBOLIC_LINK:    mode = S_IFLNK | 0777; break;
        default:                               mode = 0644;           break;
    }
    st->st_mode = mode;
}

int __syscall_fstat64(int fd, intptr_t buf_ptr) {
    struct stat* st = (struct stat*)buf_ptr;
    __wasi_filestat_t wasi;
    __wasi_errno_t err = __wasi_fd_filestat_get((__wasi_fd_t)fd, &wasi);
    if (err != 0) return -(int)err;
    filestat_to_stat(&wasi, st);
    return 0;
}

int __syscall_newfstatat(int dirfd, intptr_t path_ptr, intptr_t buf_ptr, int flags) {
    const char* path = (const char*)path_ptr;
    struct stat* st = (struct stat*)buf_ptr;

    int wasi_dirfd;
    const char* relpath;
    int rc = resolve_at(dirfd, path, &wasi_dirfd, &relpath);
    if (rc < 0) return rc;

    __wasi_lookupflags_t lookup_flags =
        (flags & AT_SYMLINK_NOFOLLOW) ? 0 : __WASI_LOOKUPFLAGS_SYMLINK_FOLLOW;

    __wasi_filestat_t wasi;
    __wasi_errno_t err = __wasi_path_filestat_get(
        (__wasi_fd_t)wasi_dirfd, lookup_flags,
        relpath, strlen(relpath), &wasi);
    if (err != 0) return -(int)err;
    filestat_to_stat(&wasi, st);
    return 0;
}

int __syscall_stat64(intptr_t path_ptr, intptr_t buf_ptr) {
    return __syscall_newfstatat(AT_FDCWD, path_ptr, buf_ptr, 0);
}

int __syscall_lstat64(intptr_t path_ptr, intptr_t buf_ptr) {
    return __syscall_newfstatat(AT_FDCWD, path_ptr, buf_ptr, AT_SYMLINK_NOFOLLOW);
}

// ============================================================================
// __syscall_getdents64
// ============================================================================

struct linux_dirent64 {
    uint64_t d_ino;
    int64_t  d_off;
    uint16_t d_reclen;
    uint8_t  d_type;
    char     d_name[];
};

#define DIRSTATE_MAX 64
struct dirstate {
    int fd;
    __wasi_dircookie_t cookie;
};
static struct dirstate g_dirstates[DIRSTATE_MAX];

static struct dirstate* get_dirstate(int fd) {
    for (int i = 0; i < DIRSTATE_MAX; i++) {
        if (g_dirstates[i].fd == fd) return &g_dirstates[i];
    }
    for (int i = 0; i < DIRSTATE_MAX; i++) {
        if (g_dirstates[i].fd == 0) {
            g_dirstates[i].fd = fd;
            g_dirstates[i].cookie = 0;
            return &g_dirstates[i];
        }
    }
    return NULL;
}

int __syscall_getdents64(int fd, intptr_t dirp_ptr, size_t count) {
    char* dirp = (char*)dirp_ptr;
    struct dirstate* state = get_dirstate(fd);
    if (!state) return -ENOMEM;

    static char wasi_buf[8192];
    size_t bufused = 0;
    __wasi_errno_t err = __wasi_fd_readdir(
        (__wasi_fd_t)fd, (uint8_t*)wasi_buf, sizeof(wasi_buf),
        state->cookie, &bufused);
    if (err != 0) return -(int)err;

    size_t out_used = 0;
    size_t in_pos = 0;
    while (in_pos + sizeof(__wasi_dirent_t) <= bufused) {
        __wasi_dirent_t hdr;
        memcpy(&hdr, wasi_buf + in_pos, sizeof(hdr));
        size_t name_off = in_pos + sizeof(__wasi_dirent_t);
        if (name_off + hdr.d_namlen > bufused) break;
        const char* name = wasi_buf + name_off;

        size_t reclen = sizeof(struct linux_dirent64) + hdr.d_namlen + 1;
        reclen = (reclen + 7) & ~(size_t)7;

        if (out_used + reclen > count) break;

        struct linux_dirent64* out =
            (struct linux_dirent64*)(dirp + out_used);
        out->d_ino = (uint64_t)hdr.d_ino;
        out->d_off = (int64_t)hdr.d_next;
        out->d_reclen = (uint16_t)reclen;
        switch (hdr.d_type) {
            case __WASI_FILETYPE_BLOCK_DEVICE:     out->d_type = DT_BLK; break;
            case __WASI_FILETYPE_CHARACTER_DEVICE: out->d_type = DT_CHR; break;
            case __WASI_FILETYPE_DIRECTORY:        out->d_type = DT_DIR; break;
            case __WASI_FILETYPE_REGULAR_FILE:     out->d_type = DT_REG; break;
            case __WASI_FILETYPE_SYMBOLIC_LINK:    out->d_type = DT_LNK; break;
            default:                               out->d_type = DT_UNKNOWN; break;
        }
        memcpy(out->d_name, name, hdr.d_namlen);
        out->d_name[hdr.d_namlen] = '\0';

        state->cookie = hdr.d_next;
        out_used += reclen;
        in_pos = name_off + hdr.d_namlen;
    }

    return (int)out_used;
}

// ============================================================================
// Misc minimal stubs
// ============================================================================

int __syscall_fcntl64(int fd, int cmd, ...) {
    __wasi_fdstat_t fdstat;
    __wasi_errno_t err = __wasi_fd_fdstat_get((__wasi_fd_t)fd, &fdstat);
    if (err != 0) return -(int)err;

    if (cmd == 3 /* F_GETFL */) {
        int flags = 0;
        if (fdstat.fs_flags & __WASI_FDFLAGS_APPEND)   flags |= O_APPEND;
        if (fdstat.fs_flags & __WASI_FDFLAGS_NONBLOCK) flags |= O_NONBLOCK;
        flags |= O_RDWR;
        return flags;
    }
    if (cmd == 4 /* F_SETFL */) return 0;
    if (cmd == 1 /* F_GETFD */ || cmd == 2 /* F_SETFD */) return 0;
    return -EINVAL;
}

int __syscall_ioctl(int fd, int op, ...) {
    (void)fd; (void)op;
    return -ENOTTY;
}

int __syscall_dup(int fd) { (void)fd; return -ENOSYS; }
