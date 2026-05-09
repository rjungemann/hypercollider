/*
    SuperCollider real time audio synthesis system
    Copyright (c) 2002 James McCartney. All rights reserved.
    http://www.audiosynth.com

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program; if not, write to the Free Software
    Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301  USA
*/

#include "SC_Endian.h"
#include "SC_HiddenWorld.h"
#include "SC_WorldOptions.h"
#include "sc_msg_iter.h"
#include "osc_utils.hpp"

#include <ctype.h>
#include <stdexcept>
#include <stdarg.h>
#include <cerrno>

#include <sys/types.h>
#include "OSC_Packet.h"

#define ASIO_STANDALONE
#include <asio.hpp>
#include <array>
#include <functional>
#include <memory>

#include "lock.h"

#include "nova-tt/semaphore.hpp"
#include "nova-tt/thread_priority.hpp"

#ifdef USE_RENDEZVOUS
#    include "Rendezvous.h"
#endif


bool ProcessOSCPacket(World* inWorld, OSC_Packet* inPacket);

namespace scsynth {

//////////////////////////////////////////////////////////////////////////////////////////////////////////


static bool UnrollOSCPacket(World* inWorld, int inSize, char* inData, OSC_Packet* inPacket) {
    if (!strcmp(inData, "#bundle")) { // is a bundle
        char* data;
        char* dataEnd = inData + inSize;
        int len = 16;
        bool hasNestedBundle = false;

        // get len of nested messages only, without len of nested bundle(s)
        data = inData + 16; // skip bundle header
        while (data < dataEnd) {
            int32 msgSize = OSCint(data);
            data += sizeof(int32);
            if (strcmp(data, "#bundle")) // is a message
                len += sizeof(int32) + msgSize;
            else
                hasNestedBundle = true;
            data += msgSize;
        }

        if (hasNestedBundle) {
            if (len > 16) { // not an empty bundle
                // add nested messages to bundle buffer
                char* buf = (char*)malloc(len);
                inPacket->mSize = len;
                inPacket->mData = buf;

                memcpy(buf, inData, 16); // copy bundle header
                data = inData + 16; // skip bundle header
                while (data < dataEnd) {
                    int32 msgSize = OSCint(data);
                    data += sizeof(int32);
                    if (strcmp(data, "#bundle")) { // is a message
                        memcpy(buf, data - sizeof(int32), sizeof(int32) + msgSize);
                        buf += msgSize;
                    }
                    data += msgSize;
                }

                // process this packet without its nested bundle(s)
                if (!ProcessOSCPacket(inWorld, inPacket)) {
                    free(buf);
                    return false;
                }
            }

            // process nested bundle(s)
            data = inData + 16; // skip bundle header
            while (data < dataEnd) {
                int32 msgSize = OSCint(data);
                data += sizeof(int32);
                if (!strcmp(data, "#bundle")) { // is a bundle
                    OSC_Packet* packet = (OSC_Packet*)malloc(sizeof(OSC_Packet));
                    memcpy(packet, inPacket, sizeof(OSC_Packet)); // clone inPacket

                    if (!UnrollOSCPacket(inWorld, msgSize, data, packet)) {
                        free(packet);
                        return false;
                    }
                }
                data += msgSize;
            }
        } else { // !hasNestedBundle
            char* buf = (char*)malloc(inSize);
            inPacket->mSize = inSize;
            inPacket->mData = buf;
            memcpy(buf, inData, inSize);

            if (!ProcessOSCPacket(inWorld, inPacket)) {
                free(buf);
                return false;
            }
        }
    } else { // is a message
        char* buf = (char*)malloc(inSize);
        inPacket->mSize = inSize;
        inPacket->mData = buf;
        memcpy(buf, inData, inSize);

        if (!ProcessOSCPacket(inWorld, inPacket)) {
            free(buf);
            return false;
        }
    }

    return true;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////

SC_Thread gAsioThread;
asio::io_context ioContext;

const int kTextBufSize = 65536;


static void udp_reply_func(struct ReplyAddress* addr, char* msg, int size) {
    using namespace asio;

    ip::udp::socket* socket = reinterpret_cast<ip::udp::socket*>(addr->mReplyData);
    ip::udp::endpoint endpoint(addr->mAddress, addr->mPort);

    asio::error_code errc;
    socket->send_to(buffer(msg, size), endpoint, 0, errc);

    if (errc)
        printf("%s\n", errc.message().c_str());
}

static void tcp_reply_func(struct ReplyAddress* addr, char* msg, int size) {
    // Write size as 32bit unsigned network-order integer
    uint32 u = sc_htonl(size);

    using namespace asio;

    // FIXME: connection could be destroyed!
    ip::tcp::socket* socket = reinterpret_cast<ip::tcp::socket*>(addr->mReplyData);

#if 0
	ip::tcp::socket::message_flags flags = 0;
#    ifdef MSG_NOSIGNAL
	flags = MSG_NOSIGNAL;
#    endif
#endif

    asio::error_code errc;
    write(*socket, buffer(&u, sizeof(uint32)), errc);
    if (errc)
        printf("%s\n", errc.message().c_str());

    write(*socket, buffer(msg, size), errc);
    if (errc)
        printf("%s\n", errc.message().c_str());
}


class SC_UdpInPort {
    World* mWorld;
    int mPortNum;
    std::string mbindTo;
    std::array<char, kTextBufSize> recvBuffer;

    asio::ip::udp::endpoint remoteEndpoint;

#ifdef USE_RENDEZVOUS
    SC_Thread mRendezvousThread;
#endif

    void handleReceivedUDP(const asio::error_code& error, std::size_t bytes_transferred) {
        if (error == asio::error::operation_aborted)
            return; /* we're done */

        if (error == asio::error::connection_refused || error == asio::error::connection_reset) {
            // avoid windows error message
            startReceiveUDP();
            return;
        }

        if (error) {
            printf("(scsynth) SC_UdpInPort: received error - %s\n", error.message().c_str());
            startReceiveUDP();
            return;
        }

        if (mWorld->mDumpOSC)
            dumpOSC(mWorld->mDumpOSC, bytes_transferred, recvBuffer.data());

        OSC_Packet* packet = (OSC_Packet*)malloc(sizeof(OSC_Packet));

        packet->mReplyAddr.mProtocol = kUDP;
        packet->mReplyAddr.mAddress = remoteEndpoint.address();
        packet->mReplyAddr.mPort = remoteEndpoint.port();
        packet->mReplyAddr.mSocket = udpSocket.native_handle();
        packet->mReplyAddr.mReplyFunc = udp_reply_func;
        packet->mReplyAddr.mReplyData = (void*)&udpSocket;

        packet->mSize = bytes_transferred;

        if (!UnrollOSCPacket(mWorld, bytes_transferred, recvBuffer.data(), packet))
            free(packet);

        startReceiveUDP();
    }

    void startReceiveUDP() {
        using namespace asio;
        udpSocket.async_receive_from(asio::buffer(recvBuffer), remoteEndpoint,
                                     [this](const auto& error, auto bytes_transferred) { this->handleReceivedUDP(error, bytes_transferred); },
                                                 asio::placeholders::bytes_transferred));
    }

    static constexpr int receiveBufferSize = 4 * 1024 * 1024;
    static constexpr int sendBufferSize = 4 * 1024 * 1024;
    static constexpr int fallbackBufferSize = 1 * 1024 * 1024;

public:
    asio::ip::udp::socket udpSocket;

    SC_UdpInPort(World* world, std::string bindTo, int inPortNum):
        mWorld(world),
        mPortNum(inPortNum),
        mbindTo(bindTo),
        udpSocket(ioContext) {
        using namespace asio;
        BOOST_AUTO(protocol, ip::udp::v4());
        udpSocket.open(protocol);

        udpSocket.bind(ip::udp::endpoint(asio::ip::make_address(bindTo), inPortNum));
        if (inPortNum == 0)
            mPortNum = udpSocket.local_endpoint().port();

        try {
            asio::socket_base::send_buffer_size sendBufferSize;
            udpSocket.get_option(sendBufferSize);
            int defaultBufferSize = sendBufferSize.value();
            if (defaultBufferSize < SC_UdpInPort::sendBufferSize) {
                sendBufferSize = SC_UdpInPort::sendBufferSize;
                asio::error_code ec;
                udpSocket.set_option(sendBufferSize, ec);
                if (ec && defaultBufferSize < SC_UdpInPort::fallbackBufferSize) {
                    sendBufferSize = SC_UdpInPort::fallbackBufferSize;
                    udpSocket.set_option(sendBufferSize);
                }
            }
        } catch (asio::system_error& e) { printf("WARNING: failed to set send buffer size (%s)\n", e.what()); }

        try {
            asio::socket_base::receive_buffer_size receiveBufferSize;
            udpSocket.get_option(receiveBufferSize);
            int defaultBufferSize = receiveBufferSize.value();
            if (defaultBufferSize < SC_UdpInPort::receiveBufferSize) {
                receiveBufferSize = SC_UdpInPort::receiveBufferSize;
                asio::error_code ec;
                udpSocket.set_option(receiveBufferSize, ec);
                if (ec && defaultBufferSize < SC_UdpInPort::fallbackBufferSize) {
                    receiveBufferSize = SC_UdpInPort::fallbackBufferSize;
                    udpSocket.set_option(receiveBufferSize);
                }
            }
        } catch (asio::system_error& e) {
            printf("WARNING: failed to set receive buffer size (%s)\n", e.what());
        }

#ifdef USE_RENDEZVOUS
        if (world->mRendezvous) {
            SC_Thread thread(std::bind(PublishPortToRendezvous, kSCRendezvous_UDP, mPortNum));
            mRendezvousThread = std::move(thread);
        }
#endif

        startReceiveUDP();
    }
};


class SC_TcpConnection : public std::enable_shared_from_this<SC_TcpConnection> {
public:
    World* mWorld;
    typedef std::shared_ptr<SC_TcpConnection> pointer;
    asio::ip::tcp::socket socket;

    SC_TcpConnection(World* world, asio::io_context& ioContext, class SC_TcpInPort* parent):
        mWorld(world),
        socket(ioContext),
        mParent(parent) {}

    ~SC_TcpConnection();

    void start() {
        const int kMaxPasswordLen = 32;
        char buf[kMaxPasswordLen];
        int32 size;
        int32 msglen;

        asio::error_code error;
        asio::ip::tcp::no_delay noDelayOption(true);
        socket.set_option(noDelayOption, error);

        // first message must be the password. 4 tries.
        bool validated = mWorld->hw->mPassword[0] == 0;
        for (int i = 0; !validated && i < 4; ++i) {
            // FIXME: error handling!
            size = asio::read(socket, asio::buffer((void*)&msglen, sizeof(int32)));
            if (size < 0)
                return;

            msglen = sc_ntohl(msglen);
            if (msglen > kMaxPasswordLen)
                break;

            size = asio::read(socket, asio::buffer((void*)buf, msglen));
            if (size < 0)
                return;

            validated = strcmp(buf, mWorld->hw->mPassword) == 0;

            std::this_thread::sleep_for(std::chrono::seconds(i + 1)); // thwart cracking.
        }

        if (validated)
            startReceiveMessage();
    }

private:
    void startReceiveMessage() {
        namespace ba = asio;
        async_read(socket, ba::buffer(&OSCMsgLength, sizeof(OSCMsgLength)),
                   std::bind(&SC_TcpConnection::handleLengthReceived, shared_from_this(), ba::placeholders::error,
                               ba::placeholders::bytes_transferred));
    }

    int32 OSCMsgLength;
    char* data;
    class SC_TcpInPort* mParent;

    void handleLengthReceived(const asio::error_code& error, size_t bytes_transferred) {
        if (error) {
            if (error == asio::error::eof)
                return; // connection closed

            printf("handleLengthReceived: error %s", error.message().c_str());
            return;
        }

        namespace ba = asio;
        // msglen is in network byte order
        OSCMsgLength = sc_ntohl(OSCMsgLength);

        data = (char*)malloc(OSCMsgLength);

        async_read(socket, ba::buffer(data, OSCMsgLength),
                   std::bind(&SC_TcpConnection::handleMsgReceived, shared_from_this(), ba::placeholders::error,
                               ba::placeholders::bytes_transferred));
    }

    void handleMsgReceived(const asio::error_code& error, size_t bytes_transferred) {
        if (error) {
            free(data);
            if (error == asio::error::eof)
                return; // connection closed

            printf("handleMsgReceived: error %s", error.message().c_str());
            return;
        }

        assert(bytes_transferred == OSCMsgLength);

        if (mWorld->mDumpOSC)
            dumpOSC(mWorld->mDumpOSC, bytes_transferred, data);

        OSC_Packet* packet = (OSC_Packet*)malloc(sizeof(OSC_Packet));

        packet->mReplyAddr.mProtocol = kTCP;
        packet->mReplyAddr.mReplyFunc = tcp_reply_func;
        packet->mReplyAddr.mReplyData = (void*)&socket;
        packet->mReplyAddr.mPort = socket.remote_endpoint().port();
        packet->mReplyAddr.mSocket = socket.native_handle();
        packet->mReplyAddr.mAddress = socket.remote_endpoint().address();

        packet->mSize = OSCMsgLength;

        if (!UnrollOSCPacket(mWorld, bytes_transferred, data, packet))
            free(packet);

        startReceiveMessage();
    }
};

class SC_TcpInPort {
    World* mWorld;
    asio::ip::tcp::acceptor acceptor;

#ifdef USE_RENDEZVOUS
    SC_Thread mRendezvousThread;
#endif

    std::atomic<int> mAvailableConnections;
    friend class SC_TcpConnection;

public:
    SC_TcpInPort(World* world, const std::string& bindTo, int inPortNum, int inMaxConnections, int inBacklog):
        mWorld(world),
        acceptor(ioContext, asio::ip::tcp::endpoint(asio::ip::make_address(bindTo), inPortNum)),
        mAvailableConnections(inMaxConnections) {
        // FIXME: backlog???

#ifdef USE_RENDEZVOUS
        if (world->mRendezvous) {
            SC_Thread thread(std::bind(PublishPortToRendezvous, kSCRendezvous_TCP,
                                         inPortNum == 0 ? acceptor.local_endpoint().port() : inPortNum));

            mRendezvousThread = std::move(thread);
        }
#endif

        startAccept();
    }

    void startAccept() {
        if (mAvailableConnections > 0) {
            --mAvailableConnections;
            SC_TcpConnection::pointer newConnection(new SC_TcpConnection(mWorld, ioContext, this));

            acceptor.async_accept(
                newConnection->socket,
                std::bind(&SC_TcpInPort::handleAccept, this, newConnection, asio::placeholders::error));
        }
    }

    void handleAccept(SC_TcpConnection::pointer newConnection, const asio::error_code& error) {
        if (!error)
            newConnection->start();
        startAccept();
    }

    void connectionDestroyed() {
        if (!mWorld->mRunning)
            return;
        mAvailableConnections += 1;
        startAccept();
    }
};

SC_TcpConnection::~SC_TcpConnection() { mParent->connectionDestroyed(); }


//////////////////////////////////////////////////////////////////////////////////////////////////////////

static void asioFunction() {
    /* NB: on macOS we just keep the default thread priority */
#ifdef NOVA_TT_PRIORITY_RT
    int priority = nova::thread_priority_interval_rt().first;
    nova::thread_set_priority_rt(priority);
#endif

    asio::executor_work_guard<asio::io_context::executor_type> work =
        asio::make_work_guard(ioContext);
    ioContext.run();
}

void startAsioThread() {
    SC_Thread asioThread(&asioFunction);
    gAsioThread = std::move(asioThread);
}

void stopAsioThread() {
    ioContext.stop();
    gAsioThread.join();
}

bool asioThreadStarted() { return gAsioThread.joinable(); }

}

using namespace scsynth;

//////////////////////////////////////////////////////////////////////////////////////////////////////////


SCSYNTH_DLLEXPORT_C bool World_SendPacketWithContext(World* inWorld, int inSize, char* inData, ReplyFunc inFunc,
                                                     void* inContext) {
    if (inSize > 0) {
        if (inWorld->mDumpOSC)
            dumpOSC(inWorld->mDumpOSC, inSize, inData);

        OSC_Packet* packet = (OSC_Packet*)malloc(sizeof(OSC_Packet));

        packet->mReplyAddr.mAddress = asio::ip::address();
        packet->mReplyAddr.mReplyFunc = inFunc;
        packet->mReplyAddr.mReplyData = inContext;
        packet->mReplyAddr.mSocket = 0;
        packet->mReplyAddr.mProtocol = kUDP;
        packet->mReplyAddr.mPort = 0;

        if (!UnrollOSCPacket(inWorld, inSize, inData, packet)) {
            free(packet);
            return false;
        }
    }
    return true;
}

SCSYNTH_DLLEXPORT_C bool World_SendPacket(World* inWorld, int inSize, char* inData, ReplyFunc inFunc) {
    return World_SendPacketWithContext(inWorld, inSize, inData, inFunc, nullptr);
}

template <typename T, typename... Args> static bool protectedOpenPort(const char* socketType, Args&&... args) noexcept {
    try {
        new T(std::forward<Args>(args)...);
        return true;
    } catch (const asio::system_error& exc) {
        // Special verbose message to help with common issue. Issue #3969
        if (exc.code() == asio::error::address_in_use) {
            scprintf("\n*** ERROR: failed to open %s socket: address in use.\n"
                     "This could be because another instance of scsynth is already using it.\n"
                     "You can use SuperCollider (sclang) to kill all running servers by running `Server.killAll`.\n"
                     "You can also kill scsynth using a terminal or your operating system's task manager.\n",
                     socketType);
        } else {
            scprintf("\n*** ERROR: failed to open %s socket: %s\n", socketType, exc.what());
        }
    } catch (const std::exception& exc) {
        scprintf("\n*** ERROR: failed to open %s socket: %s\n", socketType, exc.what());
    } catch (...) { scprintf("\n*** ERROR: failed to open %s socket: Unknown error\n", socketType); }
    return false;
}

SCSYNTH_DLLEXPORT_C int World_OpenUDP(World* inWorld, const char* bindTo, int inPort) {
    return protectedOpenPort<SC_UdpInPort>("UDP", inWorld, bindTo, inPort);
}

SCSYNTH_DLLEXPORT_C int World_OpenTCP(World* inWorld, const char* bindTo, int inPort, int inMaxConnections,
                                      int inBacklog) {
    return protectedOpenPort<SC_TcpInPort>("TCP", inWorld, bindTo, inPort, inMaxConnections, inBacklog);
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
