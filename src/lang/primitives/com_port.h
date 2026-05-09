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

#pragma once

#include "reply_impl.hpp"
#include "SC_Types.h"

#include <array>
#define ASIO_STANDALONE
#include <asio.hpp>
#include <memory>

//////////////////////////////////////////////////////////////////////////////////////////////////////////

const int kTextBufSize = 65536;

enum class HandlerType { OSC, Raw };

using HandleDataFunc = std::function<void(std::unique_ptr<char[]>, size_t)>;

//////////////////////////////////////////////////////////////////////////////////////////////////////////

namespace Detail {

class TCPConnection : public std::enable_shared_from_this<TCPConnection> {
public:
    TCPConnection(const TCPConnection&) = delete;
    TCPConnection& operator=(const TCPConnection&) = delete;
public:
    using pointer = std::shared_ptr<TCPConnection>;

    TCPConnection(asio::io_context& ioContext, int portNum, HandlerType);

    void start();
    auto& getSocket() { return mSocket; }

private:
    void handleLengthReceived(const asio::error_code& error, size_t bytes_transferred);
    void handleMsgReceived(const asio::error_code& error, size_t bytes_transferred);
    void initHandler(HandlerType);

    HandleDataFunc mHandleFunc;
    asio::ip::tcp::socket mSocket;
    int32 mOSCMsgLength;
    std::unique_ptr<char[]> mData;
    const int mPortNum;
};
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

namespace InPort {

class UDP {
public:
    UDP(const UDP&) = delete;
    UDP& operator=(const UDP&) = delete;
public:
    UDP(int inPortNum, HandlerType, int portsToCheck = 10);
    ~UDP() = default;

    auto RealPortNum() const { return mPortNum; }
    auto& getSocket() { return mUdpSocket; }

private:
    void initHandler(HandlerType type);

    void handleReceivedUDP(const asio::error_code& error, std::size_t bytes_transferred);
    void startReceiveUDP();

    int mPortNum;
    HandleDataFunc mHandleFunc;
    static constexpr int receiveBufferSize = 4 * 1024 * 1024;
    static constexpr int sendBufferSize = 4 * 1024 * 1024;
    static constexpr int fallbackBufferSize = 1 * 1024 * 1024;
    std::array<char, kTextBufSize> mRecvBuffer;
    asio::ip::udp::endpoint mRemoteEndpoint;
    asio::ip::udp::socket mUdpSocket;
};

class UDPCustom : public UDP {
public:
    UDPCustom(int inPortNum, HandlerType);
    ~UDPCustom() = default;
};

class TCP {
public:
    TCP(const TCP&) = delete;
    TCP& operator=(const TCP&) = delete;
    TCP(int inPortNum, int inMaxConnections, int inBacklog, HandlerType);

private:
    void startAccept();
    void handleAccept(Detail::TCPConnection::pointer new_connection, const asio::error_code& error);

    HandleDataFunc mHandleFunc;
    const HandlerType mHandlerType;
    const int mPortNum;
    asio::ip::tcp::acceptor mAcceptor;
};

} // namespace InPort

//////////////////////////////////////////////////////////////////////////////////////////////////////////

namespace OutPort {

class TCP {
public:
    TCP(const TCP&) = delete;
    TCP& operator=(const TCP&) = delete;
    typedef void (*ClientNotifyFunc)(void* clientData);
    TCP(std::uint64_t inAddress, int inPort, HandlerType, ClientNotifyFunc notifyFunc = 0, void* clientData = 0);
    int Close();

    asio::ip::tcp::socket& Socket() { return mSocket; }

private:
    void startReceive();
    void handleLengthReceived(const asio::error_code& error, size_t bytes_transferred);
    void handleMsgReceived(const asio::error_code& error, size_t bytes_transferred);
    void initHandler(HandlerType);

    HandleDataFunc mHandleFunc;
    int32 mOSCMsgLength;
    std::unique_ptr<char[]> mData;
    asio::ip::tcp::socket mSocket;
    asio::ip::tcp::endpoint mEndpoint;
    ClientNotifyFunc mClientNotifyFunc;
    void* mClientData;
};

} // namespace OutPort
