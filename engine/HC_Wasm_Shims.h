/*
 * HC_Wasm_Shims.h - WASM platform abstraction layer
 *
 * This header provides stubs and abstractions for POSIX APIs that are not
 * available in WebAssembly/browser environment.
 *
 * All WASM-specific code should be guarded with SC_WASM preprocessor check.
 */

#ifndef HC_WASM_SHIMS_H
#define HC_WASM_SHIMS_H

#ifdef SC_WASM

#include <cstdint>
#include <cstring>
#include <cerrno>

// ============================================================================
// Threading & Synchronization Stubs
// ============================================================================
// For Phase 1, we start single-threaded.
// pthreads can be evaluated in Phase 2 with SharedArrayBuffer support.

typedef int pthread_t;
typedef int pthread_mutex_t;
typedef int pthread_cond_t;
typedef int pthread_attr_t;
typedef int pthread_mutexattr_t;
typedef int pthread_condattr_t;

// No-op implementations
inline int pthread_mutex_init(pthread_mutex_t*, const pthread_mutexattr_t*) { return 0; }
inline int pthread_mutex_destroy(pthread_mutex_t*) { return 0; }
inline int pthread_mutex_lock(pthread_mutex_t*) { return 0; }
inline int pthread_mutex_unlock(pthread_mutex_t*) { return 0; }
inline int pthread_cond_init(pthread_cond_t*, const pthread_condattr_t*) { return 0; }
inline int pthread_cond_destroy(pthread_cond_t*) { return 0; }
inline int pthread_cond_signal(pthread_cond_t*) { return 0; }
inline int pthread_cond_broadcast(pthread_cond_t*) { return 0; }
inline int pthread_cond_wait(pthread_cond_t*, pthread_mutex_t*) { return 0; }
inline int pthread_attr_init(pthread_attr_t*) { return 0; }
inline int pthread_attr_destroy(pthread_attr_t*) { return 0; }
inline int pthread_create(pthread_t*, const pthread_attr_t*, void*(*)(void*), void*) {
	errno = ENOTSUP;
	return -1;
}
inline int pthread_join(pthread_t, void**) {
	errno = ENOTSUP;
	return -1;
}

// ============================================================================
// Dynamic Loading Stubs
// ============================================================================
// WASM uses static registration instead of dlopen/dlsym.
// These stubs are provided for source compatibility.

inline void* dlopen(const char*, int) {
	errno = ENOTSUP;
	return nullptr;
}
inline void* dlsym(void*, const char*) {
	errno = ENOTSUP;
	return nullptr;
}
inline int dlclose(void*) {
	errno = ENOTSUP;
	return -1;
}
inline const char* dlerror() { return "Dynamic loading not supported in WASM"; }

// ============================================================================
// Socket/Network Stubs
// ============================================================================
// WASM cannot use raw sockets. Message passing goes through JS bridge.

typedef int socket_t;
typedef struct { } sockaddr;
typedef struct { } sockaddr_in;
typedef struct { } sockaddr_in6;

#define AF_INET 2
#define AF_INET6 10
#define SOCK_DGRAM 2
#define SOCK_STREAM 1
#define SOL_SOCKET 1
#define SO_REUSEADDR 2
#define IPPROTO_UDP 17

inline socket_t socket(int, int, int) {
	errno = ENOTSUP;
	return -1;
}
inline int bind(socket_t, const sockaddr*, int) {
	errno = ENOTSUP;
	return -1;
}
inline int listen(socket_t, int) {
	errno = ENOTSUP;
	return -1;
}
inline socket_t accept(socket_t, sockaddr*, int*) {
	errno = ENOTSUP;
	return -1;
}
inline int connect(socket_t, const sockaddr*, int) {
	errno = ENOTSUP;
	return -1;
}
inline int sendto(socket_t, const void*, int, int, const sockaddr*, int) {
	errno = ENOTSUP;
	return -1;
}
inline int recvfrom(socket_t, void*, int, int, sockaddr*, int*) {
	errno = ENOTSUP;
	return -1;
}
inline int setsockopt(socket_t, int, int, const void*, int) {
	errno = ENOTSUP;
	return -1;
}
inline int closesocket(socket_t) {
	errno = ENOTSUP;
	return -1;
}

#ifdef _WIN32
#undef closesocket
#define closesocket(x) closesocket(x)
#endif

// ============================================================================
// Signal Handling Stubs
// ============================================================================
// WASM cannot use POSIX signals. Async handlers should use JS-level mechanisms.

#define SIGTERM 15
#define SIGKILL 9
#define SIGUSR1 10
#define SIGUSR2 12

typedef void (*signal_handler_t)(int);

inline signal_handler_t signal(int, signal_handler_t) { return nullptr; }
inline int raise(int) {
	errno = ENOTSUP;
	return -1;
}

// ============================================================================
// Process Management Stubs
// ============================================================================
// WASM doesn't fork/exec. These are provided for compilation only.

inline int fork() {
	errno = ENOTSUP;
	return -1;
}
inline int execve(const char*, char* const[], char* const[]) {
	errno = ENOTSUP;
	return -1;
}
inline int waitpid(int, int*, int) {
	errno = ENOTSUP;
	return -1;
}
inline int getpid() { return 1; }  // Single "process"

// ============================================================================
// Memory Locking Stubs
// ============================================================================

inline int mlock(const void*, int) {
	errno = ENOTSUP;
	return -1;
}
inline int munlock(const void*, int) {
	errno = ENOTSUP;
	return -1;
}

#endif // SC_WASM

#endif // HC_WASM_SHIMS_H
