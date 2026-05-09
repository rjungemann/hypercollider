#include "osc_server.h"
#include <cstring>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>

OscServer::OscServer(int port, bool tcp)
    : m_port(port), m_tcp(tcp), m_running(false), m_socket_fd(-1) {}

OscServer::~OscServer() {
    stop();
}

bool OscServer::start() {
    if (m_running) return true;

    int sockfd;
    if (m_tcp) {
        sockfd = socket(AF_INET, SOCK_STREAM, 0);
    } else {
        sockfd = socket(AF_INET, SOCK_DGRAM, 0);
    }

    if (sockfd < 0) {
        return false;
    }

    // Non-blocking for both UDP (we drain) and TCP-accept (we never block).
    int flags = fcntl(sockfd, F_GETFL, 0);
    fcntl(sockfd, F_SETFL, flags | O_NONBLOCK);

    sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(m_port);

    if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        close(sockfd);
        return false;
    }

    if (m_tcp) {
        listen(sockfd, 5);
    }

    m_socket_fd = sockfd;
    m_running = true;
    return true;
}

void OscServer::stop() {
    if (m_socket_fd >= 0) {
        close(m_socket_fd);
        m_socket_fd = -1;
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
        int client_fd = accept(m_socket_fd, (struct sockaddr*)&client_addr,
                               &client_len);
        if (client_fd >= 0) {
            uint32_t length;
            if (recv(client_fd, &length, 4, MSG_WAITALL) == 4) {
                length = ntohl(length);
                if (length > 0 && length < 1u << 20) {
                    char* buffer = new char[length];
                    ssize_t received = recv(client_fd, buffer, length,
                                            MSG_WAITALL);
                    if (received == (ssize_t)length && m_handler) {
                        m_handler(buffer, length);
                        ++packets_handled;
                    }
                    delete[] buffer;
                }
            }
            close(client_fd);
        }
    } else {
        // UDP: drain all currently-buffered datagrams.
        char buffer[8192];
        for (;;) {
            sockaddr_in client_addr;
            socklen_t client_len = sizeof(client_addr);
            ssize_t received = recvfrom(m_socket_fd, buffer, sizeof(buffer),
                                        0, (struct sockaddr*)&client_addr,
                                        &client_len);
            if (received <= 0) break; // EAGAIN/EWOULDBLOCK or error
            if (m_handler) {
                m_handler(buffer, (size_t)received);
                ++packets_handled;
            }
        }
    }

    return packets_handled;
}
