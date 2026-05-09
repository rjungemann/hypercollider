/**
 * Configuration for WebSocket/OSC Bridge Server
 * This is the central configuration for Phase 8 of the WASM port plan.
 */

export default {
  ws: {
    port: 8080,
    // Allow connections from these origins (CORS for WebSocket)
    // Use '*' for development, but specify exact origins for production
    allowedOrigins: ['http://localhost:8000', 'http://127.0.0.1:8000'],
    // Set to true to allow all origins (NOT RECOMMENDED for production)
    allowAllOrigins: true,
    // Maximum number of concurrent WebSocket connections
    maxConnections: 100,
    // Ping interval to check connection health (ms)
    pingInterval: 30000,
  },
  osc: {
    // UDP port to listen on for incoming OSC (from native sclang, DAWs, etc.)
    listenPort: 57110,
    // UDP port to send OSC to (for native scsynth, if running)
    sendPort: 57111,
    // Host to send OSC to
    sendHost: '127.0.0.1',
    // Buffer size for UDP packets
    bufferSize: 65536,
  },
  sclang: {
    // Path to native sclang binary
    path: 'sclang',
    // Arguments for sclang
    args: ['-i', 'none'],
    // Timeout for sclang evaluation (ms)
    evalTimeout: 10000,
    // Maximum number of concurrent eval requests
    maxConcurrentEvals: 10,
  },
  logging: {
    level: 'info', // 'debug', 'info', 'warn', 'error'
    colors: true,
    timestamp: true,
  },
};
