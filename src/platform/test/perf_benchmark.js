/**
 * perf_benchmark.js – Node.js performance benchmark for SuperCollider WASM
 *
 * Measures:
 *   - scsynth: module init, world create/destroy, render throughput (silent + synth)
 *   - sclang:  module init, class-library compile, eval latency per expression type
 *
 * Usage (from project root):
 *   node platform/wasm/test/perf_benchmark.js \
 *        build/wasm/server/scsynth/scsynth.js \
 *        build/wasm/lang/sclang/sclang_wasm.js \
 *        [testsuite/server/supernova/help_out.scsyndef]
 *
 * Each long-running operation is wrapped in a configurable timeout so the
 * script never hangs indefinitely.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const synthJsPath   = process.argv[2];
const sclangJsPath  = process.argv[3];
const synthdefPath  = process.argv[4] || null;

if (!synthJsPath || !sclangJsPath) {
    console.error(
        'Usage: node perf_benchmark.js <scsynth.js> <sclang_wasm.js> [synthdef.scsyndef]'
    );
    process.exit(1);
}

const TIMEOUT_MS    = 120_000;   // per-phase hard timeout
const RENDER_ITERS  = 2_000;     // render blocks per benchmark run
const EVAL_ITERS    = 50;        // SC eval repetitions per expression

// ── helpers ──────────────────────────────────────────────────────────────────

function withTimeout(promise, ms, label) {
    const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout: ${label} (>${ms}ms)`)), ms)
    );
    return Promise.race([promise, timer]);
}

function allocCStr(M, str) {
    const encoded = new TextEncoder().encode(str + '\0');
    const ptr = M._malloc(encoded.length);
    M.HEAPU8.set(encoded, ptr);
    return ptr;
}

function parseSynthDefName(buf) {
    if (buf.length < 12) return null;
    const magic = String.fromCharCode(...buf.slice(0, 4));
    if (magic !== 'SCgf') return null;
    const nameLen = buf[10];
    if (11 + nameLen > buf.length) return null;
    return String.fromCharCode(...buf.slice(11, 11 + nameLen));
}

// ── scsynth benchmark ─────────────────────────────────────────────────────────

async function benchScsynth() {
    console.log('\n' + '='.repeat(60));
    console.log('scsynth WASM benchmark');
    console.log('='.repeat(60));

    const synthJsAbs = path.resolve(synthJsPath);
    const savedCwd   = process.cwd();
    process.chdir(path.dirname(synthJsAbs));

    const SCsynthModule = require(synthJsAbs);

    const results = {};

    // 1. Module init
    process.stderr.write('[scsynth] Loading module... ');
    const t0 = performance.now();
    const M  = await withTimeout(
        SCsynthModule({ print: () => {}, printErr: () => {} }),
        TIMEOUT_MS,
        'SCsynthModule init'
    );
    results.module_init_ms = +(performance.now() - t0).toFixed(2);
    process.stderr.write(`${results.module_init_ms} ms\n`);

    const SAMPLE_RATE  = 44100;
    const BLOCK_SIZE   = 512;
    const NUM_CHANNELS = 2;
    const RT_BUDGET_US = (BLOCK_SIZE / SAMPLE_RATE) * 1e6;   // ≈ 11 610 µs

    // 2. World create
    {
        const t = performance.now();
        const worldId = M._sc_wasm_world_create(SAMPLE_RATE, BLOCK_SIZE);
        results.world_create_ms = +(performance.now() - t).toFixed(2);
        results._worldId = worldId;   // stash for later
    }

    const { _worldId: worldId } = results;
    const outBytes = BLOCK_SIZE * NUM_CHANNELS * 4;
    const outPtr   = M._malloc(outBytes);

    // 3. First render (cold)
    {
        const t = performance.now();
        M._sc_wasm_render(worldId, outPtr, BLOCK_SIZE, NUM_CHANNELS);
        results.render_cold_us = +((performance.now() - t) * 1000).toFixed(1);
    }

    // 4. Sustained render – silent (no synths)
    {
        process.stderr.write(`[scsynth] Silent render x${RENDER_ITERS}... `);
        const t = performance.now();
        for (let i = 0; i < RENDER_ITERS; i++) {
            M._sc_wasm_render(worldId, outPtr, BLOCK_SIZE, NUM_CHANNELS);
        }
        const elapsed = performance.now() - t;
        const avg_us  = elapsed / RENDER_ITERS * 1000;
        results.render_silent_total_ms = +elapsed.toFixed(2);
        results.render_silent_avg_us   = +avg_us.toFixed(1);
        results.render_silent_rt_load  = `${+(avg_us / RT_BUDGET_US * 100).toFixed(2)}%`;
        process.stderr.write(`avg ${results.render_silent_avg_us} µs (${results.render_silent_rt_load} RT)\n`);
    }

    // 5. SynthDef load + synth_new (optional)
    const defAbsPath = synthdefPath ? path.resolve(savedCwd, synthdefPath) : null;
    if (defAbsPath && fs.existsSync(defAbsPath)) {
        const defBytes = fs.readFileSync(defAbsPath);
        const defLen   = defBytes.length;
        const defPtr   = M._malloc(defLen);
        M.HEAPU8.set(defBytes, defPtr);

        {
            const t = performance.now();
            M._sc_wasm_load_synthdef(worldId, defPtr, defLen, 0);
            results.synthdef_load_ms = +(performance.now() - t).toFixed(2);
        }
        M._free(defPtr);

        const defName = parseSynthDefName(defBytes) || 'default';
        const namePtr = allocCStr(M, defName);
        {
            const t = performance.now();
            M._sc_wasm_synth_new(worldId, namePtr, 1000, 1, 0);
            results.synth_new_ms = +(performance.now() - t).toFixed(2);
        }
        M._free(namePtr);

        // 6. Sustained render – with synth
        {
            process.stderr.write(`[scsynth] Synth render x${RENDER_ITERS}... `);
            const t = performance.now();
            for (let i = 0; i < RENDER_ITERS; i++) {
                M._sc_wasm_render(worldId, outPtr, BLOCK_SIZE, NUM_CHANNELS);
            }
            const elapsed  = performance.now() - t;
            const avg_us   = elapsed / RENDER_ITERS * 1000;
            results.render_synth_total_ms = +elapsed.toFixed(2);
            results.render_synth_avg_us   = +avg_us.toFixed(1);
            results.render_synth_rt_load  = `${+(avg_us / RT_BUDGET_US * 100).toFixed(2)}%`;
            process.stderr.write(`avg ${results.render_synth_avg_us} µs (${results.render_synth_rt_load} RT)\n`);
        }
    } else {
        results.render_synth_avg_us  = null;
        results.render_synth_rt_load = null;
    }

    results.rt_budget_us = +RT_BUDGET_US.toFixed(1);

    // 7. World destroy
    {
        M._free(outPtr);
        const t = performance.now();
        M._sc_wasm_world_destroy(worldId);
        results.world_destroy_ms = +(performance.now() - t).toFixed(2);
    }

    process.chdir(savedCwd);
    delete results._worldId;
    return results;
}

// ── sclang benchmark ──────────────────────────────────────────────────────────

async function benchSclang() {
    console.log('\n' + '='.repeat(60));
    console.log('sclang WASM benchmark');
    console.log('='.repeat(60));

    const sclangJsAbs = path.resolve(sclangJsPath);
    const savedCwd    = process.cwd();
    process.chdir(path.dirname(sclangJsAbs));

    const SClangModule = require(sclangJsAbs);
    const results = {};

    // 1. Module init
    process.stderr.write('[sclang]  Loading module... ');
    const t0 = performance.now();
    const Module = await withTimeout(
        SClangModule({}),
        TIMEOUT_MS,
        'SClangModule init'
    );
    results.module_init_ms = +(performance.now() - t0).toFixed(2);
    process.stderr.write(`${results.module_init_ms} ms\n`);

    // Wire callbacks (suppress output during benchmark)
    const postLines = [];
    const postCb = Module.addFunction((ptr, len) => {
        postLines.push(Module.UTF8ToString(ptr, len));
    }, 'vii');
    const errCb = Module.addFunction((_ptr, _len) => {}, 'vii');
    Module._hc_wasm_eval_set_post_callback(postCb);
    Module._hc_wasm_eval_set_error_callback(errCb);

    // 2. Class-library compilation
    process.stderr.write('[sclang]  Compiling class library... ');
    const t1   = performance.now();
    const initRet = await withTimeout(
        Promise.resolve(Module._hc_wasm_eval_init()),
        TIMEOUT_MS,
        'hc_wasm_eval_init'
    );
    results.class_lib_compile_ms  = +(performance.now() - t1).toFixed(2);
    results.class_lib_compile_ret = initRet;
    process.stderr.write(`${results.class_lib_compile_ms} ms (ret=${initRet})\n`);

    if (initRet !== 0) {
        results.error = 'class library compilation failed';
        process.chdir(savedCwd);
        return results;
    }

    // Helper
    function evalString(code) {
        const len = Module.lengthBytesUTF8(code);
        const buf = Module._malloc(len + 1);
        Module.stringToUTF8(code, buf, len + 1);
        const resPtr = Module._hc_wasm_eval_string(buf, len);
        const result = Module.UTF8ToString(resPtr);
        Module._free(buf);
        return result;
    }

    // Warm up
    evalString('1 + 1');

    // 3. Per-expression latency
    const expressions = [
        { label: 'arithmetic_simple',  code: '1 + 1'                              },
        { label: 'arithmetic_complex', code: '(2.0 ** 8) + (100 * 3) - 42'        },
        { label: 'string_size',        code: '"hello world".size'                   },
        { label: 'array_literal_size', code: '[1, 2, 3, 4, 5].size'               },
        { label: 'array_collect',      code: '[1,2,3,4,5].collect { |x| x * x }'  },
        { label: 'block_value',        code: '{ |x| x + 1 }.value(41)'            },
    ];

    process.stderr.write('[sclang]  Running eval microbenchmarks...\n');
    for (const expr of expressions) {
        const t = performance.now();
        for (let i = 0; i < EVAL_ITERS; i++) evalString(expr.code);
        const avg_ms = (performance.now() - t) / EVAL_ITERS;
        results[`eval_${expr.label}_avg_ms`] = +avg_ms.toFixed(3);
        process.stderr.write(`           ${expr.label}: ${results[`eval_${expr.label}_avg_ms`]} ms/call\n`);
    }

    // 4. Status call overhead
    {
        const STATUS_ITERS = 200;
        const t = performance.now();
        for (let i = 0; i < STATUS_ITERS; i++) {
            const ptr = Module._hc_wasm_eval_status();
            Module.UTF8ToString(ptr);
        }
        results.status_call_avg_us = +((performance.now() - t) / STATUS_ITERS * 1000).toFixed(1);
    }

    process.chdir(savedCwd);
    return results;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    let scsynth, sclang;

    try {
        scsynth = await benchScsynth();
    } catch (e) {
        console.error('scsynth benchmark error:', e.message);
        scsynth = { error: e.message };
    }

    try {
        sclang = await benchSclang();
    } catch (e) {
        console.error('sclang benchmark error:', e.message);
        sclang = { error: e.message };
    }

    const report = { scsynth, sclang };
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS (JSON)');
    console.log('='.repeat(60));
    console.log(JSON.stringify(report, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
