#!/usr/bin/env node
'use strict';

/**
 * test_audio_frequency.js
 *
 * Render { SinOsc.ar(F, 0, 0.15) ! 2 }.play for a few F values via the
 * native WAMR binaries (hclang_native + hcsynth_native), FFT the output,
 * and assert the strongest spectral bin lands within tolerance of F.
 *
 * Catches block-rate corruption in hc_wasm_render — e.g. a spurious extra
 * World_Run that drops every other block, which produces a comb-spectrum
 * frequency offset (fix landed 2026-05-09 in engine/HC_Wasm_Api.cpp).
 *
 * Drives the native binaries directly rather than the JS Emscripten path
 * because the same shared C code in the WASM blob backs both, but the
 * native pipeline doesn't depend on Server.boot's notify handshake.
 *
 * Skips if the native binaries haven't been built (`just build-wamr-host`).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HCSYNTH_NATIVE = path.join(REPO_ROOT, 'build/native/hcsynth_host/hcsynth_native');
const HCLANG_NATIVE  = path.join(REPO_ROOT, 'build/native/hclang_host/hclang_native');
const CLASSLIB_DIR   = path.join(REPO_ROOT, 'src/class_library');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 512;
const CHANNELS = 2;
// 220/440/880 are musical octaves; 1234 is arbitrary — important that it
// does NOT divide evenly into sr/block_size (= 93.75 Hz), otherwise a
// per-block phase jump would be an integer multiple of 2π and the comb
// would be invisible (e.g. 1500 Hz = exactly 16 cycles per 512-frame
// block, which masks the bug).
const FREQS = [220, 440, 880, 1234];
const FFT_N = 65536;             // ~0.73 Hz bin width at 48 kHz
const PEAK_TOLERANCE_HZ = 3.0;   // top peak within this of requested
const SIDEBAND_GUARD_HZ = 10.0;  // peaks within this of fundamental are leakage
const MAX_SIDEBAND_RATIO = 0.25; // peaks farther than guard band must be < this
const RENDER_DURATION_S = 2.0;
const PROC_TIMEOUT_MS = 30000;

function readWavMonoLeft(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${filePath}`);
  }
  let audioFormat = 0, numChannels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataOffset = -1, dataSize = 0;
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      audioFormat   = buf.readUInt16LE(p + 8);
      numChannels   = buf.readUInt16LE(p + 10);
      sampleRate    = buf.readUInt32LE(p + 12);
      bitsPerSample = buf.readUInt16LE(p + 22);
    } else if (id === 'data') {
      dataOffset = p + 8;
      dataSize = size;
      break;
    }
    p += 8 + size + (size & 1);
  }
  if (dataOffset < 0) throw new Error('no data chunk');
  const out = [];
  if (audioFormat === 3 && bitsPerSample === 32) {
    const stride = numChannels * 4;
    for (let i = 0; i + stride <= dataSize; i += stride) {
      out.push(buf.readFloatLE(dataOffset + i));
    }
  } else if (audioFormat === 1 && bitsPerSample === 16) {
    const stride = numChannels * 2;
    for (let i = 0; i + stride <= dataSize; i += stride) {
      out.push(buf.readInt16LE(dataOffset + i) / 32768);
    }
  } else if (audioFormat === 1 && bitsPerSample === 32) {
    const stride = numChannels * 4;
    for (let i = 0; i + stride <= dataSize; i += stride) {
      out.push(buf.readInt32LE(dataOffset + i) / 2147483648);
    }
  } else {
    throw new Error(`unsupported wav format: audioFormat=${audioFormat} bps=${bitsPerSample}`);
  }
  return { samples: out, sampleRate };
}

// Iterative radix-2 FFT. N must be a power of two.
function fft(signal, N) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const lim = Math.min(signal.length, N);
  for (let i = 0; i < lim; i++) re[i] = signal[i];
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wlr = Math.cos(ang), wli = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < half; k++) {
        const tre = wr * re[i + k + half] - wi * im[i + k + half];
        const tim = wr * im[i + k + half] + wi * re[i + k + half];
        re[i + k + half] = re[i + k] - tre;
        im[i + k + half] = im[i + k] - tim;
        re[i + k] += tre;
        im[i + k] += tim;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nwr;
      }
    }
  }
  return { re, im };
}

function spectrumAnalysis(samples, sampleRate, N) {
  const { re, im } = fft(samples, N);
  const half = N >> 1;
  const mag = new Float64Array(half);
  for (let k = 0; k < half; k++) mag[k] = Math.hypot(re[k], im[k]);
  let topK = 1;
  for (let k = 2; k < half; k++) if (mag[k] > mag[topK]) topK = k;
  const guardBins = Math.ceil(SIDEBAND_GUARD_HZ * N / sampleRate);
  let sideK = -1;
  for (let k = 2; k < half; k++) {
    if (Math.abs(k - topK) <= guardBins) continue;
    if (sideK < 0 || mag[k] > mag[sideK]) sideK = k;
  }
  return {
    topFreq: topK * sampleRate / N,
    topMag:  mag[topK],
    sideFreq: sideK >= 0 ? sideK * sampleRate / N : 0,
    sideMag:  sideK >= 0 ? mag[sideK] : 0,
  };
}

// Pick a port unlikely to collide; bind() is the actual race winner.
function pickPort() {
  return 50000 + Math.floor(Math.random() * 10000);
}

function spawnAndCapture(bin, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`timeout: ${bin} ${args.join(' ')}\n${stderr}`));
    }, PROC_TIMEOUT_MS);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    return proc;
  });
}

async function renderFreq(freq, tmpRoot) {
  const scd = path.join(tmpRoot, `sine_${freq}.scd`);
  const wav = path.join(tmpRoot, `sine_${freq}.wav`);
  fs.writeFileSync(scd, [
    `var n   = NetAddr("127.0.0.1", 57110);`,
    `var def = SynthDef(\\sine${freq}, {`,
    `    Out.ar(0, SinOsc.ar(${freq}, 0, 0.15) ! 2);`,
    `}).asBytes;`,
    `n.sendBundle(0, ["/d_recv", def]);`,
    `n.sendBundle(0, ["/s_new", "sine${freq}", 1001, 0, 0]);`,
    ``,
  ].join('\n'));

  const port = pickPort();
  const synth = spawn(HCSYNTH_NATIVE, [
    '--output', wav,
    '--duration', String(RENDER_DURATION_S),
    '--sample-rate', String(SAMPLE_RATE),
    '--block-size', String(BLOCK_SIZE),
    '--channels', String(CHANNELS),
    '--udp-port', String(port),
    '--wait-for-osc-ms', '8000',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let synthErr = '';
  synth.stderr.on('data', (d) => { synthErr += d; });
  const synthExit = new Promise((resolve) => synth.on('exit', resolve));

  // Brief grace so the listener binds before lang sends.
  await new Promise((r) => setTimeout(r, 200));

  await spawnAndCapture(HCLANG_NATIVE, [
    '--classlib-dir', CLASSLIB_DIR,
    '--scsynth-host', '127.0.0.1',
    '--scsynth-port', String(port),
    '--no-server-boot',
    '--script', scd,
  ]);

  const code = await Promise.race([
    synthExit,
    new Promise((_, rej) => setTimeout(() => rej(new Error('synth timeout')), PROC_TIMEOUT_MS)),
  ]);
  if (code !== 0) {
    throw new Error(`hcsynth_native exited ${code}\n${synthErr}`);
  }
  return wav;
}

async function main() {
  for (const bin of [HCSYNTH_NATIVE, HCLANG_NATIVE]) {
    if (!fs.existsSync(bin)) {
      console.error(`skip: missing ${path.relative(REPO_ROOT, bin)} (run 'just build-wamr-host')`);
      process.exit(0);
    }
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wasm-freq-test-'));
  let passed = 0, failed = 0;
  const pass = (label) => { console.log(`PASS  ${label}`); passed++; };
  const fail = (label, msg) => { console.error(`FAIL  ${label} - ${msg}`); failed++; };

  try {
    for (const f of FREQS) {
      let wav;
      try {
        wav = await renderFreq(f, tmpRoot);
      } catch (err) {
        fail(`SinOsc(${f}) render`, err.message);
        continue;
      }
      const { samples, sampleRate } = readWavMonoLeft(wav);
      const start = BLOCK_SIZE; // skip first block (synth warmup)
      if (samples.length < start + FFT_N) {
        fail(`SinOsc(${f}) FFT`, `not enough samples: ${samples.length}`);
        continue;
      }
      const slice = samples.slice(start, start + FFT_N);
      const { topFreq, topMag, sideFreq, sideMag } = spectrumAnalysis(slice, sampleRate, FFT_N);
      const peakErr = Math.abs(topFreq - f);
      const sideRatio = topMag > 0 ? (sideMag / topMag) : 0;

      const peakLabel = `SinOsc(${f}) top peak ${topFreq.toFixed(2)} Hz (err ${peakErr.toFixed(2)} Hz)`;
      if (peakErr <= PEAK_TOLERANCE_HZ) pass(peakLabel);
      else fail(peakLabel, `expected within ${PEAK_TOLERANCE_HZ} Hz of ${f} Hz`);

      const sideLabel = `SinOsc(${f}) sideband ratio ${sideRatio.toFixed(3)} ` +
                        `(${sideFreq.toFixed(2)} Hz vs top)`;
      if (sideRatio <= MAX_SIDEBAND_RATIO) pass(sideLabel);
      else fail(sideLabel, `> ${MAX_SIDEBAND_RATIO} suggests block-rate comb (hc_wasm_render)`);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
