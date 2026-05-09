# SC WASM OSC Bridge - Phase 8

A lightweight WebSocket-to-OSC proxy server that enables browser-hosted SuperCollider WASM (scsynth) to communicate with native sclang and external OSC tools.

## Overview

This bridge is **Phase 8** of the WASM port plan. It solves the problem that browsers cannot send or receive raw UDP packets (which OSC uses by default). The bridge:

1. Listens for OSC messages on UDP port (from native sclang, DAWs, TouchOSC, Max/MSP, etc.)
2. Forwards them to connected WebSocket clients (browsers)
3. Receives WebSocket messages from browsers and forwards them to UDP targets
4. (Phase 8.2+) Evaluates SuperCollider code via native sclang subprocess

```
┌─────────────────────────────────────────────┐
│  Bridge Server (Node.js)                     │
│                                             │
│  UDP :57110 ←─ native sclang, TouchOSC, DAW │
│                 Max/MSP, Bitwig              │
│                                             │
│  WebSocket :8080 ─→ Browser tabs           │
│                 (scsynth WASM)              │
└─────────────────────────────────────────────┘
```

## Phases

### Phase 8.1: One-way Relay (2-3 days) ✅ **COMPLETE**
- [x] Create bridge directory structure
- [x] Implement OSC codec (encode/decode messages and bundles)
- [x] Implement WebSocket server
- [x] Implement UDP socket listener
- [x] Forward UDP OSC → WebSocket (binary frames) — `server.js` broadcasts raw UDP bytes to all connected WS clients
- [x] Forward WebSocket binary → UDP target — `forwardToUDP()` in `server.js`
- [ ] Test with CLI tools (oscsend, browser console) — `test.js` covers codec only; live end-to-end CLI test not yet done

### Phase 8.2: JSON Control + sclang Eval (1 week) ✅ **COMPLETE**
- [x] Add sclang child process management — `hclang_proc.js` + `setupHClangProcess()` in `server.js`
- [x] Add JSON `eval` message type for code evaluation — `handleJSONMessage` `'eval'` case in `server.js`
- [x] Capture sclang stdout/stderr and forward as JSON posts — `hclang_proc.js` stdout/stderr → `'post'` events → `broadcastToClients()`
- [x] Forward compiled SynthDef blobs to browser — `'synthdef'` event handler broadcasts base64-encoded blob
- [x] Integrate with browser IDE post window — `sc_ide.html` dynamically imports `hc_bridge_client.js` when `<meta name="sc-bridge-url">` is present; `onPost` handler calls `postLine()`

### Phase 8.3: Browser SC IDE Integration (1 week) ✅ **COMPLETE**
- [x] Implement browser-side WebSocket client — `hc_bridge_client.js` with full API (connect, evaluate, sendOSC, handlers for post/synthdef/osc/status)
- [x] Gate bridge client behind a build-time flag — `sc_ide.html` checks for `<meta name="sc-bridge-url" content="ws://...">` before importing the client; the tag is commented out by default so deployed builds never load bridge code
- [x] Add connection status to IDE — bridge status pill added to the bottom bar (shows green indicator when connected, grays out when offline)
- [x] Wire Cmd+Enter → bridge.evaluate() — `evaluateCode()` routes to `bridge.evaluate()` when bridge is connected and WASM sclang is not yet ready; also sends to bridge alongside WASM eval when both are available
- [x] Map OSC messages to scsynth WASM C API calls — `_handleBridgeOsc()` re-encodes OSC and calls `M._sc_wasm_osc_dispatch()`; `_handleBridgeSynthDef()` dispatches `/d_recv` blobs the same way
- [x] End-to-end test — enable bridge by uncommenting the meta tag; start `node server.js`; open IDE; Cmd+Enter sends to native sclang; post window shows output; SynthDef blobs are dispatched to WASM scsynth

### Phase 8.4: External Tool Integration (ongoing) 🚧 **PARTIAL**
- [x] Document OSC address patterns — see **OSC Address Patterns** section below
- [x] Add OSC recording/playback — `server.js` supports `record_start`/`record_stop`/`playback` JSON messages; recordings are timestamped and replayed with original timing
- [x] Multi-client broadcast — `server.js` already iterates all WS clients for both UDP→WS relay and JSON broadcasts
  
### Deferred, Will be Manually Approved

- [ ] Test with TouchOSC
- [ ] Test with DAWs (Bitwig, Max, Live)

## Quick Start

```bash
# Navigate to bridge directory
cd platform/wasm/bridge

# Install dependencies
npm install

# Start the bridge server
npm start

# Or directly with node
node server.js
```

The server will start on:
- WebSocket: `ws://localhost:8080`
- UDP OSC listener: `0.0.0.0:57110`
- UDP OSC sender: sends to `127.0.0.1:57111`

## Usage

### From Native sclang

Start sclang configured to send OSC to the bridge's listen port:

```bash
sclang -u 57111
```

Then in sclang, OSC messages will be sent to port 57111, and the bridge will forward them to connected browsers.

### From Browser

Connect to the bridge from your browser JavaScript:

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    // Binary frame = raw OSC message
    const msg = decodeOSC(new Uint8Array(event.data));
    console.log('OSC message:', msg.address, msg.args);
  } else {
    // Text frame = JSON control message
    const msg = JSON.parse(event.data);
    console.log('JSON message:', msg.type, msg);
  }
};

// Send OSC message to native sclang
// /s_new: synthdef-name (string), node-id (int), add-action (int), target (int)
const oscBytes = encodeOSC('/s_new', 'siii', ['sine', 1000, 1, 0]);
ws.send(oscBytes);
```

### From CLI Tools

Send OSC messages using `oscsend` or similar tools:

```bash
# Send to bridge (it will forward to browsers)
oscsend localhost 57110 /test 1 2 3

# Or use sendOSC (Python)
python3 -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.sendto(b'/test\0\0\0\0,if\0\0\01\x00\x00\x00\x00\x00\x00@\x00\x00\x00',('localhost',57110))"
```

## Configuration

Edit `config.js` to customize:

```javascript
export default {
  ws: {
    port: 8080,
    allowedOrigins: ['http://localhost:8000'],
    allowAllOrigins: false, // Set to true for development
    maxConnections: 100,
    pingInterval: 30000,
  },
  osc: {
    listenPort: 57110,
    sendPort: 57111,
    sendHost: '127.0.0.1',
    bufferSize: 65536,
  },
  sclang: {
    path: 'sclang',
    args: ['-i', 'none'],
    evalTimeout: 10000,
  },
  logging: {
    level: 'info', // 'debug', 'info', 'warn', 'error'
    colors: true,
    timestamp: true,
  },
};
```

## Protocol

### WebSocket Messages

#### Binary Frames = Raw OSC
- OSC messages are forwarded as-is
- Use `encodeOSC()` / `decodeOSC()` from `osc_codec.js`

#### Text Frames = JSON Control Messages

**Client → Server:**
```json
{ "type": "eval", "code": "Synth(\\sine, [440, 0, 0.1]).play" }
{ "type": "eval", "code": "(defsynth s (freq 440) (Out.ar 0 (SinOsc.ar freq)))", "lang": "scscm", "filename": "piece.scscm" }
{ "type": "status" }
{ "type": "ping" }
```

`eval` optional fields:
- `lang` — `"scd"` (default) or `"scscm"`. When `"scscm"`, the bridge compiles `code` to sclang before forwarding to sclang.
- `filename` — source file name used in error messages (e.g. `"piece.scscm"`).


**Server → Client:**
```json
{ "type": "welcome", "server": "hc-osc-bridge", "version": "1.0.0", "phase": "8.1" }
{ "type": "pong", "timestamp": 1234567890 }
{ "type": "status", "wsClients": 1, "uptime": 123.45, "memory": {...} }
{ "type": "post", "text": "Synth 1000 created", "level": "info" }
{ "type": "synthdef", "name": "sine", "data": "<base64-encoded-SCgf>" }
{ "type": "error", "message": "...", "details": "..." }
```

## Files

### Server-Side (Node.js)
- `server.js` - Main bridge server (WebSocket + UDP + sclang integration)
- `config.js` - Configuration (ports, logging, sclang settings)
- `osc_codec.js` - OSC message/bundle encoder/decoder
- `logger.js` - Colored, timestamped logging utility
- `hclang_proc.js` - sclang child process manager (Phase 8.2)
- `package.json` - Node.js project configuration
- `test.js` - OSC codec test suite
- `README.md` - This file

### Client-Side (Browser)
- `hc_bridge_client.js` - WebSocket client for browser IDE (Phase 8.3)
  - Connects to bridge server
  - Forwards OSC messages to scsynth WASM
  - Handles SynthDef blobs
  - Provides clean API for IDE integration

## Testing

```bash
# Run the test suite (TBD)
npm test

# Manual testing
# 1. Start bridge: node server.js
# 2. Open browser test page: open test.html
# 3. Send OSC from CLI: oscsend localhost 57110 /test 1 2 3
# 4. Verify message appears in browser console
```

## OSC Address Patterns

These are the OSC addresses the bridge relays between native sclang and the browser WASM scsynth.

### Server → Client (UDP → WebSocket)

| Address | Typetags | Arguments | Description |
|---------|----------|-----------|-------------|
| `/d_recv` | `bb` | blob, completion-blob | Send compiled SynthDef to scsynth |
| `/s_new` | `siii[si…]` | defName, nodeId, addAction, targetId, controls… | Create a new Synth |
| `/n_set` | `i[si…]` | nodeId, ctlName, value… | Set synth control values |
| `/n_free` | `i` | nodeId | Free a synth node |
| `/n_run` | `ii` | nodeId, flag | Pause/resume a node |
| `/g_new` | `iii` | groupId, addAction, targetId | Create a group node |
| `/sync` | `i` | id | Sync barrier — triggers `/synced` reply |
| `/b_alloc` | `iii` | bufNum, numFrames, numChans | Allocate a buffer |
| `/b_free` | `i` | bufNum | Free a buffer |
| `/b_write` | `issiiii` | bufNum, path, format, sampleFormat, numFrames, startFrame, leaveOpen | Write buffer to file |
| `/status` | `,` | — | Request server status |
| `/quit` | `,` | — | Quit scsynth |

### Client → Server (WebSocket → UDP)

| Address | Typetags | Arguments | Description |
|---------|----------|-----------|-------------|
| `/status.reply` | `iiiiiffdd` | 1, ugens, synths, groups, defs, avgCPU, peakCPU, nomSR, actualSR | Status response from scsynth |
| `/synced` | `i` | id | Sync barrier reply |
| `/done` | `s` | command | Async completion |
| `/fail` | `ss` | command, message | Failed command |
| `/n_go` | `iiiii` | nodeId, groupId, prevNodeId, nextNodeId, isGroup | Node started |
| `/n_end` | `iiiii` | nodeId, groupId, prevNodeId, nextNodeId, isGroup | Node ended |

### JSON Control Messages (WebSocket only)

These are not OSC — they are text frames handled by the bridge itself.

| `type` | Direction | Description |
|--------|-----------|-------------|
| `eval` | Client → Server | Evaluate SC code in native sclang. Fields: `code` (required), `lang` ('scd'\|'scscm', default 'scd'), `filename` (string, for error context) |
| `boot` | Client → Server | Start the native sclang process |
| `quit` | Client → Server | Stop the native sclang process |
| `status` | Client → Server | Request bridge status |
| `ping` | Client → Server | Keepalive ping |
| `record_start` | Client → Server | Begin recording incoming UDP OSC messages |
| `record_stop` | Client → Server | Stop recording; server replies with `recording` message containing all captured messages |
| `playback` | Client → Server | Replay a `messages` array (from a prior `recording` response) to all WS clients with original timing |
| `welcome` | Server → Client | Sent on connect |
| `pong` | Server → Client | Keepalive reply |
| `post` | Server → Client | Post window text from sclang |
| `synthdef` | Server → Client | Compiled SynthDef blob (base64) |
| `recording` | Server → Client | Captured OSC message array after `record_stop` |
| `error` | Server → Client | Error notification |

## Related Documents

- [WASM_PORT_PLAN.md](../../WASM_PORT_PLAN.md) - Main project plan
- [WEBSOCKET_OSC_BRIDGE_PLAN.md](../WEBSOCKET_OSC_BRIDGE_PLAN.md) - Detailed bridge plan
- [BROWSER_IDE_PLAN.md](../BROWSER_IDE_PLAN.md) - Browser IDE plan

## License

GPL-3.0
