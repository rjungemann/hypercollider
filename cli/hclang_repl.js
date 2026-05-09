#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const {
  allocCString,
  instantiateEmscriptenModule,
  maybeRewriteDrecvTarget,
  maybeConvertInternalCommandToOsc,
} = require('./hc_runtime');
const { getVersion } = require('./hc_utils');
const { writeAudioFile } = require('./hc_audio');
const { createUdpClient } = require('./hc_net');
const { createUnixBridge } = require('./hc_unix');
const { MidiLearnManager } = require('./hc_midi_learn');
const { PresetManager } = require('./hc_preset');

function tryCreateMidiBridge(sclang) {
  try {
    const { createMidiBridge } = require('./hc_midi');
    return createMidiBridge(sclang, null);
  } catch (_) { return null; }
}

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
    verbose: false,
    // Phase N4: live network mode
    scsynthHost: null,
    scsynthPort: null,
    langUdpPort: null,
    protocol: 'udp',
    // 2.4 Presets
    presetDir: null,
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
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--scsynth-host') out.scsynthHost = next();
    else if (a === '--scsynth-port') out.scsynthPort = parseInt(next(), 10);
    else if (a === '--lang-udp-port') out.langUdpPort = parseInt(next(), 10);
    else if (a === '--protocol') {
      const proto = next();
      if (proto !== 'udp' && proto !== 'tcp') throw new Error('--protocol must be udp or tcp');
      out.protocol = proto;
    }
    else if (a === '--preset-dir') out.presetDir = next();
    else if (a === '--version' || a === '-v') {
      console.log(`hclang_repl ${getVersion()}`);
      process.exit(0);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return out;
}

function printHelp() {
  console.log(`hclang_repl - Interactive HyperCollider REPL (WASM) (v${getVersion()})

Usage (in-process audio, default):
  hclang_repl [options]

Usage (live network mode — connect to a running scsynth):
  hclang_repl --scsynth-host 127.0.0.1 --scsynth-port 57110 [options]

Options:
  --sample-rate <hz>           Sample rate (default: ${DEFAULT_SAMPLE_RATE})
  --block-size <samples>       Render block size (default: ${DEFAULT_BLOCK_SIZE})
  --channels <n>               Output channels (default: ${DEFAULT_CHANNELS})
  --sclang-js <path>           Path to hclang.js
  --scsynth-js <path>          Path to hcsynth.js (in-process mode only)
  --verbose                    Print all sclang post window output
  --preset-dir <path>          Directory for preset JSON files (default: ~/.sc_presets)

Live network options:
  --scsynth-host <addr>        External scsynth host (enables live network mode)
  --scsynth-port <port>        External scsynth port
  --lang-udp-port <port>       Local UDP port for scsynth replies (optional)
  --protocol <udp|tcp>         Transport protocol (default: udp)

REPL commands (at the sc> prompt):
  .quit / .exit                Exit the REPL
  .help                        Show this help
  .version                     Show version info
  .info                        Show runtime info (sample rate, mode, etc.)
  .load <file.scd>             Load and evaluate a .scd file
  .bench [n]                   Re-run last expression n times (default: 100) and report timing
  .record [seconds]            Start capturing audio to /tmp/hc_record_<ts>.wav
  .stop-record                 Stop capturing and write WAV file
  .midi-map <ch>:<cc> <expr>   Map a MIDI CC to a SC expression (use ~val for CC value)
  .midi-unmap <ch>:<cc>        Remove a MIDI CC mapping
  .midi-list                   List all MIDI CC mappings
  .preset save <name>          Save last-evaluated code as a named preset
  .preset load <name>          Evaluate a saved preset's code
  .preset list                 List all saved presets
  .preset delete <name>        Delete a saved preset
  .preset export <file>        Export all presets to a JSON file
  .preset import <file>        Import presets from a JSON file

Examples:
  hclang_repl
  hclang_repl --scsynth-host 127.0.0.1 --scsynth-port 57110
  sc> SynthDef("sine", { Out.ar(0, SinOsc.ar(440) * 0.1) }).add;
  sc> Synth("sine");

Info:
  -h, --help                   Show this help and exit
  -v, --version                Show version and exit
`);
}

async function main() {
  const opts = parseArgs(process.argv);

  const hasExternalRoute = opts.scsynthHost && opts.scsynthPort;

  if (hasExternalRoute) {
    await runReplNetworkMode(opts);
  } else {
    await runReplInProcessMode(opts);
  }
}

// ---------------------------------------------------------------------------
// In-process mode (default) — sclang + scsynth both run as WASM in this process
// ---------------------------------------------------------------------------

async function runReplInProcessMode(opts) {
  let Speaker;
  try {
    Speaker = require('audio-speaker/stream');
  } catch (_) {
    console.error('[hclang_repl] The "audio-speaker" npm package is required for real-time audio.');
    console.error('Install it with: npm install audio-speaker');
    process.exit(1);
  }

  console.log('[hclang_repl] Loading WASM modules...');

  const [sclang, scsynth] = await Promise.all([
    instantiateEmscriptenModule(opts.sclangJs, { print: () => {}, printErr: () => {} }),
    instantiateEmscriptenModule(opts.scsynthJs, { print: () => {}, printErr: () => {} }),
  ]);

  const unixBridge = createUnixBridge(sclang);
  sclang.__hc_wasm_unix_bridge = unixBridge;
  globalThis.__hc_wasm_unix_bridge = unixBridge;

  const worldId = scsynth._hc_wasm_world_create(opts.sampleRate, opts.blockSize);
  if (!worldId) throw new Error('hc_wasm_world_create failed');

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
    if (opts.verbose && text.trim()) {
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

  const speaker = Speaker({
    channels: opts.channels,
    bitDepth: 16,
    sampleRate: opts.sampleRate,
  });

  speaker.on('error', (err) => {
    process.stderr.write(`[hclang_repl] speaker error: ${err.message}\n`);
  });

  const blockSamples = opts.blockSize * opts.channels;
  const outPtr = scsynth._malloc(blockSamples * 4);

  let running = true;

  // Recording state
  const recordState = {
    active: false,
    frames: [],       // Array of Float32Array blocks
    durationSec: null,
    framesRecorded: 0,
    outputPath: null,
  };

  function stopRecording() {
    if (!recordState.active) {
      console.log('[hclang_repl] Not recording.');
      return;
    }
    recordState.active = false;
    const total = recordState.frames.reduce((s, b) => s + b.length, 0);
    const interleaved = new Float32Array(total);
    let offset = 0;
    for (const b of recordState.frames) {
      interleaved.set(b, offset);
      offset += b.length;
    }
    writeAudioFile({
      outputPath: recordState.outputPath,
      interleaved,
      sampleRate: opts.sampleRate,
      channels: opts.channels,
      bitDepth: 16,
      format: 'wav',
    });
    const secs = (recordState.framesRecorded / opts.sampleRate).toFixed(2);
    console.log(`[hclang_repl] Saved ${secs}s of audio to ${recordState.outputPath}`);
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

    // Capture into recording buffer if active
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

  const inProcessInfo = {
    mode: 'in-process',
    sampleRate: opts.sampleRate,
    blockSize: opts.blockSize,
    channels: opts.channels,
  };

  const midiBridge = tryCreateMidiBridge(sclang);
  if (midiBridge && midiBridge.provider !== 'none') {
    sclang.__hc_wasm_midi_bridge = midiBridge;
    globalThis.__hc_wasm_midi_bridge = midiBridge;
  }

  function replEvalCode(code) {
    const p = allocCString(sclang, code);
    try { sclang._hc_wasm_eval_execute(p, code.length); } finally { sclang._free(p); }
  }

  const midiLearn = new MidiLearnManager(replEvalCode);
  if (midiBridge && typeof midiBridge.setOnBeforeDispatch === 'function') {
    midiBridge.setOnBeforeDispatch((src, status, d1, d2) => midiLearn.process(src, status, d1, d2));
  }

  const presetManager = new PresetManager({ dir: opts.presetDir || undefined });

  runReplLoop(opts, sclang, inProcessInfo, { recordState, stopRecording }, midiLearn, presetManager, () => {
    running = false;
    scsynth._free(outPtr);
    scsynth._hc_wasm_world_destroy(worldId);
    speaker.end();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Live network mode — sclang runs as WASM; OSC routed to an external scsynth
// ---------------------------------------------------------------------------

async function runReplNetworkMode(opts) {
  const net = require('node:net');

  console.log(`[hclang_repl] Network mode: connecting to scsynth at ${opts.scsynthHost}:${opts.scsynthPort} (${opts.protocol.toUpperCase()})`);
  console.log('[hclang_repl] Loading sclang WASM module...');

  const sclang = await instantiateEmscriptenModule(opts.sclangJs, {
    print: () => {},
    printErr: () => {},
  });

  const unixBridge = createUnixBridge(sclang);
  sclang.__hc_wasm_unix_bridge = unixBridge;
  globalThis.__hc_wasm_unix_bridge = unixBridge;

  let tcpSocket = null;
  let udpClient = null;

  if (opts.protocol === 'tcp') {
    tcpSocket = await new Promise((resolve, reject) => {
      const s = net.createConnection(opts.scsynthPort, opts.scsynthHost, () => resolve(s));
      s.once('error', reject);
    });

    tcpSocket.on('error', (err) => {
      process.stderr.write(`[hclang_repl] TCP error: ${err.message}\n`);
    });

    // Print framed replies from scsynth
    let accumBuf = Buffer.alloc(0);
    tcpSocket.on('data', (chunk) => {
      accumBuf = Buffer.concat([accumBuf, chunk]);
      while (accumBuf.length >= 4) {
        const msgLen = accumBuf.readUInt32BE(0);
        if (accumBuf.length < 4 + msgLen) break;
        const msg = accumBuf.slice(4, 4 + msgLen);
        accumBuf = accumBuf.slice(4 + msgLen);
        const addr = msg.length >= 2 && msg[0] === 0x2f
          ? msg.slice(0, msg.indexOf(0) || msg.length).toString('utf8')
          : '(unknown)';
        process.stdout.write(`[hcsynth] ${addr} (${msg.length} bytes)\n`);
      }
    });

    console.log(`[hclang_repl] TCP connected to ${opts.scsynthHost}:${opts.scsynthPort}`);
  } else {
    udpClient = createUdpClient(opts.scsynthHost, opts.scsynthPort, {
      debug: () => {},
      info: () => {},
      log: () => {},
      warn: (msg) => process.stderr.write(`[hclang_repl] ${msg}\n`),
    });

    if (opts.langUdpPort) {
      await udpClient.bindPort(opts.langUdpPort);
    }

    udpClient.onReply((msg) => {
      const addr = msg.length >= 2 && msg[0] === 0x2f
        ? msg.slice(0, msg.indexOf(0) || msg.length).toString('utf8')
        : '(unknown)';
      process.stdout.write(`[hcsynth] ${addr} (${msg.length} bytes)\n`);
    });

    console.log(`[hclang_repl] UDP routing to ${opts.scsynthHost}:${opts.scsynthPort}`);
  }

  const oscBridge = (bytesView) => {
    if (!bytesView || !bytesView.length) return -2;
    let bytes = maybeRewriteDrecvTarget(new Uint8Array(bytesView));
    bytes = maybeConvertInternalCommandToOsc(bytes);

    if (opts.protocol === 'tcp' && tcpSocket) {
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(buf.length);
      tcpSocket.write(Buffer.concat([lenBuf, buf]));
    } else if (udpClient) {
      udpClient.send(bytes);
    }
    return 0;
  };

  globalThis.__hc_wasm_forward_osc_to_engine = oscBridge;
  sclang.__hc_wasm_forward_osc_to_engine = oscBridge;

  const postCb = sclang.addFunction((ptr, len) => {
    const text = sclang.UTF8ToString(ptr, len);
    if (opts.verbose && text.trim()) {
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

  const networkInfo = {
    mode: 'network',
    protocol: opts.protocol,
    scsynthHost: opts.scsynthHost,
    scsynthPort: opts.scsynthPort,
    sampleRate: opts.sampleRate,
    blockSize: opts.blockSize,
    channels: opts.channels,
  };

  const presetManager = new PresetManager({ dir: opts.presetDir || undefined });

  runReplLoop(opts, sclang, networkInfo, null, null, presetManager, () => {
    if (tcpSocket) tcpSocket.destroy();
    if (udpClient) udpClient.close();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Shared REPL readline loop
// ---------------------------------------------------------------------------

/**
 * @param {object}   opts           - parsed CLI options
 * @param {object}   sclang         - WASM sclang module
 * @param {object}   info           - runtime info for .info command { mode, sampleRate, ... }
 * @param {object|null} recording   - { recordState, stopRecording } (in-process only; null in network mode)
 * @param {object|null} midiLearn   - MidiLearnManager instance (or null)
 * @param {object|null} presetMgr   - PresetManager instance (or null)
 * @param {function} onClose        - called when REPL exits
 */
function runReplLoop(opts, sclang, info, recording, midiLearn, presetMgr, onClose) {
  let lastCode = null;

  function evalCode(code) {
    const p = allocCString(sclang, code);
    try {
      sclang._hc_wasm_eval_execute(p, code.length);
    } finally {
      sclang._free(p);
    }
  }

  console.log('[hclang_repl] Ready. Type SC code and press Enter. Type .quit to exit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'sc> ',
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
      console.log(`hclang ${getVersion()} | hcsynth ${getVersion()}`);
      rl.prompt();
      return;
    }

    if (trimmed === '.info') {
      const lines = [
        `  version:      ${getVersion()}`,
        `  mode:         ${info.mode}`,
        `  sample-rate:  ${info.sampleRate} Hz`,
        `  block-size:   ${info.blockSize} samples`,
        `  channels:     ${info.channels}`,
      ];
      if (info.mode === 'network') {
        lines.push(`  scsynth:      ${info.protocol.toUpperCase()} ${info.scsynthHost}:${info.scsynthPort}`);
      }
      console.log('[hclang_repl] Runtime info:\n' + lines.join('\n'));
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.bench')) {
      if (!lastCode) {
        process.stderr.write('[hclang_repl] Nothing to bench yet — evaluate some code first.\n');
        rl.prompt();
        return;
      }
      const nStr = trimmed.slice(6).trim();
      const n = nStr ? parseInt(nStr, 10) : 100;
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write('[hclang_repl] .bench usage: .bench [n] (default 100)\n');
        rl.prompt();
        return;
      }
      const start = Date.now();
      for (let i = 0; i < n; i++) evalCode(lastCode);
      const elapsed = Date.now() - start;
      console.log(`[hclang_repl] ${n} iterations in ${elapsed}ms (${(elapsed / n).toFixed(2)}ms each)`);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.record')) {
      if (!recording) {
        process.stderr.write('[hclang_repl] .record is only available in in-process mode.\n');
        rl.prompt();
        return;
      }
      const { recordState } = recording;
      if (recordState.active) {
        process.stderr.write('[hclang_repl] Already recording. Use .stop-record to finish.\n');
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
      console.log(`[hclang_repl] Recording${durMsg} → ${recordState.outputPath}`);
      rl.prompt();
      return;
    }

    if (trimmed === '.stop-record') {
      if (!recording) {
        process.stderr.write('[hclang_repl] .stop-record is only available in in-process mode.\n');
        rl.prompt();
        return;
      }
      recording.stopRecording();
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.midi-map ')) {
      const rest = trimmed.slice(10).trim();
      const spaceIdx = rest.indexOf(' ');
      if (!midiLearn || spaceIdx < 0) {
        process.stderr.write('[hclang_repl] .midi-map usage: .midi-map <ch>:<cc> <expr>\n');
        rl.prompt();
        return;
      }
      const spec = rest.slice(0, spaceIdx);
      const expr = rest.slice(spaceIdx + 1).trim();
      const parts = spec.split(':');
      if (parts.length !== 2) {
        process.stderr.write('[hclang_repl] .midi-map: key must be <ch>:<cc> (e.g. 0:7)\n');
        rl.prompt();
        return;
      }
      const ch = parseInt(parts[0], 10);
      const cc = parseInt(parts[1], 10);
      if (!Number.isInteger(ch) || !Number.isInteger(cc) || ch < 0 || ch > 15 || cc < 0 || cc > 127) {
        process.stderr.write('[hclang_repl] .midi-map: ch 0–15, cc 0–127\n');
        rl.prompt();
        return;
      }
      midiLearn.map(ch, cc, expr);
      console.log(`[hclang_repl] MIDI map: ch${ch} CC${cc} → ${expr}`);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.midi-unmap ')) {
      const spec = trimmed.slice(12).trim();
      const parts = spec.split(':');
      if (!midiLearn || parts.length !== 2) {
        process.stderr.write('[hclang_repl] .midi-unmap usage: .midi-unmap <ch>:<cc>\n');
        rl.prompt();
        return;
      }
      const ch = parseInt(parts[0], 10);
      const cc = parseInt(parts[1], 10);
      const ok = midiLearn.unmap(ch, cc);
      console.log(ok
        ? `[hclang_repl] Removed MIDI map ch${ch} CC${cc}`
        : `[hclang_repl] No mapping for ch${ch} CC${cc}`);
      rl.prompt();
      return;
    }

    if (trimmed === '.midi-list') {
      const entries = midiLearn ? midiLearn.list() : [];
      if (entries.length === 0) {
        console.log('[hclang_repl] No MIDI mappings. Use .midi-map <ch>:<cc> <expr> to add one.');
      } else {
        console.log('[hclang_repl] MIDI mappings:');
        for (const { key, expr } of entries) console.log(`  ${key}  →  ${expr}`);
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('.preset ')) {
      const sub = trimmed.slice(8).trim();

      if (sub.startsWith('save ')) {
        const name = sub.slice(5).trim();
        if (!name) {
          process.stderr.write('[hclang_repl] .preset save usage: .preset save <name>\n');
          rl.prompt(); return;
        }
        if (!lastCode) {
          process.stderr.write('[hclang_repl] Nothing to save yet — evaluate some code first.\n');
          rl.prompt(); return;
        }
        presetMgr
          ? (() => { presetMgr.save(name, { code: lastCode }); console.log(`[hclang_repl] Preset saved: "${name}"`); })()
          : process.stderr.write('[hclang_repl] Preset manager not available.\n');
        rl.prompt(); return;
      }

      if (sub.startsWith('load ')) {
        const name = sub.slice(5).trim();
        if (!presetMgr) { process.stderr.write('[hclang_repl] Preset manager not available.\n'); rl.prompt(); return; }
        const preset = presetMgr.load(name);
        if (!preset) { process.stderr.write(`[hclang_repl] Preset not found: "${name}"\n`); rl.prompt(); return; }
        if (preset.code) {
          lastCode = preset.code;
          evalCode(preset.code);
          console.log(`[hclang_repl] Preset loaded: "${name}"`);
        } else {
          process.stderr.write(`[hclang_repl] Preset "${name}" has no code.\n`);
        }
        rl.prompt(); return;
      }

      if (sub === 'list') {
        const entries = presetMgr ? presetMgr.list() : [];
        if (entries.length === 0) {
          console.log('[hclang_repl] No presets. Use .preset save <name> to create one.');
        } else {
          console.log('[hclang_repl] Presets:');
          for (const p of entries) {
            const def = p.synthDefName ? ` (${p.synthDefName})` : '';
            const snippet = p.code ? p.code.slice(0, 60) + (p.code.length > 60 ? '…' : '') : '(no code)';
            console.log(`  ${p.name}${def}  →  ${snippet}`);
          }
        }
        rl.prompt(); return;
      }

      if (sub.startsWith('delete ')) {
        const name = sub.slice(7).trim();
        if (!presetMgr) { process.stderr.write('[hclang_repl] Preset manager not available.\n'); rl.prompt(); return; }
        const ok = presetMgr.delete(name);
        console.log(ok ? `[hclang_repl] Deleted preset: "${name}"` : `[hclang_repl] Preset not found: "${name}"`);
        rl.prompt(); return;
      }

      if (sub.startsWith('export ')) {
        const dest = path.resolve(sub.slice(7).trim());
        if (!presetMgr) { process.stderr.write('[hclang_repl] Preset manager not available.\n'); rl.prompt(); return; }
        try { presetMgr.exportFile(dest); console.log(`[hclang_repl] Presets exported to ${dest}`); }
        catch (e) { process.stderr.write(`[hclang_repl] Export failed: ${e.message}\n`); }
        rl.prompt(); return;
      }

      if (sub.startsWith('import ')) {
        const src = path.resolve(sub.slice(7).trim());
        if (!presetMgr) { process.stderr.write('[hclang_repl] Preset manager not available.\n'); rl.prompt(); return; }
        try {
          const n = presetMgr.importFile(src);
          console.log(`[hclang_repl] Imported ${n} preset(s) from ${src}`);
        } catch (e) { process.stderr.write(`[hclang_repl] Import failed: ${e.message}\n`); }
        rl.prompt(); return;
      }

      process.stderr.write('[hclang_repl] .preset usage: save|load|list|delete|export|import\n');
      rl.prompt(); return;
    }

    if (trimmed.startsWith('.load ')) {
      const filePath = path.resolve(trimmed.slice(6).trim());
      try {
        const code = fs.readFileSync(filePath, 'utf8');
        lastCode = code;
        evalCode(code);
        console.log(`[hclang_repl] Loaded ${filePath}`);
      } catch (e) {
        process.stderr.write(`[hclang_repl] .load error: ${e.message}\n`);
      }
      rl.prompt();
      return;
    }

    try {
      lastCode = trimmed;
      evalCode(trimmed);
    } catch (e) {
      process.stderr.write(`[hclang_repl] eval error: ${e.message}\n`);
    }

    rl.prompt();
  });

  rl.on('close', onClose);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`hclang_repl failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = { main };
