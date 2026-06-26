#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeAudioFile, detectFormat } = require('./hc_audio');
const { instantiateEmscriptenModule, maybeRewriteDrecvTarget, maybeConvertInternalCommandToOsc, setupNativeFsForCli } = require('./hc_runtime');
const { getVersion, Logger, VERBOSITY_NORMAL } = require('./hc_utils');
const { startServers } = require('./hc_net');
const { createOscQueryServer } = require('./hc_oscquery');
const { advertiseServer } = require('./hc_zeroconf');

// Default location for hcsynth.js. Honors HC_LIBEXEC_DIR when set so a
// packaged install (asdf-style plugin, etc.) can point the CLI at its
// bundled WASM artifacts without every user needing --scsynth-js.
function defaultScsynthJs() {
  const dir = process.env.HC_LIBEXEC_DIR;
  if (dir) return path.join(dir, 'hcsynth.js');
  return 'build/wasm/server/hcsynth/hcsynth.js';
}

function parseArgs(argv) {
  const out = {
    // offline render fields
    commands: null,
    output: null,
    duration: 2.0,
    channels: 2,
    bitDepth: 16,
    outputFormat: null,
    // server mode fields
    server: false,
    udpPort: 57110,
    tcpPort: null,
    bindAddress: '127.0.0.1',
    maxLogins: 64,
    tcpPassword: null,
    realtimeAudio: false,
    deviceRoutes: [],
    oscqueryPort: null,
    noOscquery: false,
    // zeroconf/mDNS fields
    noZeroconf: false,
    zeroconfName: 'SuperCollider',
    // profiling
    profileBlocks: null,
    // shared fields
    sampleRate: 48000,
    blockSize: 512,
    scsynthJs: defaultScsynthJs(),
    verbosity: VERBOSITY_NORMAL,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };

    if (a === '--commands') out.commands = next();
    else if (a === '--output') out.output = next();
    else if (a === '--duration') out.duration = parseFloat(next());
    else if (a === '--bit-depth') out.bitDepth = parseInt(next(), 10);
    else if (a === '--output-format') out.outputFormat = next();
    else if (a === '--sample-rate') out.sampleRate = parseInt(next(), 10);
    else if (a === '--block-size') out.blockSize = parseInt(next(), 10);
    else if (a === '--channels') out.channels = parseInt(next(), 10);
    else if (a === '--scsynth-js') out.scsynthJs = next();
    else if (a === '--verbosity') out.verbosity = parseInt(next(), 10);
    else if (a === '--server') out.server = true;
    else if (a === '--udp-port' || a === '-u') out.udpPort = parseInt(next(), 10);
    else if (a === '--tcp-port' || a === '-t') out.tcpPort = parseInt(next(), 10);
    else if (a === '--bind-address' || a === '-B') out.bindAddress = next();
    else if (a === '--max-logins' || a === '-l') out.maxLogins = parseInt(next(), 10);
    else if (a === '--tcp-password' || a === '-p') out.tcpPassword = next();
    else if (a === '--realtime-audio') out.realtimeAudio = true;
    else if (a === '--device-route') {
      const spec = next();
      const parts = spec.split(':');
      if (parts.length !== 2) throw new Error('--device-route format: <startBus>:<endBus>  e.g. --device-route 0:2');
      const start = parseInt(parts[0], 10);
      const end   = parseInt(parts[1], 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start)
        throw new Error('--device-route: startBus must be >= 0 and endBus > startBus');
      out.deviceRoutes.push({ start, end });
    }
    else if (a === '--oscquery-port') out.oscqueryPort = parseInt(next(), 10);
    else if (a === '--no-oscquery') out.noOscquery = true;
    else if (a === '--no-zeroconf') out.noZeroconf = true;
    else if (a === '--zeroconf-name') out.zeroconfName = next();
    else if (a === '--profile') out.profileBlocks = parseInt(next(), 10);
    else if (a === '--version' || a === '-v') {
      console.log(`hcsynth ${getVersion()}`);
      process.exit(0);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (out.deviceRoutes.length > 0) {
    if (!out.realtimeAudio) throw new Error('--device-route requires --realtime-audio');
    for (const r of out.deviceRoutes) {
      if (r.end > out.channels)
        throw new Error(`--device-route ${r.start}:${r.end} exceeds --channels ${out.channels}`);
    }
    // Check for overlapping bus assignments
    const used = new Uint8Array(out.channels);
    for (const r of out.deviceRoutes) {
      for (let c = r.start; c < r.end; c++) {
        if (used[c]) throw new Error(`--device-route: channel ${c} assigned to multiple routes`);
        used[c] = 1;
      }
    }
  }

  if (!Number.isFinite(out.sampleRate) || out.sampleRate <= 0) throw new Error('--sample-rate must be > 0');
  if (!Number.isFinite(out.blockSize) || out.blockSize <= 0) throw new Error('--block-size must be > 0');
  if (out.profileBlocks !== null && (!Number.isInteger(out.profileBlocks) || out.profileBlocks < 1))
    throw new Error('--profile must be a positive integer (number of blocks between profile dumps)');

  if (out.server) {
    if (out.udpPort !== null && (!Number.isInteger(out.udpPort) || out.udpPort < 1 || out.udpPort > 65535))
      throw new Error('--udp-port must be 1-65535');
    if (out.tcpPort !== null && (!Number.isInteger(out.tcpPort) || out.tcpPort < 1 || out.tcpPort > 65535))
      throw new Error('--tcp-port must be 1-65535');
    if (!out.udpPort && !out.tcpPort)
      throw new Error('--server requires at least --udp-port or --tcp-port');
    if (!out.bindAddress) throw new Error('--bind-address must not be empty');
    if (!Number.isInteger(out.maxLogins) || out.maxLogins < 1)
      throw new Error('--max-logins must be >= 1');
  } else {
    if (!out.commands) throw new Error('Missing required --commands <commands.json> (or use --server)');
    if (!out.output) throw new Error('Missing required --output <file.wav> (or use --server)');
    if (!Number.isFinite(out.duration) || out.duration <= 0) throw new Error('--duration must be > 0');
    if (!Number.isFinite(out.channels) || out.channels <= 0) throw new Error('--channels must be > 0');
    if (![16, 24, 32].includes(out.bitDepth)) throw new Error('--bit-depth must be 16, 24, or 32');
    if (out.outputFormat && !['wav', 'aiff', 'raw'].includes(out.outputFormat))
      throw new Error('--output-format must be wav, aiff, or raw');
  }

  return out;
}

function printHelp() {
  console.log(`hcsynth - HyperCollider synth CLI (v${getVersion()})

Offline render mode:
  hcsynth --commands commands.json --output out.wav [options]

Server mode (UDP and/or TCP):
  hcsynth --server [--udp-port <port>] [--tcp-port <port>] [options]

Offline render options:
  --commands <json>              OSC command payload (from hclang)
  --output <file>                Output audio file (.wav, .aiff, or .raw)
  --duration <seconds>           Render duration in seconds (default: 2.0)
  --channels <n>                 Number of output channels (default: 2)
  --bit-depth <n>                Output bit depth: 16, 24, or 32 (float) (default: 16)
  --output-format <fmt>          Output format: wav, aiff, raw (default: inferred from extension)

Server options:
  --server                       Run as network OSC server (until /quit or SIGINT)
  --udp-port <port>, -u          UDP listen port (default: 57110 when --server)
  --tcp-port <port>, -t          TCP listen port (disabled unless specified)
  --bind-address <addr>, -B      Bind address (default: 127.0.0.1)
  --max-logins <n>, -l           Max simultaneous TCP connections (default: 64)
  --tcp-password <pass>, -p      TCP session password (default: none)
  --realtime-audio               Stream rendered audio to system speakers (requires 'audio-speaker' npm package)
  --device-route <start>:<end>   Route channels [start, end) to a separate speaker (repeatable).
                                 Requires --realtime-audio and --channels >= end.
                                 e.g. --channels 4 --device-route 0:2 --device-route 2:4
                                 (two stereo speakers from a 4-channel world)
  --oscquery-port <port>         Start an OSCQuery HTTP server on this port (default: --udp-port + 1)
  --no-oscquery                  Disable the OSCQuery HTTP server
  --no-zeroconf                 Disable mDNS service advertisement (default: enabled in server mode)
  --zeroconf-name <name>        Service name for mDNS advertisement (default: "SuperCollider")

Shared options:
  --sample-rate <hz>             Sample rate in Hz (default: 48000)
  --block-size <samples>         Render block size (default: 512)
  --profile <n>                  Emit a CPU/timing profile summary every N render blocks (stdout)
  --verbosity <level>            Logging verbosity: -2 (silent) to 2 (debug)
                                 (default: 0, normal)
  --scsynth-js <path>            Path to hcsynth.js

Examples:
  hcsynth --commands cmds.json --output out.wav
  hcsynth --server --udp-port 57110
  hcsynth --server -u 57110 -t 57120 -B 0.0.0.0
  hcsynth --server --tcp-port 57120 --max-logins 8 --tcp-password secret
  hcsynth --server --udp-port 57110 --realtime-audio

Info:
  -h, --help                     Show this help and exit
  -v, --version                  Show version and exit
`);
}

async function runScsynthCli(opts) {
  const logger = new Logger(opts.verbosity || VERBOSITY_NORMAL);
  const commandsPath = path.resolve(opts.commands);
  const outputPath = path.resolve(opts.output);

  logger.debug('runScsynthCli started', { opts });

  const payload = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
  if (!payload || typeof payload !== 'object') {
    throw new Error('commands payload must be a JSON object');
  }
  if (payload.formatVersion !== 1) {
    throw new Error(`Unsupported commands formatVersion: ${payload.formatVersion}`);
  }
  if (!Array.isArray(payload.packetsBase64)) {
    throw new Error('commands payload must include packetsBase64 array');
  }
  const packetsBase64 = payload.packetsBase64;
  for (let i = 0; i < packetsBase64.length; i++) {
    if (typeof packetsBase64[i] !== 'string') {
      throw new Error(`packetsBase64[${i}] must be a base64 string`);
    }
  }

  const scsynth = await instantiateEmscriptenModule(opts.scsynthJs, {
    print: () => {},
    printErr: () => {},
  });

  const nativeFsSetup = setupNativeFsForCli(scsynth);
  if (nativeFsSetup.enabled) {
    logger.info(`Native FS enabled at ${nativeFsSetup.mountPoint}`);
  } else {
    logger.debug(`Native FS setup skipped: ${nativeFsSetup.reason}`);
  }

  const worldId = scsynth._hc_wasm_world_create(opts.sampleRate, opts.blockSize);
  if (!worldId) throw new Error('hc_wasm_world_create failed');

  try {
    logger.info(`Dispatching ${packetsBase64.length} OSC packets...`);
    for (let i = 0; i < packetsBase64.length; i++) {
      const raw = Buffer.from(packetsBase64[i], 'base64');
      let bytes = maybeRewriteDrecvTarget(new Uint8Array(raw));
      bytes = maybeConvertInternalCommandToOsc(bytes);
      logger.debug(`Packet ${i}: ${bytes.length} bytes`);
      const ptr = scsynth._malloc(bytes.length);
      try {
        scsynth.HEAPU8.set(bytes, ptr);
        let rc = -3;
        if (typeof scsynth._hc_wasm_osc_dispatch === 'function') {
          rc = scsynth._hc_wasm_osc_dispatch(worldId, ptr, bytes.length);
        } else if (typeof scsynth.ccall === 'function') {
          rc = scsynth.ccall('hc_wasm_osc_dispatch', 'number', ['number', 'number', 'number'], [worldId, ptr, bytes.length]);
        }
        if (rc !== 0) {
          throw new Error(`OSC dispatch failed at packet ${i} (rc=${rc})`);
        }
        logger.debug(`Packet ${i} dispatched (rc=${rc})`);
      } finally {
        scsynth._free(ptr);
      }
    }

    const totalSamples = Math.floor(opts.duration * opts.sampleRate);
    logger.info(`Rendering ${totalSamples} samples...`);
    const interleaved = new Float32Array(totalSamples * opts.channels);
    const blockFrames = opts.blockSize;
    const blockSamples = blockFrames * opts.channels;
    const outBytes = blockSamples * 4;
    const outPtr = scsynth._malloc(outBytes);

    // Profiling state — used when --profile N is set.
    const profileInterval = opts.profileBlocks || null;
    let profileBlockCount = 0;
    let profileTotalTime = 0;
    let profilePeakTime = 0;
    let profileWindowStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

    function dumpProfile(label) {
      const blockDurationMs = (blockFrames / opts.sampleRate) * 1000;
      const avgMs = profileBlockCount > 0 ? profileTotalTime / profileBlockCount : 0;
      const cpuPct = blockDurationMs > 0 ? (avgMs / blockDurationMs) * 100 : 0;
      const wallMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - profileWindowStart;
      console.log(
        `[profile] ${label}: blocks=${profileBlockCount}` +
        ` avg=${avgMs.toFixed(3)}ms peak=${profilePeakTime.toFixed(3)}ms` +
        ` blockDuration=${blockDurationMs.toFixed(3)}ms cpu=${cpuPct.toFixed(1)}%` +
        ` wall=${wallMs.toFixed(0)}ms`
      );
      profileBlockCount = 0;
      profileTotalTime = 0;
      profilePeakTime = 0;
      profileWindowStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    try {
      let framesWritten = 0;
      let blockIndex = 0;
      while (framesWritten < totalSamples) {
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const rc = scsynth._hc_wasm_render(worldId, outPtr, blockFrames, opts.channels);
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        if (rc !== 0) throw new Error(`hc_wasm_render failed (${rc})`);

        if (profileInterval !== null) {
          profileBlockCount++;
          profileTotalTime += elapsed;
          if (elapsed > profilePeakTime) profilePeakTime = elapsed;
          if (profileBlockCount >= profileInterval) {
            dumpProfile(`block ${blockIndex + 1}`);
          }
        }

        const block = new Float32Array(scsynth.HEAPF32.buffer, outPtr, blockSamples);
        const remaining = totalSamples - framesWritten;
        const copyFrames = Math.min(blockFrames, remaining);
        interleaved.set(block.subarray(0, copyFrames * opts.channels), framesWritten * opts.channels);
        framesWritten += copyFrames;
        blockIndex++;
      }
      logger.info(`Rendered ${totalSamples} samples`);
      // Final profile dump for any remaining blocks in the window.
      if (profileInterval !== null && profileBlockCount > 0) {
        dumpProfile('final');
      }
    } finally {
      scsynth._free(outPtr);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    writeAudioFile({
      outputPath,
      interleaved,
      sampleRate: opts.sampleRate,
      channels: opts.channels,
      bitDepth: opts.bitDepth || 16,
      format: opts.outputFormat || detectFormat(outputPath),
    });

    return {
      outputPath,
      packetCount: packetsBase64.length,
    };
  } finally {
    scsynth._hc_wasm_world_destroy(worldId);
  }
}

async function runScsynthServer(opts) {
  const logger = new Logger(opts.verbosity || VERBOSITY_NORMAL);

  logger.debug('runScsynthServer started', { opts });

  const scsynth = await instantiateEmscriptenModule(opts.scsynthJs, {
    print: (text) => logger.debug('[hcsynth]', text),
    printErr: (text) => logger.debug('[scsynth:err]', text),
  });

  const nativeFsSetup = setupNativeFsForCli(scsynth);
  if (nativeFsSetup.enabled) {
    logger.info(`Native FS enabled at ${nativeFsSetup.mountPoint}`);
  } else {
    logger.debug(`Native FS setup skipped: ${nativeFsSetup.reason}`);
  }

  const worldId = scsynth._hc_wasm_world_create(opts.sampleRate, opts.blockSize);
  if (!worldId) throw new Error('hc_wasm_world_create failed');

  let Speaker = null;
  let outPtr = null;
  let audioRunning = false;
  // routes: array of { start, end, chCount, speaker }
  // Single-device path uses one route covering all channels.
  const audioRoutes = [];

  if (opts.realtimeAudio) {
    try {
      Speaker = require('audio-speaker/stream');
    } catch (_) {
      throw new Error(
        'The "audio-speaker" npm package is required for --realtime-audio.\n' +
        'Install it with: npm install audio-speaker'
      );
    }

    // Build route list: explicit --device-route args, or one default route for all channels.
    const routeSpecs = opts.deviceRoutes.length > 0
      ? opts.deviceRoutes
      : [{ start: 0, end: opts.channels }];

    for (const spec of routeSpecs) {
      const chCount = spec.end - spec.start;
      const spk = Speaker({ channels: chCount, bitDepth: 16, sampleRate: opts.sampleRate });
      spk.on('error', (err) => logger.warn(`[speaker:${spec.start}-${spec.end}] ${err.message}`));
      audioRoutes.push({ start: spec.start, end: spec.end, chCount, speaker: spk });
    }

    const blockSamples = opts.blockSize * opts.channels;
    outPtr = scsynth._malloc(blockSamples * 4);
    audioRunning = true;

    function renderBlock() {
      if (!audioRunning) return;

      const rc = scsynth._hc_wasm_render(worldId, outPtr, opts.blockSize, opts.channels);
      if (rc !== 0) {
        setImmediate(renderBlock);
        return;
      }

      const floats = new Float32Array(scsynth.HEAPF32.buffer, outPtr, blockSamples);

      // Reference-counted drain: schedule next render only after all speakers accept their data.
      let pendingDrains = 0;

      function maybeNext() {
        if (pendingDrains === 0) setImmediate(renderBlock);
      }

      for (const route of audioRoutes) {
        const pcm = Buffer.alloc(opts.blockSize * route.chCount * 2);
        for (let f = 0; f < opts.blockSize; f++) {
          for (let c = 0; c < route.chCount; c++) {
            const src = f * opts.channels + route.start + c;
            const x = Math.max(-1, Math.min(1, floats[src]));
            const s = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
            pcm.writeInt16LE(s, (f * route.chCount + c) * 2);
          }
        }
        if (!route.speaker.write(pcm)) {
          pendingDrains++;
          route.speaker.once('drain', () => { pendingDrains--; maybeNext(); });
        }
      }

      maybeNext();
    }

    if (routeSpecs.length === 1) {
      logger.log(`Real-time audio: ${opts.channels}ch @ ${opts.sampleRate}Hz, block=${opts.blockSize}`);
    } else {
      logger.log(`Real-time audio: ${opts.channels}ch @ ${opts.sampleRate}Hz, block=${opts.blockSize}, routes: ${routeSpecs.map(r => `${r.start}:${r.end}`).join(', ')}`);
    }
    renderBlock();
  }

  // Periodic profiling: when --profile N is given, log CPU metrics every N seconds.
  let profileInterval = null;
  if (opts.profileBlocks) {
    // In server mode N is interpreted as a polling interval in seconds (minimum 1).
    const intervalSec = Math.max(1, opts.profileBlocks);
    const cpuOutPtr = scsynth._malloc(4);
    const xrunsOutPtr = scsynth._malloc(4);
    const bufUsedOutPtr = scsynth._malloc(4);
    profileInterval = setInterval(() => {
      try {
        const rc = scsynth._hc_wasm_get_metrics
          ? scsynth._hc_wasm_get_metrics(worldId, cpuOutPtr, xrunsOutPtr, bufUsedOutPtr)
          : -1;
        if (rc === 0) {
          const cpu = scsynth.HEAPF32[cpuOutPtr >> 2];
          const xruns = scsynth.HEAP32[xrunsOutPtr >> 2];
          const bufUsed = scsynth.HEAP32[bufUsedOutPtr >> 2];
          console.log(
            `[profile] cpu=${cpu.toFixed(1)}% xruns=${xruns} bufUsed=${bufUsed}` +
            ` sampleRate=${opts.sampleRate} blockSize=${opts.blockSize}`
          );
        }
      } catch (_) { /* ignore profiling errors */ }
    }, intervalSec * 1000);
  }

  let oscQueryServer = null;
  if (!opts.noOscquery) {
    const oqPort = opts.oscqueryPort || ((opts.udpPort || 57110) + 1);
    try {
      oscQueryServer = await createOscQueryServer({ port: oqPort, oscPort: opts.udpPort || 57110, logger });
    } catch (e) {
      logger.warn(`OSCQuery server failed to start on port ${oqPort}: ${e.message || e}`);
    }
  }

  // mDNS service advertisement (Bonjour / Zeroconf)
  let zeroconf = null;
  if (!opts.noZeroconf) {
    try {
      const oqPort = oscQueryServer ? (opts.oscqueryPort || ((opts.udpPort || 57110) + 1)) : null;
      zeroconf = advertiseServer({
        name: opts.zeroconfName || 'SuperCollider',
        udpPort: opts.udpPort || null,
        tcpPort: opts.tcpPort || null,
        oscQueryPort: oqPort,
        logger,
      });
    } catch (e) {
      logger.warn(`mDNS advertisement failed: ${e.message || e}`);
    }
  }

  try {
    await startServers(scsynth, worldId, {
      udpPort: opts.udpPort || null,
      tcpPort: opts.tcpPort || null,
      bindAddress: opts.bindAddress,
      maxLogins: opts.maxLogins,
      password: opts.tcpPassword,
    }, logger);
  } finally {
    if (profileInterval !== null) clearInterval(profileInterval);
    if (oscQueryServer) { try { await oscQueryServer.close(); } catch (_) {} }
    if (zeroconf) { try { await zeroconf.unpublish(); } catch (_) {} }
    audioRunning = false;
    if (outPtr !== null) scsynth._free(outPtr);
    for (const route of audioRoutes) {
      try { route.speaker.end(); } catch (_) {}
    }
    scsynth._hc_wasm_world_destroy(worldId);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const logger = new Logger(opts.verbosity);
  if (opts.server) {
    await runScsynthServer(opts);
  } else {
    const result = await runScsynthCli(opts);
    logger.log(`[OK] Rendered ${result.packetCount} packets to ${result.outputPath}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`hcsynth failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = {
  runScsynthCli,
  runScsynthServer,
};
