#!/usr/bin/env node
'use strict';

/**
 * test_hclang_scscm.js
 *
 * Integration tests for the hclang + scscm integration (Phase H1).
 *
 * Tier 1 — Pure-JS compiler checks (no WASM required)
 *   Verify compileScscmText() produces expected sclang output for fixtures.
 *
 * Tier 2 — One-step vs two-step parity (WASM required)
 *   For each fixture, assert that:
 *     runSclangCli({ script: 'foo.scscm' })
 *   produces the same packetsBase64 array as:
 *     compileScscmText(source) → write temp .scd → runSclangCli({ script: tempScd })
 *
 * Tier 3 — --lang flag override (WASM required)
 *   Write scscm source to a .sc-extension file, run with opts.lang='scscm',
 *   assert same packets as direct .scscm run.
 *
 * Environment variables:
 *   SKIP_WASM=1   Skip Tiers 2 and 3; only run Tier 1.
 */

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { compileScscmText } = require('../lhc_compile');
const { runSclangCli }     = require('../hclang');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const HC_DIR     = path.join(__dirname, '..', 'examples', 'hypercollider');
const SCLANG_JS  = path.join(REPO_ROOT, 'build/wasm/lang/hclang/hclang.js');
const SKIP_WASM  = process.env.SKIP_WASM === '1' || !fs.existsSync(SCLANG_JS);

let passed  = 0;
let failed  = 0;
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
// Fixtures (subset with both .scscm and .scd files)
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    id: 'kick1',
    scscmFile: 'kick1.scscm',
    expectedSubstrings: ['SynthDef("kick1"', 'EnvGen.kr', 'SinOsc.ar', 'HPF.ar', 'Pan2.ar', 'Out.ar'],
  },
  {
    id: 'snare1',
    scscmFile: 'snare1.scscm',
    expectedSubstrings: ['SynthDef("snare1"', 'EnvGen.kr', 'WhiteNoise.ar', 'HPF.ar', 'Pan2.ar'],
  },
  {
    id: 'hihat1',
    scscmFile: 'hihat1.scscm',
    expectedSubstrings: ['SynthDef("hihat1"', 'EnvGen.kr', 'HPF.ar', 'WhiteNoise.ar', 'Pan2.ar'],
  },
  {
    id: 'bass1',
    scscmFile: 'bass1.scscm',
    expectedSubstrings: ['SynthDef("bass1"', 'EnvGen.kr', 'Saw.ar', 'RLPF.ar', 'Pan2.ar', 'Out.ar'],
  },
  {
    id: 'pluck1',
    scscmFile: 'pluck1.scscm',
    expectedSubstrings: ['SynthDef("pluck1"', 'EnvGen.kr', 'SinOsc.ar', 'RLPF.ar', 'Pan2.ar', 'Out.ar'],
  },
];

// ---------------------------------------------------------------------------
// Tier 1 — Pure-JS compiler integration via lhc_compile
// ---------------------------------------------------------------------------

section('TIER 1 — lhc_compile module: compileScscmText()');

for (const fix of FIXTURES) {
  const scscmPath = path.join(HC_DIR, fix.scscmFile);

  if (!fs.existsSync(scscmPath)) {
    skip(`${fix.id}: source file exists`, 'file not found');
    continue;
  }

  const source = fs.readFileSync(scscmPath, 'utf8');
  let compiled;

  try {
    compiled = compileScscmText(source, scscmPath);
  } catch (err) {
    fail(`${fix.id}: compileScscmText() succeeds`, err.message);
    continue;
  }

  pass(`${fix.id}: compileScscmText() succeeds`);

  for (const sub of fix.expectedSubstrings) {
    if (compiled.includes(sub)) {
      pass(`${fix.id}: compiled output contains "${sub}"`);
    } else {
      fail(`${fix.id}: compiled output contains "${sub}"`, `Got: ${compiled.slice(0, 200)}`);
    }
  }
}

// Test error propagation: bad syntax should throw a clear error
{
  let threw = false;
  try {
    compileScscmText('(defsynth bad (', 'bad.scscm');
  } catch (err) {
    threw = true;
    if (/scscm compilation failed/i.test(err.message)) {
      pass('compileScscmText() error message contains "scscm compilation failed"');
    } else {
      fail('compileScscmText() error message contains "scscm compilation failed"', `Got: ${err.message}`);
    }
  }
  if (!threw) fail('compileScscmText() throws on malformed input', 'Expected throw, got none');
}

// ---------------------------------------------------------------------------
// Tier 2 — One-step vs two-step parity (WASM required)
// ---------------------------------------------------------------------------

section('TIER 2 — One-step vs two-step parity (runSclangCli)');

if (SKIP_WASM) {
  for (const fix of FIXTURES) {
    skip(`${fix.id}: one-step == two-step packet parity`, 'hclang.js not built or SKIP_WASM=1');
  }
} else {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hclang-scscm-test-'));

  Promise.resolve().then(async () => {
    try {
      for (const fix of FIXTURES) {
        const scscmPath = path.join(HC_DIR, fix.scscmFile);
        if (!fs.existsSync(scscmPath)) {
          skip(`${fix.id}: one-step == two-step packet parity`, 'scscm file not found');
          continue;
        }

        const source = fs.readFileSync(scscmPath, 'utf8');
        let compiledSclang;
        try {
          compiledSclang = compileScscmText(source, scscmPath);
        } catch (err) {
          fail(`${fix.id}: compile for two-step`, err.message);
          continue;
        }

        // Two-step path: write compiled sclang to temp .scd, run hclang on it
        const twoStepScd  = path.join(tmpRoot, `${fix.id}_two_step.scd`);
        const twoStepOut  = path.join(tmpRoot, `${fix.id}_two_step.commands.json`);
        fs.writeFileSync(twoStepScd, compiledSclang, 'utf8');

        let twoStepResult;
        try {
          twoStepResult = await runSclangCli({
            script:    twoStepScd,
            output:    twoStepOut,
            sclangJs:  SCLANG_JS,
            verbose:   false,
            noSnapshot: false,
          });
        } catch (err) {
          fail(`${fix.id}: two-step runSclangCli succeeds`, err.message);
          continue;
        }

        // One-step path: run hclang directly on the .scscm file
        const oneStepOut = path.join(tmpRoot, `${fix.id}_one_step.commands.json`);
        let oneStepResult;
        try {
          oneStepResult = await runSclangCli({
            script:    scscmPath,
            output:    oneStepOut,
            sclangJs:  SCLANG_JS,
            verbose:   false,
            noSnapshot: false,
          });
        } catch (err) {
          fail(`${fix.id}: one-step runSclangCli succeeds`, err.message);
          continue;
        }

        pass(`${fix.id}: both one-step and two-step complete without error`);

        // Compare packet counts
        if (oneStepResult.packetCount === twoStepResult.packetCount) {
          pass(`${fix.id}: packet counts match (${oneStepResult.packetCount})`);
        } else {
          fail(
            `${fix.id}: packet counts match`,
            `one-step=${oneStepResult.packetCount}, two-step=${twoStepResult.packetCount}`,
          );
          continue;
        }

        // Compare packet content
        const oneStepPayload  = JSON.parse(fs.readFileSync(oneStepOut, 'utf8'));
        const twoStepPayload  = JSON.parse(fs.readFileSync(twoStepOut, 'utf8'));
        const packetsMatch = oneStepPayload.packetsBase64.every(
          (pkt, i) => pkt === twoStepPayload.packetsBase64[i],
        );

        if (packetsMatch) {
          pass(`${fix.id}: all packet bytes match between one-step and two-step`);
        } else {
          fail(`${fix.id}: all packet bytes match between one-step and two-step`, 'OSC content differs');
        }
      }

      // ---------------------------------------------------------------------------
      // Tier 3 — --lang flag override
      // ---------------------------------------------------------------------------

      section('TIER 3 — --lang flag override');

      for (const fix of FIXTURES.slice(0, 1)) { // test with kick1 only to keep runtime short
        const scscmPath = path.join(HC_DIR, fix.scscmFile);
        if (!fs.existsSync(scscmPath)) {
          skip(`${fix.id}: --lang scscm flag override`, 'scscm file not found');
          continue;
        }

        const source = fs.readFileSync(scscmPath, 'utf8');

        // Write scscm source to a file with a .sc extension
        const wrongExtPath = path.join(tmpRoot, `${fix.id}_wrong_ext.sc`);
        const langOverrideOut = path.join(tmpRoot, `${fix.id}_lang_override.commands.json`);
        fs.writeFileSync(wrongExtPath, source, 'utf8');

        let langOverrideResult;
        try {
          langOverrideResult = await runSclangCli({
            script:    wrongExtPath,
            output:    langOverrideOut,
            sclangJs:  SCLANG_JS,
            verbose:   false,
            noSnapshot: false,
            lang:      'scscm',  // force scscm mode despite wrong extension
          });
        } catch (err) {
          fail(`${fix.id}: --lang scscm override run succeeds`, err.message);
          continue;
        }

        // Compare with the direct .scscm run (from Tier 2 output)
        const oneStepOut = path.join(tmpRoot, `${fix.id}_one_step.commands.json`);
        if (!fs.existsSync(oneStepOut)) {
          skip(`${fix.id}: --lang override matches direct .scscm`, 'Tier 2 result missing');
          continue;
        }

        const directPayload   = JSON.parse(fs.readFileSync(oneStepOut, 'utf8'));
        const overridePayload = JSON.parse(fs.readFileSync(langOverrideOut, 'utf8'));

        if (langOverrideResult.packetCount === directPayload.packetsBase64.length) {
          pass(`${fix.id}: --lang scscm override produces same packet count as direct .scscm`);
        } else {
          fail(
            `${fix.id}: --lang scscm override produces same packet count as direct .scscm`,
            `override=${langOverrideResult.packetCount}, direct=${directPayload.packetsBase64.length}`,
          );
        }

        const overridePacketsMatch = overridePayload.packetsBase64.every(
          (pkt, i) => pkt === directPayload.packetsBase64[i],
        );
        if (overridePacketsMatch) {
          pass(`${fix.id}: --lang scscm override packet bytes match direct .scscm`);
        } else {
          fail(`${fix.id}: --lang scscm override packet bytes match direct .scscm`, 'OSC content differs');
        }
      }
    } finally {
      // Clean up temp files only if all tests passed
      if (failed === 0) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } else {
        console.error(`\nTemp artifacts kept at: ${tmpRoot}`);
      }

      printSummary();
    }
  }).catch((err) => {
    console.error(`Unhandled error: ${err.message}`);
    process.exit(1);
  });

  return; // async path handles exit
}

printSummary();

function printSummary() {
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}
