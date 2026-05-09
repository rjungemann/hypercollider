/**
 * sc_wasm_test.js – Minimal offline test for the SuperCollider WASM engine.
 *
 * Prerequisites:
 *   node sc_wasm_test.js <path-to-scsynth.js> [path-to-synthdef.scsyndef [synthdef-name]]
 *
 * Without a .scsyndef file the test just creates a world, renders silence, and
 * verifies that World_New + World_Run plumbing works end-to-end.
 * When a .scsyndef is provided it also exercises sc_wasm_load_synthdef +
 * sc_wasm_synth_new and verifies non-silence.  The synthdef name is parsed
 * automatically from the SCgf binary (first definition); you may override it
 * with the optional third argument.
 *
 * Usage examples (from the project root):
 *   node platform/wasm/test/sc_wasm_test.js build/wasm/server/scsynth/scsynth.js
 *   node platform/wasm/test/sc_wasm_test.js build/wasm/server/scsynth/scsynth.js \
 *        testsuite/server/supernova/help_out.scsyndef
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const synthJsPath    = process.argv[2];
const synthdefPath   = process.argv[3] || null;
const synthdefNameOverride = process.argv[4] || null;

if (!synthJsPath) {
    console.error('Usage: node sc_wasm_test.js <path-to-scsynth.js> [synthdef.scsyndef [name]]');
    process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Load the Emscripten MODULARIZE factory and instantiate
// ──────────────────────────────────────────────────────────────────────────────

// Resolve paths before any chdir.
const synthJsAbsPath     = path.resolve(synthJsPath);
const synthdefAbsPath    = synthdefPath ? path.resolve(synthdefPath) : null;
process.chdir(path.dirname(synthJsAbsPath));

// The generated JS exports SCsynthModule (set via -s EXPORT_NAME=SCsynthModule).
// In MODULARIZE mode the file does:  module.exports = SCsynthModule;
// Calling SCsynthModule({...}) returns a Promise that resolves to the fully
// initialized Module instance.
const SCsynthModule = require(synthJsAbsPath);

SCsynthModule({
    // Suppress verbose SC startup output during testing.
    print:    () => {},
    printErr: () => {},
}).then(M => {
    runTests(M).catch(err => {
        console.error('Test failed with exception:', err);
        process.exit(1);
    });
}).catch(err => {
    console.error('Module initialization failed:', err);
    process.exit(1);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test runner
// ──────────────────────────────────────────────────────────────────────────────

async function runTests(M) {
    let passed = 0;
    let failed = 0;

    function assert(cond, msg) {
        if (cond) {
            console.log(`  PASS  ${msg}`);
            passed++;
        } else {
            console.error(`  FAIL  ${msg}`);
            failed++;
        }
    }

    // ── 1. Create world ──────────────────────────────────────────────────────
    console.log('\n[1] World creation');
    const SAMPLE_RATE = 44100;
    const BLOCK_SIZE  = 512;

    const worldId = M._sc_wasm_world_create(SAMPLE_RATE, BLOCK_SIZE);
    assert(worldId > 0,              `sc_wasm_world_create returned ${worldId}`);

    const sr = M._sc_wasm_world_sample_rate(worldId);
    assert(sr === SAMPLE_RATE,       `sample rate = ${sr} (expected ${SAMPLE_RATE})`);

    const bs = M._sc_wasm_world_block_size(worldId);
    assert(bs === BLOCK_SIZE,        `block size = ${bs} (expected ${BLOCK_SIZE})`);

    // ── 2. Render silence (no synths yet) ────────────────────────────────────
    console.log('\n[2] Render silence (no synths)');
    const NUM_CHANNELS = 2;
    const outBytes = BLOCK_SIZE * NUM_CHANNELS * 4;   // float32
    const outPtr   = M._malloc(outBytes);
    M.HEAPF32.fill(0, outPtr >> 2, (outPtr >> 2) + BLOCK_SIZE * NUM_CHANNELS);

    const renderRet = M._sc_wasm_render(worldId, outPtr, BLOCK_SIZE, NUM_CHANNELS);
    assert(renderRet === 0,          `sc_wasm_render returned ${renderRet}`);

    // Without any synths, output should be all zeros (or very close).
    const outView = new Float32Array(M.HEAPF32.buffer, outPtr, BLOCK_SIZE * NUM_CHANNELS);
    const maxSilence = Math.max(...Array.from(outView).map(Math.abs));
    assert(maxSilence < 1e-10,       `silence check: max abs = ${maxSilence}`);

    // ── 3. SynthDef loading (optional) ──────────────────────────────────────
    if (synthdefAbsPath) {
        console.log('\n[3] SynthDef loading + synth creation');

        const defBytes = fs.readFileSync(synthdefAbsPath);
        const defLen   = defBytes.length;
        const defPtr   = M._malloc(defLen);
        M.HEAPU8.set(defBytes, defPtr);

        const loadRet = M._sc_wasm_load_synthdef(worldId, defPtr, defLen, 0 /* null */);
        assert(loadRet === 0,        `sc_wasm_load_synthdef returned ${loadRet}`);
        M._free(defPtr);

        // Parse synthdef name from binary (or use override).
        const defName = synthdefNameOverride || parseSynthDefName(defBytes) || 'default';
        console.log(`    Using synthdef name: "${defName}"`);

        // Create a synth (node 1000, add-action=1 = add-to-head, target=0 = root group)
        const namePtr  = allocCStr(M, defName);
        const synthRet = M._sc_wasm_synth_new(worldId, namePtr, 1000, 1, 0);
        M._free(namePtr);
        assert(synthRet === 0,       `sc_wasm_synth_new returned ${synthRet}`);

        // Render a block with the synth running.
        M.HEAPF32.fill(0, outPtr >> 2, (outPtr >> 2) + BLOCK_SIZE * NUM_CHANNELS);
        const renderRet2 = M._sc_wasm_render(worldId, outPtr, BLOCK_SIZE, NUM_CHANNELS);
        assert(renderRet2 === 0,     `sc_wasm_render (with synth) returned ${renderRet2}`);

        const outView2 = new Float32Array(M.HEAPF32.buffer, outPtr, BLOCK_SIZE * NUM_CHANNELS);
        const maxSignal = Math.max(...Array.from(outView2).map(Math.abs));
        assert(maxSignal > 1e-6,     `non-silence check: max abs = ${maxSignal}`);
    } else {
        console.log('\n[3] SynthDef loading skipped (no .scsyndef path provided)');
    }

    // ── 4. Cleanup ───────────────────────────────────────────────────────────
    console.log('\n[4] Cleanup');
    M._free(outPtr);
    const destroyRet = M._sc_wasm_world_destroy(worldId);
    assert(destroyRet === 0,         `sc_wasm_world_destroy returned ${destroyRet}`);

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log(`\n──────────────────────────────────────`);
    console.log(`Tests: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
    if (failed > 0) process.exit(1);
}

// Helper: allocate a C string in wasm heap; caller must free the returned ptr.
function allocCStr(M, str) {
    const encoded = new TextEncoder().encode(str + '\0');
    const ptr = M._malloc(encoded.length);
    M.HEAPU8.set(encoded, ptr);
    return ptr;
}

/**
 * Parse the first SynthDef name from an SCgf binary buffer.
 * SCgf layout:
 *   0-3  : "SCgf"
 *   4-7  : file version  (BE uint32)
 *   8-9  : num defs      (BE uint16)
 *   10   : first def name length (uint8 Pascal-style, 1 byte)
 *   11.. : name chars
 */
function parseSynthDefName(buf) {
    if (buf.length < 12) return null;
    const magic = String.fromCharCode(...buf.slice(0, 4));
    if (magic !== 'SCgf') return null;
    const nameLen = buf[10];   // 1-byte Pascal length at byte 10
    if (11 + nameLen > buf.length) return null;
    return String.fromCharCode(...buf.slice(11, 11 + nameLen));
}
