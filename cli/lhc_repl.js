#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { Lexer } = require('./lhc_lexer');
const { Parser } = require('./lhc_parser');
const { CodeGenerator } = require('./lhc_codegen');
const {
  allocCString,
  instantiateEmscriptenModule,
  maybeRewriteDrecvTarget,
  maybeConvertInternalCommandToOsc,
} = require('./hc_runtime');
const { getVersion } = require('./hc_utils');
const { writeAudioFile } = require('./hc_audio');
const { createUnixBridge } = require('./hc_unix');

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_BLOCK_SIZE = 512;
const DEFAULT_CHANNELS = 2;
const DEFAULT_SCLANG_JS = 'build/wasm/lang/hclang/hclang.js';
const DEFAULT_SCSYNTH_JS = 'build/wasm/server/hcsynth/hcsynth.js';

function parseArgs(argv) {
  const out = {
    sampleRate: DEFAULT_SAMPLE_RATE,
    blockSize: DEFAULT_BLOCK_SIZE,
    channels: DEFAULT_CHANNELS,
    sclangJs: DEFAULT_SCLANG_JS,
    scsynthJs: DEFAULT_SCSYNTH_JS,
    sclangRuntime: 'auto',
    nativeSclangBin: process.env.SCSCM_NATIVE_SCLANG_BIN || 'sclang',
    showCompiled: false,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };

    if (a === '--sample-rate') out.sampleRate = parseInt(next(), 10);
    else if (a === '--block-size') out.blockSize = parseInt(next(), 10);
    else if (a === '--channels') out.channels = parseInt(next(), 10);
    else if (a === '--sclang-js') out.sclangJs = next();
    else if (a === '--scsynth-js') out.scsynthJs = next();
    else if (a === '--sclang-runtime') out.sclangRuntime = next();
    else if (a === '--native-sclang-bin') out.nativeSclangBin = next();
    else if (a === '--native-sclang') out.sclangRuntime = 'native';
    else if (a === '--wasm-sclang') out.sclangRuntime = 'wasm';
    else if (a === '--show-compiled') out.showCompiled = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--version' || a === '-v') {
      console.log(`lhc_repl (lhc) ${getVersion()}`);
      process.exit(0);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!['auto', 'wasm', 'native'].includes(out.sclangRuntime)) {
    throw new Error(`Invalid --sclang-runtime '${out.sclangRuntime}' (expected auto, wasm, or native)`);
  }

  return out;
}

function printHelp() {
  console.log(`lhc_repl - Interactive HyperCollider Lisp REPL (v${getVersion()})

Usage:
  lhc_repl [options]

Options:
  --sample-rate <hz>      Sample rate (default: ${DEFAULT_SAMPLE_RATE})
  --block-size <samples>  Render block size (default: ${DEFAULT_BLOCK_SIZE})
  --channels <n>          Output channels (default: ${DEFAULT_CHANNELS})
  --sclang-runtime <mode> sclang runtime: auto|wasm|native (default: auto)
  --native-sclang-bin <p> Native sclang binary path (default: sclang)
  --native-sclang         Force native sclang runtime
  --wasm-sclang           Force WASM sclang runtime
  --sclang-js <path>      Path to hclang.js
  --scsynth-js <path>     Path to hcsynth.js
  --show-compiled         Print the compiled SC code before evaluating
  --verbose               Print all sclang post window output

REPL commands (at the scscm> prompt):
  .quit / .exit           Exit the REPL
  .help                   Show this help
  .version                Show version info
  .info                   Show runtime info (sample rate, block size, channels)
  .load <file.scscm>      Load and evaluate a .scscm file
  .load-sc <file.scd>     Load and evaluate a .scd file directly (no compilation)
  .bench [n]              Re-run last expression n times (default: 100) and report timing
  .record [seconds]       Start capturing audio to /tmp/hc_record_<ts>.wav (WASM mode only)
  .stop-record            Stop capturing and write WAV file (WASM mode only)

Input is compiled from scscm (Scheme-like) syntax to sclang, then evaluated.
Default runtime mode is auto: try WASM first, then fall back to native sclang.
Each line is treated as a complete scscm expression.

Examples:
  lhc_repl --show-compiled
  scscm> (SynthDef "sine" (fn (freq 440) (Out.ar 0 (SinOsc.ar freq 0))))
  scscm> (Synth "sine" (dict :freq 440))

Info:
  -h, --help              Show this help and exit
  -v, --version           Show version and exit
`);
}

function compileScscm(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const codegen = new CodeGenerator();
  return codegen.generate(ast);
}

async function runNativeRepl(opts) {
  console.log(`[lhc_repl] Starting native sclang runtime: ${opts.nativeSclangBin}`);

  const sclang = childProcess.spawn(opts.nativeSclangBin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  sclang.stdout.on('data', (chunk) => process.stdout.write(chunk));
  sclang.stderr.on('data', (chunk) => process.stderr.write(chunk));

  sclang.on('error', (err) => {
    process.stderr.write(`[lhc_repl] Failed to launch native sclang: ${err.message}\n`);
    process.exit(1);
  });

  let lastSource = null;

  function evalScCode(code) {
    sclang.stdin.write(`${code}\n`);
  }

  function evalScscm(source) {
    let scCode;
    try {
      scCode = compileScscm(source);
    } catch (e) {
      const msg = e.line !== undefined
        ? `compile error at line ${e.line}, col ${e.column}: ${e.message}`
        : `compile error: ${e.message}`;
      process.stderr.write(`[lhc_repl] ${msg}\n`);
      return;
    }

    if (opts.showCompiled) {
      process.stdout.write(`[compiled] ${scCode}\n`);
    }

    evalScCode(scCode);
  }

  console.log('[lhc_repl] Ready (native). Type scscm code and press Enter. Type .quit to exit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'scscm> ',
    terminal: process.stdin.isTTY,
  });

  rl.prompt();

  rl.on('line', (line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === '.quit' || trimmed === '.exit') {
      rl.close();
      return;
    }

    if (trimmed === '.help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (trimmed === '.version') {
      console.log(`scscm ${getVersion()} | sclang native (${opts.nativeSclangBin})`);
      rl.prompt();
      return;
    }

    if (trimmed === '.info') {
      console.log('[lhc_repl] Runtime info:');
      console.log(`  version:      ${getVersion()}`);
      console.log('  mode:         native-sclang');
      console.log(`  sclang-bin:   ${opts.nativeSclangBin}`);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.bench')) {
      if (!lastSource) {
        process.stderr.write('[lhc_repl] Nothing to bench yet — evaluate some code first.\n');
        rl.prompt();
        return;
      }
      const nStr = trimmed.slice(6).trim();
      const n = nStr ? parseInt(nStr, 10) : 100;
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write('[lhc_repl] .bench usage: .bench [n] (default 100)\n');
        rl.prompt();
        return;
      }
      const start = Date.now();
      for (let i = 0; i < n; i++) evalScscm(lastSource);
      const elapsed = Date.now() - start;
      console.log(`[lhc_repl] ${n} iterations in ${elapsed}ms (${(elapsed / n).toFixed(2)}ms each)`);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.record') || trimmed === '.stop-record') {
      process.stderr.write('[lhc_repl] .record is available only in WASM runtime mode.\n');
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.load-sc ')) {
      const filePath = path.resolve(trimmed.slice(9).trim());
      try {
        const code = fs.readFileSync(filePath, 'utf8');
        evalScCode(code);
        console.log(`[lhc_repl] Loaded SC file ${filePath}`);
      } catch (e) {
        process.stderr.write(`[lhc_repl] .load-sc error: ${e.message}\n`);
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.load ')) {
      const filePath = path.resolve(trimmed.slice(6).trim());
      try {
        const source = fs.readFileSync(filePath, 'utf8');
        lastSource = source;
        evalScscm(source);
        console.log(`[lhc_repl] Loaded ${filePath}`);
      } catch (e) {
        process.stderr.write(`[lhc_repl] .load error: ${e.message}\n`);
      }
      rl.prompt();
      return;
    }

    lastSource = trimmed;
    evalScscm(trimmed);
    rl.prompt();
  });

  rl.on('close', () => {
    try {
      sclang.stdin.write('0.exit;\n');
    } catch (_) {
      // ignore when stdin already closed
    }
    sclang.stdin.end();
  });

  await new Promise((resolve) => {
    sclang.on('close', (code) => {
      if (typeof code === 'number' && code !== 0) {
        process.stderr.write(`[lhc_repl] native sclang exited with code ${code}\n`);
      }
      resolve();
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.sclangRuntime === 'native') {
    await runNativeRepl(opts);
    return;
  }

  if (opts.sclangRuntime === 'wasm') {
    await runWasmRepl(opts);
    return;
  }

  try {
    await runWasmRepl(opts);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`[lhc_repl] WASM runtime failed (${msg}); falling back to native sclang.\n`);
    await runNativeRepl(opts);
  }
}

async function runWasmRepl(opts) {
  let Speaker;
  try {
    const mod = await import('audio-speaker/stream');
    Speaker = mod.default;
  } catch (_) {
    throw new Error('The "audio-speaker" npm package is required for WASM realtime mode (install with: npm install audio-speaker)');
  }

  console.log('[lhc_repl] Loading WASM modules...');

  // Resolve paths to absolute before Promise.all — instantiateEmscriptenModule
  // uses process.chdir() internally, so a concurrent call would resolve a
  // relative path against the wrong directory.
  const sclangJsAbs = path.resolve(opts.sclangJs);
  const scsynthJsAbs = path.resolve(opts.scsynthJs);

  const [sclang, scsynth] = await Promise.all([
    instantiateEmscriptenModule(sclangJsAbs, { print: () => {}, printErr: () => {} }),
    instantiateEmscriptenModule(scsynthJsAbs, { print: () => {}, printErr: () => {} }),
  ]);

  const unixBridge = createUnixBridge(sclang);
  sclang.__hc_wasm_unix_bridge = unixBridge;
  globalThis.__hc_wasm_unix_bridge = unixBridge;

  const worldId = scsynth._hc_wasm_world_create(opts.sampleRate, opts.blockSize);
  if (!worldId) throw new Error('hc_wasm_world_create failed');

  // Direct in-process OSC bridge: sclang OSC → scsynth dispatch
  const oscBridge = (bytesView) => {
    if (!bytesView || !bytesView.length) return -2;
    let bytes = maybeRewriteDrecvTarget(new Uint8Array(bytesView));
    bytes = maybeConvertInternalCommandToOsc(bytes);
    const ptr = scsynth._malloc(bytes.length);
    try {
      scsynth.HEAPU8.set(bytes, ptr);
      const rc = scsynth._hc_wasm_osc_dispatch(worldId, ptr, bytes.length);
      return rc;
    } finally {
      scsynth._free(ptr);
    }
  };

  globalThis.__hc_wasm_forward_osc_to_engine = oscBridge;
  sclang.__hc_wasm_forward_osc_to_engine = oscBridge;

  const postCb = sclang.addFunction((ptr, len) => {
    const text = sclang.UTF8ToString(ptr, len);
    if (text.trim()) {
      process.stdout.write(text);
    }
  }, 'vii');

  const errCb = sclang.addFunction((ptr, len) => {
    const text = sclang.UTF8ToString(ptr, len);
    if (text.trim()) {
      process.stderr.write(`[hclang] ${text}`);
    }
  }, 'vii');

  sclang._hc_wasm_eval_set_post_callback(postCb);
  sclang._hc_wasm_eval_set_error_callback(errCb);

  const initRc = sclang._hc_wasm_eval_boot_sequence();
  if (initRc !== 0) throw new Error(`hc_wasm_eval_boot_sequence failed (${initRc})`);

  // Mark server as running so SC class library methods work
  const serverInit =
    'Server.default.statusWatcher.serverRunning = true; Server.default.statusWatcher.notified = true;';
  {
    const p = allocCString(sclang, serverInit);
    try {
      sclang._hc_wasm_eval_execute(p, serverInit.length);
    } finally {
      sclang._free(p);
    }
  }

  // Set up audio-speaker for real-time audio output
  const speaker = Speaker({
    channels: opts.channels,
    bitDepth: 16,
    sampleRate: opts.sampleRate,
  });

  speaker.on('error', (err) => {
    process.stderr.write(`[lhc_repl] speaker error: ${err.message}\n`);
  });

  const blockSamples = opts.blockSize * opts.channels;
  const outPtr = scsynth._malloc(blockSamples * 4);

  let running = true;

  const recordState = {
    active: false,
    frames: [],
    durationSec: null,
    framesRecorded: 0,
    outputPath: null,
  };

  function stopRecording() {
    if (!recordState.active) {
      console.log('[lhc_repl] Not recording.');
      return;
    }
    recordState.active = false;
    const total = recordState.frames.reduce((s, b) => s + b.length, 0);
    const interleaved = new Float32Array(total);
    let offset = 0;
    for (const b of recordState.frames) { interleaved.set(b, offset); offset += b.length; }
    writeAudioFile({
      outputPath: recordState.outputPath,
      interleaved,
      sampleRate: opts.sampleRate,
      channels: opts.channels,
      bitDepth: 16,
      format: 'wav',
    });
    const secs = (recordState.framesRecorded / opts.sampleRate).toFixed(2);
    console.log(`[lhc_repl] Saved ${secs}s to ${recordState.outputPath}`);
    recordState.frames = [];
    recordState.framesRecorded = 0;
  }

  function renderBlock() {
    if (!running) return;

    const rc = scsynth._hc_wasm_render(worldId, outPtr, opts.blockSize, opts.channels);
    if (rc !== 0) {
      setImmediate(renderBlock);
      return;
    }

    const floats = new Float32Array(scsynth.HEAPF32.buffer, outPtr, blockSamples);

    if (recordState.active) {
      recordState.frames.push(new Float32Array(floats));
      recordState.framesRecorded += opts.blockSize;
      if (recordState.durationSec !== null &&
          recordState.framesRecorded >= recordState.durationSec * opts.sampleRate) {
        stopRecording();
      }
    }

    const pcm = Buffer.alloc(blockSamples * 2);
    for (let i = 0; i < blockSamples; i++) {
      const x = Math.max(-1, Math.min(1, floats[i]));
      const s = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      pcm.writeInt16LE(s, i * 2);
    }

    if (speaker.write(pcm)) {
      setImmediate(renderBlock);
    } else {
      speaker.once('drain', renderBlock);
    }
  }

  renderBlock();

  function evalScCode(code) {
    const p = allocCString(sclang, code);
    try {
      sclang._hc_wasm_eval_execute(p, code.length);
    } finally {
      sclang._free(p);
    }
  }

  function evalScscm(source) {
    let scCode;
    try {
      scCode = compileScscm(source);
    } catch (e) {
      const msg = e.line !== undefined
        ? `compile error at line ${e.line}, col ${e.column}: ${e.message}`
        : `compile error: ${e.message}`;
      process.stderr.write(`[lhc_repl] ${msg}\n`);
      return;
    }

    if (opts.showCompiled) {
      process.stdout.write(`[compiled] ${scCode}\n`);
    }

    evalScCode(scCode);
  }

  console.log('[lhc_repl] Ready. Type scscm code and press Enter. Type .quit to exit.\n');

  let lastSource = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'scscm> ',
    terminal: process.stdin.isTTY,
  });

  rl.prompt();

  rl.on('line', (line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === '.quit' || trimmed === '.exit') {
      rl.close();
      return;
    }

    if (trimmed === '.help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (trimmed === '.version') {
      console.log(`hcl ${getVersion()} | hclang ${getVersion()} | hcsynth ${getVersion()}`);
      rl.prompt();
      return;
    }

    if (trimmed === '.info') {
      console.log('[lhc_repl] Runtime info:');
      console.log(`  version:      ${getVersion()}`);
      console.log(`  mode:         in-process`);
      console.log(`  sample-rate:  ${opts.sampleRate} Hz`);
      console.log(`  block-size:   ${opts.blockSize} samples`);
      console.log(`  channels:     ${opts.channels}`);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.bench')) {
      if (!lastSource) {
        process.stderr.write('[lhc_repl] Nothing to bench yet — evaluate some code first.\n');
        rl.prompt();
        return;
      }
      const nStr = trimmed.slice(6).trim();
      const n = nStr ? parseInt(nStr, 10) : 100;
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write('[lhc_repl] .bench usage: .bench [n] (default 100)\n');
        rl.prompt();
        return;
      }
      const start = Date.now();
      for (let i = 0; i < n; i++) evalScscm(lastSource);
      const elapsed = Date.now() - start;
      console.log(`[lhc_repl] ${n} iterations in ${elapsed}ms (${(elapsed / n).toFixed(2)}ms each)`);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.record')) {
      if (recordState.active) {
        process.stderr.write('[lhc_repl] Already recording. Use .stop-record to finish.\n');
        rl.prompt();
        return;
      }
      const secStr = trimmed.slice(7).trim();
      const durationSec = secStr ? parseFloat(secStr) : null;
      const ts = Date.now();
      recordState.outputPath = `/tmp/hc_record_${ts}.wav`;
      recordState.durationSec = (durationSec && durationSec > 0) ? durationSec : null;
      recordState.framesRecorded = 0;
      recordState.frames = [];
      recordState.active = true;
      const durMsg = durationSec ? ` (${durationSec}s)` : ' (until .stop-record)';
      console.log(`[lhc_repl] Recording${durMsg} → ${recordState.outputPath}`);
      rl.prompt();
      return;
    }

    if (trimmed === '.stop-record') {
      stopRecording();
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.load-sc ')) {
      const filePath = path.resolve(trimmed.slice(9).trim());
      try {
        const code = fs.readFileSync(filePath, 'utf8');
        evalScCode(code);
        console.log(`[lhc_repl] Loaded SC file ${filePath}`);
      } catch (e) {
        process.stderr.write(`[lhc_repl] .load-sc error: ${e.message}\n`);
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.load ')) {
      const filePath = path.resolve(trimmed.slice(6).trim());
      try {
        const source = fs.readFileSync(filePath, 'utf8');
        lastSource = source;
        evalScscm(source);
        console.log(`[lhc_repl] Loaded ${filePath}`);
      } catch (e) {
        process.stderr.write(`[lhc_repl] .load error: ${e.message}\n`);
      }
      rl.prompt();
      return;
    }

    lastSource = trimmed;
    evalScscm(trimmed);
    rl.prompt();
  });

  rl.on('close', () => {
    running = false;
    scsynth._free(outPtr);
    scsynth._hc_wasm_world_destroy(worldId);
    speaker.end();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`lhc_repl failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = { main };
