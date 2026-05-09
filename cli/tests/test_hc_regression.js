#!/usr/bin/env node
'use strict';

/**
 * test_audio_regression.js
 *
 * Render a small corpus of deterministic patches two ways:
 *  1) WASM sclang + WASM scsynth (CLI wrappers)
 *  2) Native scsynth NRT (same OSC messages, canonicalized /d_recv completion)
 *
 * Then compare output audio with signal metrics and optional SoX diff artifacts.
 *
 * Environment variables:
 *   NATIVE_HCSYNTH              Path to native scsynth binary.
 *   NATIVE_SCLANG               Path to native sclang binary (reserved for future use).
 *   SKIP_NATIVE=1               Skip native rendering and only do WASM smoke checks.
 *   AUDIO_DIFF_KEEP_ARTIFACTS=1 Keep temp artifacts even on success.
 *   AUDIO_DIFF_SOX=1            Generate SoX diff/spectrogram artifacts when sox exists.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runSclangCli } = require('../hclang');
const { runScsynthCli } = require('../hcsynth');
const { maybeConvertInternalCommandToOsc } = require('../hc_runtime');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCLANG_JS = path.join(REPO_ROOT, 'build/wasm/lang/hclang/hclang.js');
const SCSYNTH_JS = path.join(REPO_ROOT, 'build/wasm/server/hcsynth/hcsynth.js');

function firstExistingPath(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const NATIVE_HCSYNTH = firstExistingPath([
  process.env.NATIVE_HCSYNTH,
  process.env.NATIVE_SCSYNTH,
  '/opt/homebrew/bin/scsynth',
  '/usr/local/bin/scsynth',
  path.join(REPO_ROOT, 'build_native/server/scsynth/scsynth'),
]);

const NATIVE_SCLANG = firstExistingPath([
  process.env.NATIVE_SCLANG,
  '/opt/homebrew/bin/sclang',
  '/usr/local/bin/sclang',
  path.join(REPO_ROOT, 'build_native/lang/sclang/sclang'),
]);

const SKIP_NATIVE = process.env.SKIP_NATIVE === '1';
const KEEP_ARTIFACTS = process.env.AUDIO_DIFF_KEEP_ARTIFACTS === '1';
const WANT_SOX_ARTIFACTS = process.env.AUDIO_DIFF_SOX === '1';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 512;
const CHANNELS = 2;

const PATCHES = [
  {
    id: 'sine_basic',
    duration: 2.0,
    script: 'x = { SinOsc.ar(220, 0, 0.12) ! 2 }.play;\n',
    thresholds: { minPeak: 1e-4, minCorr: 0.995, minSnrDb: 30.0, maxDiffRms: 0.015 },
  },
  {
    id: 'am_tone',
    duration: 2.0,
    script: [
      'x = {',
      '  var mod = SinOsc.kr(2, 0, 0.4, 0.6);',
      '  (SinOsc.ar(220, 0, 0.1) * mod) ! 2',
      '}.play;',
      '',
    ].join('\n'),
    thresholds: { minPeak: 1e-4, minCorr: 0.985, minSnrDb: 25.0, maxDiffRms: 0.02 },
  },
  {
    id: 'fm_tone',
    duration: 2.0,
    script: [
      'SynthDef("reg_fm", { |freq = 220, amp = 0.12|',
      '  var mod = SinOsc.ar(freq * 2, 0, freq * 0.4);',
      '  var car = SinOsc.ar(freq + mod, 0, amp);',
      '  Out.ar(0, car ! 2);',
      '}).add;',
      'Synth("reg_fm", ["freq", 220, "amp", 0.12]);',
      '',
    ].join('\n'),
    thresholds: { minPeak: 1e-4, minCorr: 0.98, minSnrDb: 22.0, maxDiffRms: 0.03 },
  },
  {
    id: 'perc_env',
    duration: 2.0,
    script: [
      'SynthDef("reg_perc", { |freq = 330, amp = 0.15|',
      '  var env = EnvGen.kr(Env.perc(0.01, 0.8), doneAction: 2);',
      '  var sig = SinOsc.ar(freq, 0, amp) * env;',
      '  Out.ar(0, Pan2.ar(sig, 0));',
      '}).add;',
      'Synth("reg_perc", ["freq", 330, "amp", 0.15]);',
      '',
    ].join('\n'),
    thresholds: { minPeak: 1e-4, minCorr: 0.97, minSnrDb: 20.0, maxDiffRms: 0.04 },
  },
];

function padTo4(buf) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

function oscString(s) {
  return padTo4(Buffer.from(s + '\0', 'ascii'));
}

function oscInt32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function buildOscMessage(address, typetag, argBufs) {
  return Buffer.concat([oscString(address), oscString(typetag), ...argBufs]);
}

function buildOscBundle(oscTimeSecs, oscTimeFrac, messages) {
  const header = Buffer.alloc(16);
  header.write('#bundle\0', 0, 'ascii');
  header.writeUInt32BE(oscTimeSecs, 8);
  header.writeUInt32BE(oscTimeFrac, 12);
  const parts = [header];
  for (const msg of messages) {
    const sz = Buffer.alloc(4);
    sz.writeUInt32BE(msg.length, 0);
    parts.push(sz, msg);
  }
  return Buffer.concat(parts);
}

function nrtEntry(bundle) {
  const sz = Buffer.alloc(4);
  sz.writeUInt32BE(bundle.length, 0);
  return Buffer.concat([sz, bundle]);
}

function buildNrtScore(rawMessages, durationSecs) {
  const TIME_HI = 0;
  const TIME_LO = 1;
  const termSecs = Math.max(1, Math.ceil(durationSecs));
  const TERM_HI = termSecs;
  const TERM_LO = 0;

  const gNewMsg = buildOscMessage('/g_new', ',iii', [oscInt32(1), oscInt32(0), oscInt32(0)]);
  const entries = [nrtEntry(buildOscBundle(TIME_HI, TIME_LO, [gNewMsg]))];

  for (const msg of rawMessages) {
    entries.push(nrtEntry(buildOscBundle(TIME_HI, TIME_LO, [msg])));
  }

  const cSetMsg = buildOscMessage('/c_set', ',ii', [oscInt32(0), oscInt32(0)]);
  entries.push(nrtEntry(buildOscBundle(TERM_HI, TERM_LO, [cSetMsg])));

  return Buffer.concat(entries);
}

function readOscString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const text = buf.slice(offset, end).toString('ascii');
  const next = (end + 4) & ~3;
  return { text, next };
}

function maybeCanonicalizeDrecv(rawMessage) {
  if (!rawMessage || rawMessage.length < 16) return rawMessage;
  const addr = readOscString(rawMessage, 0);
  const tags = readOscString(rawMessage, addr.next);
  if (addr.text !== '/d_recv' || tags.text !== ',bb') return rawMessage;

  let p = tags.next;
  if (p + 4 > rawMessage.length) return rawMessage;
  const b1Size = rawMessage.readUInt32BE(p);
  p += 4;
  const b1End = p + b1Size;
  if (b1End > rawMessage.length) return rawMessage;
  const blob1 = rawMessage.slice(p, b1End);
  p = (b1End + 3) & ~3;

  if (p + 4 > rawMessage.length) return rawMessage;
  const b2Size = rawMessage.readUInt32BE(p);
  p += 4;
  const b2End = p + b2Size;
  if (b2End > rawMessage.length) return rawMessage;
  const blob2 = rawMessage.slice(p, b2End);

  const converted = Buffer.from(maybeConvertInternalCommandToOsc(blob2));
  const b2Out = converted;

  const b1Len = Buffer.alloc(4);
  b1Len.writeUInt32BE(blob1.length, 0);
  const b2Len = Buffer.alloc(4);
  b2Len.writeUInt32BE(b2Out.length, 0);

  return Buffer.concat([
    oscString('/d_recv'),
    oscString(',bb'),
    b1Len,
    padTo4(blob1),
    b2Len,
    padTo4(b2Out),
  ]);
}

function runNativeNrt(scoreBuffer, outputPath, sampleRate, channels) {
  const scoreFile = outputPath + '.score.osc';
  fs.writeFileSync(scoreFile, scoreBuffer);
  try {
    const result = spawnSync(
      NATIVE_HCSYNTH,
      [
        '-o', String(channels),
        '-N', scoreFile,
        '_',
        outputPath,
        String(sampleRate),
        'WAV',
        'int16',
      ],
      { timeout: 45000 }
    );
    return {
      ok: result.status === 0 && !result.error,
      stderr: result.stderr ? result.stderr.toString() : '',
      stdout: result.stdout ? result.stdout.toString() : '',
    };
  } finally {
    try { fs.unlinkSync(scoreFile); } catch (_) {}
  }
}

function readWavPcm16(filePath) {
  const b = fs.readFileSync(filePath);
  if (b.length < 44 || b.slice(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Invalid WAV file: ' + filePath);
  }

  let dataOffset = -1;
  let dataSize = 0;
  let channels = 0;
  let sampleRate = 0;

  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.slice(p, p + 4).toString('ascii');
    const size = b.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') {
      channels = b.readUInt16LE(body + 2);
      sampleRate = b.readUInt32LE(body + 4);
      const bitsPerSample = b.readUInt16LE(body + 14);
      if (bitsPerSample !== 16) throw new Error('Expected 16-bit WAV: ' + filePath);
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
      break;
    }
    p = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error('WAV data chunk not found: ' + filePath);
  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const s = b.readInt16LE(dataOffset + i * 2);
    samples[i] = s / 32768;
  }

  return { samples, channels, sampleRate };
}

function readAiffPcm16(filePath) {
  const b = fs.readFileSync(filePath);
  if (b.length < 12 || b.slice(0, 4).toString('ascii') !== 'FORM') {
    throw new Error('Invalid AIFF file: ' + filePath);
  }

  let channels = 0;
  let sampleRate = SAMPLE_RATE;
  let dataOffset = -1;
  let dataSize = 0;

  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.slice(p, p + 4).toString('ascii');
    const size = b.readUInt32BE(p + 4);
    const body = p + 8;
    if (id === 'COMM') {
      channels = b.readUInt16BE(body);
      const sampleSize = b.readUInt16BE(body + 6);
      if (sampleSize !== 16) throw new Error('Expected 16-bit AIFF: ' + filePath);
      // Extended float parsing is omitted; tests use fixed sample rate.
      sampleRate = SAMPLE_RATE;
    } else if (id === 'SSND') {
      const offset = b.readUInt32BE(body);
      const ssndData = body + 8 + offset;
      dataOffset = ssndData;
      dataSize = Math.max(0, size - 8 - offset);
      break;
    }
    p = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error('AIFF SSND chunk not found: ' + filePath);
  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const s = b.readInt16BE(dataOffset + i * 2);
    samples[i] = s / 32768;
  }

  return { samples, channels, sampleRate };
}

function interleavedToMono(samples, channels) {
  if (channels <= 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += samples[f * channels + c];
    }
    mono[f] = sum / channels;
  }
  return mono;
}

function rms(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / arr.length);
}

function peak(arr) {
  let p = 0;
  for (let i = 0; i < arr.length; i++) {
    const a = Math.abs(arr[i]);
    if (a > p) p = a;
  }
  return p;
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

function alignedSlice(arr, start, n) {
  return arr.subarray(start, start + n);
}

function bestLag(a, b, maxLag) {
  const n = Math.min(a.length, b.length);
  if (n < 2048) return 0;
  const win = Math.min(16384, n - maxLag - 1);
  let best = 0;
  let bestCorr = -Infinity;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const aStart = lag >= 0 ? lag : 0;
    const bStart = lag >= 0 ? 0 : -lag;
    const len = Math.min(win, a.length - aStart, b.length - bStart);
    if (len <= 1024) continue;
    const c = correlation(alignedSlice(a, aStart, len), alignedSlice(b, bStart, len));
    if (c > bestCorr) {
      bestCorr = c;
      best = lag;
    }
  }
  return best;
}

function compareSignals(ref, test) {
  const lag = bestLag(ref, test, 1024);
  const refStart = lag >= 0 ? lag : 0;
  const testStart = lag >= 0 ? 0 : -lag;
  const n = Math.min(ref.length - refStart, test.length - testStart);
  const r = alignedSlice(ref, refStart, n);
  const t = alignedSlice(test, testStart, n);

  const diff = new Float32Array(n);
  let maxAbsDiff = 0;
  for (let i = 0; i < n; i++) {
    const d = r[i] - t[i];
    diff[i] = d;
    const a = Math.abs(d);
    if (a > maxAbsDiff) maxAbsDiff = a;
  }

  const refRms = rms(r);
  const testRms = rms(t);
  const diffRms = rms(diff);
  const snrDb = 20 * Math.log10((refRms + 1e-12) / (diffRms + 1e-12));
  const corr = correlation(r, t);

  return {
    lag,
    comparedSamples: n,
    refPeak: peak(r),
    testPeak: peak(t),
    refRms,
    testRms,
    diffRms,
    maxAbsDiff,
    snrDb,
    corr,
  };
}

function commandExists(cmd) {
  const r = spawnSync('command', ['-v', cmd], { shell: true });
  return r.status === 0;
}

function makeSoxArtifacts(nativePath, wasmPath, outPrefix) {
  const diffWav = outPrefix + '.diff.wav';
  const diffPng = outPrefix + '.diff.png';
  const nativePng = outPrefix + '.native.png';
  const wasmPng = outPrefix + '.wasm.png';

  spawnSync('sox', ['-m', '-v', '1', nativePath, '-v', '-1', wasmPath, diffWav], { stdio: 'ignore' });
  spawnSync('sox', [diffWav, '-n', 'spectrogram', '-o', diffPng], { stdio: 'ignore' });
  spawnSync('sox', [nativePath, '-n', 'spectrogram', '-o', nativePng], { stdio: 'ignore' });
  spawnSync('sox', [wasmPath, '-n', 'spectrogram', '-o', wasmPng], { stdio: 'ignore' });

  return { diffWav, diffPng, nativePng, wasmPng };
}

function fmt(n, digits) {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

async function runPatchCase(patch, rootDir, nativeAvailable, soxAvailable) {
  const caseDir = path.join(rootDir, patch.id);
  fs.mkdirSync(caseDir, { recursive: true });

  const scriptPath = path.join(caseDir, patch.id + '.scd');
  const commandsPath = path.join(caseDir, patch.id + '.commands.json');
  const wasmWav = path.join(caseDir, patch.id + '.wasm.wav');
  const nativeWav = path.join(caseDir, patch.id + '.native.wav');

  fs.writeFileSync(scriptPath, patch.script, 'utf8');

  const compileResult = await runSclangCli({
    script: scriptPath,
    output: commandsPath,
    sclangJs: SCLANG_JS,
    verbose: false,
  });

  await runScsynthCli({
    commands: commandsPath,
    output: wasmWav,
    duration: patch.duration,
    sampleRate: SAMPLE_RATE,
    blockSize: BLOCK_SIZE,
    channels: CHANNELS,
    scsynthJs: SCSYNTH_JS,
  });

  const wasmAudio = readWavPcm16(wasmWav);
  const wasmMono = interleavedToMono(wasmAudio.samples, wasmAudio.channels);
  const wasmPeak = peak(wasmMono);

  const base = {
    id: patch.id,
    packetCount: compileResult.packetCount,
    wasmPeak,
    skippedNative: false,
    passed: true,
    reason: '',
    metrics: null,
    artifacts: {},
  };

  if (compileResult.packetCount <= 0) {
    base.passed = false;
    base.reason = 'No OSC packets emitted by sclang for patch.';
    return base;
  }

  if (wasmPeak < patch.thresholds.minPeak) {
    base.passed = false;
    base.reason = `WASM render appears silent (peak=${fmt(wasmPeak, 6)}).`;
    return base;
  }

  if (!nativeAvailable) {
    base.skippedNative = true;
    return base;
  }

  const payload = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
  const rawPackets = payload.packetsBase64.map((b) => Buffer.from(b, 'base64'));
  const canonicalPackets = rawPackets.map((p) => maybeCanonicalizeDrecv(p));
  const score = buildNrtScore(canonicalPackets, patch.duration);

  const nativeRun = runNativeNrt(score, nativeWav, SAMPLE_RATE, CHANNELS);
  if (!nativeRun.ok || !fs.existsSync(nativeWav)) {
    base.passed = false;
    base.reason = 'Native NRT render failed: ' + ((nativeRun.stderr || nativeRun.stdout || '').slice(0, 240));
    return base;
  }

  const nativeAudio = readWavPcm16(nativeWav);
  const nativeMono = interleavedToMono(nativeAudio.samples, nativeAudio.channels);
  const metrics = compareSignals(nativeMono, wasmMono);
  base.metrics = metrics;

  const meets = (
    metrics.corr >= patch.thresholds.minCorr
    && metrics.snrDb >= patch.thresholds.minSnrDb
    && metrics.diffRms <= patch.thresholds.maxDiffRms
  );

  if (!meets) {
    base.passed = false;
    base.reason = [
      `corr=${fmt(metrics.corr, 5)} (<${patch.thresholds.minCorr})`,
      `snrDb=${fmt(metrics.snrDb, 2)} (<${patch.thresholds.minSnrDb})`,
      `diffRms=${fmt(metrics.diffRms, 6)} (>${patch.thresholds.maxDiffRms})`,
    ].join(', ');
  }

  if (soxAvailable && (WANT_SOX_ARTIFACTS || !base.passed)) {
    base.artifacts = makeSoxArtifacts(nativeWav, wasmWav, path.join(caseDir, patch.id));
  }

  return base;
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-audio-regression-'));
  const nativeAvailable = !SKIP_NATIVE && !!NATIVE_HCSYNTH;
  const soxAvailable = commandExists('sox');

  if (!nativeAvailable) {
    console.log('Note: native scsynth unavailable; expected /opt/homebrew/bin/scsynth, or set NATIVE_HCSYNTH.');
  } else {
    console.log('Using native scsynth at: ' + NATIVE_HCSYNTH);
  }
  if (NATIVE_SCLANG) {
    console.log('Detected native sclang at: ' + NATIVE_SCLANG);
  }
  if (WANT_SOX_ARTIFACTS && !soxAvailable) {
    console.log('Note: AUDIO_DIFF_SOX=1 set but sox was not found; skipping spectrogram artifacts.');
  }

  const results = [];
  let failed = 0;
  let passed = 0;
  let skipped = 0;

  try {
    for (const patch of PATCHES) {
      process.stdout.write(`Running ${patch.id} ... `);
      let result;
      try {
        result = await runPatchCase(patch, tmpRoot, nativeAvailable, soxAvailable);
      } catch (e) {
        result = {
          id: patch.id,
          passed: false,
          skippedNative: false,
          reason: e && e.message ? e.message : String(e),
        };
      }
      results.push(result);

      if (result.skippedNative) {
        skipped++;
        console.log('SKIP (native unavailable)');
      } else if (result.passed) {
        passed++;
        if (result.metrics) {
          console.log(`PASS (corr=${fmt(result.metrics.corr, 5)}, snr=${fmt(result.metrics.snrDb, 2)}dB, diffRms=${fmt(result.metrics.diffRms, 6)})`);
        } else {
          console.log('PASS');
        }
      } else {
        failed++;
        console.log('FAIL');
      }
    }

    console.log('\n--- Audio Regression Report ---');
    for (const r of results) {
      if (r.skippedNative) {
        console.log(`  ○ ${r.id} (native comparison skipped)`);
        continue;
      }
      if (r.passed) {
        if (r.metrics) {
          console.log(`  ✓ ${r.id} corr=${fmt(r.metrics.corr, 5)} snr=${fmt(r.metrics.snrDb, 2)}dB diffRms=${fmt(r.metrics.diffRms, 6)} lag=${r.metrics.lag}`);
        } else {
          console.log(`  ✓ ${r.id}`);
        }
      } else {
        console.log(`  ✗ ${r.id} ${r.reason ? '- ' + r.reason : ''}`);
      }
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);

    if (failed > 0 || KEEP_ARTIFACTS) {
      console.log(`Artifacts kept at: ${tmpRoot}`);
    } else {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    console.error('Unhandled error:', e && e.stack ? e.stack : e);
    console.error(`Artifacts kept at: ${tmpRoot}`);
    process.exit(1);
  }
}

main();
