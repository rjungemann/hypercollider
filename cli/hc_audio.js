'use strict';

const fs = require('node:fs');
const path = require('node:path');

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// WAV — PCM 16-bit (legacy export, used internally)
// ---------------------------------------------------------------------------

function writeWavPcm16({ outputPath, interleaved, sampleRate, channels }) {
  writeAudioFile({
    outputPath,
    interleaved,
    sampleRate,
    channels,
    format: 'wav',
    bitDepth: 16,
  });
}

// ---------------------------------------------------------------------------
// Shared WAV writer (supports 16, 24, 32-float)
// ---------------------------------------------------------------------------

function _writeWav({ outputPath, interleaved, sampleRate, channels, bitDepth }) {
  const isFloat = bitDepth === 32;
  const audioFormat = isFloat ? 3 : 1; // 3 = IEEE_FLOAT, 1 = PCM
  const bytesPerSample = bitDepth === 24 ? 3 : bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = interleaved.length * bytesPerSample;
  const riffSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(riffSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  const data = Buffer.alloc(dataSize);

  if (isFloat) {
    for (let i = 0; i < interleaved.length; i++) {
      data.writeFloatLE(clamp(interleaved[i], -1, 1), i * 4);
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < interleaved.length; i++) {
      const x = clamp(interleaved[i], -1, 1);
      const s = x < 0 ? Math.round(x * 8388608) : Math.round(x * 8388607);
      // Write 3 bytes little-endian (sign-extend via masking)
      data[i * 3 + 0] = (s) & 0xff;
      data[i * 3 + 1] = (s >> 8) & 0xff;
      data[i * 3 + 2] = (s >> 16) & 0xff;
    }
  } else {
    // 16-bit PCM
    for (let i = 0; i < interleaved.length; i++) {
      const x = clamp(interleaved[i], -1, 1);
      const s = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      data.writeInt16LE(s, i * 2);
    }
  }

  fs.writeFileSync(outputPath, Buffer.concat([header, data]));
}

// ---------------------------------------------------------------------------
// AIFF writer (supports 16 and 24-bit integer; 32-float not standard in AIFF)
// ---------------------------------------------------------------------------

/**
 * Encode a sample rate as an 80-bit IEEE 754 extended precision float.
 * Used in the AIFF COMM chunk.
 */
function _toExtended80(value) {
  const buf = Buffer.alloc(10);
  if (value === 0) return buf;

  let sign = 0;
  if (value < 0) { sign = 1; value = -value; }

  let exp = Math.floor(Math.log2(value));
  const mantissa = value / Math.pow(2, exp);
  exp += 16383; // biased exponent

  buf.writeUInt16BE((sign << 15) | exp, 0);

  // 64-bit integer mantissa: mantissa × 2^63
  const hi = Math.floor(mantissa * 0x80000000);
  const lo = Math.round((mantissa * 0x80000000 - hi) * 0x100000000) >>> 0;
  buf.writeUInt32BE(hi >>> 0, 2);
  buf.writeUInt32BE(lo, 6);

  return buf;
}

function _writeAiff({ outputPath, interleaved, sampleRate, channels, bitDepth }) {
  // AIFF only supports integer PCM in this writer; treat 32 as 32-bit int
  const effectiveBits = bitDepth === 32 ? 32 : bitDepth;
  const bytesPerSample = effectiveBits === 24 ? 3 : effectiveBits / 8;
  const numFrames = interleaved.length / channels;

  // COMM chunk: 18 bytes fixed
  const commData = Buffer.alloc(18);
  commData.writeUInt16BE(channels, 0);
  commData.writeUInt32BE(numFrames, 2);
  commData.writeUInt16BE(effectiveBits, 6);
  _toExtended80(sampleRate).copy(commData, 8);

  const commChunk = Buffer.alloc(8 + 18);
  commChunk.write('COMM', 0, 'ascii');
  commChunk.writeUInt32BE(18, 4);
  commData.copy(commChunk, 8);

  // SSND chunk: 8-byte offset/blockSize header + sample data
  const dataSize = interleaved.length * bytesPerSample;
  const ssndHeader = Buffer.alloc(16);
  ssndHeader.write('SSND', 0, 'ascii');
  ssndHeader.writeUInt32BE(8 + dataSize, 4); // chunk size
  ssndHeader.writeUInt32BE(0, 8);  // offset
  ssndHeader.writeUInt32BE(0, 12); // blockSize

  const ssndData = Buffer.alloc(dataSize);

  if (effectiveBits === 32) {
    // 32-bit big-endian signed integer
    for (let i = 0; i < interleaved.length; i++) {
      const x = clamp(interleaved[i], -1, 1);
      const s = x < 0 ? Math.round(x * 2147483648) : Math.round(x * 2147483647);
      ssndData.writeInt32BE(s, i * 4);
    }
  } else if (effectiveBits === 24) {
    for (let i = 0; i < interleaved.length; i++) {
      const x = clamp(interleaved[i], -1, 1);
      const s = x < 0 ? Math.round(x * 8388608) : Math.round(x * 8388607);
      // Big-endian 24-bit
      ssndData[i * 3 + 0] = (s >> 16) & 0xff;
      ssndData[i * 3 + 1] = (s >> 8) & 0xff;
      ssndData[i * 3 + 2] = (s) & 0xff;
    }
  } else {
    // 16-bit big-endian
    for (let i = 0; i < interleaved.length; i++) {
      const x = clamp(interleaved[i], -1, 1);
      const s = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      ssndData.writeInt16BE(s, i * 2);
    }
  }

  // FORM chunk wrapping everything
  const formBody = Buffer.concat([
    Buffer.from('AIFF', 'ascii'),
    commChunk,
    ssndHeader,
    ssndData,
  ]);
  // Pad SSND data to even byte count
  const ssndPad = (dataSize % 2 === 1) ? Buffer.alloc(1) : Buffer.alloc(0);

  const formHeader = Buffer.alloc(8);
  formHeader.write('FORM', 0, 'ascii');
  formHeader.writeUInt32BE(4 + commChunk.length + ssndHeader.length + dataSize + ssndPad.length, 4);

  fs.writeFileSync(outputPath, Buffer.concat([formHeader, formBody, ssndPad]));
}

// ---------------------------------------------------------------------------
// Raw PCM writer (headerless, little-endian, same bit depth options)
// ---------------------------------------------------------------------------

function _writeRaw({ outputPath, interleaved, bitDepth }) {
  const isFloat = bitDepth === 32;
  const bytesPerSample = bitDepth === 24 ? 3 : bitDepth / 8;
  const data = Buffer.alloc(interleaved.length * bytesPerSample);

  if (isFloat) {
    for (let i = 0; i < interleaved.length; i++) {
      data.writeFloatLE(clamp(interleaved[i], -1, 1), i * 4);
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < interleaved.length; i++) {
      const x = clamp(interleaved[i], -1, 1);
      const s = x < 0 ? Math.round(x * 8388608) : Math.round(x * 8388607);
      data[i * 3 + 0] = (s) & 0xff;
      data[i * 3 + 1] = (s >> 8) & 0xff;
      data[i * 3 + 2] = (s >> 16) & 0xff;
    }
  } else {
    for (let i = 0; i < interleaved.length; i++) {
      const x = clamp(interleaved[i], -1, 1);
      const s = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      data.writeInt16LE(s, i * 2);
    }
  }

  fs.writeFileSync(outputPath, data);
}

// ---------------------------------------------------------------------------
// Format detection from file extension
// ---------------------------------------------------------------------------

function detectFormat(outputPath) {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.aif' || ext === '.aiff') return 'aiff';
  if (ext === '.raw' || ext === '.pcm') return 'raw';
  return 'wav';
}

// ---------------------------------------------------------------------------
// Public API — unified entry point
// ---------------------------------------------------------------------------

/**
 * Write audio samples to a file.
 *
 * @param {object} opts
 * @param {string}      opts.outputPath   - Destination file path
 * @param {Float32Array} opts.interleaved - Interleaved float32 samples, range -1..1
 * @param {number}      opts.sampleRate   - Sample rate in Hz
 * @param {number}      opts.channels     - Channel count
 * @param {string}      [opts.format]     - 'wav' | 'aiff' | 'raw' (default: inferred from extension, then 'wav')
 * @param {number}      [opts.bitDepth]   - 16 | 24 | 32 (default: 16)
 */
function writeAudioFile({ outputPath, interleaved, sampleRate, channels, format, bitDepth = 16 }) {
  const fmt = format || detectFormat(outputPath);

  if (bitDepth !== 16 && bitDepth !== 24 && bitDepth !== 32) {
    throw new Error(`--bit-depth must be 16, 24, or 32 (got ${bitDepth})`);
  }

  switch (fmt) {
    case 'aiff':
      _writeAiff({ outputPath, interleaved, sampleRate, channels, bitDepth });
      break;
    case 'raw':
      _writeRaw({ outputPath, interleaved, bitDepth });
      break;
    case 'wav':
    default:
      _writeWav({ outputPath, interleaved, sampleRate, channels, bitDepth });
      break;
  }
}

module.exports = {
  writeAudioFile,
  writeWavPcm16,  // kept for backward compatibility
  detectFormat,
};
