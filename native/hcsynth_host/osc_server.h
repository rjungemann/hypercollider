#ifndef HC_OSC_SERVER_H
#define HC_OSC_SERVER_H

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

class OscServer {
public:
    // Callback invoked once per inbound datagram. The buffer is owned by the
    // server (do not free); copy out anything you need to keep beyond the
    // callback.
    using PacketHandler = std::function<void(const char* buf, size_t len)>;

    OscServer(int port, bool tcp = false);
    ~OscServer();

    bool start();
    void stop();
    bool is_running() const;

    void set_packet_handler(PacketHandler h) { m_handler = std::move(h); }

    // Drain all currently-buffered datagrams (non-blocking). Calls the
    // registered packet handler for each. Returns the number of packets
    // handed off (or -1 if not running).
    int process();

private:
    int m_port;
    bool m_tcp;
    bool m_running;
    int m_socket_fd;
    PacketHandler m_handler;
};

#endif // HC_OSC_SERVER_H
