#include "osc_server.h"
#include "hc_platform.h"
#include <cstring>

namespace {
hc_socket_t as_socket(std::uintptr_t s) { return static_cast<hc_socket_t>(s); }
const std::uintptr_t kNoSocket = static_cast<std::uintptr_t>(HC_INVALID_SOCKET);
}

OscServer::OscServer(int port, bool tcp)
    : m_port(port), m_tcp(tcp), m_running(false), m_socket_fd(kNoSocket) {}

OscServer::~OscServer() {
    stop();
}

bool OscServer::start() {
    if (m_running) return true;
    if (!hc_sockets_init()) return false;

    hc_socket_t sockfd;
    if (m_tcp) {
        sockfd = socket(AF_INET, SOCK_STREAM, 0);
    } else {
        sockfd = socket(AF_INET, SOCK_DGRAM, 0);
    }

    if (sockfd == HC_INVALID_SOCKET) {
        return false;
    }

    // Non-blocking for both UDP (we drain) and TCP-accept (we never block).
    hc_socket_set_nonblocking(sockfd);

    sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(m_port);

    if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        hc_close_socket(sockfd);
        return false;
    }

    if (m_tcp) {
        listen(sockfd, 5);
    }

    m_socket_fd = static_cast<std::uintptr_t>(sockfd);
    m_running = true;
    return true;
}

void OscServer::stop() {
    if (m_socket_fd != kNoSocket) {
        hc_close_socket(as_socket(m_socket_fd));
        m_socket_fd = kNoSocket;
    }
    m_running = false;
}

bool OscServer::is_running() const {
    return m_running;
}

int OscServer::process() {
    if (!m_running) return -1;

    int packets_handled = 0;

    if (m_tcp) {
        // Accept one connection per call. Length-prefixed framing per
        // SuperCollider's TCP convention (uint32 BE length, then payload).
        sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        hc_socket_t client_fd = accept(as_socket(m_socket_fd),
                                       (struct sockaddr*)&client_addr, &client_len);
        if (client_fd != HC_INVALID_SOCKET) {
            // On Windows an accepted socket inherits the listener's
            // non-blocking mode, and MSG_WAITALL fails on one; POSIX does not
            // inherit it. Either way the reads below block.
            hc_socket_set_nonblocking(client_fd, false);
            uint32_t length;
            if (recv(client_fd, reinterpret_cast<char*>(&length), 4, MSG_WAITALL) == 4) {
                length = ntohl(length);
                if (length > 0 && length < 1u << 20) {
                    char* buffer = new char[length];
                    auto received = recv(client_fd, buffer, (int)length, MSG_WAITALL);
                    if (received == (int)length && m_handler) {
                        m_handler(buffer, length);
                        ++packets_handled;
                    }
                    delete[] buffer;
                }
            }
            hc_close_socket(client_fd);
        }
    } else {
        // UDP: drain all currently-buffered datagrams.
        char buffer[8192];
        for (;;) {
            sockaddr_in client_addr;
            socklen_t client_len = sizeof(client_addr);
            auto received = recvfrom(as_socket(m_socket_fd), buffer, (int)sizeof(buffer),
                                     0, (struct sockaddr*)&client_addr, &client_len);
            if (received <= 0) break; // EAGAIN/EWOULDBLOCK or error
            if (m_handler) {
                m_handler(buffer, (size_t)received);
                ++packets_handled;
            }
        }
    }

    return packets_handled;
}
