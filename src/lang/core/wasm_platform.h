/*
 * SC_Wasm_Platform.h
 * SuperCollider Language - WASM Platform Abstraction Layer
 *
 * Provides platform-agnostic interfaces for WASM builds.
 * Replaces platform-specific implementations (POSIX threads, file I/O, etc.)
 * with stubs or JavaScript-bridged equivalents.
 *
 * Phase 7.2: sclang WASM Implementation
 */

#ifndef _SC_WASM_PLATFORM_H_
#define _SC_WASM_PLATFORM_H_

#ifdef SC_WASM

#include <cstdint>
#include <cstring>
#include <ctime>

/*
 * ============================================================================
 * THREADING STUBS
 * ============================================================================
 * sclang uses pthreads for scheduling and I/O. WASM is single-threaded,
 * so we provide stubs that compile but don't actually create threads.
 * Scheduling is deferred to Phase 8+ with JavaScript event loop integration.
 * When compiling with Emscripten, use its own pthread types.
 */

#ifdef __EMSCRIPTEN__
// Pull in Emscripten's own pthread types so the inline stubs below compile
#    include <pthread.h>
#else
typedef int pthread_t;
typedef int pthread_mutex_t;
typedef int pthread_cond_t;
typedef int pthread_attr_t;
typedef int pthread_mutexattr_t;

#define PTHREAD_MUTEX_INITIALIZER 0
#define PTHREAD_COND_INITIALIZER 0
#endif

inline int pthread_create(pthread_t *thread, const pthread_attr_t *attr,
                         void *(*start_routine)(void *), void *arg) {
    // No-op: WASM is single-threaded
    return 0;
}

inline int pthread_join(pthread_t thread, void **value_ptr) {
    // No-op
    return 0;
}

inline int pthread_mutex_init(pthread_mutex_t *mutex, const pthread_mutexattr_t *attr) {
    // No-op
    return 0;
}

inline int pthread_mutex_destroy(pthread_mutex_t *mutex) {
    // No-op
    return 0;
}

inline int pthread_mutex_lock(pthread_mutex_t *mutex) {
    // No-op
    return 0;
}

inline int pthread_mutex_unlock(pthread_mutex_t *mutex) {
    // No-op
    return 0;
}

inline int pthread_cond_init(pthread_cond_t *cond, const void *attr) {
    // No-op
    return 0;
}

inline int pthread_cond_destroy(pthread_cond_t *cond) {
    // No-op
    return 0;
}

inline int pthread_cond_wait(pthread_cond_t *cond, pthread_mutex_t *mutex) {
    // No-op
    return 0;
}

inline int pthread_cond_signal(pthread_cond_t *cond) {
    // No-op
    return 0;
}

inline int pthread_cond_broadcast(pthread_cond_t *cond) {
    // No-op
    return 0;
}

/*
 * ============================================================================
 * PROCESS / EXECUTION STUBS
 * ============================================================================
 */

inline pid_t fork() {
    // No-op: WASM cannot fork processes
    return -1;
}

inline int execve(const char *filename, char *const argv[], char *const envp[]) {
    // No-op: WASM cannot execute external processes
    return -1;
}

/*
 * ============================================================================
 * DYNAMIC LOADING STUBS
 * ============================================================================
 * Plugins are statically linked in WASM builds.
 */

#define RTLD_LAZY 0
#define RTLD_NOW 0
#define RTLD_GLOBAL 0

inline void *dlopen(const char *filename, int flags) {
    // No-op: plugins are statically linked
    return nullptr;
}

inline int dlclose(void *handle) {
    // No-op
    return 0;
}

inline void *dlsym(void *handle, const char *symbol) {
    // No-op
    return nullptr;
}

inline const char *dlerror() {
    // Return empty error message
    return "";
}

/*
 * ============================================================================
 * SIGNAL HANDLING STUBS
 * ============================================================================
 */

#ifndef __EMSCRIPTEN__
// Only define signal stubs if not using Emscripten's signal implementation
typedef void (*sig_t)(int);
typedef int sigset_t;
typedef int sig_atomic_t;

#define SIG_DFL ((sig_t)0)
#define SIG_IGN ((sig_t)1)
#define SIG_ERR ((sig_t)-1)
#define SIGTERM 15
#define SIGINT 2
#define SIGABRT 6
#define SIGUSR1 10
#define SIGUSR2 12
#define SIGHUP 1

inline sig_t signal(int signum, sig_t handler) {
    // No-op: signals not available in WASM
    return SIG_DFL;
}

inline int sigaction(int signum, const void *act, void *oldact) {
    // No-op
    return 0;
}

inline int sigemptyset(sigset_t *set) {
    if (set) *set = 0;
    return 0;
}

inline int sigaddset(sigset_t *set, int signum) {
    if (set) *set |= (1 << signum);
    return 0;
}

inline int sigprocmask(int how, const sigset_t *set, sigset_t *oldset) {
    // No-op
    return 0;
}
#endif

/*
 * ============================================================================
 * NETWORK / SOCKET STUBS
 * ============================================================================
 * Network communication is bridged through JS or handled via in-process OSC.
 * When compiling with Emscripten, use its own socket types.
 */

#ifndef __EMSCRIPTEN__
// Only define socket stubs if not using Emscripten's socket implementation
// Also check if these are already defined to avoid conflicts with system headers

#ifndef AF_INET
#define AF_INET 2
#endif
#ifndef SOCK_STREAM
#define SOCK_STREAM 1
#endif
#ifndef SOCK_DGRAM
#define SOCK_DGRAM 2
#endif
#ifndef SOL_SOCKET
#define SOL_SOCKET 1
#endif
#ifndef SO_REUSEADDR
#define SO_REUSEADDR 2
#endif
#ifndef SO_RCVBUF
#define SO_RCVBUF 8
#endif
#ifndef SO_SNDBUF
#define SO_SNDBUF 7
#endif
#ifndef IPPROTO_TCP
#define IPPROTO_TCP 6
#endif

#ifndef socklen_t_DEFINED
#ifndef _SOCKLEN_T
typedef int socklen_t;
#define socklen_t_DEFINED
#define _SOCKLEN_T
#endif
#endif

#ifndef sockaddr_DEFINED
#ifndef _SOCKADDR_DEFINED
struct sockaddr {
    unsigned short sa_family;
};
#define sockaddr_DEFINED
#define _SOCKADDR_DEFINED
#endif
#endif

#ifndef sockaddr_in_DEFINED
struct sockaddr_in {
    short sin_family;
    unsigned short sin_port;
    struct {
        unsigned long s_addr;
    } sin_addr;
    char sin_zero[8];
};
#define sockaddr_in_DEFINED
#endif

#ifndef socket_t_DEFINED
typedef int socket_t;
#define socket_t_DEFINED
#endif

inline socket_t socket(int domain, int type, int protocol) {
    // No-op: WASM cannot use sockets
    return -1;
}

inline int bind(socket_t sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    // No-op
    return -1;
}

inline int listen(socket_t sockfd, int backlog) {
    // No-op
    return -1;
}

inline socket_t accept(socket_t sockfd, struct sockaddr *addr, socklen_t *addrlen) {
    // No-op
    return -1;
}

inline int connect(socket_t sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    // No-op
    return -1;
}

inline ssize_t send(socket_t sockfd, const void *buf, size_t len, int flags) {
    // No-op
    return -1;
}

inline ssize_t recv(socket_t sockfd, void *buf, size_t len, int flags) {
    // No-op
    return -1;
}

inline int close(int fd) {
    // No-op (file I/O not available in WASM)
    return 0;
}

inline int setsockopt(socket_t sockfd, int level, int optname, const void *optval, socklen_t optlen) {
    // No-op
    return 0;
}

#endif

/*
 * ============================================================================
 * TIME FUNCTIONS
 * ============================================================================
 * These are implemented in SC_Wasm_Platform.cpp using emscripten_get_now()
 * or equivalent JavaScript bridge.
 */

extern double sc_wasm_get_now();  // Returns current time in seconds (doubles)
extern void sc_wasm_sleep_ms(int milliseconds);  // Sleep for N milliseconds

/*
 * ============================================================================
 * SCHEDULING STUBS
 * ============================================================================
 * Full scheduling is deferred to Phase 8. These are placeholder stubs.
 */

extern void sc_wasm_schedule_callback(void (*callback)(void*), void* ctx, double delay_seconds);

#endif  // SC_WASM

#endif  // _SC_WASM_PLATFORM_H_
