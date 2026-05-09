/**
 * sc_sclang_wasm_test.js – Functional test for the SuperCollider WASM sclang module.
 *
 * Phase 9 test: verifies that the WASM sclang actually evaluates SC code via
 * PyrInterpreter (not the old pattern-matching stub).
 *
 * Prerequisites:
 *   node sc_sclang_wasm_test.js <path-to-sclang_wasm.js>
 *
 * Example (from project root):
 *   node platform/wasm/test/sc_sclang_wasm_test.js \
 *        build/wasm/lang/sclang/sclang_wasm.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const sclangJsPath = process.argv[2];
if (!sclangJsPath) {
    console.error('Usage: node sc_sclang_wasm_test.js <path-to-sclang_wasm.js>');
    process.exit(1);
}
if (!fs.existsSync(sclangJsPath)) {
    console.error(`File not found: ${sclangJsPath}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Simple test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    const ok = (actual === expected) ||
               (typeof expected === 'string' && typeof actual === 'string' &&
                actual.trim() === expected.trim());
    if (ok) {
        console.log(`  PASS  ${label}`);
        passed++;
    } else {
        console.log(`  FAIL  ${label}`);
        console.log(`        expected: ${JSON.stringify(expected)}`);
        console.log(`        actual  : ${JSON.stringify(actual)}`);
        failed++;
    }
}

function checkContains(label, actual, substring) {
    const ok = typeof actual === 'string' && actual.includes(substring);
    if (ok) {
        console.log(`  PASS  ${label}`);
        passed++;
    } else {
        console.log(`  FAIL  ${label}`);
        console.log(`        expected to contain: ${JSON.stringify(substring)}`);
        console.log(`        actual             : ${JSON.stringify(actual)}`);
        failed++;
    }
}

function checkNotContains(label, actual, substring) {
    const ok = typeof actual === 'string' && !actual.includes(substring);
    if (ok) {
        console.log(`  PASS  ${label}`);
        passed++;
    } else {
        console.log(`  FAIL  ${label}  (string should NOT contain ${JSON.stringify(substring)})`);
        console.log(`        actual: ${JSON.stringify(actual)}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('='.repeat(60));
    console.log('SC WASM sclang – Phase 9 functional test');
    console.log('='.repeat(60));

    // -----------------------------------------------------------------------
    // 1. Load the WASM module
    // -----------------------------------------------------------------------
    console.log('\n[1] Loading WASM sclang module...');
    const SClangModule = require(path.resolve(sclangJsPath));

    let Module;
    try {
        Module = await SClangModule();
    } catch (e) {
        console.error('Failed to instantiate WASM module:', e.message);
        process.exit(1);
    }
    console.log('    Module loaded OK');

    // -----------------------------------------------------------------------
    // 2. Wire up post / error callbacks
    // -----------------------------------------------------------------------
    const postLines = [];
    const errLines  = [];

    const postCb = Module.addFunction((ptr, len) => {
        const str = Module.UTF8ToString(ptr, len);
        postLines.push(str);
        process.stdout.write('[post] ' + str);
    }, 'vii');

    const errCb = Module.addFunction((ptr, len) => {
        const str = Module.UTF8ToString(ptr, len);
        errLines.push(str);
        process.stdout.write('[err]  ' + str);
    }, 'vii');

    Module._hc_wasm_eval_set_post_callback(postCb);
    Module._hc_wasm_eval_set_error_callback(errCb);

    // -----------------------------------------------------------------------
    // 3. Initialize (compiles the class library)
    // -----------------------------------------------------------------------
    console.log('\n[2] Initializing (compiling class library)...');
    console.log('    This may take a moment on first run.\n');

    const t0   = Date.now();
    const initRet = Module._hc_wasm_eval_init();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    console.log(`\n    hc_wasm_eval_init() returned ${initRet} (elapsed: ${elapsed}s)`);

    if (initRet !== 0) {
        console.log('\nFATAL: class library compilation failed – cannot run eval tests');
        console.log('Errors logged:');
        errLines.forEach(l => console.log('  ', l));
        process.exit(1);
    }

    // -----------------------------------------------------------------------
    // 4. Evaluation tests
    // -----------------------------------------------------------------------
    console.log('\n[3] Running evaluation tests...\n');

    function evalString(code) {
        const len = Module.lengthBytesUTF8(code);
        const buf = Module._malloc(len + 1);
        Module.stringToUTF8(code, buf, len + 1);
        const resPtr = Module._hc_wasm_eval_string(buf, len);
        const result = Module.UTF8ToString(resPtr);
        Module._free(buf);
        return result;
    }

    // Arithmetic
    let r;

    r = evalString('1 + 1');
    check('1 + 1 evaluates to "2"', r.replace(/^.*?-> /, '').trim(), '2');
    checkNotContains('1 + 1 is NOT a stub result', r, '[eval:');

    r = evalString('2 + 2');
    check('2 + 2 evaluates to "4"', r.replace(/^.*?-> /, '').trim(), '4');

    r = evalString('10 - 3');
    check('10 - 3 evaluates to "7"', r.replace(/^.*?-> /, '').trim(), '7');

    r = evalString('3 * 4');
    check('3 * 4 evaluates to "12"', r.replace(/^.*?-> /, '').trim(), '12');

    r = evalString('10 / 2');
    check('10 / 2 evaluates to "5.0"', r.replace(/^.*?-> /, '').trim(), '5.0');

    // String
    r = evalString('"hello".size');
    check('"hello".size evaluates to "5"', r.replace(/^.*?-> /, '').trim(), '5');

    // Array
    r = evalString('[1, 2, 3].size');
    check('[1, 2, 3].size evaluates to "3"', r.replace(/^.*?-> /, '').trim(), '3');

    // Ensure the old stub placeholder is completely gone
    r = evalString('99 * 99');
    checkNotContains('99 * 99 is NOT a stub result', r, '[eval:');
    check('99 * 99 evaluates to "9801"', r.replace(/^.*?-> /, '').trim(), '9801');

    // -----------------------------------------------------------------------
    // 5. Status check
    // -----------------------------------------------------------------------
    console.log('\n[4] Status...\n');
    const statusPtr = Module._hc_wasm_eval_status();
    const status    = Module.UTF8ToString(statusPtr);
    console.log('    ' + status);
    checkContains('Status shows initialized', status, 'initialized');
    checkContains('Status shows compiledOK=true', status, 'compiledOK=true');

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('Unhandled error:', e);
    process.exit(1);
});
