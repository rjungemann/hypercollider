#include "wasm_host.h"
#include "hc_platform.h"
#include <CLI/CLI.hpp>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <cerrno>
#include <csignal>
#include <chrono>
#include <cstdint>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <utility>

namespace fs = std::filesystem;

#ifndef _WIN32
#include <linenoise.h>
#else
// linenoise needs a POSIX terminal (termios). On Windows the REPL reads
// plain lines: no line editing, and history is not kept.
static char* linenoise(const char* prompt) {
    fputs(prompt, stdout);
    fflush(stdout);
    std::string line;
    if (!std::getline(std::cin, line))
        return nullptr;
    char* out = static_cast<char*>(malloc(line.size() + 1));
    if (out)
        memcpy(out, line.c_str(), line.size() + 1);
    return out;
}
static void linenoiseFree(void* p) { free(p); }
static int linenoiseSetMultiLine(int) { return 0; }
static int linenoiseHistoryLoad(const char*) { return 0; }
static int linenoiseHistoryAdd(const char*) { return 0; }
static int linenoiseHistorySave(const char*) { return 0; }
#endif

// The embedded blobs are defined in generated C files (cmake/EmbedWasmRun.cmake),
// so they need C linkage: MSVC mangles C++ variable names, GCC and Clang do not.
extern "C" {
#ifdef HC_EMBEDDED_WASM
extern const uint8_t hclang_wasm_blob[];
extern const size_t  hclang_wasm_blob_len;
#endif
#ifdef HC_EMBEDDED_CLASSLIB_PACK
extern const uint8_t hclang_classlib_pack_blob[];
extern const size_t  hclang_classlib_pack_blob_len;
#endif
}

// Global WASM host instance
static WasmHost g_wasm_host;

// REPL state (Phase H3: scscm support)
static bool g_repl_scscm_mode = false; // false = scd mode, true = scscm mode

// ---------------------------------------------------------------------------
// Snapshot helpers (Phase I2): warm-start heap restoration
// ---------------------------------------------------------------------------
// Snapshot file layout: 4-byte magic (0x48435350) + 64-byte SHA256 hash + heap bytes
// Hash is computed from the WASM binary contents (compiled class definitions are
// part of the binary, so binary mtime alone uniquely identifies a snapshot state).

static void simple_sha256(const uint8_t* data, size_t len, uint8_t out[64]) {
    // Simple checksum hash. In production, use a real SHA256 library.
    uint64_t hash = 0xd3d3d3d3d3d3d3d3ULL;
    for (size_t i = 0; i < len; ++i) {
        hash = ((hash << 5) + hash) ^ data[i];
    }
    for (int i = 0; i < 8; ++i) {
        memcpy(out + i * 8, &hash, 8);
    }
}

static const char* get_snapshot_path() {
    static std::string path;
    if (path.empty()) {
        std::string home = hc_home_dir();
        std::error_code ec;
        fs::path base = home.empty() ? fs::temp_directory_path(ec) : fs::path(home);
        path = (base / ".cache" / "hclang" / "heap.bin").string();
    }
    return path.c_str();
}

static bool save_snapshot(uint8_t* heap_base, uint32_t heap_size,
                         const uint8_t* wasm_bytes, uint32_t wasm_size) {
    const char* snap_path = get_snapshot_path();

    // Create the directory, parents included, if needed.
    std::error_code ec;
    fs::create_directories(fs::path(snap_path).parent_path(), ec);

    FILE* f = fopen(snap_path, "wb");
    if (!f) return false;

    const uint32_t SNAP_MAGIC = 0x48435350;
    uint8_t hash[64] = {};
    if (wasm_bytes && wasm_size > 0) {
        simple_sha256(wasm_bytes, wasm_size, hash);
    }

    if (fwrite(&SNAP_MAGIC, 4, 1, f) != 1) {
        fclose(f); return false;
    }
    if (fwrite(hash, 64, 1, f) != 1) {
        fclose(f); return false;
    }
    if (fwrite(heap_base, heap_size, 1, f) != 1) {
        fclose(f); return false;
    }

    fclose(f);
    return true;
}

static bool restore_snapshot(uint8_t* heap_base, uint32_t heap_capacity,
                            const uint8_t* wasm_bytes, uint32_t wasm_size) {
    const char* snap_path = get_snapshot_path();

    FILE* f = fopen(snap_path, "rb");
    if (!f) return false;

    uint32_t magic = 0;
    uint8_t hash[64] = {};
    if (fread(&magic, 4, 1, f) != 1) { fclose(f); return false; }
    if (fread(hash, 64, 1, f) != 1) { fclose(f); return false; }

    const uint32_t SNAP_MAGIC = 0x48435350;
    if (magic != SNAP_MAGIC) { fclose(f); return false; }

    // Verify hash
    uint8_t expected_hash[64] = {};
    if (wasm_bytes && wasm_size > 0) {
        simple_sha256(wasm_bytes, wasm_size, expected_hash);
    }
    if (memcmp(hash, expected_hash, 64) != 0) {
        fclose(f); return false;
    }

    // Validate heap size
    fseek(f, 0, SEEK_END);
    long file_size = ftell(f);
    fseek(f, 68, SEEK_SET);
    uint32_t snap_heap_size = (uint32_t)(file_size - 68);

    if (snap_heap_size > heap_capacity) {
        fclose(f); return false;
    }

    // Restore heap
    if (fread(heap_base, snap_heap_size, 1, f) != 1) {
        fclose(f); return false;
    }

    fclose(f);
    return true;
}

// ---------------------------------------------------------------------------
// Host functions that the WASM module can call back into via WAMR imports
// ---------------------------------------------------------------------------
// These must be registered with wasm_runtime_register_natives() before
// wasm_runtime_load().  The function signature "$i" = (pointer, i32).
// WAMR will translate the WASM linear-memory address automatically and
// pass a native void* to the function.

static void hc_host_post_impl(wasm_exec_env_t /*env*/,
                               void* text, int32_t len) {
    if (text && len > 0)
        fwrite(text, 1, static_cast<size_t>(len), stdout);
    fflush(stdout);
}

static void hc_host_error_impl(wasm_exec_env_t /*env*/,
                                void* text, int32_t len) {
    if (text && len > 0)
        fwrite(text, 1, static_cast<size_t>(len), stderr);
    fflush(stderr);
}

// Emscripten notifies the host when WASM linear memory grows.  No-op here.
static void emscripten_notify_memory_growth_impl(wasm_exec_env_t /*env*/,
                                                  int32_t /*memidx*/) {}

// Emscripten calls this during __wasm_call_ctors to populate its in-memory VFS
// with files that were embedded via --embed-file at link time.  Each entry in
// the table (pointed to by `ptr`) is { name_ptr: u32, len: u32, data_ptr: u32 };
// the list is terminated by a zero name_ptr.
//
// We forward each entry to the WASM-exported helper hc_wasm_vfs_create_file
// which calls Emscripten's POSIX fopen/fwrite/fclose (which do route through
// MEMFS) to materialise the files so compileLibrary() can iterate them.
static void emscripten_fs_load_embedded_files_impl(wasm_exec_env_t env,
                                                    uint32_t ptr) {
    fprintf(stderr, "[vfs] _emscripten_fs_load_embedded_files called, ptr=0x%x\n", ptr);
    fflush(stderr);
    wasm_module_inst_t inst = wasm_runtime_get_module_inst(env);
    wasm_function_inst_t fn_create =
        wasm_runtime_lookup_function(inst, "hc_wasm_vfs_create_file");
    if (!fn_create) {
        fprintf(stderr, "Warning: hc_wasm_vfs_create_file not found; "
                        "class library files won't be in VFS\n");
        return;
    }

    uint32_t count = 0;
    while (true) {
        if (!wasm_runtime_validate_app_addr(inst, ptr, 12)) break;
        auto* e = reinterpret_cast<uint32_t*>(
            wasm_runtime_addr_app_to_native(inst, ptr));
        if (!e) break;
        uint32_t name_wptr = e[0];
        uint32_t len       = e[1];
        uint32_t data_wptr = e[2];
        ptr += 12;
        if (name_wptr == 0) break; // null sentinel

        uint32_t argv[3] = { name_wptr, data_wptr, len };
        if (!wasm_runtime_call_wasm(env, fn_create, 3, argv)) {
            fprintf(stderr, "[vfs] hc_wasm_vfs_create_file failed: %s\n",
                    wasm_runtime_get_exception(inst));
            wasm_runtime_clear_exception(inst);
        }
        ++count;
    }
    fprintf(stderr, "[vfs] embedded %u class library file(s) into MEMFS\n", count);
}

// OSC forwarding to scsynth.
// When --scsynth-host / --scsynth-port are set, an outbound UDP socket is
// opened in main(); WASM-side OSC sends from netAddrSend land here, are
// copied out of WASM linear memory, and pushed to that address with sendto().
// Without a configured socket, sends are silently dropped (script can run
// without a synth attached).
// WASM type: (i32 msg_ptr, i32 size) -> i32
static hc_socket_t g_osc_socket  = HC_INVALID_SOCKET;
static sockaddr_in g_osc_addr    = {};
static int32_t sc_wasm_forward_osc_js_impl(wasm_exec_env_t env,
                                            int32_t msg_ptr,
                                            int32_t size) {
    if (g_osc_socket == HC_INVALID_SOCKET || size <= 0) return 0;
    wasm_module_inst_t inst = wasm_runtime_get_module_inst(env);
    if (!wasm_runtime_validate_app_addr(inst, (uint32_t)msg_ptr, (uint32_t)size))
        return -1;
    const void* native = wasm_runtime_addr_app_to_native(inst, (uint32_t)msg_ptr);
    if (!native) return -1;
    // Winsock takes a char* and an int length; POSIX accepts both.
    auto sent = sendto(g_osc_socket, static_cast<const char*>(native), size, 0,
                       (sockaddr*)&g_osc_addr, (int)sizeof(g_osc_addr));
    return (sent == size) ? 0 : -2;
}

// Emscripten longjmp support — no-op stub to prevent unlinked-call traps.
static void emscripten_throw_longjmp_impl(wasm_exec_env_t /*env*/) {}

// Ctrl-C / SIGINT polling. The bytecode interpreter calls
// hc_host_poll_interrupt every ~4096 dispatches; we set the flag from a
// SIGINT handler. WASM consumes (and clears) the flag here, then unwinds
// via wasiEscape — back to runInterpreter, back to the host call, and
// (if --repl) back to the prompt. Without this, Ctrl-C would either be
// absorbed by linenoise's own handler (only effective at the prompt) or,
// in a long-running script, do nothing until the WASM call returned.
static volatile sig_atomic_t g_interrupt_pending = 0;

static void sigint_handler(int /*sig*/) {
    hc_rearm_sigint_handler(sigint_handler);
    g_interrupt_pending = 1;
    // Don't re-raise / don't exit. The interpreter will pick this up on
    // its next interrupt-poll dispatch.
}

static int32_t hc_host_poll_interrupt_impl(wasm_exec_env_t /*env*/) {
    int32_t v = g_interrupt_pending;
    g_interrupt_pending = 0;
    return v;
}

// Quarks CLI: Host execution functions for command execution from WASM.
// These are called by WASM via WASI imports when prPipeOpen_Wasm and similar
// primitives execute shell commands.

// hc_host_exec: run a shell command, return exit code.
// The commands hc_host_exec* run execute on the host, but their paths come
// from the guest: Quarks.folder is /home/user/.local/share/SuperCollider/
// downloaded-quarks inside the sandbox whatever --quarks-dir says. Each
// pre-opened directory the host maps for quarks (--quarks-dir,
// --extra-class-path) is rewritten to its host path, so `git clone <url>
// <Quarks.folder>/x` lands in --quarks-dir. Spaces are escaped, as the guest's
// formatPathForCmdLine does.
static std::vector<std::pair<std::string, std::string>> g_host_cmd_dirs; // guest, host

static bool is_path_char(char c) {
    return std::isalnum((unsigned char)c) || c == '.' || c == '_' || c == '-';
}

static std::string host_command(const char* cmd, int32_t len) {
    std::string command(cmd, len);
    for (const auto& [guest, host] : g_host_cmd_dirs) {
        std::string escaped;
        for (char c : host) {
            if (c == ' ') escaped += '\\';
            escaped += c;
        }
        size_t pos = 0;
        while ((pos = command.find(guest, pos)) != std::string::npos) {
            size_t end = pos + guest.size();
            // Whole path components only: /a/b is not a prefix of /a/bc.
            if (end < command.size() && is_path_char(command[end])) {
                pos = end;
                continue;
            }
            command.replace(pos, guest.size(), escaped);
            pos += escaped.size();
        }
    }
    return command;
}

static int32_t hc_host_exec_impl(wasm_exec_env_t /*env*/,
                                  const char* cmd, int32_t len) {
    if (!cmd || len <= 0) {
        return -1;
    }
    std::string command = host_command(cmd, len);
    return ::system(command.c_str());
}

// hc_host_exec_capture: run a shell command, capture stdout.
// Returns exit code. Output is written to the buffer at out_ptr (max out_len bytes).
// Actual bytes written (excluding null terminator) is stored at bytes_written_ptr.
static int32_t hc_host_exec_capture_impl(wasm_exec_env_t /*env*/,
                                          const char* cmd, int32_t len,
                                          char* out_ptr, int32_t out_len,
                                          int32_t* bytes_written_ptr) {
    if (!cmd || len <= 0 || !out_ptr || out_len <= 0 || !bytes_written_ptr) {
        return -1;
    }

    std::string command = host_command(cmd, len);

    // Use popen to capture stdout
    FILE* pipe = hc_popen(command.c_str(), "r");
    if (!pipe) {
        return -1;
    }

    int bytes_written = 0;
    char buffer[256];
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
        size_t chunk_len = strlen(buffer);
        if (bytes_written + (int)chunk_len >= out_len) {
            // Not enough space, truncate
            chunk_len = out_len - bytes_written - 1;
            if (chunk_len <= 0) break;
        }
        memcpy(out_ptr + bytes_written, buffer, chunk_len);
        bytes_written += chunk_len;
    }

    int exit_code = hc_pclose_exit_code(pipe);

    // Null-terminate the output
    if (bytes_written < out_len) {
        out_ptr[bytes_written] = '\0';
    } else {
        out_ptr[out_len - 1] = '\0';
        bytes_written = out_len - 1;
    }

    *bytes_written_ptr = bytes_written;
    return exit_code; // -1 when it did not exit normally
}

static void install_sigint_handler() {
    // A Ctrl-C at the prompt interrupts linenoise's read(); the interrupt
    // flag is still set, but linenoise just bails out and the REPL re-prompts.
    hc_install_sigint_handler(sigint_handler);
}

// ---------------------------------------------------------------------------
// invoke_* trampoline implementations
//
// Emscripten compiles longjmp support via invoke_* wrappers.  Each
// invoke_X(funcIdx, arg0, ...) call should:
//   1. Call the WASM function table entry at funcIdx with the remaining args.
//   2. Return whatever the function returned (or void).
//
// We implement this via wasm_runtime_call_indirect which looks up the
// function table element by index and dispatches it correctly.
// i64 args are packed as two consecutive uint32_t values (lo, hi) in argv.
// ---------------------------------------------------------------------------

// invoke_vii  (i32, i32, i32) -> nil
static void invoke_vii_impl(wasm_exec_env_t env, int32_t idx,
                             int32_t a0, int32_t a1) {
    uint32_t argv[2] = { (uint32_t)a0, (uint32_t)a1 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 2, argv);
}
// invoke_vi   (i32, i32) -> nil
static void invoke_vi_impl(wasm_exec_env_t env, int32_t idx, int32_t a0) {
    uint32_t argv[1] = { (uint32_t)a0 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 1, argv);
}
// invoke_i    (i32) -> i32   (added when hc_host_poll_interrupt — () -> i32 —
// got called from within a setjmp scope, causing Emscripten to emit a
// matching invoke_* trampoline import)
static int32_t invoke_i_impl(wasm_exec_env_t env, int32_t idx) {
    uint32_t argv[1] = { 0 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 0, argv);
    return (int32_t)argv[0];
}
// invoke_ii   (i32, i32) -> i32
static int32_t invoke_ii_impl(wasm_exec_env_t env, int32_t idx, int32_t a0) {
    uint32_t argv[1] = { (uint32_t)a0 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 1, argv);
    return (int32_t)argv[0];
}
// invoke_iii  (i32, i32, i32) -> i32
static int32_t invoke_iii_impl(wasm_exec_env_t env, int32_t idx,
                                int32_t a0, int32_t a1) {
    uint32_t argv[2] = { (uint32_t)a0, (uint32_t)a1 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 2, argv);
    return (int32_t)argv[0];
}
// invoke_iiii (i32, i32, i32, i32) -> i32
static int32_t invoke_iiii_impl(wasm_exec_env_t env, int32_t idx,
                                 int32_t a0, int32_t a1, int32_t a2) {
    uint32_t argv[3] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 3, argv);
    return (int32_t)argv[0];
}
// invoke_viii (i32, i32, i32, i32) -> nil
static void invoke_viii_impl(wasm_exec_env_t env, int32_t idx,
                              int32_t a0, int32_t a1, int32_t a2) {
    uint32_t argv[3] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 3, argv);
}
// invoke_viiii (i32, i32, i32, i32, i32) -> nil
static void invoke_viiii_impl(wasm_exec_env_t env, int32_t idx,
                               int32_t a0, int32_t a1, int32_t a2, int32_t a3) {
    uint32_t argv[4] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2, (uint32_t)a3 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 4, argv);
}
// invoke_viiiii (i32, i32, i32, i32, i32, i32) -> nil
static void invoke_viiiii_impl(wasm_exec_env_t env, int32_t idx,
                                int32_t a0, int32_t a1, int32_t a2,
                                int32_t a3, int32_t a4) {
    uint32_t argv[5] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2,
                         (uint32_t)a3, (uint32_t)a4 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 5, argv);
}
// invoke_iiijji (i32, i32, i32, i64, i64, i32) -> i32
// i64 is packed as lo/hi uint32 pairs
static int32_t invoke_iiijji_impl(wasm_exec_env_t env, int32_t idx,
                                   int32_t a0, int32_t a1,
                                   int64_t a2, int64_t a3, int32_t a4) {
    uint32_t argv[7] = {
        (uint32_t)a0, (uint32_t)a1,
        (uint32_t)(uint64_t)a2, (uint32_t)((uint64_t)a2 >> 32),
        (uint32_t)(uint64_t)a3, (uint32_t)((uint64_t)a3 >> 32),
        (uint32_t)a4
    };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 7, argv);
    return (int32_t)argv[0];
}
// invoke_viijj (i32, i32, i32, i64, i64) -> nil
static void invoke_viijj_impl(wasm_exec_env_t env, int32_t idx,
                               int32_t a0, int32_t a1,
                               int64_t a2, int64_t a3) {
    uint32_t argv[6] = {
        (uint32_t)a0, (uint32_t)a1,
        (uint32_t)(uint64_t)a2, (uint32_t)((uint64_t)a2 >> 32),
        (uint32_t)(uint64_t)a3, (uint32_t)((uint64_t)a3 >> 32)
    };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 6, argv);
}
// invoke_iiiijj (i32, i32, i32, i32, i64, i64) -> i32, counting the table
// index: the name is the return type then the callee's params, i i i j j.
// The C parameters must match the registered "(iiiiII)i" one for one -- an
// extra int32 here shifts every argument after it, and on x86-64 the last
// one is then read from whatever is on the stack (the callee, keywordFixStack,
// got a garbage key-argument count, which faulted only for some environment
// sizes).
static int32_t invoke_iiiijj_impl(wasm_exec_env_t env, int32_t idx,
                                   int32_t a0, int32_t a1, int32_t a2,
                                   int64_t a3, int64_t a4) {
    uint32_t argv[7] = {
        (uint32_t)a0, (uint32_t)a1, (uint32_t)a2,
        (uint32_t)(uint64_t)a3, (uint32_t)((uint64_t)a3 >> 32),
        (uint32_t)(uint64_t)a4, (uint32_t)((uint64_t)a4 >> 32)
    };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 7, argv);
    return (int32_t)argv[0];
}

// Emscripten __syscall_* stubs — Emscripten musl wraps the return through
// __syscall_ret(), which interprets values in (-4096, 0) as -errno. Always
// return -ENOSYS (-52 in Emscripten WASI errno) so callers see ENOSYS rather
// than the misleading EPERM/E2BIG that a literal -1 produces.
//
// __syscall_getcwd is special: the C library treats a missing CWD as a fatal
// error (e.g. std::filesystem::current_path() throws filesystem_error), so we
// return a synthetic "/" instead of -ENOSYS. WASI doesn't expose a real CWD.
static constexpr int32_t WASI_ENOSYS = -52; // __WASI_ERRNO_NOSYS
static int32_t __syscall_getcwd_impl(wasm_exec_env_t env, int32_t buf, int32_t size) {
    if (size < 2) return -68; // __WASI_ERRNO_RANGE
    wasm_module_inst_t inst = wasm_runtime_get_module_inst(env);
    char* native_buf = (char*)wasm_runtime_addr_app_to_native(inst, buf);
    if (!native_buf) return -21; // __WASI_ERRNO_FAULT
    native_buf[0] = '/';
    native_buf[1] = '\0';
    return 2; // length including null terminator
}
static int32_t __syscall_chmod_impl(wasm_exec_env_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_pipe2_impl(wasm_exec_env_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_getdents64_impl(wasm_exec_env_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_poll_impl(wasm_exec_env_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_readlinkat_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_socket_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_bind_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_recvfrom_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_getsockopt_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_connect_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_getpeername_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_getsockname_impl(wasm_exec_env_t, int32_t, int32_t, int32_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }

// WAMR native symbol table — registered before wasm_runtime_load()
static NativeSymbol hc_native_symbols[] = {
    { "hc_host_post",                    (void*)hc_host_post_impl,                    "(*i)"      },
    { "hc_host_error",                   (void*)hc_host_error_impl,                   "(*i)"      },
    { "emscripten_notify_memory_growth",       (void*)emscripten_notify_memory_growth_impl,       "(i)"  },
    { "_emscripten_fs_load_embedded_files",    (void*)emscripten_fs_load_embedded_files_impl,     "(i)"  },
    { "sc_wasm_forward_osc_js",          (void*)sc_wasm_forward_osc_js_impl,          "(ii)i"     },
    { "_emscripten_throw_longjmp",       (void*)emscripten_throw_longjmp_impl,        "()"        },
    { "hc_host_poll_interrupt",          (void*)hc_host_poll_interrupt_impl,          "()i"       },
    // Quarks CLI: Host execution functions
    { "hc_host_exec",                    (void*)hc_host_exec_impl,                    "(*i)i"     },
    // (cmd, cmd_len, out, out_len, bytes_written): "*~" is a buffer and its
    // length, translated and bounds-checked; a bare "i" would hand the C side
    // a guest offset where it expects a pointer.
    { "hc_host_exec_capture",            (void*)hc_host_exec_capture_impl,            "(*~*~*)i"   },
    // invoke_* trampolines — dispatch through WASM function table
    { "invoke_vii",    (void*)invoke_vii_impl,    "(iii)"     },
    { "invoke_vi",     (void*)invoke_vi_impl,     "(ii)"      },
    { "invoke_i",      (void*)invoke_i_impl,      "(i)i"      },
    { "invoke_ii",     (void*)invoke_ii_impl,     "(ii)i"     },
    { "invoke_iii",    (void*)invoke_iii_impl,    "(iii)i"    },
    { "invoke_iiii",   (void*)invoke_iiii_impl,   "(iiii)i"   },
    { "invoke_viii",   (void*)invoke_viii_impl,   "(iiii)"    },
    { "invoke_viiii",  (void*)invoke_viiii_impl,  "(iiiii)"   },
    { "invoke_viiiii", (void*)invoke_viiiii_impl, "(iiiiii)"  },
    { "invoke_iiijji", (void*)invoke_iiijji_impl, "(iiiIIi)i" },
    { "invoke_viijj",  (void*)invoke_viijj_impl,  "(iiiII)"   },
    { "invoke_iiiijj", (void*)invoke_iiiijj_impl, "(iiiiII)i" },
    // __syscall_* stubs — Emscripten STANDALONE_WASM OS-level calls not covered by WASI
    { "__syscall_getcwd",      (void*)__syscall_getcwd_impl,      "(ii)i"     },
    { "__syscall_chmod",       (void*)__syscall_chmod_impl,       "(ii)i"     },
    { "__syscall_pipe2",       (void*)__syscall_pipe2_impl,       "(ii)i"     },
    { "__syscall_getdents64",  (void*)__syscall_getdents64_impl,  "(iii)i"    },
    { "__syscall_poll",        (void*)__syscall_poll_impl,        "(iii)i"    },
    { "__syscall_readlinkat",  (void*)__syscall_readlinkat_impl,  "(iiii)i"   },
    { "__syscall_socket",      (void*)__syscall_socket_impl,      "(iiiiii)i" },
    { "__syscall_bind",        (void*)__syscall_bind_impl,        "(iiiiii)i" },
    { "__syscall_recvfrom",    (void*)__syscall_recvfrom_impl,    "(iiiiii)i" },
    { "__syscall_getsockopt",  (void*)__syscall_getsockopt_impl,  "(iiiiii)i" },
    { "__syscall_connect",     (void*)__syscall_connect_impl,     "(iiiiii)i" },
    { "__syscall_getpeername", (void*)__syscall_getpeername_impl, "(iiiiii)i" },
    { "__syscall_getsockname", (void*)__syscall_getsockname_impl, "(iiiiii)i" },
};

static void register_host_functions() {
    uint32_t n = sizeof(hc_native_symbols) / sizeof(NativeSymbol);
    if (!wasm_runtime_register_natives("env", hc_native_symbols, n)) {
        fprintf(stderr, "Warning: failed to register native host functions\n");
    }
}

// ---------------------------------------------------------------------------
// Class library pack extraction (Phase 9 self-contained mode)
//
// Mirrors the parser in engine/HC_Wasm_Eval.cpp::wasm_classlib_preload_buffer.
// The pack is a single binary with magic header + count + per-entry
// {pathLen, contentLen, path, content} tuples. This walks the pack on the
// host side and materialises every entry as a real file under <out_dir>,
// stripping the MEMFS prefix so the resulting tree is suitable for a WASI
// pre-open (as if --classlib-dir pointed at it).
// ---------------------------------------------------------------------------
static constexpr uint8_t HC_PACK_MAGIC[8] = {
    'S','C','C','L','P','K','\x01','\n'
};

static bool make_dirs(const std::string& path) {
    // Create the leading directory of `path`, parents included.
    fs::path parent = fs::path(path).parent_path();
    if (parent.empty()) return true;
    std::error_code ec;
    fs::create_directories(parent, ec);
    return !ec;
}

// A new, empty directory under the system temp directory, named
// <prefix><random>; empty when none could be made.
static std::string make_temp_dir(const char* prefix) {
    std::error_code ec;
    fs::path base = fs::temp_directory_path(ec);
    if (ec) return "";
    std::random_device rd;
    for (int attempt = 0; attempt < 16; ++attempt) {
        char suffix[17];
        snprintf(suffix, sizeof(suffix), "%08x%08x", rd(), rd());
        fs::path dir = base / (std::string(prefix) + suffix);
        if (fs::create_directory(dir, ec) && !ec) return dir.string();
    }
    return "";
}

// Extract a pack to <out_dir>, treating <memfs_prefix> as a virtual root —
// any entry path that starts with the prefix becomes a relative file under
// out_dir. Other entries are skipped (most packs only contain prefixed
// entries, but we don't trust the input). Returns the number of files
// written, or -1 on parse error.
static int extract_pack(const uint8_t* buf, size_t len,
                        const char* out_dir,
                        const char* memfs_prefix) {
    if (len < 12 || memcmp(buf, HC_PACK_MAGIC, 8) != 0) return -1;
    auto read_u32 = [](const uint8_t* p) -> uint32_t {
        return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
               ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
    };
    size_t pos = 8;
    uint32_t count = read_u32(buf + pos); pos += 4;
    size_t prefix_len = strlen(memfs_prefix);
    int written = 0;
    for (uint32_t i = 0; i < count; ++i) {
        if (pos + 8 > len) return -1;
        uint32_t pathLen    = read_u32(buf + pos); pos += 4;
        uint32_t contentLen = read_u32(buf + pos); pos += 4;
        if (pos + pathLen + contentLen > len) return -1;
        std::string memfs_path((const char*)(buf + pos), pathLen); pos += pathLen;
        const uint8_t* content = buf + pos; pos += contentLen;
        if (memfs_path.size() <= prefix_len + 1
            || memcmp(memfs_path.data(), memfs_prefix, prefix_len) != 0
            || memfs_path[prefix_len] != '/') {
            continue;
        }
        std::string out_path = std::string(out_dir) + memfs_path.substr(prefix_len);
        make_dirs(out_path);
        FILE* f = fopen(out_path.c_str(), "wb");
        if (!f) continue;
        fwrite(content, 1, contentLen, f);
        fclose(f);
        ++written;
    }
    return written;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
static std::string read_file(const std::string& path) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return "";
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size <= 0) { fclose(f); return ""; }
    std::string content(static_cast<size_t>(size), '\0');
    fread(&content[0], 1, static_cast<size_t>(size), f);
    fclose(f);
    return content;
}

// ---------------------------------------------------------------------------
// SCSCM support (Phase H3)
// ---------------------------------------------------------------------------

static std::string detect_lang_from_filename(const std::string& path) {
    if (path.size() >= 6 && path.substr(path.size() - 6) == ".scscm") {
        return "scscm";
    }
    return "scd";
}

static std::string compile_scscm_to_sclang(const std::string& scscm_code,
                                          const std::string& filename,
                                          bool debug_output) {
    // For Phase H3, we'll use a subprocess call to node cli/lhc.js
    // This is the contingency approach (4a) mentioned in the plan.
    // The preferred approach (4b) would be to bundle the compiler as WASM.
    
    // The scscm code goes through a temp file in a directory of its own.
    // (This used to be mkstemp("/tmp/hclang_scscm_XXXXXX.scscm"), which
    // fails: mkstemp needs the template to end in XXXXXX.)
    std::string temp_dir = make_temp_dir("hclang_scscm_");
    if (temp_dir.empty()) {
        fprintf(stderr, "Failed to create temp file for scscm compilation\n");
        return "";
    }
    const std::string temp_file = (fs::path(temp_dir) / "input.scscm").string();
    auto remove_temp = [&temp_dir]() {
        std::error_code ec;
        fs::remove_all(temp_dir, ec);
    };
    {
        std::ofstream out(temp_file, std::ios::binary);
        out.write(scscm_code.data(), (std::streamsize)scscm_code.size());
        if (!out) {
            fprintf(stderr, "Failed to write scscm code to temp file\n");
            remove_temp();
            return "";
        }
    }

    // Build the command: lhc.js, relative to the working directory.
    std::string cmd = "node ./cli/lhc.js \"";
    cmd += temp_file;
    cmd += "\"";

    // Open a pipe to capture the output
    FILE* pipe = hc_popen(cmd.c_str(), "r");
    if (!pipe) {
        fprintf(stderr, "Failed to run scscm compiler: %s\n", strerror(errno));
        remove_temp();
        return "";
    }
    
    // Read the output
    std::string sclang_code;
    char buffer[4096];
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
        sclang_code += buffer;
    }
    
    int status = hc_pclose_exit_code(pipe);

    // Clean up temp file
    remove_temp();
    
    if (status != 0) {
        fprintf(stderr, "scscm compilation failed with exit code %d\n", status);
        return "";
    }
    
    // Write debug output if requested
    if (debug_output) {
        std::string debug_path = filename + ".compiled.sc";
        FILE* debug_f = fopen(debug_path.c_str(), "w");
        if (debug_f) {
            fwrite(sclang_code.c_str(), 1, sclang_code.size(), debug_f);
            fclose(debug_f);
            fprintf(stdout, "[scscm] Debug output written to %s\n", debug_path.c_str());
        }
    }
    
    return sclang_code;
}

// ---------------------------------------------------------------------------
// REPL loop (linenoise)
//
// Phase 11 polish:
//   - Multi-line input: track unbalanced ( ) [ ] { } and string quotes
//     across input lines; only dispatch when the buffered text is
//     syntactically self-contained.
//   - History at $HOME/.hclang_history (was CWD).
//   - Quote-aware skip so e.g. `"foo)"` doesn't open a paren.
//
// `exit` (typed alone on a line) breaks the loop. Empty lines just
// re-prompt unless we're mid-expression, in which case they extend the
// buffer with a newline.
// ---------------------------------------------------------------------------

// Returns true if the buffered SC source is "complete enough" to dispatch.
// Tracks paren/bracket/brace depth and string state (single line strings
// only — SC does support multi-line strings via "..\n..", same rule).
static bool repl_input_is_complete(const std::string& buf) {
    int depth = 0;
    bool in_str = false;
    bool in_sym = false;        // \'foo bar\' style
    bool in_line_comment = false;
    bool in_block_comment = false;
    char prev = 0;
    for (size_t i = 0; i < buf.size(); ++i) {
        char c = buf[i];
        if (in_line_comment) {
            if (c == '\n') in_line_comment = false;
        } else if (in_block_comment) {
            if (prev == '*' && c == '/') in_block_comment = false;
        } else if (in_str) {
            if (c == '\\' && i + 1 < buf.size()) { ++i; }
            else if (c == '"') in_str = false;
        } else if (in_sym) {
            if (c == '\'') in_sym = false;
        } else {
            if (prev == '/' && c == '/') { in_line_comment = true; --depth; /* undo earlier '/' */ continue; }
            if (prev == '/' && c == '*') { in_block_comment = true; continue; }
            switch (c) {
                case '(': case '[': case '{': ++depth; break;
                case ')': case ']': case '}': --depth; break;
                case '"': in_str = true; break;
                case '\'': in_sym = true; break;
                default: break;
            }
        }
        prev = c;
    }
    return !in_str && !in_sym && !in_block_comment && depth <= 0;
}

static std::string history_file_path() {
    std::string home = hc_home_dir();
    if (home.empty())
        return ".hclang_history";
    return (fs::path(home) / ".hclang_history").string();
}

static void repl_dispatch(const std::string& code) {
    if (code.empty()) return;
    
    // Phase H3: Handle mode toggle commands
    std::string trimmed = code;
    // Trim whitespace
    size_t start = trimmed.find_first_not_of(" \t");
    if (start != std::string::npos) {
        size_t end = trimmed.find_last_not_of(" \t\n\r");
        trimmed = trimmed.substr(start, end - start + 1);
    }
    
    if (trimmed == ".scscm") {
        g_repl_scscm_mode = true;
        printf("Switched to scscm mode. Enter scscm code to compile and evaluate.\n");
        printf("Type '.sc' to return to sclang mode.\n");
        return;
    }
    if (trimmed == ".sc") {
        g_repl_scscm_mode = false;
        printf("Switched to sclang mode.\n");
        return;
    }
    
    // Compile scscm to sclang if in scscm mode
    std::string code_to_eval = code;
    if (g_repl_scscm_mode) {
        code_to_eval = compile_scscm_to_sclang(code, "<repl>", false);
        if (code_to_eval.empty()) {
            fprintf(stderr, "scscm compilation failed\n");
            return;
        }
    }
    
    auto     len    = static_cast<uint32_t>(code_to_eval.size() + 1);
    void*    native = nullptr;
    uint32_t wptr   = g_wasm_host.wasm_malloc(len, &native);
    if (!wptr) return;
    memcpy(native, code_to_eval.c_str(), len);
    wasm_val_t res[1]{};
    g_wasm_host.call("hc_wasm_eval_string", 1, res,
                     wptr, (int32_t)(len - 1));
    g_wasm_host.wasm_free(wptr);
}

static void repl_loop() {
    linenoiseSetMultiLine(1);
    std::string hist_path = history_file_path();
    linenoiseHistoryLoad(hist_path.c_str());
    printf("hclang WASM REPL — type 'exit' to quit, Ctrl-C to abort line.\n");

    std::string buffer;
    const char* prompt = "hclang> ";
    while (true) {
        char* line = linenoise(prompt);
        if (!line) {
            // EOF (Ctrl-D) or read error — exit cleanly.
            printf("\n");
            break;
        }
        if (buffer.empty() && strcmp(line, "exit") == 0) {
            linenoiseFree(line);
            break;
        }
        if (buffer.empty() && strlen(line) == 0) {
            linenoiseFree(line);
            continue;
        }
        if (!buffer.empty()) buffer += '\n';
        buffer += line;
        linenoiseFree(line);

        if (!repl_input_is_complete(buffer)) {
            // Switch to a continuation prompt and keep reading.
            prompt = "    ... ";
            continue;
        }

        linenoiseHistoryAdd(buffer.c_str());
        repl_dispatch(buffer);
        buffer.clear();
        prompt = "hclang> ";
    }
    linenoiseHistorySave(hist_path.c_str());
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main(int argc, char** argv) {
    struct Options {
        std::string script_file;
        std::string output_file;
        bool        repl          = false;
        std::string scsynth_host;
        int         scsynth_port  = 0;
        int         verbosity     = 0;
        // Host path of the SC class library, mounted at the WASM-side path
        // /usr/share/SuperCollider/SCClassLibrary via WASI pre-open.
        std::string classlib_dir;
        // Optional path to hclang_classlib.pack (Phase 3.3 fast path). If
        // set, the host loads the file and hands the bytes to
        // hc_wasm_classlib_preload_bytes before init, skipping ~200 WASI
        // path_open round-trips during compileLibrary.
        std::string classlib_pack;
        // When ON, ignore the embedded WASM blob (if any) and load
        // hclang.{aot,wasm} from CWD. Lets the wamr-aot bench row exercise
        // the on-disk .aot file. Also honoured via HC_WASM_FROM_DISK env var.
        bool        wasm_from_disk = false;
        // When ON, fake `Server.default` into thinking it's booted so SC
        // patches that use `{...}.play` work in the wamr-full pipeline
        // without a /done/notify handshake. Also points Server.default's
        // addr at --scsynth-host/--scsynth-port. Phase 12.4b.
        bool        no_server_boot = false;
        std::string lang = "auto"; // auto, scd, scscm
        bool        scscm_debug = false;
        // Quarks CLI: Host path to quarks directory, pre-opened at
        // /home/user/.local/share/SuperCollider/downloaded-quarks in WASI.
        std::string quarks_dir;
        // Quarks CLI: Additional class library paths to search.
        // Each path is pre-opened at /extra-class-lib/<index>/<basename> in WASI.
        std::vector<std::string> extra_class_paths;
    } opts;

    CLI::App app("hclang - HyperCollider language native WASM host\n\n"
                 "Supports .scd (sclang) and .scscm (scscm) files.\n"
                 "Use --lang to force language, or .scscm/.sc in REPL.");
    app.add_option("--script,-s",    opts.script_file,  "SC code file to evaluate");
    app.add_option("--output,-o",    opts.output_file,  "Output WAV (for offline render)");
    app.add_flag  ("--repl",         opts.repl,         "Start interactive REPL");
    app.add_option("--scsynth-host", opts.scsynth_host, "scsynth host for OSC forwarding");
    app.add_option("--scsynth-port", opts.scsynth_port, "scsynth port for OSC forwarding");
    app.add_option("--classlib-dir,-l", opts.classlib_dir,
                                     "Path to SC class library on host");
    app.add_option("--classlib-pack,-p", opts.classlib_pack,
                                     "Path to hclang_classlib.pack (fast-path "
                                     "alternative to scanning --classlib-dir)");
    app.add_flag  ("--wasm-from-disk", opts.wasm_from_disk,
                                     "Skip the embedded WASM blob; load "
                                     "hclang.{aot,wasm} from CWD. Also "
                                     "honoured via HC_WASM_FROM_DISK=1.");
    // Quarks CLI options
    app.add_option("--quarks-dir,-q", opts.quarks_dir,
                                     "Path to SuperCollider Quarks directory on host. "
                                     "Mounted at /home/user/.local/share/SuperCollider/downloaded-quarks in WASI.");
    app.add_option("--extra-class-path", opts.extra_class_paths,
                                     "Additional class library path to search. "
                                     "Can be specified multiple times. "
                                     "Mounted at /extra-class-lib/<n>/<basename> in WASI.");
    app.add_flag  ("--no-server-boot", opts.no_server_boot,
                                     "Fake Server.default into 'booted' "
                                     "state and point its addr at "
                                     "--scsynth-host/-port. Lets `{...}.play` "
                                     "work in the wamr-full pipeline.");
    app.add_option("--lang", opts.lang,              "Force input language: auto, scd, or scscm");
    app.add_flag  ("--scscm-debug", opts.scscm_debug,  "Write compiled sclang to .compiled.sc");
    app.add_option("-v,--verbose",   opts.verbosity,    "Verbosity level");
    CLI11_PARSE(app, argc, argv);

    // 0.4 Line-buffer stdout/stderr. Without this, redirecting hclang_native
    // output to a file (or pipe) switches stdio to block buffering — script
    // posts wouldn't appear until the buffer fills (~4 KB) or the process
    // exits. Line buffering preserves the terminal-like behaviour the user
    // expects when they run e.g. `./hclang_native --script foo.scd | tee log`.
#ifdef _WIN32
    // The MSVC CRT has no line buffering (_IOLBF is full buffering there) and
    // rejects a size of 0 for it, so it is unbuffered.
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
#else
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IOLBF, 0);
#endif

    // 0.5 Open OSC forwarding socket if scsynth target is configured.
    if (!opts.scsynth_host.empty() && opts.scsynth_port > 0) {
        if (!hc_sockets_init()) {
            fprintf(stderr, "Failed to initialise sockets\n");
            return 1;
        }
        g_osc_socket = socket(AF_INET, SOCK_DGRAM, 0);
        if (g_osc_socket == HC_INVALID_SOCKET) {
            fprintf(stderr, "Failed to open OSC socket: %s\n", strerror(errno));
            return 1;
        }
        g_osc_addr.sin_family = AF_INET;
        g_osc_addr.sin_port   = htons((uint16_t)opts.scsynth_port);
        if (inet_pton(AF_INET, opts.scsynth_host.c_str(),
                      &g_osc_addr.sin_addr) != 1) {
            fprintf(stderr, "Invalid scsynth host address: %s\n",
                    opts.scsynth_host.c_str());
            return 1;
        }
        fprintf(stderr, "OSC forwarding to %s:%d\n",
                opts.scsynth_host.c_str(), opts.scsynth_port);
    }

    // ── Host-stage timing ────────────────────────────────────────────────
    // When -v 1 is set, print one line per major boot stage to stderr so
    // diagnostic tools (and docs/WAMR_PERF_PARITY_PLAN.md) can attribute
    // each ms of cold-start. Cheap monotonic clock; no allocations on
    // the hot path.
    auto t_now = []() {
        return std::chrono::steady_clock::now();
    };
    auto t_start = t_now();
    auto t_prev  = t_start;
    auto stage = [&](const char* name) {
        if (opts.verbosity < 1) { t_prev = t_now(); return; }
        auto now = t_now();
        auto dur = std::chrono::duration_cast<std::chrono::milliseconds>(
                       now - t_prev).count();
        auto since_start = std::chrono::duration_cast<std::chrono::milliseconds>(
                       now - t_start).count();
        fprintf(stderr, "[stage] %-22s %5lld ms (cumulative %5lld ms)\n",
                name, (long long)dur, (long long)since_start);
        t_prev = now;
    };

    // 1. Init WAMR runtime
    if (!g_wasm_host.init()) {
        fprintf(stderr, "Failed to initialize WASM host: %s\n",
                g_wasm_host.get_error().c_str());
        return 1;
    }
    stage("wamr_init");

    // 2. Register native host functions BEFORE loading the module
    register_host_functions();

    // 2.5 Install SIGINT handler. Doing this AFTER the host functions are
    // registered so that as soon as Ctrl-C is possible, the WASM-side poll
    // is wired up to drain it.
    install_sigint_handler();
    stage("register_natives");

    // 3. Load WASM (or AOT) module. WAMR's wasm_runtime_load auto-detects
    // format via magic bytes; the host picks between three sources:
    //   1. embedded blob (default when HC_EMBED_WASM=1 at build time)
    //   2. on-disk hclang.{aot,wasm} when --wasm-from-disk or
    //      HC_WASM_FROM_DISK=1 is set, or when no embed is available
    //   3. fallback to disk if loading the embedded blob fails
    const bool prefer_disk = opts.wasm_from_disk
        || (getenv("HC_WASM_FROM_DISK") != nullptr);
    bool loaded = false;
#ifdef HC_EMBEDDED_WASM
    if (!prefer_disk) {
        if (!g_wasm_host.load(hclang_wasm_blob,
                              static_cast<uint32_t>(hclang_wasm_blob_len),
                              "hclang")) {
            fprintf(stderr, "Failed to load embedded WASM: %s\n",
                    g_wasm_host.get_error().c_str());
            return 1;
        }
        if (opts.verbosity > 0) {
            fprintf(stderr, "Loaded module: <embedded hclang.wasm>\n");
        }
        loaded = true;
    }
#endif
    if (!loaded) {
        // Try hclang.aot first if present. If load fails (e.g. binary
        // built without WAMR_BUILD_AOT=1), fall back to .wasm rather than
        // erroring out — lets the wamr-aot bench gracefully degrade on
        // hosts that don't support AOT.
        bool aot_present = false;
        if (FILE* f = fopen("hclang.aot", "rb")) {
            fclose(f); aot_present = true;
        }
        if (aot_present && g_wasm_host.load_file("hclang.aot", "hclang")) {
            if (opts.verbosity > 0) {
                fprintf(stderr, "Loaded module: hclang.aot\n");
            }
        } else {
            if (aot_present && opts.verbosity > 0) {
                fprintf(stderr, "hclang.aot load failed (%s); falling back to hclang.wasm\n",
                        g_wasm_host.get_error().c_str());
            }
            if (!g_wasm_host.load_file("hclang.wasm", "hclang")) {
                fprintf(stderr, "Failed to load WASM from hclang.wasm: %s\n",
                        g_wasm_host.get_error().c_str());
                return 1;
            }
            if (opts.verbosity > 0) {
                fprintf(stderr, "Loaded module: hclang.wasm\n");
            }
        }
    }

    stage("wasm_load");

    // 3.5 Register WASI pre-opens for the SC class library.
    //
    // Source priority:
    //   1. --classlib-dir <path>           (explicit on-disk classlib)
    //   2. embedded pack → temp dir       (Phase 9 self-contained mode)
    //
    // Without one of these, passOne_ProcessDir's recursive_directory_iterator
    // can't enumerate any SC files and the class library compile produces
    // an empty bytecode table.
    std::string classlib_temp_dir; // owned cleanup at exit
    if (!opts.classlib_dir.empty()) {
        // Validate the user-supplied path before WAMR boot. Bad paths
        // surface much later as opaque "class extension for nonexistent
        // class" errors that look like compiler bugs.
        std::error_code ec;
        fs::file_status st = fs::status(opts.classlib_dir, ec);
        if (ec || !fs::exists(st)) {
            fprintf(stderr,
                "ERROR: --classlib-dir '%s' does not exist (%s).\n"
                "  Pass a path to a SuperCollider SCClassLibrary directory,\n"
                "  or omit --classlib-dir to use the embedded pack.\n",
                opts.classlib_dir.c_str(),
                ec ? ec.message().c_str() : "No such file or directory");
            return 1;
        }
        if (!fs::is_directory(st)) {
            fprintf(stderr,
                "ERROR: --classlib-dir '%s' is not a directory.\n",
                opts.classlib_dir.c_str());
            return 1;
        }
        // Check the directory contains at least one .sc file (recursive
        // single-level scan; cheap enough). An empty dir would let WAMR
        // boot but produce zero compiled classes.
        bool found_sc = false;
        for (fs::directory_iterator it(opts.classlib_dir, ec), end; !ec && it != end;
             it.increment(ec)) {
            const std::string name = it->path().filename().string();
            auto ends_with = [&name](const char* suffix) {
                const size_t n = strlen(suffix);
                return name.size() >= n && name.compare(name.size() - n, n, suffix) == 0;
            };
            if (ends_with(".sc") || ends_with(".sc.in")) {
                found_sc = true;
                break;
            }
            // Allow nested layout (Common/, Platform/, etc.); don't recurse,
            // just trust that any subdir is enough signal.
            std::error_code dir_ec;
            if (!name.empty() && name[0] != '.' && it->is_directory(dir_ec)) {
                found_sc = true;
                break;
            }
        }
        if (!found_sc) {
            fprintf(stderr,
                "ERROR: --classlib-dir '%s' contains no .sc files or subdirs.\n"
                "  Expected a SuperCollider SCClassLibrary tree (Common/, Platform/, ...).\n",
                opts.classlib_dir.c_str());
            return 1;
        }
        if (opts.verbosity > 0) {
            fprintf(stderr,
                "Using --classlib-dir %s%s\n",
                opts.classlib_dir.c_str(),
#ifdef HC_EMBEDDED_CLASSLIB_PACK
                " (overriding embedded pack)"
#else
                ""
#endif
            );
        }
    } else {
#ifdef HC_EMBEDDED_CLASSLIB_PACK
        classlib_temp_dir = make_temp_dir("hclang_classlib_");
        if (classlib_temp_dir.empty()) {
            fprintf(stderr, "Failed to create temp dir for embedded classlib\n");
            return 1;
        }
        int n = extract_pack(hclang_classlib_pack_blob,
                             hclang_classlib_pack_blob_len,
                             classlib_temp_dir.c_str(),
                             "/usr/share/SuperCollider/SCClassLibrary");
        if (n < 0) {
            fprintf(stderr, "Failed to extract embedded classlib pack\n");
            return 1;
        }
        opts.classlib_dir = classlib_temp_dir;
        if (opts.verbosity > 0) {
            fprintf(stderr, "Extracted embedded classlib (%d files) → %s\n",
                    n, classlib_temp_dir.c_str());
        }
#else
        fprintf(stderr,
            "No --classlib-dir given and no embedded pack available.\n"
            "Either pass --classlib-dir <path-to-SCClassLibrary>, or rebuild\n"
            "with HC_EMBED_WASM=ON.\n");
        return 1;
#endif
    }
    g_wasm_host.add_wasi_dir(opts.classlib_dir,
                             "/usr/share/SuperCollider/SCClassLibrary");

    // 3.6 Quarks CLI: WASI pre-open for quarks directory.
    // This allows SC's Quarks.folder (= Platform.userAppSupportDir ++ "downloaded-quarks")
    // to resolve to the host's quarks directory via the WASI pre-opened path.
    // Platform.userAppSupportDir returns /home/user/.local/share/SuperCollider in WASM.
    if (!opts.quarks_dir.empty()) {
        // Validate the user-supplied path
        std::error_code ec;
        fs::file_status st = fs::status(opts.quarks_dir, ec);
        if (ec || !fs::exists(st)) {
            fprintf(stderr,
                "WARNING: --quarks-dir '%s' does not exist (%s).\n",
                opts.quarks_dir.c_str(),
                ec ? ec.message().c_str() : "No such file or directory");
        } else if (!fs::is_directory(st)) {
            fprintf(stderr,
                "WARNING: --quarks-dir '%s' is not a directory.\n",
                opts.quarks_dir.c_str());
        } else {
            g_wasm_host.add_wasi_dir(opts.quarks_dir,
                                     "/home/user/.local/share/SuperCollider/downloaded-quarks");
            g_host_cmd_dirs.emplace_back("/home/user/.local/share/SuperCollider/downloaded-quarks",
                                         opts.quarks_dir);
            if (opts.verbosity > 0) {
                fprintf(stderr,
                    "Using --quarks-dir %s (mounted at /home/user/.local/share/SuperCollider/downloaded-quarks)\n",
                    opts.quarks_dir.c_str());
            }
        }
    }

    // 3.7 Quarks CLI: WASI pre-open for extra class paths.
    // Each extra path is pre-opened at /extra-class-lib/<index>/<basename>.
    for (size_t i = 0; i < opts.extra_class_paths.size(); ++i) {
        const std::string& host_path = opts.extra_class_paths[i];
        std::error_code ec;
        fs::file_status st = fs::status(host_path, ec);
        if (ec || !fs::exists(st)) {
            fprintf(stderr,
                "WARNING: --extra-class-path '%s' does not exist (%s). Skipping.\n",
                host_path.c_str(),
                ec ? ec.message().c_str() : "No such file or directory");
            continue;
        }
        if (!fs::is_directory(st)) {
            fprintf(stderr,
                "WARNING: --extra-class-path '%s' is not a directory. Skipping.\n",
                host_path.c_str());
            continue;
        }
        
        // Extract basename from path (C++17 filesystem would be cleaner but we avoid it here)
        size_t last_slash = host_path.find_last_of("/\\");
        std::string basename = (last_slash == std::string::npos) ? host_path : host_path.substr(last_slash + 1);
        std::string wasm_path = "/extra-class-lib/" + std::to_string(i) + "/" + basename;
        
        g_wasm_host.add_wasi_dir(host_path, wasm_path);
        g_host_cmd_dirs.emplace_back(wasm_path, host_path);
        if (opts.verbosity > 0) {
            fprintf(stderr, "Using --extra-class-path %s (mounted at %s)\n",
                    host_path.c_str(), wasm_path.c_str());
        }
    }

    // 4. Instantiate with generous stack + heap. The default 64 KB stack can
    // be insufficient for AOT mode where each WASM frame may use more
    // aux-stack space; bump to 1 MB. host_managed_heap is for the host's
    // own wasm_runtime_module_malloc allocations (the OSC dispatch path
    // in particular), separate from the WASM's internal malloc.
    //
    // AOT mode also pressurises SC's internal parser allocator (heavier
    // codegen, more stack frames in the recursive descent). Without
    // enough headroom the class-library compile aborts with "memory
    // exhausted" and a `filesystem_error` that traps under
    // -fno-exceptions. 256 MB host_managed_heap leaves room for both
    // the OSC dispatch path and the parser's bursts.
    if (!g_wasm_host.instantiate(1024u * 1024u, 256u * 1024u * 1024u)) {
        fprintf(stderr, "Failed to instantiate WASM: %s\n",
                g_wasm_host.get_error().c_str());
        return 1;
    }
    stage("instantiate");

    // 4.5 Run C++ static constructors.
    // WAMR skips __wasm_call_ctors for WASI modules (it expects _start to call
    // it), but we never call _start because proc_exit runs C++ static
    // destructors and corrupts module-level std::string globals.  Export the
    // function and call it once here before any other WASM exports so that
    // all static objects (std::string, etc.) are properly initialised.
    {
        if (!g_wasm_host.call_v("__wasm_call_ctors")) {
            fprintf(stderr, "Warning: __wasm_call_ctors not found or failed: %s\n",
                    g_wasm_host.get_error().c_str());
        }
    }
    stage("wasm_call_ctors");

    // 4.6 Hand the class library pack to the WASM module before
    // hc_wasm_eval_init runs compileLibrary. Skips ~200 individual
    // path_open / fd_read round-trips on the WASI pre-opened classlib dir.
    //
    // Source priority:
    //   1. --classlib-pack <path> (loaded from disk)
    //   2. embedded blob if HC_EMBEDDED_CLASSLIB_PACK=1
    //   3. skip (init falls back to per-file WASI reads from --classlib-dir)
    {
        const uint8_t* pack_bytes = nullptr;
        size_t         pack_size  = 0;
        std::vector<uint8_t> file_buf;
        const char*    src = nullptr;

        if (!opts.classlib_pack.empty()) {
            FILE* f = fopen(opts.classlib_pack.c_str(), "rb");
            if (!f) {
                fprintf(stderr, "Failed to open --classlib-pack '%s': %s\n",
                        opts.classlib_pack.c_str(), strerror(errno));
                return 1;
            }
            fseek(f, 0, SEEK_END);
            long sz = ftell(f);
            rewind(f);
            if (sz <= 0) {
                fprintf(stderr, "--classlib-pack '%s' is empty\n",
                        opts.classlib_pack.c_str());
                fclose(f);
                return 1;
            }
            file_buf.resize((size_t)sz);
            size_t n = fread(file_buf.data(), 1, (size_t)sz, f);
            fclose(f);
            if (n != (size_t)sz) {
                fprintf(stderr, "Short read on --classlib-pack: got %zu/%ld bytes\n",
                        n, sz);
                return 1;
            }
            pack_bytes = file_buf.data();
            pack_size  = (size_t)sz;
            src = "--classlib-pack";
        }
#ifdef HC_EMBEDDED_CLASSLIB_PACK
        else {
            pack_bytes = hclang_classlib_pack_blob;
            pack_size  = hclang_classlib_pack_blob_len;
            src = "embedded blob";
        }
#endif

        if (pack_bytes && pack_size > 0) {
            void*    native_ptr = nullptr;
            uint32_t wptr = g_wasm_host.wasm_malloc(
                static_cast<uint32_t>(pack_size), &native_ptr);
            if (!wptr || !native_ptr) {
                fprintf(stderr, "Failed to allocate %zu bytes in WASM for pack\n",
                        pack_size);
                return 1;
            }
            memcpy(native_ptr, pack_bytes, pack_size);
            wasm_val_t res[1]{};
            bool ok = g_wasm_host.call("hc_wasm_classlib_preload_bytes",
                                        1, res,
                                        (int32_t)wptr, (int32_t)pack_size);
            int32_t loaded = ok ? res[0].of.i32 : -1;
            g_wasm_host.wasm_free(wptr);
            if (!ok || loaded < 0) {
                fprintf(stderr, "hc_wasm_classlib_preload_bytes failed: %s\n",
                        g_wasm_host.get_error().c_str());
                return 1;
            }
            if (opts.verbosity > 0) {
                fprintf(stderr,
                        "Class library pack loaded from %s: %d entries (%zu bytes)\n",
                        src, loaded, pack_size);
            }
        }
    }

    stage("classlib_preload");

    // 4.7 Quarks CLI: put the extra class paths, and the quarks folder, on the
    // class search path. This has to come before hc_wasm_eval_init, which is
    // what compiles the class library (boot_sequence does not compile again).
    std::vector<std::string> include_paths;
    for (size_t i = 0; i < opts.extra_class_paths.size(); ++i) {
        const std::string& host_path = opts.extra_class_paths[i];
        std::error_code ec;
        if (!fs::is_directory(host_path, ec))
            continue; // warned about at the pre-open
        size_t last_slash = host_path.find_last_of("/\\");
        std::string basename = (last_slash == std::string::npos) ? host_path : host_path.substr(last_slash + 1);
        include_paths.push_back("/extra-class-lib/" + std::to_string(i) + "/" + basename);
    }
    if (!opts.quarks_dir.empty())
        include_paths.push_back("/home/user/.local/share/SuperCollider/downloaded-quarks");
    for (const std::string& wasm_path : include_paths) {
        void* native_ptr = nullptr;
        uint32_t wptr = g_wasm_host.wasm_malloc((uint32_t)wasm_path.size() + 1, &native_ptr);
        if (!wptr || !native_ptr) {
            fprintf(stderr, "Failed to allocate WASM buffer for class path %s\n", wasm_path.c_str());
            continue;
        }
        memcpy(native_ptr, wasm_path.c_str(), wasm_path.size() + 1);
        g_wasm_host.call("hc_wasm_eval_add_include_path", 0, nullptr, wptr);
        g_wasm_host.wasm_free(wptr);
        if (opts.verbosity > 0) {
            fprintf(stderr, "[quarks] Registered class path: %s\n", wasm_path.c_str());
        }
    }
    // A snapshot holds a compiled class library: restoring one would skip the
    // compile these paths need, and saving one would hand their classes to
    // every later run.
    const bool use_snapshot = include_paths.empty();

    // 5. Init the language runtime (or restore from snapshot)
    bool snapshot_restored = false;
    {
        // Try to restore heap snapshot for warm start (Phase I2)
        wasm_module_inst_t inst = g_wasm_host.get_instance();
        uint8_t* heap_base = (uint8_t*)g_wasm_host.addr_to_native(0);
        if (use_snapshot && inst && heap_base) {
            // Get heap capacity (use maximum value for now; WAMR provides via memory limits)
            const uint32_t max_heap_size = 256u * 1024u * 1024u;
            snapshot_restored = restore_snapshot(heap_base, max_heap_size,
                                               g_wasm_host.get_wasm_bytes(),
                                               g_wasm_host.get_wasm_size());
            if (snapshot_restored && opts.verbosity > 0) {
                fprintf(stderr, "[snapshot] Heap restored from cache (skipping eval_init)\n");
            }
        }

        // If snapshot wasn't available, run eval_init
        if (!snapshot_restored) {
            int32_t rc = 0;
            if (!g_wasm_host.call_i("hc_wasm_eval_init", &rc) || rc != 0) {
                fprintf(stderr, "hc_wasm_eval_init failed (rc=%d): %s\n",
                        rc, g_wasm_host.get_error().c_str());
                return 1;
            }
        }
    }

    // Quarks CLI: Signal that quarks support is available when quarks_dir is provided.
    // This sets the g_quarks_dir_registered flag in HC_Wasm_Eval.cpp which is checked
    // by hc_wasm_quarks_available() on the WASI path.
    if (!opts.quarks_dir.empty()) {
        int32_t available = 1;
        if (!g_wasm_host.call("hc_wasm_quarks_set_available", 0, nullptr, available)) {
            fprintf(stderr, "Warning: hc_wasm_quarks_set_available call failed: %s\n",
                    g_wasm_host.get_error().c_str());
        } else if (opts.verbosity > 0) {
            fprintf(stderr, "[quarks] Quarks support enabled\n");
        }
    }

    stage("eval_init");

    // 6. Boot: parse and compile the class library
    //    Skip if snapshot was restored (heap already contains the initialized state).
    if (!snapshot_restored) {
        int32_t rc = 0;
        if (!g_wasm_host.call_i("hc_wasm_eval_boot_sequence", &rc) || rc != 0) {
            fprintf(stderr, "hc_wasm_eval_boot_sequence failed (rc=%d): %s\n",
                    rc, g_wasm_host.get_error().c_str());
            return 1;
        }

        // Save snapshot for next run (Phase I2)
        if (use_snapshot) {
            wasm_module_inst_t inst = g_wasm_host.get_instance();
            uint8_t* heap_base = (uint8_t*)g_wasm_host.addr_to_native(0);
            if (inst && heap_base) {
                int32_t heap_end = 0;
                if (g_wasm_host.call_i("hc_wasm_eval_heap_end", &heap_end)) {
                    if (heap_end > 0) {
                        save_snapshot(heap_base, (uint32_t)heap_end,
                                    g_wasm_host.get_wasm_bytes(),
                                    g_wasm_host.get_wasm_size());
                        if (opts.verbosity > 0) {
                            fprintf(stderr, "[snapshot] Heap saved (%d bytes)\n", heap_end);
                        }
                    }
                }
            }
        }
    }
    stage("boot_sequence");

    // 6.5 Server.boot shim (Phase 12.4b).
    //
    // The wamr-full pipeline runs hcsynth_native standalone — no
    // /done /notify handshake — so SC's Server.boot() would hang
    // waiting for a reply that never comes. With --no-server-boot we
    // pre-eval SC code that:
    //   1. Points Server.default's addr at --scsynth-host/--scsynth-port
    //      (when supplied; otherwise leaves the default 127.0.0.1:57110).
    //   2. Sets the statusWatcher's hasBooted + notified flags so
    //      Server.default.serverRunning returns true.
    //   3. `Function.play`'s `warnIfNotRunning` gate now passes, and
    //      `def.doSend(server, synthMsg)` dispatches /d_recv + /s_new
    //      to the standalone synth as it would to a real server.
    //
    // Side effect: any OSCFunc registrations the user script makes
    // for `/n_end` cleanup will register but never fire (we don't
    // route inbound OSC back into the WASM yet — that's the next
    // sub-task).
    if (opts.no_server_boot) {
        std::string prep;
        if (!opts.scsynth_host.empty() && opts.scsynth_port > 0) {
            prep += "Server.default.addr_(NetAddr(\"";
            prep += opts.scsynth_host;
            prep += "\", ";
            prep += std::to_string(opts.scsynth_port);
            prep += "));\n";
        }
        prep +=
            "Server.default.statusWatcher.instVarPut(\\hasBooted, true);\n"
            "Server.default.statusWatcher.instVarPut(\\notified, true);\n";

        auto     prep_len = static_cast<uint32_t>(prep.size());
        void*    prep_native = nullptr;
        uint32_t prep_wptr   = g_wasm_host.wasm_malloc(prep_len + 1, &prep_native);
        if (!prep_wptr) {
            fprintf(stderr, "Failed to allocate WASM buffer for --no-server-boot prep\n");
            return 1;
        }
        memcpy(prep_native, prep.c_str(), prep_len + 1);
        g_wasm_host.call("hc_wasm_eval_execute", 0, nullptr,
                         prep_wptr, (int32_t)prep_len);
        g_wasm_host.wasm_free(prep_wptr);
        if (opts.verbosity > 0) {
            fprintf(stderr,
                "--no-server-boot: faked Server.default booted state%s\n",
                (!opts.scsynth_host.empty() && opts.scsynth_port > 0)
                    ? " + addr update" : "");
        }
    }

    // 7. Execute script file if provided
    if (!opts.script_file.empty()) {
        std::string code = read_file(opts.script_file);
        if (code.empty()) {
            fprintf(stderr, "Failed to read script: %s\n",
                    opts.script_file.c_str());
            return 1;
        }
        
        // Phase H3: Compile scscm to sclang if needed
        std::string detected_lang = opts.lang;
        if (detected_lang == "auto") {
            detected_lang = detect_lang_from_filename(opts.script_file);
        }
        
        std::string code_to_eval = code;
        if (detected_lang == "scscm") {
            code_to_eval = compile_scscm_to_sclang(code, opts.script_file, opts.scscm_debug);
            if (code_to_eval.empty()) {
                fprintf(stderr, "Failed to compile scscm file: %s\n", opts.script_file.c_str());
                return 1;
            }
        }
        
        // Allocate source string in WASM linear memory
        auto     len    = static_cast<uint32_t>(code_to_eval.size());
        void*    native = nullptr;
        uint32_t wptr   = g_wasm_host.wasm_malloc(len + 1, &native);
        if (!wptr) {
            fprintf(stderr, "Failed to allocate WASM buffer for script\n");
            return 1;
        }
        memcpy(native, code_to_eval.c_str(), len + 1);
        g_wasm_host.call("hc_wasm_eval_execute", 0, nullptr,
                         wptr, (int32_t)len);
        g_wasm_host.wasm_free(wptr);
    }

    // 8. REPL
    if (opts.repl) {
        repl_loop();
    }

    // 9. Cleanup. If we extracted the embedded classlib pack to a temp dir,
    // remove it (best-effort: ignore failures so a leftover doesn't mask a
    // genuine exit code from the script).
    if (!classlib_temp_dir.empty()) {
        std::error_code ec;
        fs::remove_all(classlib_temp_dir, ec);
    }

    return 0;
}
