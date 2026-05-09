#!/usr/bin/env node
'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { runSclangCli } = require('./hclang');
const { runScsynthCli } = require('./hcsynth');
const { getVersion, Logger, VERBOSITY_NORMAL } = require('./hc_utils');

function parseArgs(argv) {
  const out = {
    script: null,
    output: null,
    duration: 2.0,
    sampleRate: 48000,
    blockSize: 512,
    channels: 2,
    bitDepth: 16,
    outputFormat: null,
    sclangJs: 'build/wasm/lang/hclang/hclang.js',
    scsynthJs: 'build/wasm/server/hcsynth/hcsynth.js',
    verbose: false,
    verbosity: VERBOSITY_NORMAL,
    scsynthHost: null,
    scsynthPort: null,
    langUdpPort: null,
    callStop: false,
    printTiming: false,
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
    else if (a === '--duration') out.duration = parseFloat(next());
    else if (a === '--sample-rate') out.sampleRate = parseInt(next(), 10);
    else if (a === '--block-size') out.blockSize = parseInt(next(), 10);
    else if (a === '--channels') out.channels = parseInt(next(), 10);
    else if (a === '--bit-depth') out.bitDepth = parseInt(next(), 10);
    else if (a === '--output-format') out.outputFormat = next();
    else if (a === '--sclang-js') out.sclangJs = next();
    else if (a === '--scsynth-js') out.scsynthJs = next();
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--verbosity') out.verbosity = parseInt(next(), 10);
    else if (a === '--scsynth-host') out.scsynthHost = next();
    else if (a === '--scsynth-port') out.scsynthPort = parseInt(next(), 10);
    else if (a === '--lang-udp-port') out.langUdpPort = parseInt(next(), 10);
    else if (a === '--call-stop') out.callStop = true;
    else if (a === '--print-timing') out.printTiming = true;
    else if (a === '--version' || a === '-v') {
      console.log(`hc (hclang) ${getVersion()}`);
      process.exit(0);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!out.script) throw new Error('Missing required --script <file.scd>');

  const hasExternalRoute = out.scsynthHost && out.scsynthPort;

  if (!hasExternalRoute) {
    // Offline mode requires --output
    if (!out.output) throw new Error('Missing required --output <file.wav> (or use --scsynth-host + --scsynth-port for live routing)');
    if (!Number.isFinite(out.duration) || out.duration <= 0) throw new Error('--duration must be > 0');
    if (!Number.isFinite(out.sampleRate) || out.sampleRate <= 0) throw new Error('--sample-rate must be > 0');
    if (!Number.isFinite(out.blockSize) || out.blockSize <= 0) throw new Error('--block-size must be > 0');
    if (!Number.isFinite(out.channels) || out.channels <= 0) throw new Error('--channels must be > 0');
    if (![16, 24, 32].includes(out.bitDepth)) throw new Error('--bit-depth must be 16, 24, or 32');
    if (out.outputFormat && !['wav', 'aiff', 'raw'].includes(out.outputFormat))
      throw new Error('--output-format must be wav, aiff, or raw');
  }

  return out;
}

function printHelp() {
  console.log(`hc - HyperCollider CLI (v${getVersion()})

Offline render mode:
  hc --script input.scd --output out.wav [options]

Live routing mode (routes OSC directly to a running scsynth over UDP):
  hc --script input.scd --scsynth-host 127.0.0.1 --scsynth-port 57110 [options]

Required:
  --script <file>              Input .scd file to render or route

Offline options:
  --output <file>              Output audio file (.wav, .aiff, or .raw)
  --duration <seconds>         Render duration in seconds (default: 2.0)
  --channels <n>               Number of output channels (default: 2)
  --bit-depth <n>              Output bit depth: 16, 24, or 32 (float) (default: 16)
  --output-format <fmt>        Output format: wav, aiff, raw (default: inferred from extension)

Live routing options:
  --scsynth-host <addr>        Remote scsynth host address
  --scsynth-port <port>        Remote scsynth UDP port
  --lang-udp-port <port>       Local UDP port for scsynth replies (optional)

Shared options:
  --sample-rate <hz>           Sample rate in Hz (default: 48000)
  --block-size <samples>       Render block size (default: 512)
  --verbosity <level>          Logging verbosity: -2 (silent) to 2 (debug)
                               (default: 0, normal)
  --sclang-js <path>           Path to hclang.js
  --scsynth-js <path>          Path to hcsynth.js
  --verbose                    Print sclang post output (legacy flag)
  --print-timing               Write compile_ms and synth_ms to stderr after render
  -- <arg> [<arg> ...]         Extra args passed to the script via thisProcess.argv

Examples:
  hc --script sine.scd --output sine.wav
  hc --script piece.scd --output out.wav --duration 30 --sample-rate 48000
  hc --script debug.scd --output out.wav --verbosity 1
  hc --script sine.scd --scsynth-host 127.0.0.1 --scsynth-port 57110
  hc --script live.scd --scsynth-host 127.0.0.1 --scsynth-port 57110 --lang-udp-port 57111

Info:
  -h, --help                   Show this help and exit
  -v, --version                Show version and exit
`);
}

async function main() {
  const opts = parseArgs(process.argv);
  const logger = new Logger(opts.verbosity);

  const hasExternalRoute = opts.scsynthHost && opts.scsynthPort;

  if (hasExternalRoute) {
    // Live routing mode: evaluate sclang and forward OSC directly to scsynth via UDP
    logger.info(`Evaluating ${opts.script} → routing to ${opts.scsynthHost}:${opts.scsynthPort}...`);
    await runSclangCli({
      script: opts.script,
      output: null,
      sclangJs: opts.sclangJs,
      verbose: opts.verbose || opts.verbosity >= 1,
      verbosity: opts.verbosity,
      scsynthHost: opts.scsynthHost,
      scsynthPort: opts.scsynthPort,
      langUdpPort: opts.langUdpPort,
      callStop: opts.callStop,
      scriptArgs: opts.scriptArgs,
    });
    logger.log(`✓ Routed OSC from ${opts.script} to ${opts.scsynthHost}:${opts.scsynthPort}`);
    return;
  }

  // Offline render mode
  const outputPath = path.resolve(opts.output);

  const tempCommandsPath = path.join(
    os.tmpdir(),
    `sc_cli_packets_${process.pid}_${Date.now()}.json`
  );

  logger.debug('hc starting (offline)', { opts });

  try {
    logger.info(`Evaluating ${opts.script}...`);
    const t0 = Date.now();
    const sclangResult = await runSclangCli({
      script: opts.script,
      output: tempCommandsPath,
      sclangJs: opts.sclangJs,
      verbose: opts.verbose || opts.verbosity >= 1,
      verbosity: opts.verbosity,
      scriptArgs: opts.scriptArgs,
      printTiming: opts.printTiming,
    });
    const t1 = Date.now();
    logger.info(`Captured ${sclangResult.packetCount} OSC packets`);

    logger.info(`Rendering ${opts.duration.toFixed(2)}s at ${opts.sampleRate}Hz...`);
    const scsynthResult = await runScsynthCli({
      commands: tempCommandsPath,
      output: outputPath,
      duration: opts.duration,
      sampleRate: opts.sampleRate,
      blockSize: opts.blockSize,
      channels: opts.channels,
      bitDepth: opts.bitDepth,
      outputFormat: opts.outputFormat,
      scsynthJs: opts.scsynthJs,
      verbosity: opts.verbosity,
    });
    const t2 = Date.now();

    if (opts.printTiming) {
      process.stderr.write(`compile_ms: ${t1 - t0}\nsynth_ms: ${t2 - t1}\n`);
    }

    logger.log(`✓ Rendered ${opts.duration.toFixed(2)}s to ${scsynthResult.outputPath}`);
  } finally {
    try {
      if (fs.existsSync(tempCommandsPath)) {
        fs.unlinkSync(tempCommandsPath);
      }
    } catch (e) {
      // best-effort cleanup of temporary packet payload
    }
  }
}

main().catch((err) => {
  console.error(`hc failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
