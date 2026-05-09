'use strict';

/**
 * net_server.js - UDP/TCP server and client helpers for WASM CLI networking
 *
 * Phase N1: UDP server mode for hcsynth
 *   startUdpServer(scsynth, worldId, opts, logger) -> Promise<void>
 *
 * Phase N2: TCP server mode for hcsynth
 *   startTcpServer(scsynth, worldId, opts, logger) -> Promise<void>
 *
 * Phase N3: External scsynth UDP routing
 *   createUdpClient(host, port, logger) -> { send, onReply, bindPort, close }
 *
 * The Node.js process owns the sockets; the WASM module owns no sockets.
 * OSC bytes cross the boundary via the C-exported functions:
 *   _hc_wasm_osc_dispatch_reply(worldId, ptr, len) -> rc
 *   _hc_wasm_reply_count(worldId)                  -> n
 *   _hc_wasm_reply_peek(worldId, ptr, bufSize)      -> bytesRead
 * Both hc_wasm_osc_dispatch (fire-and-forget) and hc_wasm_osc_dispatch_reply
 * (captures scsynth→client replies) are supported; _reply variant is preferred.
 */

const dgram = require('node:dgram');
const net = require('node:net');

const MAX_REPLY_BUF = 65536; // 64 KiB — more than enough for any single OSC reply

// ---------------------------------------------------------------------------
// OSC helpers
// ---------------------------------------------------------------------------

/**
 * Extract the OSC address string from a raw buffer.
 * Returns null if buf does not look like an OSC message (must start with '/').
 */
function getOscAddress(buf) {
  if (!buf || buf.length < 2 || buf[0] !== 0x2f /* '/' */) return null;
  let end = 1;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.slice(0, end).toString('utf8');
}

/**
 * Build a minimal OSC /error message with a string description.
 * Layout: addr\0[pad] ,s\0\0 msg\0[pad]
 */
function buildOscString(str) {
  const strBuf = Buffer.from(str + '\0');
  const pad = (4 - (strBuf.length % 4)) % 4;
  return Buffer.concat([strBuf, Buffer.alloc(pad)]);
}

function buildOscError(address, message) {
  const addrBuf = buildOscString(address);
  const typeBuf = buildOscString(',s');
  const msgBuf = buildOscString(message);
  return Buffer.concat([addrBuf, typeBuf, msgBuf]);
}

// ---------------------------------------------------------------------------
// Internal dispatch helper (shared by UDP and TCP)
// ---------------------------------------------------------------------------

/**
 * Dispatch a single OSC packet into the WASM world and drain any reply packets.
 * Returns an array of reply Buffers (may be empty if no reply API is available).
 */
function dispatchAndCollectReplies(scsynth, worldId, msg, logger) {
  const replies = [];

  const ptr = scsynth._malloc(msg.length);
  try {
    scsynth.HEAPU8.set(new Uint8Array(msg.buffer, msg.byteOffset, msg.length), ptr);

    let rc = -3;
    if (typeof scsynth._hc_wasm_osc_dispatch_reply === 'function') {
      rc = scsynth._hc_wasm_osc_dispatch_reply(worldId, ptr, msg.length);
    } else if (typeof scsynth._hc_wasm_osc_dispatch === 'function') {
      rc = scsynth._hc_wasm_osc_dispatch(worldId, ptr, msg.length);
    }

    if (rc !== 0) {
      logger.warn(`OSC dispatch failed (rc=${rc})`);
    }
  } finally {
    scsynth._free(ptr);
  }

  if (typeof scsynth._hc_wasm_reply_peek === 'function') {
    const replyPtr = scsynth._malloc(MAX_REPLY_BUF);
    try {
      let len;
      while ((len = scsynth._hc_wasm_reply_peek(worldId, replyPtr, MAX_REPLY_BUF)) > 0) {
        replies.push(
          Buffer.from(scsynth.HEAPU8.buffer, replyPtr, len).slice()
        );
      }
    } finally {
      scsynth._free(replyPtr);
    }
  }

  return replies;
}

function dispatchAndReply(scsynth, worldId, msg, rinfo, socket, logger) {
  const replies = dispatchAndCollectReplies(scsynth, worldId, msg, logger);
  for (const reply of replies) {
    logger.debug(`UDP reply ${reply.length} bytes -> ${rinfo.address}:${rinfo.port}`);
    socket.send(reply, 0, reply.length, rinfo.port, rinfo.address);
  }
}

function dispatchAndReplyTcp(scsynth, worldId, msg, socket, logger) {
  const replies = dispatchAndCollectReplies(scsynth, worldId, msg, logger);
  for (const reply of replies) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(reply.length);
    logger.debug(`TCP reply ${reply.length} bytes`);
    socket.write(Buffer.concat([lenBuf, reply]));
  }
}

// ---------------------------------------------------------------------------
// Public API — UDP server (Phase N1)
// ---------------------------------------------------------------------------

/**
 * Start a UDP server that routes incoming OSC packets into the WASM scsynth
 * world and sends any replies back to the originating peer.
 *
 * The returned Promise resolves when the server shuts down (either via a
 * /quit OSC message or SIGINT/SIGTERM).
 *
 * @param {object}  scsynth  - Emscripten WASM module instance
 * @param {number}  worldId  - World ID returned by hc_wasm_world_create
 * @param {object}  opts     - { udpPort, bindAddress }
 * @param {object}  logger   - Logger instance
 * @returns {Promise<void>}
 */
function startUdpServer(scsynth, worldId, opts, logger) {
  const udpPort = opts.udpPort !== undefined ? opts.udpPort : 57110;
  const bindAddress = opts.bindAddress || '127.0.0.1';

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');

    let shuttingDown = false;
    function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      try { socket.close(); } catch (_) {}
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    socket.on('error', (err) => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      reject(err);
    });

    socket.on('message', (msg, rinfo) => {
      const addr = getOscAddress(msg);
      logger.debug(`UDP recv ${msg.length} bytes from ${rinfo.address}:${rinfo.port} addr=${addr}`);

      if (addr === '/quit') {
        logger.log('Received /quit — shutting down UDP server');
        shutdown();
        return;
      }

      dispatchAndReply(scsynth, worldId, msg, rinfo, socket, logger);
    });

    socket.on('close', () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      logger.log(`UDP server closed (was listening on ${bindAddress}:${udpPort})`);
      resolve();
    });

    socket.bind(udpPort, bindAddress, () => {
      const addr = socket.address();
      logger.log(`scsynth UDP server listening on ${addr.address}:${addr.port}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Public API — TCP server (Phase N2)
// ---------------------------------------------------------------------------

/**
 * Start a TCP server that speaks the native SC TCP framing protocol:
 * 4-byte big-endian length prefix + OSC bytes, in both directions.
 *
 * @param {object}  scsynth  - Emscripten WASM module instance
 * @param {number}  worldId  - World ID returned by hc_wasm_world_create
 * @param {object}  opts     - { tcpPort, bindAddress, maxLogins, password }
 * @param {object}  logger   - Logger instance
 * @returns {Promise<void>}
 */
function startTcpServer(scsynth, worldId, opts, logger) {
  const tcpPort = opts.tcpPort;
  const bindAddress = opts.bindAddress || '127.0.0.1';
  const maxLogins = opts.maxLogins !== undefined ? opts.maxLogins : 64;
  const password = opts.password || null;

  return new Promise((resolve, reject) => {
    let connectionCount = 0;

    const server = net.createServer((socket) => {
      if (connectionCount >= maxLogins) {
        logger.warn(`TCP: max logins (${maxLogins}) reached — rejecting connection`);
        const errMsg = buildOscError('/error', 'server full');
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(errMsg.length);
        socket.end(Buffer.concat([lenBuf, errMsg]));
        return;
      }

      connectionCount++;
      const peer = `${socket.remoteAddress}:${socket.remotePort}`;
      logger.log(`TCP client connected: ${peer} (${connectionCount}/${maxLogins})`);

      let authenticated = !password;
      let accumBuf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        accumBuf = Buffer.concat([accumBuf, chunk]);

        while (accumBuf.length >= 4) {
          const msgLen = accumBuf.readUInt32BE(0);
          if (accumBuf.length < 4 + msgLen) break;

          const msg = accumBuf.slice(4, 4 + msgLen);
          accumBuf = accumBuf.slice(4 + msgLen);

          const addr = getOscAddress(msg);
          logger.debug(`TCP recv ${msg.length} bytes from ${peer} addr=${addr}`);

          if (password && !authenticated) {
            // Require /notify with password string as first argument before anything else.
            if (addr === '/notify') {
              // OSC /notify ,s <password>: addr(padded) + typetag(padded) + string(padded)
              // Extract first string argument after type tag.
              const provided = extractFirstOscString(msg);
              if (provided === password) {
                authenticated = true;
                logger.log(`TCP client authenticated: ${peer}`);
                // Send /done /notify reply
                const done = buildOscError('/done', '/notify');
                const lenBuf = Buffer.alloc(4);
                lenBuf.writeUInt32BE(done.length);
                socket.write(Buffer.concat([lenBuf, done]));
              } else {
                logger.warn(`TCP: bad password from ${peer}`);
                const errMsg = buildOscError('/error', 'bad password');
                const lenBuf = Buffer.alloc(4);
                lenBuf.writeUInt32BE(errMsg.length);
                socket.end(Buffer.concat([lenBuf, errMsg]));
              }
              continue;
            } else {
              const errMsg = buildOscError('/error', 'not authenticated');
              const lenBuf = Buffer.alloc(4);
              lenBuf.writeUInt32BE(errMsg.length);
              socket.write(Buffer.concat([lenBuf, errMsg]));
              continue;
            }
          }

          if (addr === '/quit') {
            logger.log(`TCP: received /quit from ${peer}`);
            socket.end();
            shutdown();
            return;
          }

          dispatchAndReplyTcp(scsynth, worldId, msg, socket, logger);
        }
      });

      socket.on('close', () => {
        connectionCount--;
        logger.log(`TCP client disconnected: ${peer} (${connectionCount} remaining)`);
      });

      socket.on('error', (err) => {
        logger.warn(`TCP socket error (${peer}): ${err.message}`);
      });
    });

    let shuttingDown = false;
    function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close();
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    server.on('error', (err) => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      reject(err);
    });

    server.on('close', () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      logger.log(`TCP server closed (was listening on ${bindAddress}:${tcpPort})`);
      resolve();
    });

    server.listen(tcpPort, bindAddress, () => {
      const addr = server.address();
      logger.log(`scsynth TCP server listening on ${addr.address}:${addr.port}`);
    });
  });
}

/**
 * Extract the first OSC string argument from a message (after address + type tag).
 * Used for password extraction from /notify messages.
 * Returns null if not found.
 */
function extractFirstOscString(buf) {
  // Skip address (null-terminated, padded to 4 bytes)
  let pos = 0;
  while (pos < buf.length && buf[pos] !== 0) pos++;
  pos = Math.ceil((pos + 1) / 4) * 4; // skip to next 4-byte boundary

  // Skip type tag string (e.g., ",s")
  while (pos < buf.length && buf[pos] !== 0) pos++;
  pos = Math.ceil((pos + 1) / 4) * 4;

  // Read first string argument
  if (pos >= buf.length) return null;
  let end = pos;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.slice(pos, end).toString('utf8');
}

// ---------------------------------------------------------------------------
// Public API — UDP client (Phase N3)
// ---------------------------------------------------------------------------

/**
 * Create a UDP client for routing sclang OSC output to an external scsynth.
 *
 * @param {string}  host    - Remote scsynth host
 * @param {number}  port    - Remote scsynth port
 * @param {object}  logger  - Logger instance
 * @returns {{ send, onReply, bindPort, close }}
 */
function createUdpClient(host, port, logger) {
  const socket = dgram.createSocket('udp4');
  let replyCallback = null;

  socket.on('message', (msg, rinfo) => {
    const addr = getOscAddress(msg);
    logger.debug(`UDP client reply ${msg.length} bytes from ${rinfo.address}:${rinfo.port} addr=${addr}`);
    if (replyCallback) replyCallback(msg, rinfo);
  });

  socket.on('error', (err) => {
    logger.warn(`UDP client error: ${err.message}`);
  });

  function send(bytes) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    socket.send(buf, 0, buf.length, port, host);
  }

  function onReply(callback) {
    replyCallback = callback;
  }

  function bindPort(langPort) {
    return new Promise((resolve, reject) => {
      socket.bind(langPort, '0.0.0.0', () => {
        const addr = socket.address();
        logger.debug(`UDP client bound on ${addr.address}:${addr.port}`);
        resolve(addr.port);
      });
      socket.once('error', reject);
    });
  }

  function close() {
    try { socket.close(); } catch (_) {}
  }

  return { send, onReply, bindPort, close };
}

// ---------------------------------------------------------------------------
// Public API — combined server launcher (Phase N1 + N2)
// ---------------------------------------------------------------------------

/**
 * Start UDP and/or TCP servers based on opts.
 * Resolves when ALL started servers have shut down.
 *
 * @param {object}  scsynth  - Emscripten WASM module instance
 * @param {number}  worldId  - World ID
 * @param {object}  opts     - { udpPort?, bindAddress?, tcpPort?, maxLogins?, password? }
 * @param {object}  logger   - Logger instance
 * @returns {Promise<void>}
 */
async function startServers(scsynth, worldId, opts, logger) {
  const promises = [];

  if (opts.udpPort) {
    promises.push(startUdpServer(scsynth, worldId, opts, logger));
  }

  if (opts.tcpPort) {
    promises.push(startTcpServer(scsynth, worldId, opts, logger));
  }

  if (promises.length === 0) {
    throw new Error('No server port specified — set --udp-port and/or --tcp-port');
  }

  await Promise.all(promises);
}

module.exports = { startUdpServer, startTcpServer, startServers, createUdpClient };
