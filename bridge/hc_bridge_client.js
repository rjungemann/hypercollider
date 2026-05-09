/**
 * SC Bridge Client - Phase 8.3
 * 
 * Browser-side WebSocket client for the OSC Bridge Server.
 * This module connects to the bridge and:
 * 1. Forwards OSC messages to the local scsynth WASM engine
 * 2. Sends code to sclang for evaluation
 * 3. Receives post window output and SynthDef blobs
 * 4. Provides a clean API for the browser IDE
 */

/**
 * HCBridgeClient - WebSocket client for OSC Bridge
 * 
 * Events:
 * - 'connect': () - Connected to bridge
 * - 'disconnect': () - Disconnected from bridge
 * - 'post': (text: string, level: string) - Post window message
 * - 'synthdef': (name: string, data: Uint8Array) - Compiled SynthDef
 * - 'error': (message: string) - Error from bridge
 * - 'status': (info: Object) - Status response
 * - 'osc': (address: string, typetags: string, args: Array) - Raw OSC message
 */
export class HCBridgeClient {
  /**
   * Create a new bridge client
   * @param {string} url - WebSocket URL (e.g., 'ws://localhost:8080')
   * @param {Object} options - Options
   * @param {Function} options.onPost - Post message handler
   * @param {Function} options.onSynthDef - SynthDef handler
   * @param {Function} options.onStatus - Status handler
   * @param {Function} options.onError - Error handler
   */
  constructor(url = 'ws://localhost:8080', options = {}) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // ms
    
    // Event handlers
    this._handlers = {
      post: options.onPost || (() => {}),
      synthdef: options.onSynthDef || (() => {}),
      status: options.onStatus || (() => {}),
      error: options.onError || (() => {}),
      connect: options.onConnect || (() => {}),
      disconnect: options.onDisconnect || (() => {}),
      osc: options.onOsc || (() => {}),
    };
    
    // OSC message handlers for scsynth WASM
    this.oscHandlers = {
      '/s_new': this._handleSynthNew.bind(this),
      '/n_set': this._handleSynthSet.bind(this),
      '/n_free': this._handleSynthFree.bind(this),
      '/d_recv': this._handleSynthDefRecv.bind(this),
      '/sync': this._handleSync.bind(this),
    };
    
    // Connect immediately
    this.connect();
  }

  /**
   * Connect to the bridge server
   */
  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.binaryType = 'arraybuffer';
    
    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._handlers.connect();
    };
    
    this.ws.onclose = () => {
      this.connected = false;
      this._handlers.disconnect();
      this._attemptReconnect();
    };
    
    this.ws.onerror = (err) => {
      this._handlers.error(err.message || 'WebSocket error');
    };
    
    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this._handleBinaryMessage(event.data);
      } else {
        this._handleTextMessage(event.data);
      }
    };
  }

  /**
   * Attempt to reconnect after disconnection
   */
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._handlers.error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Handle binary message (raw OSC)
   */
  _handleBinaryMessage(data) {
    const buffer = new Uint8Array(data);
    
    try {
      // Try to decode as OSC bundle first
      let decoded;
      try {
        decoded = { type: 'bundle', ...decodeOSCBundle(buffer) };
      } catch (e) {
        // Try as single message
        decoded = decodeOSC(buffer);
      }
      
      // Handle known OSC addresses
      if (decoded.address && this.oscHandlers[decoded.address]) {
        this.oscHandlers[decoded.address](decoded.args);
      }
      
      // Emit raw OSC event
      this._handlers.osc(decoded.address, decoded.typetags, decoded.args);
    } catch (e) {
      console.warn('Failed to decode OSC message:', e.message);
    }
  }

  /**
   * Handle text message (JSON)
   */
  _handleTextMessage(data) {
    try {
      const msg = JSON.parse(data);
      
      switch (msg.type) {
        case 'welcome':
          // Server welcome message
          break;
          
        case 'pong':
          // Ping/pong response
          break;
          
        case 'post':
          this._handlers.post(msg.text, msg.level || 'info');
          break;
          
        case 'synthdef':
          // Decode base64 data
          const synthDefData = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
          this._handlers.synthdef(msg.name, synthDefData);
          break;
          
        case 'status':
          this._handlers.status(msg);
          break;
          
        case 'error':
          this._handlers.error(msg.message || 'Unknown error');
          break;
          
        default:
          console.warn('Unknown message type:', msg.type);
      }
    } catch (e) {
      this._handlers.error(`Failed to parse JSON: ${e.message}`);
    }
  }

  /**
   * Send a JSON control message to the bridge
   */
  sendMessage(msg) {
    if (!this.connected || !this.ws) {
      this._handlers.error('Not connected to bridge');
      return false;
    }
    
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Evaluate SuperCollider code via sclang
   * @param {string} code - SC code to evaluate
   * @param {Object} options - Options
   * @param {string} options.lang - Language: 'scd' (default) or 'scscm'
   * @param {string} options.filename - Source filename for error context
   */
  evaluate(code, options = {}) {
    const msg = { type: 'eval', code };
    if (options.lang) {
      msg.lang = options.lang;
    }
    if (options.filename) {
      msg.filename = options.filename;
    }
    return this.sendMessage(msg);
  }

  /**
   * Boot the sclang process on the bridge
   */
  boot() {
    return this.sendMessage({ type: 'boot' });
  }

  /**
   * Quit the sclang process on the bridge
   */
  quit() {
    return this.sendMessage({ type: 'quit' });
  }

  /**
   * Request status from the bridge
   */
  status() {
    return this.sendMessage({ type: 'status' });
  }

  /**
   * Send ping to check connection
   */
  ping() {
    return this.sendMessage({ type: 'ping' });
  }

  /**
   * Send raw OSC message to the bridge (forwarded to UDP)
   */
  sendOSC(address, typetags, args) {
    if (!this.connected || !this.ws) {
      this._handlers.error('Not connected to bridge');
      return false;
    }
    
    const encoded = encodeOSC(address, typetags, args);
    this.ws.send(encoded);
    return true;
  }

  /**
   * Disconnect from the bridge
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected to the bridge
   */
  isConnected() {
    return this.connected;
  }

  // ============================================================
  // OSC Message Handlers for scsynth WASM
  // ============================================================

  /**
   * Handle /s_new OSC message
   * Called when a new synth should be created
   */
  _handleSynthNew(args) {
    // args: [synthDefName, nodeId, addAction, targetId, ...controlArgs]
    // This would be forwarded to scsynth WASM via Module._sc_wasm_synth_new()
    if (typeof window !== 'undefined' && window.M && window.M._sc_wasm_synth_new) {
      const worldId = 0; // Default world
      const synthDefNamePtr = window.M._malloc(args[0].length + 1);
      window.M.writeAsciiToMemory(args[0], synthDefNamePtr);
      window.M._sc_wasm_synth_new(worldId, synthDefNamePtr, args[1], args[2], args[3]);
      window.M._free(synthDefNamePtr);
    }
    console.log('OSC /s_new:', args);
  }

  /**
   * Handle /n_set OSC message
   * Called when synth control values should be set
   */
  _handleSynthSet(args) {
    // args: [nodeId, controlName, value, controlName2, value2, ...]
    if (typeof window !== 'undefined' && window.M && window.M._sc_wasm_synth_set) {
      for (let i = 1; i < args.length; i += 2) {
        const controlName = args[i];
        const value = args[i + 1];
        window.M._sc_wasm_synth_set(args[0], controlName, value);
      }
    }
    console.log('OSC /n_set:', args);
  }

  /**
   * Handle /n_free OSC message
   * Called when a synth should be freed
   */
  _handleSynthFree(args) {
    // args: [nodeId]
    if (typeof window !== 'undefined' && window.M && window.M._sc_wasm_synth_free) {
      window.M._sc_wasm_synth_free(args[0]);
    }
    console.log('OSC /n_free:', args);
  }

  /**
   * Handle /d_recv OSC message
   * Called when a SynthDef blob is received
   */
  _handleSynthDefRecv(args) {
    // args: [synthDefName, ...blobData]
    // The blob data would need to be extracted from the OSC message
    console.log('OSC /d_recv:', args);
  }

  /**
   * Handle /sync OSC message
   */
  _handleSync(args) {
    console.log('OSC /sync:', args);
  }
}

// ============================================================
// Default OSC Codec Implementation (for browser use)
// ============================================================

/**
 * Minimal OSC codec for browser use (same as osc_codec.js but for browser)
 * This is a subset of the full codec for common use cases
 */

// OSC type information
const OSC_TYPE_SIZES = {
  i: 4, f: 4, d: 8, s: 0, S: 0, c: 4, r: 4, m: 4, t: 8, 
  F: 0, T: 0, N: 0, I: 0, h: 8, ':': 8, b: 0,
};

function padTo4(n) {
  return ((n + 3) & ~3);
}

function writePaddedString(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str + '\0');
  const paddedLength = padTo4(bytes.length);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  return padded;
}

function readPaddedString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end++;
  }
  const decoder = new TextDecoder();
  const str = decoder.decode(buffer.subarray(offset, end));
  const lengthIncludingNull = end - offset + 1;
  const paddedEnd = ((lengthIncludingNull + 3) & ~3) + offset;
  return { string: str, nextOffset: paddedEnd };
}

function int32ToBytes(value) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setInt32(0, value, false);
  return new Uint8Array(buf);
}

function bytesToInt32(buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getInt32(0, false);
}

function float32ToBytes(value) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, false);
  return new Uint8Array(buf);
}

function bytesToFloat32(buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getFloat32(0, false);
}

/**
 * Encode OSC message
 */
export function encodeOSC(address, typetags, args) {
  const addressBytes = writePaddedString(address);
  const typeBytes = writePaddedString(',' + typetags);
  
  const argBuffers = [];
  for (let i = 0; i < typetags.length; i++) {
    const tag = typetags[i];
    const arg = args[i];
    let encoded;
    
    switch (tag) {
      case 'i':
        encoded = int32ToBytes(arg);
        break;
      case 'f':
        encoded = float32ToBytes(arg);
        break;
      case 's':
      case 'S':
        encoded = writePaddedString(arg);
        break;
      case 'd':
        const buf64 = new ArrayBuffer(8);
        new DataView(buf64).setFloat64(0, arg, false);
        encoded = new Uint8Array(buf64);
        break;
      default:
        // Unknown type - skip
        encoded = new Uint8Array(0);
    }
    
    // Pad to 4 bytes
    const paddedLength = padTo4(encoded.length);
    if (encoded.length < paddedLength) {
      const padded = new Uint8Array(paddedLength);
      padded.set(encoded);
      encoded = padded;
    }
    
    argBuffers.push(encoded);
  }
  
  const totalLength = addressBytes.length + typeBytes.length + 
    argBuffers.reduce((sum, b) => sum + b.length, 0);
  
  const result = new Uint8Array(totalLength);
  let offset = 0;
  result.set(addressBytes, offset);
  offset += addressBytes.length;
  result.set(typeBytes, offset);
  offset += typeBytes.length;
  for (const argBuf of argBuffers) {
    result.set(argBuf, offset);
    offset += argBuf.length;
  }
  
  return result;
}

/**
 * Decode OSC message
 */
export function decodeOSC(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer = new Uint8Array(buffer);
  }
  
  let offset = 0;
  
  // Read address
  const { string: address, nextOffset } = readPaddedString(buffer, offset);
  offset = nextOffset;
  
  // Read type tags
  const { string: typeTagString, nextOffset: nextOffset2 } = readPaddedString(buffer, offset);
  offset = nextOffset2;
  
  // Remove the leading comma
  const typetags = typeTagString.substring(1);
  
  // Read arguments
  const args = [];
  for (let i = 0; i < typetags.length; i++) {
    const tag = typetags[i];
    
    switch (tag) {
      case 'i':
        args.push(bytesToInt32(buffer.subarray(offset, offset + 4)));
        offset += 4;
        break;
      case 'f':
        args.push(bytesToFloat32(buffer.subarray(offset, offset + 4)));
        offset += 4;
        break;
      case 'd':
        args.push(new DataView(buffer.buffer, buffer.byteOffset + offset, 8).getFloat64(0, false));
        offset += 8;
        break;
      case 's':
      case 'S': {
        const result = readPaddedString(buffer, offset);
        args.push(result.string);
        offset = result.nextOffset;
        break;
      }
      default:
        // Skip unknown types
        offset += OSC_TYPE_SIZES[tag] || 4;
    }
  }
  
  return {
    address,
    typetags,
    args,
    raw: buffer,
  };
}

export default HCBridgeClient;
