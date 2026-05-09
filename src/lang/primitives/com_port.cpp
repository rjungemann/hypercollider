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

#include "SC_BoundsMacros.h"
#include "com_port.h"
#include "SC_Endian.h"
#include <ctype.h>
#include <stdexcept>
#include <stdarg.h>
#include "sc_base.h"
#include <cerrno>
#include "sc_sched.h"

#include "lock.h"
#include "msg.h"
#include "reply_impl.hpp"

#define ASIO_STANDALONE
#include <asio.hpp>

#define scprintf printf
#include "osc_utils.hpp"
#undef scprintf

void ProcessOSCPacket(std::unique_ptr<OSC_Packet> inPacket, int inPortNum, double time);
void ProcessRawMessage(std::unique_ptr<char[]> inData, size_t inSize, ReplyAddress& replyAddress, int inPortNum,
                       double time);

//////////////////////////////////////////////////////////////////////////////////////////////////////////

SC_Thread gAsioThread;
asio::io_context ioContext;


static void asioFunction() {
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

//////////////////////////////////////////////////////////////////////////////////////////////////////////

// One MessageHandler<> class for each HandlerType.
// The signature of handleMessage can differ between handler types, so templatizing the class
// allows us to specify a message handler func using e.g. MessageHandler<HandlerType::OSC>::handleMessage
template <HandlerType H> struct MessageHandler {};

template <> struct MessageHandler<HandlerType::OSC> {
    static void handleMessage(Protocol protocol, int replySocket, const asio::ip::address& replyAddress,
                              int replyPort, std::unique_ptr<char[]> data, size_t dataSize, int localPort) {
        const double timeReceived = elapsedTime(); // get time now to minimize jitter due to lang load

        auto packet = std::make_unique<OSC_Packet>(OSC_Packet { std::move(data),
                                                                dataSize,
                                                                {
#ifdef SC_WASM
                                                                    replyAddress.is_v4() ? replyAddress.to_v4().to_uint() : 0,
                                                                    protocol,
                                                                    replyPort,
                                                                    replySocket,
#else
                                                                    replyAddress, protocol, replyPort, replySocket,
#endif
                                                                    nullptr, // mReplyFunc
                                                                    nullptr // mReplyData
                                                                } });

        ProcessOSCPacket(std::move(packet), localPort, timeReceived);
    }
};

template <> struct MessageHandler<HandlerType::Raw> {
    static void handleMessage(Protocol protocol, int replySocket, const asio::ip::address& replyAddress,
                              int replyPort, std::unique_ptr<char[]> data, size_t dataSize, int localPort) {
        const double timeReceived = elapsedTime(); // get time now to minimize jitter due to lang load

        ReplyAddress addrObject;
        addrObject.mProtocol = protocol;
    #ifdef SC_WASM
        addrObject.mAddress = replyAddress.is_v4() ? replyAddress.to_v4().to_uint() : 0;
    #else
        addrObject.mAddress = replyAddress;
    #endif
        addrObject.mSocket = replySocket;
        addrObject.mPort = replyPort;
        addrObject.mReplyFunc = nullptr;
        addrObject.mReplyData = nullptr;

        ProcessRawMessage(std::move(data), dataSize, addrObject, localPort, timeReceived);
    }
};


//////////////////////////////////////////////////////////////////////////////////////////////////////////

namespace Detail {

TCPConnection::TCPConnection(asio::io_context& ioContext, int portNum, HandlerType handlerType):
    mSocket(ioContext),
    mOSCMsgLength(0),
    mPortNum(portNum) {
    initHandler(handlerType);
}

void TCPConnection::initHandler(HandlerType handlerType) {
    switch (handlerType) {
    case HandlerType::OSC: {
        using Handler = MessageHandler<HandlerType::OSC>;
        mHandleFunc = [this](auto data, auto dataSize) {
            const int replyPort = 0;
            const asio::ip::address replyAddress;
            Handler::handleMessage(kTCP, mSocket.native_handle(), replyAddress, replyPort, std::move(data), dataSize,
                                   mPortNum);
        };
        return;
    }
    case HandlerType::Raw: {
        using Handler = MessageHandler<HandlerType::Raw>;
        mHandleFunc = [this](auto data, auto dataSize) {
            const int replyPort = 0;
            const asio::ip::address replyAddress;
            Handler::handleMessage(kTCP, mSocket.native_handle(), replyAddress, replyPort, std::move(data), dataSize,
                                   mPortNum);
        };
        return;
    }
    }
}

void TCPConnection::start() {
    namespace ba = asio;
    ba::async_read(mSocket, ba::buffer(&mOSCMsgLength, sizeof(mOSCMsgLength)),
                   [receiver = shared_from_this()](auto error, auto bytesTransferred) {
                       receiver->handleLengthReceived(error, bytesTransferred);
                   });
}

void TCPConnection::handleLengthReceived(const asio::error_code& error, size_t bytes_transferred) {
    if (error) {
        return;
    }

    namespace ba = asio;
    // msglen is in network byte order
    mOSCMsgLength = sc_ntohl(mOSCMsgLength);

    mData = std::make_unique<char[]>(mOSCMsgLength);

    ba::async_read(mSocket, ba::buffer(mData.get(), mOSCMsgLength),
                   [receiver = shared_from_this()](auto error, auto bytesReceived) {
                       receiver->handleMsgReceived(error, bytesReceived);
                   });
}

void TCPConnection::handleMsgReceived(const asio::error_code& error, size_t bytes_transferred) {
    if (error) {
        mData.reset();
        return;
    }

    assert(bytes_transferred == mOSCMsgLength);

    mHandleFunc(std::move(mData), mOSCMsgLength);

    start();
}

} // namespace Detail

//////////////////////////////////////////////////////////////////////////////////////////////////////////

namespace InPort {

UDP::UDP(int inPortNum, HandlerType handlerType, int portsToCheck): mPortNum(inPortNum), mUdpSocket(ioContext) {
    using namespace asio;

    auto protocol = ip::udp::v4();

    mUdpSocket.open(protocol);

    for (int offset = 0; offset != portsToCheck; ++offset) {
        try {
            mUdpSocket.bind(ip::udp::endpoint(protocol, inPortNum + offset));
            mPortNum = inPortNum + offset;
            break;
        } catch (std::exception const&) {
            if (offset == (portsToCheck - 1))
                throw std::runtime_error("unable to bind udp socket\n");
        }
    }

    try {
        asio::socket_base::send_buffer_size sendBufferSize;
        mUdpSocket.get_option(sendBufferSize);
        int originalBufferSize = sendBufferSize.value();
        if (originalBufferSize < UDP::sendBufferSize) {
            sendBufferSize = UDP::sendBufferSize;
            asio::error_code ec;
            mUdpSocket.set_option(sendBufferSize, ec);
            if (ec && originalBufferSize < UDP::fallbackBufferSize) {
                sendBufferSize = UDP::fallbackBufferSize;
                mUdpSocket.set_option(sendBufferSize);
            }
        }
    } catch (asio::system_error& e) {
        printf("(sclang) SC_UdpInPort: WARNING: failed to set send buffer size (%s)\n", e.what());
    }

    try {
        asio::socket_base::receive_buffer_size receiveBufferSize;
        mUdpSocket.get_option(receiveBufferSize);
        int originalBufferSize = receiveBufferSize.value();
        if (originalBufferSize < UDP::receiveBufferSize) {
            receiveBufferSize = UDP::receiveBufferSize;
            asio::error_code ec;
            mUdpSocket.set_option(receiveBufferSize, ec);
            if (ec && originalBufferSize < UDP::fallbackBufferSize) {
                receiveBufferSize = UDP::fallbackBufferSize;
                mUdpSocket.set_option(receiveBufferSize);
            }
        }
    } catch (asio::system_error& e) {
        printf("(sclang) SC_UdpInPort: WARNING: failed to set receive buffer size (%s)\n", e.what());
    }

    initHandler(handlerType);

    startReceiveUDP();
}

void UDP::initHandler(HandlerType handlerType) {
    switch (handlerType) {
    case HandlerType::OSC: {
        using Handler = MessageHandler<HandlerType::OSC>;
        mHandleFunc = [this](auto data, auto dataSize) {
            Handler::handleMessage(kUDP, mUdpSocket.native_handle(), mRemoteEndpoint.address(), mRemoteEndpoint.port(),
                                   std::move(data), dataSize, mPortNum);
        };
        return;
    }
    case HandlerType::Raw: {
        using Handler = MessageHandler<HandlerType::Raw>;
        mHandleFunc = [this](auto data, auto dataSize) {
            Handler::handleMessage(kUDP, mUdpSocket.native_handle(), mRemoteEndpoint.address(), mRemoteEndpoint.port(),
                                   std::move(data), dataSize, mPortNum);
        };
        return;
    }
    }
}

void UDP::startReceiveUDP() {
    using namespace asio;
    mUdpSocket.async_receive_from(
        asio::buffer(mRecvBuffer), mRemoteEndpoint,
        [this](auto error, auto bytesTransferred) { handleReceivedUDP(error, bytesTransferred); });
}

void UDP::handleReceivedUDP(const asio::error_code& error, std::size_t bytesTransferred) {
    if (error == asio::error::operation_aborted)
        return; /* we're done */

    if (error == asio::error::connection_refused || error == asio::error::connection_reset) {
        // avoid windows error message
        startReceiveUDP();
        return;
    }

    if (error) {
        printf("(sclang) SC_UdpInPort: received error - %s\n", error.message().c_str());
        startReceiveUDP();
        return;
    }

    std::unique_ptr<char[]> data(new char[bytesTransferred]);
    memcpy(data.get(), mRecvBuffer.data(), bytesTransferred);

    mHandleFunc(std::move(data), bytesTransferred);

    startReceiveUDP();
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

UDPCustom::UDPCustom(int inPortNum, HandlerType handlerType): UDP(inPortNum, handlerType, 1) {}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

TCP::TCP(int inPortNum, int inMaxConnections, int inBacklog, HandlerType handlerType):
    mAcceptor(ioContext, asio::ip::tcp::endpoint(asio::ip::tcp::v4(), inPortNum)),
    mPortNum(inPortNum),
    mHandlerType(handlerType) {
    // FIXME: handle max connections
    // FIXME: backlog???

    startAccept();
}

void TCP::startAccept() {
    const auto newConnection = std::make_shared<Detail::TCPConnection>(ioContext, mPortNum, mHandlerType);

    mAcceptor.async_accept(newConnection->getSocket(),
                           [this, newConnection](auto error) { handleAccept(newConnection, error); });
}

void TCP::handleAccept(Detail::TCPConnection::pointer newConnection, const asio::error_code& error) {
    if (!error)
        newConnection->start();
    startAccept();
}

} // namespace InPort

//////////////////////////////////////////////////////////////////////////////////////////////////////////

namespace OutPort {

TCP::TCP(std::uint64_t inAddress, int inPort, HandlerType handlerType, ClientNotifyFunc notifyFunc, void* clientData):
    mSocket(ioContext),
    mEndpoint(asio::ip::address_v4(inAddress), inPort),
    mClientNotifyFunc(notifyFunc),
    mClientData(clientData) {
    using namespace asio;

    asio::error_code error;
    ip::tcp::no_delay noDelayOption(true);
    mSocket.set_option(noDelayOption, error);

    mSocket.connect(mEndpoint);

    initHandler(handlerType);

    startReceive();
}

void TCP::initHandler(HandlerType handlerType) {
    switch (handlerType) {
    case HandlerType::OSC:
        using Handler = MessageHandler<HandlerType::OSC>;
        mHandleFunc = [this](auto data, auto dataSize) {
            Handler::handleMessage(kTCP, mSocket.native_handle(), mSocket.remote_endpoint().address(),
                                   mSocket.remote_endpoint().port(), std::move(data), dataSize,
                                   mSocket.local_endpoint().port());
        };
    }
}

void TCP::startReceive() {
    namespace ba = asio;
    ba::async_read(mSocket, ba::buffer(&mOSCMsgLength, sizeof(mOSCMsgLength)),
                   [this](auto error, auto bytesTransferred) { handleLengthReceived(error, bytesTransferred); });
}

void TCP::handleLengthReceived(const asio::error_code& error, size_t bytes_transferred) {
    if (error == asio::error::connection_aborted) {
        if (mClientNotifyFunc)
            (*mClientNotifyFunc)(mClientData);
    }

    if (error)
        return;

    // msglen is in network byte order
    mOSCMsgLength = sc_ntohl(mOSCMsgLength);
    mData = std::make_unique<char[]>(mOSCMsgLength);

    namespace ba = asio;
    ba::async_read(mSocket, ba::buffer(mData.get(), mOSCMsgLength),
                   [this](auto error, auto bytesTransferred) { handleMsgReceived(error, bytesTransferred); });
}

void TCP::handleMsgReceived(const asio::error_code& error, size_t bytes_transferred) {
    double timeReceived = elapsedTime(); // get time now to minimize jitter due to lang load
    if (error == asio::error::connection_aborted) {
        if (mClientNotifyFunc)
            (*mClientNotifyFunc)(mClientData);
    }

    if (error) {
        mData.reset();
        return;
    }

    // The mOSCMsgLength read from the message header should match the actual number of bytes available.
    assert(bytes_transferred == mOSCMsgLength);

    mHandleFunc(std::move(mData), mOSCMsgLength);

    startReceive();
}

int TCP::Close() {
    asio::error_code error;

    mSocket.shutdown(asio::ip::tcp::socket::shutdown_both, error);
    mSocket.close();

    if (error) {
        if (error != asio::error::not_connected) {
            ::error("Socket shutdown failed, closed socket anyway. %s", error.message().c_str());
            return errFailed;
        }
    }

    return errNone;
}

} // namespace OutPort
