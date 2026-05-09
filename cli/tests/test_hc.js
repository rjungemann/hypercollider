#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSclangCli } = require('../hclang');
const { runScsynthCli } = require('../hcsynth');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCLANG_JS = path.join(REPO_ROOT, 'build/wasm/lang/hclang/hclang.js');
const SCSYNTH_JS = path.join(REPO_ROOT, 'build/wasm/server/hcsynth/hcsynth.js');

function wavPeak(filePath) {
  const b = fs.readFileSync(filePath);
  let peak = 0;
  for (let i = 44; i + 1 < b.length; i += 2) {
    const s = b.readInt16LE(i) / 32768;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return peak;
}

async function expectThrows(label, fn) {
  try {
    await fn();
    console.error(`FAIL  ${label} (expected throw)`);
    return false;
  } catch (_e) {
    console.log(`PASS  ${label}`);
    return true;
  }
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wasm-cli-test-'));
  let passed = 0;
  let failed = 0;

  const pass = (label) => {
    console.log(`PASS  ${label}`);
    passed++;
  };
  const fail = (label, msg) => {
    console.error(`FAIL  ${label}${msg ? ` - ${msg}` : ''}`);
    failed++;
  };

  try {
    // Test 1: empty script -> silence
    const emptyScd = path.join(tmpRoot, 'empty.scd');
    const emptyCommands = path.join(tmpRoot, 'empty.commands.json');
    const emptyWav = path.join(tmpRoot, 'empty.wav');
    fs.writeFileSync(emptyScd, '\n');

    const r1 = await runSclangCli({ script: emptyScd, output: emptyCommands, sclangJs: SCLANG_JS, verbose: false });
    await runScsynthCli({ commands: emptyCommands, output: emptyWav, duration: 1, sampleRate: 48000, blockSize: 512, channels: 2, scsynthJs: SCSYNTH_JS });
    const p1 = wavPeak(emptyWav);
    if (r1.packetCount === 0 || p1 < 1e-6) pass('empty script renders silence');
    else fail('empty script renders silence', `packetCount=${r1.packetCount}, peak=${p1}`);

    // Test 2: simple .play -> non-silent
    const sineScd = path.join(tmpRoot, 'sine.scd');
    const sineCommands = path.join(tmpRoot, 'sine.commands.json');
    const sineWav = path.join(tmpRoot, 'sine.wav');
    fs.writeFileSync(sineScd, 'x = { SinOsc.ar(440, 0, 0.15) ! 2 }.play;\n');

    const r2 = await runSclangCli({ script: sineScd, output: sineCommands, sclangJs: SCLANG_JS, verbose: false });
    await runScsynthCli({ commands: sineCommands, output: sineWav, duration: 2, sampleRate: 48000, blockSize: 512, channels: 2, scsynthJs: SCSYNTH_JS });
    const p2 = wavPeak(sineWav);
    if (r2.packetCount > 0 && p2 > 1e-4) pass('sine script renders non-silent audio');
    else fail('sine script renders non-silent audio', `packetCount=${r2.packetCount}, peak=${p2}`);

    // Test 3: split command payload has expected shape
    const payload = JSON.parse(fs.readFileSync(sineCommands, 'utf8'));
    if (payload && payload.formatVersion === 1 && Array.isArray(payload.packetsBase64)) pass('hclang command payload shape is valid');
    else fail('hclang command payload shape is valid');

    // Test 4: bad sclang module path fails
    if (await expectThrows('invalid sclang module path fails', async () => {
      await runSclangCli({ script: sineScd, output: path.join(tmpRoot, 'bad.commands.json'), sclangJs: 'does/not/exist.js', verbose: false });
    })) passed++; else failed++;

    // Test 5: malformed commands file fails
    const malformed = path.join(tmpRoot, 'malformed.commands.json');
    fs.writeFileSync(malformed, JSON.stringify({ hello: 'world' }));
    if (await expectThrows('malformed commands payload fails', async () => {
      await runScsynthCli({ commands: malformed, output: path.join(tmpRoot, 'malformed.wav'), duration: 1, sampleRate: 48000, blockSize: 512, channels: 2, scsynthJs: SCSYNTH_JS });
    })) passed++; else failed++;
  } finally {
    // Keep temp artifacts if failures occur for easier debugging.
    if (failed === 0) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } else {
      console.error(`Artifacts kept at: ${tmpRoot}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`Unhandled test error: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
