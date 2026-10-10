// hc_platform.h -- the OS calls the native hosts make, on POSIX and Windows.
//
// Everything else they need (files, directories, temp paths) comes from
// std::filesystem. What is here is what the C++ standard library does not
// cover: UDP/TCP sockets, running a shell command and reading its output,
// Ctrl-C, and the user's home directory.
#pragma once

#include <cstdio>
#include <cstdlib>
#include <string>

#ifdef _WIN32
#  if !defined(_WIN32_WINNT) || _WIN32_WINNT < 0x0600
#    undef _WIN32_WINNT
#    define _WIN32_WINNT 0x0600 // Vista: inet_pton
#  endif
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  include <basetsd.h>
#  include <csignal>
#  ifdef _MSC_VER
typedef SSIZE_T ssize_t;
#  endif
#else
#  include <arpa/inet.h>
#  include <fcntl.h>
#  include <netinet/in.h>
#  include <signal.h>
#  include <sys/socket.h>
#  include <sys/wait.h>
#  include <unistd.h>
#endif

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------
#ifdef _WIN32
typedef SOCKET hc_socket_t;
#  define HC_INVALID_SOCKET INVALID_SOCKET
#else
typedef int hc_socket_t;
#  define HC_INVALID_SOCKET (-1)
#endif

// Winsock must be started before the first socket call; elsewhere a no-op.
inline bool hc_sockets_init() {
#ifdef _WIN32
    WSADATA data;
    return WSAStartup(MAKEWORD(2, 2), &data) == 0;
#else
    return true;
#endif
}

inline int hc_close_socket(hc_socket_t s) {
#ifdef _WIN32
    return closesocket(s);
#else
    return close(s);
#endif
}

inline bool hc_socket_set_nonblocking(hc_socket_t s, bool nonblocking = true) {
#ifdef _WIN32
    u_long on = nonblocking ? 1 : 0;
    return ioctlsocket(s, FIONBIO, &on) == 0;
#else
    int flags = fcntl(s, F_GETFL, 0);
    if (flags < 0) return false;
    flags = nonblocking ? (flags | O_NONBLOCK) : (flags & ~O_NONBLOCK);
    return fcntl(s, F_SETFL, flags) == 0;
#endif
}

// ---------------------------------------------------------------------------
// Shell commands
// ---------------------------------------------------------------------------
inline FILE* hc_popen(const char* command, const char* mode) {
#ifdef _WIN32
    return _popen(command, mode);
#else
    return popen(command, mode);
#endif
}

// Closes a hc_popen stream and returns the command's exit code, or -1 when
// it could not be waited for or did not exit normally.
inline int hc_pclose_exit_code(FILE* pipe) {
#ifdef _WIN32
    return _pclose(pipe); // already the exit code
#else
    int status = pclose(pipe);
    if (status == -1 || !WIFEXITED(status))
        return -1;
    return WEXITSTATUS(status);
#endif
}

// ---------------------------------------------------------------------------
// Ctrl-C
// ---------------------------------------------------------------------------
// The handler runs on SIGINT, and keeps running on later ones.
inline void hc_install_sigint_handler(void (*handler)(int)) {
#ifdef _WIN32
    // The CRT delivers a console Ctrl-C as SIGINT. It resets the handler
    // to the default after each signal, so the handler must reinstall itself
    // (see hc_rearm_sigint_handler).
    signal(SIGINT, handler);
#else
    struct sigaction sa {};
    sa.sa_handler = handler;
    sigemptyset(&sa.sa_mask);
    // No SA_RESTART: a blocking read (the REPL's prompt) is interrupted, so
    // a Ctrl-C there returns at once.
    sa.sa_flags = 0;
    sigaction(SIGINT, &sa, nullptr);
#endif
}

// Call first thing in a SIGINT handler installed above.
inline void hc_rearm_sigint_handler(void (*handler)(int)) {
#ifdef _WIN32
    signal(SIGINT, handler);
#else
    (void)handler;
#endif
}

// ---------------------------------------------------------------------------
// Home directory
// ---------------------------------------------------------------------------
// $HOME, else (Windows) %USERPROFILE%; empty when neither is set.
inline std::string hc_home_dir() {
    const char* home = std::getenv("HOME");
#ifdef _WIN32
    if (!home || !*home)
        home = std::getenv("USERPROFILE");
#endif
    return (home && *home) ? std::string(home) : std::string();
}
