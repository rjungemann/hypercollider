#!/usr/bin/env node
/**
 * WebSocket/OSC Bridge Server - Phase 8.1 & 8.2
 * 
 * This is the main bridge server that relays messages between:
 * - WebSocket clients (browsers running scsynth WASM)
 * - UDP OSC (native sclang, DAWs, TouchOSC, etc.)
 * - Native sclang process (for code evaluation)
 * 
 * Phase 8.1: One-way relay (UDP ↔ WebSocket)
 * Phase 8.2: JSON control + sclang eval
 */

import { WebSocketServer } from 'ws';
import * as dgram from 'node:dgram';
import config from './config.js';
import { encodeOSC, decodeOSC, encodeOSCBundle, decodeOSCBundle } from './osc_codec.js';
import { Logger } from './logger.js';
import { HClangProcess } from './hclang_proc.js';

const logger = new Logger(config.logging);

// ============================================================
// Configuration (imported from config.js)
// ============================================================
const WSS_PORT = config.ws.port;
const OSC_LISTEN_PORT = config.osc.listenPort;
const OSC_SEND_PORT = config.osc.sendPort;
const OSC_SEND_HOST = config.osc.sendHost;

// ============================================================
// State
// ============================================================
const wsClients = new Set();
let udpSocket;
let sclangProcess;

// OSC recording/playback state (Phase 8.4)
let oscRecording = null; // null = idle, Array = actively recording
let oscPlaybackActive = false;

// ============================================================
// UDP Socket Setup
// ============================================================
function setupUDPSocket() {
  udpSocket = dgram.createSocket('udp4');

  udpSocket.on('message', (msg, rinfo) => {
    logger.debug('UDP OSC message received', {
      from: `${rinfo.address}:${rinfo.port}`,
      length: msg.length,
    });

    // Record message if recording is active
    if (oscRecording !== null) {
      oscRecording.push({ timestamp: Date.now(), data: Array.from(msg) });
    }

    try {
      // Forward to all connected WebSocket clients as binary
      for (const client of wsClients) {
        if (client.readyState === 1) { // OPEN
          client.send(msg);
        }
      }
      logger.info('UDP->WS: Forwarded OSC message to WebSocket clients', { clientCount: wsClients.size });
    } catch (e) {
      logger.error('Failed to forward UDP message', { error: e.message });
    }
  });

  udpSocket.on('error', (err) => {
    logger.error('UDP socket error', { error: err.message });
  });

  udpSocket.on('listening', () => {
    const address = udpSocket.address();
    logger.info('UDP socket listening', { address: address.address, port: address.port });
  });

  // Bind to listen port
  udpSocket.bind(OSC_LISTEN_PORT);

  return udpSocket;
}

// ============================================================
// WebSocket Server Setup
// ============================================================
function setupWebSocketServer() {
  const wss = new WebSocketServer({
    port: WSS_PORT,
    // Origin verification
    verifyClient: (info) => {
      if (config.ws.allowAllOrigins) {
        return true;
      }
      const origin = info.origin;
      const allowed = config.ws.allowedOrigins.includes(origin);
      if (!allowed) {
        logger.warn('WebSocket connection rejected - origin not allowed', { origin });
      }
      return allowed;
    },
  });

  wss.on('connection', (ws, req) => {
    const remoteAddress = req.socket.remoteAddress;
    const remotePort = req.socket.remotePort;
    logger.info('WebSocket client connected', { address: remoteAddress, port: remotePort });

    wsClients.add(ws);

    // Set up message handler
    ws.on('message', (data, isBinary) => {
      logger.debug('WebSocket message received', {
        from: `${remoteAddress}:${remotePort}`,
        isBinary,
        length: data.length,
      });

      if (isBinary) {
        // Binary frame = raw OSC bytes
        // Forward to UDP target
        forwardToUDP(data);
      } else {
        // Text frame = JSON control message
        handleJSONMessage(ws, data.toString());
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      logger.info('WebSocket client disconnected', { address: remoteAddress, port: remotePort });
    });

    ws.on('error', (err) => {
      logger.error('WebSocket client error', { address: remoteAddress, error: err.message });
      wsClients.delete(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      server: 'hc-osc-bridge',
      version: '1.0.0',
      phase: '8.2',
      wsPort: WSS_PORT,
      oscPort: OSC_LISTEN_PORT,
      sclangReady: sclangProcess ? sclangProcess.isReady() : false,
      timestamp: Date.now(),
    }));
  });

  wss.on('error', (err) => {
    logger.error('WebSocket server error', { error: err.message });
  });

  // Set up ping/pong for connection health
  setInterval(() => {
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.ping();
      }
    }
  }, config.ws.pingInterval);

  return wss;
}

// ============================================================
// Sclang Process Integration (Phase 8.2)
// ============================================================
function setupHClangProcess() {
  sclangProcess = new HClangProcess();

  // Forward sclang post messages to all WebSocket clients
  sclangProcess.on('post', (msg) => {
    logger.debug('Sclang post message', { text: msg.text, level: msg.level });
    broadcastToClients({ type: 'post', text: msg.text, level: msg.level });
  });

  // Forward SynthDef blobs to all WebSocket clients
  sclangProcess.on('synthdef', (msg) => {
    logger.info('SynthDef compiled', { name: msg.name, size: msg.data.length });
    broadcastToClients({ type: 'synthdef', name: msg.name, data: msg.data.toString('base64') });
  });

  sclangProcess.on('error', (err) => {
    logger.error('Sclang error', { message: err.message, details: err.details });
    broadcastToClients({ type: 'post', text: err.message, level: 'error' });
  });

  sclangProcess.on('ready', () => {
    logger.info('Sclang process ready');
    broadcastToClients({ type: 'post', text: 'sclang ready', level: 'info' });
  });

  sclangProcess.on('exit', (code) => {
    logger.warn('Sclang process exited', { code });
    broadcastToClients({ type: 'post', text: `sclang exited with code ${code}`, level: 'warn' });
  });

  return sclangProcess;
}

/**
 * Broadcast a JSON message to all connected WebSocket clients
 */
function broadcastToClients(msg) {
  const json = JSON.stringify(msg);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}

// ============================================================
// Message Forwarding
// ============================================================
function forwardToUDP(data) {
  if (!udpSocket) {
    logger.error('UDP socket not initialized, cannot forward message');
    return;
  }

  try {
    udpSocket.send(data, OSC_SEND_PORT, OSC_SEND_HOST, (err) => {
      if (err) {
        logger.error('Failed to send UDP message', { error: err.message });
      } else {
        logger.debug('WS->UDP: Forwarded message to UDP target', {
          host: OSC_SEND_HOST,
          port: OSC_SEND_PORT,
        });
      }
    });
  } catch (e) {
    logger.error('Failed to forward WebSocket message to UDP', { error: e.message });
  }
}

// ============================================================
// JSON Control Message Handling (Phase 8.2)
// ============================================================
function handleJSONMessage(ws, data) {
  try {
    const msg = JSON.parse(data);
    logger.debug('Received JSON control message', { type: msg.type });

    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;

      case 'status':
        ws.send(JSON.stringify({
          type: 'status',
          wsClients: wsClients.size,
          sclangReady: sclangProcess ? sclangProcess.isReady() : false,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        }));
        break;

      case 'boot':
        // Start sclang if not already running
        if (!sclangProcess) {
          setupHClangProcess();
          ws.send(JSON.stringify({ type: 'post', text: 'Starting sclang...', level: 'info' }));
        } else if (!sclangProcess.isReady()) {
          ws.send(JSON.stringify({ type: 'post', text: 'sclang already starting...', level: 'info' }));
        } else {
          ws.send(JSON.stringify({ type: 'post', text: 'sclang already running', level: 'info' }));
        }
        break;

      case 'quit':
        // Quit sclang
        if (sclangProcess) {
          sclangProcess.quit();
          sclangProcess = null;
          ws.send(JSON.stringify({ type: 'post', text: 'sclang stopped', level: 'info' }));
        } else {
          ws.send(JSON.stringify({ type: 'post', text: 'sclang not running', level: 'info' }));
        }
        break;

      case 'eval': {
        // Phase 8.2: Evaluate SuperCollier code
        // Support: msg.code (sclang), msg.lang ('scscm'|'scd'), msg.filename (for error context)
        if (!sclangProcess) {
          setupHClangProcess();
        }

        if (!sclangProcess.isReady()) {
          ws.send(JSON.stringify({
            type: 'post',
            text: 'sclang not ready, please wait...',
            level: 'warn',
          }));
          // Queue the eval for when sclang is ready
          sclangProcess.once('ready', () => {
            handleJSONMessage(ws, data);
          });
          return;
        }

        let codeToEval = msg.code;
        const lang = msg.lang || 'scd';

        // Compile scscm to sclang if needed
        if (lang === 'scscm') {
          try {
            // Dynamically import the CommonJS scscm compiler
            const { compileScscmText } = await import('../cli/lhc_compile.js');
            const filename = msg.filename || '<eval>';
            codeToEval = compileScscmText(codeToEval, filename);
          } catch (err) {
            ws.send(JSON.stringify({
              type: 'post',
              text: `scscm compilation error: ${err.message}`,
              level: 'error',
            }));
            break;
          }
        }

        sclangProcess.evaluate(codeToEval, {}, (result) => {
          if (result.error) {
            ws.send(JSON.stringify({
              type: 'post',
              text: result.error,
              level: 'error',
            }));
          } else if (result.output) {
            ws.send(JSON.stringify({
              type: 'post',
              text: result.output.trim(),
              level: 'info',
            }));
          }
        });
        break;
      }

      // Phase 8.4: OSC Recording
      case 'record_start':
        oscRecording = [];
        logger.info('OSC recording started');
        broadcastToClients({ type: 'post', text: 'OSC recording started', level: 'info' });
        break;

      case 'record_stop': {
        const recording = oscRecording;
        oscRecording = null;
        const count = recording ? recording.length : 0;
        logger.info('OSC recording stopped', { count });
        ws.send(JSON.stringify({ type: 'recording', messages: recording || [], count }));
        broadcastToClients({ type: 'post', text: `OSC recording stopped — ${count} messages captured`, level: 'info' });
        break;
      }

      case 'playback':
        if (!Array.isArray(msg.messages) || msg.messages.length === 0) {
          ws.send(JSON.stringify({ type: 'error', message: 'playback: messages array required' }));
          break;
        }
        playbackOSC(msg.messages);
        break;

      default:
        logger.warn('Unknown JSON message type', { type: msg.type });
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${msg.type}`,
        }));
    }
  } catch (e) {
    logger.error('Failed to parse JSON message', { error: e.message });
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Invalid JSON message',
      details: e.message,
    }));
  }
}

// ============================================================
// OSC Playback (Phase 8.4)
// ============================================================

/**
 * Replay a recorded sequence of OSC messages to all connected WebSocket clients.
 * Timing is preserved relative to the first message.
 * @param {Array<{timestamp: number, data: number[]}>} messages
 */
function playbackOSC(messages) {
  if (oscPlaybackActive) {
    logger.warn('Playback already in progress');
    return;
  }
  oscPlaybackActive = true;
  const firstTs = messages[0].timestamp;
  broadcastToClients({ type: 'post', text: `Playback: replaying ${messages.length} OSC messages`, level: 'info' });

  let completed = 0;
  for (const entry of messages) {
    const delay = entry.timestamp - firstTs;
    setTimeout(() => {
      const buf = Buffer.from(entry.data);
      for (const client of wsClients) {
        if (client.readyState === 1) client.send(buf);
      }
      completed++;
      if (completed === messages.length) {
        oscPlaybackActive = false;
        broadcastToClients({ type: 'post', text: 'Playback complete', level: 'info' });
      }
    }, delay);
  }
}

// ============================================================
// Main Entry Point
// ============================================================
function main() {
  logger.info('Starting SC WASM OSC Bridge Server - Phase 8.2', {
    version: '1.0.0',
    wsPort: WSS_PORT,
    oscPort: OSC_LISTEN_PORT,
  });

  // Setup servers
  setupUDPSocket();
  setupWebSocketServer();
  
  // Setup sclang process (lazy - started on first eval or boot request)
  // setupHClangProcess(); // Start lazily to avoid startup delay

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down gracefully...');
    if (udpSocket) {
      udpSocket.close();
    }
    if (sclangProcess) {
      sclangProcess.quit();
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    if (udpSocket) {
      udpSocket.close();
    }
    if (sclangProcess) {
      sclangProcess.quit();
    }
    process.exit(0);
  });
}

main();
