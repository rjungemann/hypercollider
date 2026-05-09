#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSclangCli } = require('../hclang');
const { runScsynthCli } = require('../hcsynth');

const SCLANG_JS = 'build/wasm/lang/hclang/hclang.js';
const SCSYNTH_JS = 'build/wasm/server/hcsynth/hcsynth.js';

if (!fs.existsSync(SCLANG_JS) || !fs.existsSync(SCSYNTH_JS)) {
  console.log('SKIP: WASM build artifacts not found. Run `just build` first.');
  process.exit(0);
}

const SINE_SCD = path.resolve('examples/sine_wave.scd');
if (!fs.existsSync(SINE_SCD)) {
  console.error(`Missing example: ${SINE_SCD}`);
  process.exit(1);
}

const DURATION = 0.5;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, reason) {
  console.error(`  ✗ ${label}: ${reason}`);
  failed++;
}

async function renderFormat({ format, bitDepth, ext }) {
  const label = `${format} ${bitDepth}-bit`;
  const outPath = path.join(os.tmpdir(), `test_cli_formats_${format}_${bitDepth}.${ext}`);
  const packetsPath = path.join(os.tmpdir(), `test_cli_formats_packets_${format}_${bitDepth}.json`);

  try {
    await runSclangCli({
      script: SINE_SCD,
      output: packetsPath,
      sclangJs: SCLANG_JS,
      verbose: false,
      verbosity: -2,
    });

    await runScsynthCli({
      commands: packetsPath,
      output: outPath,
      duration: DURATION,
      sampleRate: SAMPLE_RATE,
      blockSize: 512,
      channels: CHANNELS,
      bitDepth,
      outputFormat: format,
      scsynthJs: SCSYNTH_JS,
      verbosity: -2,
    });

    if (!fs.existsSync(outPath)) {
      fail(label, 'output file not created');
      return;
    }

    const stat = fs.statSync(outPath);

    if (stat.size < 100) {
      fail(label, `output too small (${stat.size} bytes)`);
      return;
    }

    if (format === 'wav') {
      const buf = Buffer.alloc(4);
      const fd = fs.openSync(outPath, 'r');
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      if (buf.toString('ascii') !== 'RIFF') {
        fail(label, `expected RIFF header, got ${buf.toString('hex')}`);
        return;
      }
    } else if (format === 'aiff') {
      const buf = Buffer.alloc(4);
      const fd = fs.openSync(outPath, 'r');
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      if (buf.toString('ascii') !== 'FORM') {
        fail(label, `expected FORM header, got ${buf.toString('hex')}`);
        return;
      }
    }

    ok(`${label} (${stat.size} bytes → ${outPath})`);
  } catch (e) {
    fail(label, e.message);
  } finally {
    try { if (fs.existsSync(packetsPath)) fs.unlinkSync(packetsPath); } catch (_) {}
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
  }
}

async function main() {
  console.log('test_cli_formats: output format and bit-depth combinations\n');

  const cases = [
    { format: 'wav',  bitDepth: 16, ext: 'wav'  },
    { format: 'wav',  bitDepth: 24, ext: 'wav'  },
    { format: 'wav',  bitDepth: 32, ext: 'wav'  },
    { format: 'aiff', bitDepth: 16, ext: 'aiff' },
    { format: 'aiff', bitDepth: 24, ext: 'aiff' },
    { format: 'aiff', bitDepth: 32, ext: 'aiff' },
    { format: 'raw',  bitDepth: 16, ext: 'raw'  },
  ];

  for (const c of cases) {
    await renderFormat(c);
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`test_cli_formats: fatal error: ${err.message}`);
  process.exit(1);
});
