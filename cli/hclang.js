#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { allocCString, instantiateEmscriptenModule, maybeRewriteDrecvTarget, maybeConvertInternalCommandToOsc } = require('./hc_runtime');
const { getVersion, Logger, VERBOSITY_NORMAL } = require('./hc_utils');
const { createUdpClient } = require('./hc_net');
const { createMidiBridge } = require('./hc_midi');
const { createUnixBridge } = require('./hc_unix');

function parseArgs(argv) {
  const out = {
    script: null,
    output: null,
    sclangJs: 'build/wasm/lang/hclang/hclang.js',
    verbose: false,
    verbosity: VERBOSITY_NORMAL,
    scsynthHost: null,
    scsynthPort: null,
    langUdpPort: null,
    callStop: false,
    printReady: false,
    printTiming: false,
    noSnapshot: false,
    snapshotOut: null,
    scriptArgs: [],
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };

    if (a === '--') {
      out.scriptArgs = argv.slice(i + 1);
      break;
    } else if (a === '--script') out.script = next();
    else if (a === '--output') out.output = next();
    else if (a === '--sclang-js') out.sclangJs = next();
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--verbosity') out.verbosity = parseInt(next(), 10);
    else if (a === '--scsynth-host') out.scsynthHost = next();
    else if (a === '--scsynth-port') out.scsynthPort = parseInt(next(), 10);
    else if (a === '--lang-udp-port') out.langUdpPort = parseInt(next(), 10);
    else if (a === '--call-stop') out.callStop = true;
    else if (a === '--print-ready') out.printReady = true;
    else if (a === '--print-timing') out.printTiming = true;
    else if (a === '--no-snapshot') out.noSnapshot = true;
    else if (a === '--snapshot-out') out.snapshotOut = next();
    else if (a === '--version' || a === '-v') {
      console.log(`hclang ${getVersion()}`);
      process.exit(0);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  // --print-ready can be used without --script to measure startup time only.
  if (!out.printReady && !out.script) throw new Error('Missing required --script <file.scd>');

  const hasExternalRoute = out.scsynthHost && out.scsynthPort;
  if (!out.printReady && !hasExternalRoute && !out.output) {
    throw new Error('Missing required --output <commands.json> (or use --scsynth-host + --scsynth-port for live routing)');
  }

  return out;
}

function printHelp() {
  console.log(`hclang - WASM hclang command extractor (v${getVersion()})

Usage (offline — collect packets to file):
  hclang --script input.scd --output commands.json [options]

Usage (live routing — stream OSC directly to running hcsynth):
  hclang --script input.scd --scsynth-host 127.0.0.1 --scsynth-port 57110 [options]

Required:
  --script <file>              Input .scd file to evaluate

Offline options:
  --output <file>              Output JSON file (OSC commands)

Live routing options:
  --scsynth-host <addr>        Remote hcsynth host address
  --scsynth-port <port>        Remote hcsynth UDP port
  --lang-udp-port <port>       Local UDP port for hcsynth replies (optional)
  --call-stop                  Evaluate Main.stop after script finishes (default: false)
  --print-ready                Print "hclang:ready" to stdout after boot sequence; exit immediately (no --script required)
  --print-timing               Print "compile_ms: N" to stderr after each script eval (for warm-phase benchmarking)
  --no-snapshot                Disable heap snapshot cache (always run full compileLibrary)
  --snapshot-out <path>        Save boot snapshot to <path> after a full cold boot (cmake use)
  -- <arg> [<arg> ...]         Extra args passed to the script via thisProcess.argv

Shared options:
  --verbosity <level>          Logging verbosity: -2 (silent) to 2 (debug)
                               (default: 0, normal)
  --sclang-js <path>           Path to hclang.js
  --verbose                    Print hclang post output (legacy flag)

Examples:
  hclang --script sine.scd --output commands.json
  hclang --script piece.scd --output commands.json --verbosity 1
  hclang --script sine.scd --scsynth-host 127.0.0.1 --scsynth-port 57110
  hclang --script sine.scd --scsynth-host 127.0.0.1 --scsynth-port 57110 --lang-udp-port 57111

Info:
  -h, --help                   Show this help and exit
  -v, --version                Show version and exit
`);
}

// ─── Heap snapshot helpers ────────────────────────────────────────────────────

const SNAP_DIR  = path.join(os.homedir(), '.cache', 'hclang');
const SNAP_FILE = path.join(SNAP_DIR, 'heap.bin');
const SNAP_MAGIC = 0x48435350; // 'HCSP'

// Hash covers the .wasm binary (compiled code) + .data mtime (class library).
// Any rebuild invalidates the snapshot automatically.
function snapshotHash(sclangJsPath) {
  const wasmPath = sclangJsPath.replace(/\.js$/, '.wasm');
  const dataPath = sclangJsPath.replace(/\.js$/, '.data');
  const h = crypto.createHash('sha256');
  if (fs.existsSync(wasmPath)) h.update(fs.readFileSync(wasmPath));
  if (fs.existsSync(dataPath)) h.update(String(fs.statSync(dataPath).mtimeMs));
  return h.digest('hex');
}

// Wasm-only hash: used for the sidecar snapshot (hclang_snap.bin) generated at
// cmake build time.  .data mtime is excluded because bundling the snapshot into
// .data would change .data's mtime after generation, invalidating the hash.
// The .wasm binary alone uniquely identifies the compiled SC class definitions.
function snapshotHashWasmOnly(sclangJsPath) {
  const wasmPath = sclangJsPath.replace(/\.js$/, '.wasm');
  const h = crypto.createHash('sha256');
  if (fs.existsSync(wasmPath)) h.update(fs.readFileSync(wasmPath));
  return h.digest('hex');
}

function saveSnapshot(module, sclangJsPath) {
  try {
    const heapEnd  = module._hc_wasm_eval_heap_end();
    const snapshot = Buffer.from(module.HEAPU8.buffer, 0, heapEnd);
    const hash     = snapshotHash(sclangJsPath);
    const header   = Buffer.alloc(68); // 4-byte magic + 64-byte hex hash
    header.writeUInt32BE(SNAP_MAGIC, 0);
    header.write(hash, 4, 'ascii');
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(SNAP_FILE, Buffer.concat([header, snapshot]));
  } catch (_) {
    // non-fatal: skip on read-only FS, quota exceeded, etc.
  }
}

// Save a build-time sidecar snapshot to a specified path using the wasm-only hash.
// Called when --snapshot-out is passed (by cmake POST_BUILD).
function saveBundledSnapshot(module, sclangJsPath, outPath) {
  try {
    const heapEnd  = module._hc_wasm_eval_heap_end();
    const snapshot = Buffer.from(module.HEAPU8.buffer, 0, heapEnd);
    const hash     = snapshotHashWasmOnly(sclangJsPath);
    const header   = Buffer.alloc(68);
    header.writeUInt32BE(SNAP_MAGIC, 0);
    header.write(hash, 4, 'ascii');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.concat([header, snapshot]));
  } catch (_) {
    // non-fatal
  }
}

// Returns true if a valid, current snapshot was restored into module.HEAPU8.
function tryRestoreSnapshot(module, sclangJsPath) {
  // 1. Try sidecar snapshot (same dir as hclang.js, wasm-only hash).
  //    Written by cmake POST_BUILD; ships alongside hclang.js in distribution.
  const sidecarPath = path.join(path.dirname(sclangJsPath), 'hclang_snap.bin');
  if (sidecarPath !== SNAP_FILE) {
    try {
      if (fs.existsSync(sidecarPath)) {
        const raw = fs.readFileSync(sidecarPath);
        if (raw.length >= 68 &&
            raw.readUInt32BE(0) === SNAP_MAGIC &&
            raw.slice(4, 68).toString('ascii') === snapshotHashWasmOnly(sclangJsPath)) {
          module.HEAPU8.set(raw.slice(68), 0);
          return true;
        }
      }
    } catch (_) {
      // fall through to user cache
    }
  }

  // 2. Try user cache (full hash: wasm + .data mtime).
  try {
    if (!fs.existsSync(SNAP_FILE)) return false;
    const raw = fs.readFileSync(SNAP_FILE);
    if (raw.length < 68) return false;
    if (raw.readUInt32BE(0) !== SNAP_MAGIC) return false;
    if (raw.slice(4, 68).toString('ascii') !== snapshotHash(sclangJsPath)) return false;
    module.HEAPU8.set(raw.slice(68), 0);
    return true;
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function runSclangCli(opts) {
  const logger = new Logger(opts.verbosity || VERBOSITY_NORMAL);

  logger.debug('runSclangCli started', { opts });

  // Per-stage timing instrumentation (P1.2 diagnostic baseline).
  // Cheap monotonic clock; printed to stderr under -v 1 (verbosity >= 1).
  const tStart = Date.now();
  let tPrev = tStart;
  const stage = (name) => {
    if (opts.verbosity < 1) { tPrev = Date.now(); return; }
    const now = Date.now();
    const dur = now - tPrev;
    const since_start = now - tStart;
    process.stderr.write(`[stage] ${name.padEnd(22)} ${dur.toString().padStart(5)} ms (cumulative ${since_start.toString().padStart(5)} ms)\n`);
    tPrev = now;
  };

  const hasExternalRoute = opts.scsynthHost && opts.scsynthPort;

  // When routing externally, output path is optional.
  const outputPath = opts.output ? path.resolve(opts.output) : null;

  const packets = [];
  const postLines = [];
  const errLines = [];

  const tModuleStart = Date.now();
  const sclang = await instantiateEmscriptenModule(opts.sclangJs, {
    print: () => {},
    printErr: () => {},
  });
  const tModuleEnd = Date.now();
  stage("wasm_load");

  const midiBridge = createMidiBridge(sclang, logger);
  sclang.__hc_wasm_midi_bridge = midiBridge;
  globalThis.__hc_wasm_midi_bridge = midiBridge;

  const unixBridge = createUnixBridge(sclang, logger);
  sclang.__hc_wasm_unix_bridge = unixBridge;
  globalThis.__hc_wasm_unix_bridge = unixBridge;
  stage("setup_bridges");

  let udpClient = null;

  if (hasExternalRoute) {
    udpClient = createUdpClient(opts.scsynthHost, opts.scsynthPort, logger);

    if (opts.langUdpPort) {
      await udpClient.bindPort(opts.langUdpPort);
    }

    udpClient.onReply((msg) => {
      // Log any replies from the remote scsynth (e.g. /done, /status.reply)
      const addr = msg.length >= 2 && msg[0] === 0x2f
        ? msg.slice(0, msg.indexOf(0) || msg.length).toString('utf8')
        : '(unknown)';
      logger.info(`scsynth reply: ${addr} (${msg.length} bytes)`);
    });
  }

  const captureBridge = (bytesView) => {
    if (!bytesView || !bytesView.length) return -2;

    let bytes = maybeRewriteDrecvTarget(new Uint8Array(bytesView));
    bytes = maybeConvertInternalCommandToOsc(bytes);

    if (hasExternalRoute) {
      udpClient.send(bytes);
      return 0;
    }

    packets.push(Buffer.from(bytes).toString('base64'));
    return 0;
  };

  globalThis.__hc_wasm_forward_osc_to_engine = captureBridge;
  sclang.__hc_wasm_forward_osc_to_engine = captureBridge;

  const postCb = sclang.addFunction((ptr, len) => {
    const text = sclang.UTF8ToString(ptr, len);
    postLines.push(text);
    if (opts.verbose) {
      process.stdout.write(text);
    }
  }, 'vii');

  const errCb = sclang.addFunction((ptr, len) => {
    const text = sclang.UTF8ToString(ptr, len);
    errLines.push(text);
    process.stderr.write(text);
  }, 'vii');

  const wasmJsPath = path.resolve(opts.sclangJs);
  const tBootStart = Date.now();
  stage("pre_boot");

  // Try to restore a heap snapshot before registering callbacks — the restore
  // overwrites all linear memory (including any previously written callback
  // pointers), so callbacks must always be (re-)registered after this call.
  let snapshotRestored = false;
  if (!opts.noSnapshot) {
    snapshotRestored = tryRestoreSnapshot(sclang, wasmJsPath);
  }
  if (snapshotRestored) {
    stage("snapshot_restore");
  }

  // Register/re-register callbacks on both paths:
  // - fast path: re-register overwrites stale function-table indices from snapshot
  // - slow path: initial registration before compileLibrary runs
  sclang._hc_wasm_eval_set_post_callback(postCb);
  sclang._hc_wasm_eval_set_error_callback(errCb);
  stage("register_callbacks");

  const initRc = sclang._hc_wasm_eval_boot_sequence();
  const tBootEnd = Date.now();
  stage("boot_sequence");
  if (initRc !== 0) throw new Error(`hc_wasm_eval_boot_sequence failed (${initRc})`);

  // Save snapshot after first successful full boot so subsequent runs are fast.
  if (!snapshotRestored && !opts.noSnapshot) {
    saveSnapshot(sclang, wasmJsPath);
    stage("snapshot_save");
  }

  // Save build-time sidecar snapshot when --snapshot-out is provided (cmake POST_BUILD).
  if (!snapshotRestored && opts.snapshotOut) {
    saveBundledSnapshot(sclang, wasmJsPath, opts.snapshotOut);
    stage("bundled_snapshot_save");
  }

  if (opts.printTiming) {
    process.stderr.write(
      `hclang_module_ms: ${tModuleEnd - tModuleStart}\n` +
      `hclang_boot_ms: ${tBootEnd - tBootStart}\n` +
      `hclang_snapshot_used: ${snapshotRestored ? 1 : 0}\n`
    );
  }

  if (opts.printReady) {
    process.stdout.write('hclang:ready\n');
    // Startup-only mode: exit without evaluating any script.
    if (!opts.script) return { outputPath: null, packetCount: 0, routed: false };
  }

  const scriptPath = path.resolve(opts.script);
  const script = fs.readFileSync(scriptPath, 'utf8');
  stage("script_load");

  const serverState = 'Server.default.statusWatcher.serverRunning = true; Server.default.statusWatcher.notified = true;';
  {
    const p = allocCString(sclang, serverState);
    try {
      sclang._hc_wasm_eval_execute(p, serverState.length);
    } finally {
      sclang._free(p);
    }
  }

  {
    const extraArgs = opts.scriptArgs && opts.scriptArgs.length > 0 ? opts.scriptArgs : [];
    const argList = JSON.stringify(['sclang', scriptPath, ...extraArgs]);
    const prelude = `thisProcess.argv = ${argList};`;
    const pp = allocCString(sclang, prelude);
    try {
      sclang._hc_wasm_eval_execute(pp, prelude.length);
    } finally {
      sclang._free(pp);
    }
    logger.debug(`Set thisProcess.argv = ${argList}`);
  }
  stage("setup_server");

  {
    const p = allocCString(sclang, script);
    logger.info(`Evaluating script ${scriptPath}...`);
    const tEvalStart = Date.now();
    try {
      sclang._hc_wasm_eval_execute(p, script.length);
    } finally {
      sclang._free(p);
    }
    const tEvalEnd = Date.now();
    stage("eval_execute");
    if (opts.printTiming) {
      process.stderr.write(`hclang_eval_ms: ${tEvalEnd - tEvalStart}\n`);
    }
    logger.debug(`Script evaluation complete, captured ${packets.length} OSC packets`);
  }

  if (opts.callStop) {
    const stopCode = 'Main.stop;';
    const p = allocCString(sclang, stopCode);
    try {
      sclang._hc_wasm_eval_execute(p, stopCode.length);
    } finally {
      sclang._free(p);
    }
    logger.debug('Called Main.stop');
  }

  globalThis.__hc_wasm_forward_osc_to_engine = null;
  sclang.__hc_wasm_forward_osc_to_engine = null;
  if (midiBridge && typeof midiBridge.disposeClient === 'function') {
    try {
      midiBridge.disposeClient();
    } catch (_) {
      // ignore cleanup failures
    }
  }
  globalThis.__hc_wasm_midi_bridge = null;
  sclang.__hc_wasm_midi_bridge = null;
  globalThis.__hc_wasm_unix_bridge = null;
  sclang.__hc_wasm_unix_bridge = null;

  if (udpClient) {
    udpClient.close();
  }

  const errText = errLines.join('');
  const hasUserScriptError = /syntax error|parse error|Command line parse failed/i.test(errText);

  if (hasExternalRoute) {
    if (hasUserScriptError) {
      const msg = `sclang compilation failed for user script:\n${errText}`;
      throw new Error(msg);
    }
    logger.info(`✓ Forwarded OSC packets to ${opts.scsynthHost}:${opts.scsynthPort}`);
    return { outputPath: null, packetCount: 0, routed: true };
  }

  if (hasUserScriptError && packets.length === 0) {
    const msg = `sclang compilation failed for user script:\n${errText}`;
    throw new Error(msg);
  }

  const payload = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    scriptPath,
    packetsBase64: packets,
  };

  logger.info(`Writing ${packets.length} packets to ${outputPath}...`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  logger.info(`✓ Extracted ${packets.length} OSC packets`);

  const tEnd = Date.now();
  const totalWall = tEnd - tStart;
  if (opts.verbosity >= 1) {
    process.stderr.write(`[summary] total_wall ${totalWall} ms\n`);
  }

  return {
    outputPath,
    packetCount: packets.length,
    routed: false,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const logger = new Logger(opts.verbosity);
  const result = await runSclangCli(opts);
  if (result.routed) {
    logger.log(`✓ Routed OSC to external scsynth`);
  } else {
    logger.log(`✓ Wrote ${result.packetCount} OSC packets to ${result.outputPath}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`hclang failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = {
  runSclangCli,
};
