/**
 * OSC Codec - Minimal OSC message encoder/decoder
 * Part of Phase 8 (OSC Bridge) of the WASM port plan.
 * 
 * This is a lightweight OSC codec that can be used both in Node.js (bridge server)
 * and in the browser. It handles the core OSC message format:
 * - Address pattern (null-terminated string, padded to 4-byte boundary)
 * - Type tag string (null-terminated string, padded to 4-byte boundary)
 * - Arguments (each padded to 4-byte boundary)
 */

// OSC type tags and their corresponding JS types
const OSC_TYPES = {
  i: { name: 'int32', size: 4 },
  f: { name: 'float32', size: 4 },
  d: { name: 'float64', size: 8 },
  s: { name: 'string', size: 0 }, // variable
  S: { name: 'symbol', size: 0 }, // variable
  c: { name: 'char', size: 4 },
  r: { name: 'rgba', size: 4 },
  m: { name: 'midi', size: 4 },
  t: { name: 'timetag', size: 8 },
  F: { name: 'false', size: 0 },
  T: { name: 'true', size: 0 },
  N: { name: 'nil', size: 0 },
  I: { name: 'infinitum', size: 0 },
  b: { name: 'blob', size: 0 }, // variable
  h: { name: 'int64', size: 8 },
  ':': { name: 'timetag', size: 8 }, // alias
};

/**
 * Pad a buffer to a multiple of 4 bytes (OSC requirement)
 */
function padTo4(buffer) {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  const padding = 4 - remainder;
  const padded = new Uint8Array(buffer.length + padding);
  padded.set(buffer);
  return padded;
}

/**
 * Write a null-terminated string padded to 4-byte boundary
 */
function writePaddedString(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str + '\0');
  return padTo4(bytes);
}

/**
 * Read a null-terminated string from a buffer at a given offset
 */
function readPaddedString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end++;
  }
  const decoder = new TextDecoder();
  const str = decoder.decode(buffer.subarray(offset, end));
  // OSC strings are null-terminated and padded to 4-byte boundary
  // The null byte is at position 'end', so total length is (end - offset + 1)
  // Pad to next 4-byte boundary
  const lengthIncludingNull = end - offset + 1;
  const paddedEnd = ((lengthIncludingNull + 3) & ~3) + offset;
  return { string: str, nextOffset: paddedEnd };
}

/**
 * Encode an OSC message to a Uint8Array
 * @param {string} address - OSC address pattern (e.g., '/s_new')
 * @param {string} typetags - OSC type tag string WITHOUT leading comma (e.g., 'sii')
 * @param {Array} args - Arguments matching the typetags
 * @returns {Uint8Array} - Encoded OSC message
 */
export function encodeOSC(address, typetags, args) {
  const addressBytes = writePaddedString(address);
  // OSC type tag string starts with ',' followed by type tags, null-terminated
  const typeBytes = writePaddedString(',' + typetags);
  
  const argBuffers = [];
  for (let i = 0; i < typetags.length; i++) {
    const tag = typetags[i];
    const arg = args[i];
    const encoded = encodeArg(tag, arg);
    argBuffers.push(padTo4(encoded));
  }
  
  // Calculate total length and concatenate
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
 * Encode a single OSC argument based on its type tag
 */
function encodeArg(tag, value) {
  switch (tag) {
    case 'i': // int32
      return int32ToBytes(value);
    case 'f': // float32
      return float32ToBytes(value);
    case 'd': // float64
      return float64ToBytes(value);
    case 's': // string
    case 'S': // symbol
      return writePaddedString(value);
    case 'c': // char
      return new Uint8Array([value.charCodeAt(0), 0, 0, 0]);
    case 'F': // false
      return new Uint8Array(0);
    case 'T': // true
      return new Uint8Array(0);
    case 'N': // nil
      return new Uint8Array(0);
    case 'm': // midi (4 bytes: port, status, data1, data2)
      return new Uint8Array(4);
    case 't': // timetag (8 bytes: seconds, fraction)
    case ':':
      return new Uint8Array(8);
    case 'h': // int64
      return int64ToBytes(BigInt(value));
    default:
      console.warn(`OSC: unknown type tag '${tag}'`);
      return new Uint8Array(0);
  }
}

/**
 * Decode an OSC message from a Uint8Array or Buffer
 * @param {Uint8Array|Buffer} buffer - Raw OSC message
 * @returns {Object} - { address: string, typetags: string, args: Array, raw: Uint8Array }
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
    const { arg, nextOffset: argNext } = decodeArg(buffer, offset, tag);
    args.push(arg);
    offset = argNext;
  }
  
  return {
    address,
    typetags,
    args,
    raw: buffer,
  };
}

/**
 * Decode a single OSC argument from a buffer
 */
function decodeArg(buffer, offset, tag) {
  switch (tag) {
    case 'i':
      return { arg: bytesToInt32(buffer.subarray(offset, offset + 4)), nextOffset: offset + 4 };
    case 'f':
      return { arg: bytesToFloat32(buffer.subarray(offset, offset + 4)), nextOffset: offset + 4 };
    case 'd':
      return { arg: bytesToFloat64(buffer.subarray(offset, offset + 8)), nextOffset: offset + 8 };
    case 's':
    case 'S': {
      const result = readPaddedString(buffer, offset);
      return { arg: result.string, nextOffset: result.nextOffset };
    }
    case 'c':
      return { arg: String.fromCharCode(buffer[offset]), nextOffset: offset + 4 };
    case 'F':
      return { arg: false, nextOffset: offset };
    case 'T':
      return { arg: true, nextOffset: offset };
    case 'N':
    case 'I':
      return { arg: null, nextOffset: offset };
    case 'm':
    case 'r':
      return { arg: buffer.subarray(offset, offset + 4), nextOffset: offset + 4 };
    case 't':
    case ':':
      return { arg: buffer.subarray(offset, offset + 8), nextOffset: offset + 8 };
    case 'h':
      return { arg: bytesToInt64(buffer.subarray(offset, offset + 8)), nextOffset: offset + 8 };
    default:
      console.warn(`OSC: unknown type tag '${tag}' at offset ${offset}`);
      // Skip 4 bytes as fallback
      return { arg: null, nextOffset: offset + 4 };
  }
}

// ========== Helper Functions ==========

function int32ToBytes(value) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setInt32(0, value, false); // Big-endian (network byte order)
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

function float64ToBytes(value) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return new Uint8Array(buf);
}

function bytesToFloat64(buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getFloat64(0, false);
}

function int64ToBytes(value) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigInt64(0, value, false);
  return new Uint8Array(buf);
}

function bytesToInt64(buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getBigInt64(0, false);
}

/**
 * Create an OSC bundle (collection of messages with a timetag)
 * @param {number} timetag - Unix timestamp in seconds (use 0 for immediate)
 * @param {Array} messages - Array of {address, typetags, args} objects
 * @returns {Uint8Array} - Encoded OSC bundle
 */
export function encodeOSCBundle(timetag, messages) {
  // Bundle header: '#bundle\0' + timetag (8 bytes)
  const bundleHeader = writePaddedString('#bundle');
  const timetagBytes = int64ToBytes(BigInt(timetag * Math.pow(2, 32))); // Convert to NTP timestamp
  
  // Encode each message with its length prefix
  const messageBuffers = [];
  for (const msg of messages) {
    const encoded = encodeOSC(msg.address, msg.typetags, msg.args);
    const lengthBytes = int32ToBytes(encoded.length);
    messageBuffers.push(lengthBytes, encoded);
  }
  
  // Calculate total length
  const totalLength = bundleHeader.length + timetagBytes.length +
    messageBuffers.reduce((sum, b) => sum + b.length, 0);
  
  const result = new Uint8Array(totalLength);
  let offset = 0;
  result.set(bundleHeader, offset);
  offset += bundleHeader.length;
  result.set(timetagBytes, offset);
  offset += timetagBytes.length;
  for (const msgBuf of messageBuffers) {
    result.set(msgBuf, offset);
    offset += msgBuf.length;
  }
  
  return result;
}

/**
 * Decode an OSC bundle from a buffer
 * @param {Uint8Array|Buffer} buffer - Raw OSC bundle
 * @returns {Object} - { timetag: number, messages: Array }
 */
export function decodeOSCBundle(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer = new Uint8Array(buffer);
  }
  
  let offset = 0;
  
  // Check bundle header
  const header = String.fromCharCode.apply(null, buffer.subarray(offset, offset + 8));
  if (header !== '#bundle\0') {
    throw new Error('Invalid OSC bundle header');
  }
  offset += 8;
  
  // Read timetag (8 bytes)
  const timetagBytes = buffer.subarray(offset, offset + 8);
  const timetag = Number(bytesToInt64(timetagBytes)) / Math.pow(2, 32);
  offset += 8;
  
  // Read messages
  const messages = [];
  while (offset < buffer.length) {
    // Read message length (4 bytes)
    const length = bytesToInt32(buffer.subarray(offset, offset + 4));
    offset += 4;
    
    // Read message data
    const messageBuffer = buffer.subarray(offset, offset + length);
    offset += length;
    
    // Decode the message
    const message = decodeOSC(messageBuffer);
    messages.push(message);
  }
  
  return { timetag, messages };
}

export default {
  encodeOSC,
  decodeOSC,
  encodeOSCBundle,
  decodeOSCBundle,
};
