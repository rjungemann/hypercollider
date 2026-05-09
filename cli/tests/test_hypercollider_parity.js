#!/usr/bin/env node
'use strict';

/**
 * test_hypercollider_parity.js
 *
 * Three-tier comparison suite for WASM CLI vs native SuperCollider, using
 * instruments ported from the hyper-collider repo as fixtures.
 *
 * Tier 1 — SCSCM code-text checks (no WASM required)
 *   Compile each .scscm fixture and assert expected substrings appear in the
 *   generated sclang. Catches transpiler regressions immediately.
 *
 * Tier 2 — WASM smoke tests
 *   Render each .scd fixture via the WASM CLI and verify the WAV is non-silent
 *   and has the expected approximate duration. Runs anywhere the WASM build
 *   exists; does not require native SuperCollider.
 *
 * Tier 3 — WASM vs native audio parity  (requires NATIVE_HCSYNTH)
 *   Feed the same OSC score to both renderers and compare signal metrics
 *   (peak, RMS, correlation, SNR). Tolerates small IIR/noise divergence with
 *   instrument-appropriate thresholds.
 *
 * Environment variables:
 *   NATIVE_HCSYNTH              Path to native scsynth binary.
 *   SKIP_NATIVE=1               Skip native rendering; only run Tiers 1 and 2.
 *   SKIP_WASM=1                 Skip WASM rendering; only run Tier 1.
 *   AUDIO_DIFF_SOX=1            Generate SoX diff/spectrogram artifacts on failure.
 *   AUDIO_DIFF_KEEP_ARTIFACTS=1 Keep temp files even on success.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Lexer }         = require('../lhc_lexer');
const { Parser }        = require('../lhc_parser');
const { CodeGenerator } = require('../lhc_codegen');
const { runSclangCli }  = require('../hclang');
const { runScsynthCli } = require('../hcsynth');
const { maybeConvertInternalCommandToOsc } = require('../hc_runtime');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CLI_DIR  = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CLI_DIR, '..');
const HC_DIR   = path.join(CLI_DIR, 'examples', 'hypercollider');

const SCLANG_JS  = path.join(REPO_ROOT, 'build/wasm/lang/hclang/hclang.js');
const SCSYNTH_JS = path.join(REPO_ROOT, 'build/wasm/server/hcsynth/hcsynth.js');

function firstExisting(...candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const NATIVE_HCSYNTH = firstExisting(
  process.env.NATIVE_HCSYNTH,
  process.env.NATIVE_SCSYNTH,
  '/opt/homebrew/bin/scsynth',
  '/usr/local/bin/scsynth',
  path.join(REPO_ROOT, 'build_native/server/scsynth/scsynth'),
);

const SKIP_NATIVE = process.env.SKIP_NATIVE === '1';
const SKIP_WASM   = process.env.SKIP_WASM === '1';
const WANT_SOX    = process.env.AUDIO_DIFF_SOX === '1';
const KEEP_ARTS   = process.env.AUDIO_DIFF_KEEP_ARTIFACTS === '1';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE  = 512;
const CHANNELS    = 2;

// ---------------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------------
// duration: render length in seconds (must be > instrument decay so the body
//           is fully audible, but not so long that silence dominates metrics).
// thresholds: loosened vs. test_audio_regression.js because hyper-collider
//   instruments use WhiteNoise, HPF, BPF whose exact floating-point output can
//   diverge slightly between WASM and native scsynth.
// scscmExpected: substrings that MUST appear in the compiled sclang output.

const FIXTURES = [
  {
    id: 'kick1',
    scdFile: 'kick1.scd',
    scscmFile: 'kick1.scscm',
    duration: 0.8,
    thresholds: { minPeak: 1e-4, minCorr: 0.90, minSnrDb: 18.0, maxDiffRms: 0.06 },
    scscmExpected: ['SynthDef("kick1"', 'EnvGen.kr', 'SinOsc.ar', 'HPF.ar', 'Pan2.ar', 'Out.ar'],
  },
  {
    id: 'snare1',
    scdFile: 'snare1.scd',
    scscmFile: 'snare1.scscm',
    duration: 0.5,
    thresholds: { minPeak: 1e-4, minCorr: 0.88, minSnrDb: 16.0, maxDiffRms: 0.07 },
    scscmExpected: ['SynthDef("snare1"', 'EnvGen.kr', 'SinOsc.ar', 'BPF.ar', 'HPF.ar', 'WhiteNoise.ar', 'Pan2.ar'],
  },
  {
    id: 'hihat1',
    scdFile: 'hihat1.scd',
    scscmFile: 'hihat1.scscm',
    duration: 0.3,
    thresholds: { minPeak: 1e-4, minCorr: 0.85, minSnrDb: 14.0, maxDiffRms: 0.08 },
    scscmExpected: ['SynthDef("hihat1"', 'EnvGen.kr', 'HPF.ar', 'BPF.ar', 'WhiteNoise.ar', 'Pan2.ar'],
  },
  {
    id: 'bass1',
    scdFile: 'bass1.scd',
    scscmFile: 'bass1.scscm',
    duration: 1.2,
    thresholds: { minPeak: 1e-4, minCorr: 0.92, minSnrDb: 20.0, maxDiffRms: 0.05 },
    scscmExpected: ['SynthDef("bass1"', 'EnvGen.kr', 'Saw.ar', 'RLPF.ar', 'Pan2.ar', 'Out.ar'],
  },
  {
    id: 'pluck1',
    scdFile: 'pluck1.scd',
    scscmFile: 'pluck1.scscm',
    duration: 1.0,
    thresholds: { minPeak: 1e-4, minCorr: 0.90, minSnrDb: 18.0, maxDiffRms: 0.06 },
    scscmExpected: ['SynthDef("pluck1"', 'EnvGen.kr', 'SinOsc.ar', 'RLPF.ar', 'Pan2.ar', 'Out.ar'],
  },
];

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(label) {
  console.log(`  ✓ PASS: ${label}`);
  passed++;
}

function fail(label, reason) {
  console.log(`  ✗ FAIL: ${label}`);
  if (reason) console.log(`         ${reason}`);
  failed++;
}

function skip(label, reason) {
  console.log(`  - SKIP: ${label}${reason ? ' (' + reason + ')' : ''}`);
  skipped++;
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(title);
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// SCSCM compiler (mirrors test_scscm.js compile())
// ---------------------------------------------------------------------------

function compileScscm(srcPath) {
  const source = fs.readFileSync(srcPath, 'utf-8');
  const tokens = new Lexer(source).tokenize();
  const ast    = new Parser(tokens).parse();
  return new CodeGenerator().generate(ast);
}

// ---------------------------------------------------------------------------
// WAV reading / signal metrics (shared with test_audio_regression.js)
// ---------------------------------------------------------------------------

function readWavPcm16(filePath) {
  const b = fs.readFileSync(filePath);
  if (b.length < 44 || b.slice(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Invalid WAV: ' + filePath);
  }
  let dataOffset = -1, dataSize = 0, channels = 0, sampleRate = 0;
  let p = 12;
  while (p + 8 <= b.length) {
    const id   = b.slice(p, p + 4).toString('ascii');
    const size = b.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') {
      channels   = b.readUInt16LE(body + 2);
      sampleRate = b.readUInt32LE(body + 4);
      const bps  = b.readUInt16LE(body + 14);
      if (bps !== 16) throw new Error('Expected 16-bit WAV');
    } else if (id === 'data') {
      dataOffset = body;
      dataSize   = size;
      break;
    }
    p = body + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error('WAV data chunk not found');
  const n = Math.floor(dataSize / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = b.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return { samples, channels, sampleRate };
}

function interleavedToMono(samples, channels) {
  if (channels <= 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const mono   = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[f * channels + c];
    mono[f] = sum / channels;
  }
  return mono;
}

function rms(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / (arr.length || 1));
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
  if (!n) return 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const mA = sumA / n, mB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - mA, db = b[i] - mB;
    num += da * db; denA += da * da; denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

function bestLag(a, b, maxLag) {
  const n = Math.min(a.length, b.length);
  if (n < 2048) return 0;
  const win = Math.min(16384, n - maxLag - 1);
  let best = 0, bestC = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const aS = lag >= 0 ? lag : 0;
    const bS = lag >= 0 ? 0 : -lag;
    const len = Math.min(win, a.length - aS, b.length - bS);
    if (len <= 1024) continue;
    const c = correlation(a.subarray(aS, aS + len), b.subarray(bS, bS + len));
    if (c > bestC) { bestC = c; best = lag; }
  }
  return best;
}

function compareSignals(ref, test) {
  const lag = bestLag(ref, test, 1024);
  const rS  = lag >= 0 ? lag : 0;
  const tS  = lag >= 0 ? 0  : -lag;
  const n   = Math.min(ref.length - rS, test.length - tS);
  const r   = ref.subarray(rS, rS + n);
  const t   = test.subarray(tS, tS + n);
  const diff = new Float32Array(n);
  for (let i = 0; i < n; i++) diff[i] = r[i] - t[i];
  const diffRms = rms(diff);
  const refRms  = rms(r);
  const snrDb   = 20 * Math.log10((refRms + 1e-12) / (diffRms + 1e-12));
  return { lag, corr: correlation(r, t), refPeak: peak(r), testPeak: peak(t),
           refRms, testRms: rms(t), diffRms, snrDb };
}

// ---------------------------------------------------------------------------
// NRT score builder (same as test_audio_regression.js)
// ---------------------------------------------------------------------------

function padTo4(buf) {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}
function oscString(s) { return padTo4(Buffer.from(s + '\0', 'ascii')); }
function oscInt32(n)  { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b; }

function buildOscMessage(address, typetag, argBufs) {
  return Buffer.concat([oscString(address), oscString(typetag), ...argBufs]);
}

function buildOscBundle(hi, lo, messages) {
  const header = Buffer.alloc(16);
  header.write('#bundle\0', 0, 'ascii');
  header.writeUInt32BE(hi, 8);
  header.writeUInt32BE(lo, 12);
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
  const termSecs = Math.max(1, Math.ceil(durationSecs));
  const gNew = buildOscMessage('/g_new', ',iii', [oscInt32(1), oscInt32(0), oscInt32(0)]);
  const entries = [nrtEntry(buildOscBundle(0, 1, [gNew]))];
  for (const msg of rawMessages) {
    entries.push(nrtEntry(buildOscBundle(0, 1, [msg])));
  }
  const cSet = buildOscMessage('/c_set', ',ii', [oscInt32(0), oscInt32(0)]);
  entries.push(nrtEntry(buildOscBundle(termSecs, 0, [cSet])));
  return Buffer.concat(entries);
}

function readOscString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const text = buf.slice(offset, end).toString('ascii');
  return { text, next: (end + 4) & ~3 };
}

function maybeCanonicalizeDrecv(rawMessage) {
  if (!rawMessage || rawMessage.length < 16) return rawMessage;
  const addr = readOscString(rawMessage, 0);
  const tags = readOscString(rawMessage, addr.next);
  if (addr.text !== '/d_recv' || tags.text !== ',bb') return rawMessage;
  let p = tags.next;
  if (p + 4 > rawMessage.length) return rawMessage;
  const b1Size = rawMessage.readUInt32BE(p); p += 4;
  const b1End  = p + b1Size;
  if (b1End > rawMessage.length) return rawMessage;
  const blob1  = rawMessage.slice(p, b1End);
  p = (b1End + 3) & ~3;
  if (p + 4 > rawMessage.length) return rawMessage;
  const b2Size = rawMessage.readUInt32BE(p); p += 4;
  const b2End  = p + b2Size;
  if (b2End > rawMessage.length) return rawMessage;
  const blob2  = rawMessage.slice(p, b2End);
  const converted = Buffer.from(maybeConvertInternalCommandToOsc(blob2));
  const b1Len = Buffer.alloc(4); b1Len.writeUInt32BE(blob1.length, 0);
  const b2Len = Buffer.alloc(4); b2Len.writeUInt32BE(converted.length, 0);
  return Buffer.concat([oscString('/d_recv'), oscString(',bb'), b1Len, padTo4(blob1), b2Len, padTo4(converted)]);
}

function runNativeNrt(scoreBuffer, outputPath, sampleRate, channels) {
  const scoreFile = outputPath + '.score.osc';
  fs.writeFileSync(scoreFile, scoreBuffer);
  try {
    const r = spawnSync(
      NATIVE_HCSYNTH,
      ['-o', String(channels), '-N', scoreFile, '_', outputPath, String(sampleRate), 'WAV', 'int16'],
      { timeout: 45000 }
    );
    return { ok: r.status === 0 && !r.error, stderr: r.stderr?.toString() ?? '', stdout: r.stdout?.toString() ?? '' };
  } finally {
    try { fs.unlinkSync(scoreFile); } catch (_) {}
  }
}

function commandExists(cmd) {
  return spawnSync('command', ['-v', cmd], { shell: true }).status === 0;
}

function makeSoxArtifacts(nativePath, wasmPath, prefix) {
  const diffWav = prefix + '.diff.wav';
  spawnSync('sox', ['-m', '-v', '1', nativePath, '-v', '-1', wasmPath, diffWav], { stdio: 'ignore' });
  spawnSync('sox', [diffWav,    '-n', 'spectrogram', '-o', prefix + '.diff.png'],   { stdio: 'ignore' });
  spawnSync('sox', [nativePath, '-n', 'spectrogram', '-o', prefix + '.native.png'], { stdio: 'ignore' });
  spawnSync('sox', [wasmPath,   '-n', 'spectrogram', '-o', prefix + '.wasm.png'],   { stdio: 'ignore' });
}

function fmt(n, d) { return Number.isFinite(n) ? n.toFixed(d) : String(n); }

// ---------------------------------------------------------------------------
// Tier 1: SCSCM code-text checks
// ---------------------------------------------------------------------------

function runCodeTextChecks() {
  section('TIER 1 — SCSCM CODE-TEXT CHECKS');

  for (const fix of FIXTURES) {
    const scscmPath = path.join(HC_DIR, fix.scscmFile);
    if (!fs.existsSync(scscmPath)) {
      skip(`${fix.id}: scscm file present`, 'file not found');
      continue;
    }

    let sc;
    try {
      sc = compileScscm(scscmPath);
    } catch (err) {
      fail(`${fix.id}: compiles without error`, err.message);
      continue;
    }

    pass(`${fix.id}: compiles without error`);

    for (const expected of fix.scscmExpected) {
      if (sc.includes(expected)) {
        pass(`${fix.id}: output contains "${expected}"`);
      } else {
        fail(`${fix.id}: output contains "${expected}"`, `Got:\n${sc.slice(0, 300)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tier 2: WASM smoke tests
// ---------------------------------------------------------------------------

async function runWasmSmokeTests(tmpDir) {
  section('TIER 2 — WASM SMOKE TESTS');

  if (!fs.existsSync(SCLANG_JS)) {
    for (const fix of FIXTURES) {
      skip(`${fix.id}: WASM render non-silent`, 'hclang.js not built');
    }
    return;
  }

  for (const fix of FIXTURES) {
    const scdPath = path.join(HC_DIR, fix.scdFile);
    if (!fs.existsSync(scdPath)) {
      skip(`${fix.id}: WASM render non-silent`, '.scd file not found');
      continue;
    }

    const caseDir     = path.join(tmpDir, fix.id);
    fs.mkdirSync(caseDir, { recursive: true });
    const commandsPath = path.join(caseDir, 'commands.json');
    const wasmWav      = path.join(caseDir, 'wasm.wav');

    try {
      const compile = await runSclangCli({ script: scdPath, output: commandsPath, sclangJs: SCLANG_JS, verbose: false });

      if (compile.packetCount <= 0) {
        fail(`${fix.id}: WASM render non-silent`, 'sclang emitted no OSC packets');
        continue;
      }

      await runScsynthCli({ commands: commandsPath, output: wasmWav, duration: fix.duration,
                            sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE, channels: CHANNELS, scsynthJs: SCSYNTH_JS });

      const audio = readWavPcm16(wasmWav);
      const mono  = interleavedToMono(audio.samples, audio.channels);
      const pk    = peak(mono);

      if (pk >= fix.thresholds.minPeak) {
        pass(`${fix.id}: WASM render non-silent (peak=${fmt(pk, 5)})`);
      } else {
        fail(`${fix.id}: WASM render non-silent`, `peak=${fmt(pk, 8)} < ${fix.thresholds.minPeak}`);
      }

      // Duration check: WAV frames ÷ sample_rate should be ≈ fix.duration (±20%)
      const actualDur = audio.samples.length / audio.channels / audio.sampleRate;
      const durOk     = Math.abs(actualDur - fix.duration) / fix.duration < 0.20;
      if (durOk) {
        pass(`${fix.id}: WAV duration ~${fix.duration}s (got ${fmt(actualDur, 3)}s)`);
      } else {
        fail(`${fix.id}: WAV duration ~${fix.duration}s`, `got ${fmt(actualDur, 3)}s`);
      }
    } catch (err) {
      fail(`${fix.id}: WASM render non-silent`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Tier 3: WASM vs native audio parity
// ---------------------------------------------------------------------------

async function runNativeParity(tmpDir, soxAvailable) {
  section('TIER 3 — WASM vs NATIVE AUDIO PARITY');

  if (SKIP_NATIVE || !NATIVE_HCSYNTH) {
    const reason = SKIP_NATIVE ? 'SKIP_NATIVE=1' : 'native scsynth not found';
    for (const fix of FIXTURES) {
      skip(`${fix.id}: wasm≈native (corr, SNR, RMS)`, reason);
    }
    return;
  }

  for (const fix of FIXTURES) {
    const caseDir      = path.join(tmpDir, fix.id);
    fs.mkdirSync(caseDir, { recursive: true });
    const commandsPath = path.join(caseDir, 'commands.json');
    const wasmWav      = path.join(caseDir, 'wasm.wav');
    const nativeWav    = path.join(caseDir, 'native.wav');

    // Re-use compiled commands from Tier 2 if present; otherwise re-run sclang.
    const scdPath = path.join(HC_DIR, fix.scdFile);
    try {
      if (!fs.existsSync(commandsPath)) {
        await runSclangCli({ script: scdPath, output: commandsPath, sclangJs: SCLANG_JS, verbose: false });
      }
      if (!fs.existsSync(wasmWav)) {
        await runScsynthCli({ commands: commandsPath, output: wasmWav, duration: fix.duration,
                              sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE, channels: CHANNELS, scsynthJs: SCSYNTH_JS });
      }
    } catch (err) {
      fail(`${fix.id}: wasm≈native`, 'WASM render failed: ' + err.message);
      continue;
    }

    // Build NRT score from WASM sclang packets
    let rawPackets;
    try {
      const payload  = JSON.parse(fs.readFileSync(commandsPath, 'utf-8'));
      rawPackets     = payload.packetsBase64.map((b) => Buffer.from(b, 'base64'));
    } catch (err) {
      fail(`${fix.id}: wasm≈native`, 'Could not read OSC commands: ' + err.message);
      continue;
    }

    const canonical = rawPackets.map((p) => maybeCanonicalizeDrecv(p));
    const score     = buildNrtScore(canonical, fix.duration);
    const nativeRun = runNativeNrt(score, nativeWav, SAMPLE_RATE, CHANNELS);

    if (!nativeRun.ok || !fs.existsSync(nativeWav)) {
      fail(`${fix.id}: wasm≈native`, 'Native NRT render failed: ' + ((nativeRun.stderr || nativeRun.stdout || '').slice(0, 200)));
      continue;
    }

    const nativeAudio = readWavPcm16(nativeWav);
    const wasmAudio   = readWavPcm16(wasmWav);
    const nativeMono  = interleavedToMono(nativeAudio.samples, nativeAudio.channels);
    const wasmMono    = interleavedToMono(wasmAudio.samples,   wasmAudio.channels);
    const m           = compareSignals(nativeMono, wasmMono);
    const th          = fix.thresholds;

    const corrOk   = m.corr    >= th.minCorr;
    const snrOk    = m.snrDb   >= th.minSnrDb;
    const diffOk   = m.diffRms <= th.maxDiffRms;
    const allOk    = corrOk && snrOk && diffOk;

    const detail = `corr=${fmt(m.corr,4)} snrDb=${fmt(m.snrDb,1)} diffRms=${fmt(m.diffRms,5)}`;
    if (allOk) {
      pass(`${fix.id}: wasm≈native (${detail})`);
    } else {
      const why = [
        !corrOk ? `corr ${fmt(m.corr,4)} < ${th.minCorr}` : null,
        !snrOk  ? `snrDb ${fmt(m.snrDb,1)} < ${th.minSnrDb}` : null,
        !diffOk ? `diffRms ${fmt(m.diffRms,5)} > ${th.maxDiffRms}` : null,
      ].filter(Boolean).join(', ');
      fail(`${fix.id}: wasm≈native`, why);
    }

    if (soxAvailable && (WANT_SOX || !allOk)) {
      makeSoxArtifacts(nativeWav, wasmWav, path.join(caseDir, fix.id));
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanupTmp(tmpDir) {
  if (KEEP_ARTS) return;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Hyper-Collider Parity Test Suite');
  console.log('='.repeat(60));

  const nativeAvailable = !SKIP_NATIVE && !!NATIVE_HCSYNTH;
  const soxAvailable    = commandExists('sox');

  if (!nativeAvailable && !SKIP_NATIVE) {
    console.log('Note: native scsynth not found — Tier 3 will be skipped.');
    console.log('      Set NATIVE_HCSYNTH=/path/to/scsynth to enable parity checks.');
  } else if (nativeAvailable) {
    console.log('Native scsynth: ' + NATIVE_HCSYNTH);
  }
  if (SKIP_WASM) {
    console.log('Note: SKIP_WASM=1 — Tier 2 will be skipped.');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-hc-parity-'));

  try {
    // Tier 1 is always synchronous and never skipped
    runCodeTextChecks();

    if (!SKIP_WASM) {
      await runWasmSmokeTests(tmpDir);
      await runNativeParity(tmpDir, soxAvailable);
    } else {
      section('TIER 2 — WASM SMOKE TESTS');
      for (const fix of FIXTURES) skip(`${fix.id}: WASM render non-silent`, 'SKIP_WASM=1');
      section('TIER 3 — WASM vs NATIVE AUDIO PARITY');
      for (const fix of FIXTURES) skip(`${fix.id}: wasm≈native`, 'SKIP_WASM=1');
    }
  } finally {
    cleanupTmp(tmpDir);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
