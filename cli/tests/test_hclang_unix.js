#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createUnixBridge } = require('../hc_unix');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SCLANG_JS = path.join(PROJECT_ROOT, 'build', 'wasm', 'lang', 'hclang', 'hclang.js');

let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`  FAIL  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

function assert(name, cond, detail) {
  if (cond) pass(name);
  else fail(name, detail || 'assertion failed');
}

function extractResultValue(evalResult) {
  if (typeof evalResult !== 'string') return String(evalResult);
  const idx = evalResult.indexOf('->');
  if (idx < 0) return evalResult.trim();
  return evalResult.slice(idx + 2).trim();
}

async function instantiateSclang(withUnixBridge) {
  const abs = path.resolve(SCLANG_JS);
  if (!fs.existsSync(abs)) {
    throw new Error(`hclang.js not found: ${abs}`);
  }

  const moduleDir = path.dirname(abs);
  const oldCwd = process.cwd();
  process.chdir(moduleDir);
  try {
    const Factory = require(abs);
    const sclang = await Factory({ print: () => {}, printErr: () => {} });

    const postLines = [];
    const errLines = [];

    const postCb = sclang.addFunction((ptr, len) => {
      postLines.push(sclang.UTF8ToString(ptr, len));
    }, 'vii');
    const errCb = sclang.addFunction((ptr, len) => {
      errLines.push(sclang.UTF8ToString(ptr, len));
    }, 'vii');

    sclang._hc_wasm_eval_set_post_callback(postCb);
    sclang._hc_wasm_eval_set_error_callback(errCb);

    if (withUnixBridge) {
      const bridge = createUnixBridge(sclang);
      sclang.__hc_wasm_unix_bridge = bridge;
      globalThis.__hc_wasm_unix_bridge = bridge;
    } else {
      sclang.__hc_wasm_unix_bridge = null;
      globalThis.__hc_wasm_unix_bridge = null;
    }

    const rc = sclang._hc_wasm_eval_boot_sequence();
    if (rc !== 0) {
      throw new Error(`hc_wasm_eval_boot_sequence failed (${rc})`);
    }

    return { sclang, postLines, errLines };
  } finally {
    process.chdir(oldCwd);
  }
}

function evalString(sclang, code) {
  const len = sclang.lengthBytesUTF8(code);
  const ptr = sclang._malloc(len + 1);
  sclang.stringToUTF8(code, ptr, len + 1);
  try {
    const resPtr = sclang._hc_wasm_eval_string(ptr, len);
    return sclang.UTF8ToString(resPtr);
  } finally {
    sclang._free(ptr);
  }
}

async function testCliUnixBridgePath() {
  console.log('\n[1] CLI bridge path');
  const { sclang } = await instantiateSclang(true);

  const trueCmd = extractResultValue(evalString(sclang, '"/usr/bin/true".systemCmd'));
  assert('String.systemCmd success returns 0', trueCmd === '0', `got ${JSON.stringify(trueCmd)}`);

  const falseCmd = extractResultValue(evalString(sclang, '"/usr/bin/false".systemCmd'));
  assert('String.systemCmd failure returns non-zero', falseCmd !== '0', `got ${JSON.stringify(falseCmd)}`);

  const pidText = extractResultValue(evalString(sclang, 'thisProcess.pid'));
  const pid = Number.parseInt(pidText, 10);
  assert('thisProcess.pid returns positive integer', Number.isInteger(pid) && pid > 0, `got ${JSON.stringify(pidText)}`);

  const running = extractResultValue(evalString(sclang, '(thisProcess.pid).pidRunning'));
  assert('Integer.pidRunning true for current process', running === 'true', `got ${JSON.stringify(running)}`);

  const errnoIsInt = extractResultValue(evalString(sclang, 'Unix.errno.isInteger'));
  assert('Unix.errno returns integer-compatible value', errnoIsInt === 'true', `got ${JSON.stringify(errnoIsInt)}`);

  const stdoutString = extractResultValue(evalString(sclang, '"/bin/echo hello".unixCmdGetStdOut'));
  assert('String.unixCmdGetStdOut returns captured stdout', stdoutString.includes('hello'), `got ${JSON.stringify(stdoutString)}`);

  const stdoutArgv = extractResultValue(evalString(sclang, '["/usr/bin/printf", "argv-ok"].unixCmdGetStdOut'));
  assert('Array.unixCmdGetStdOut returns captured stdout', stdoutArgv.includes('argv-ok'), `got ${JSON.stringify(stdoutArgv)}`);
}

async function testBrowserUnsupportedPath() {
  console.log('\n[2] Browser unsupported path');
  const { sclang, errLines, postLines } = await instantiateSclang(false);

  const result = extractResultValue(evalString(sclang, '"/usr/bin/true".systemCmd'));
  const explicitFailure = result.includes('Primitive') || result.includes('ERROR') || result.includes('failed');
  assert('systemCmd fails explicitly without unix bridge', explicitFailure, `result=${JSON.stringify(result)}`);

  const diagnostics = result + errLines.join('') + postLines.join('');
  const sawUnsupported = diagnostics.includes('Primitive') || diagnostics.includes('unsupported');
  assert('unsupported path reports user-visible failure', sawUnsupported, 'expected explicit unsupported failure diagnostics');
}

async function main() {
  console.log('='.repeat(60));
  console.log('WASM sclang Unix bridge tests (Phase 8.6)');
  console.log('='.repeat(60));

  try {
    await testCliUnixBridgePath();
    await testBrowserUnsupportedPath();
  } catch (err) {
    fail('Fatal test error', err && err.message ? err.message : String(err));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
