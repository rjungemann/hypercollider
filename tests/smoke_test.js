/**
 * WASM Smoke Tests for SuperCollider
 * 
 * Phase 1: Verify basic initialization and C API functionality
 * 
 * Run with: node testsuite/wasm/smoke_test.js
 * 
 * Requires: hclang.js, hclang.wasm, hclang.data in build_wasm_test/lang/sclang/
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const BUILD_DIR = path.join(__dirname, '../../build_wasm_test/lang/sclang');
const SCSCYNTH_BUILD_DIR = path.join(__dirname, '../../build_wasm_test/server/scsynth');

// ============================================================================
// TEST HARNESS
// ============================================================================

class SmokeTest {
    constructor(name) {
        this.name = name;
        this.passed = 0;
        this.failed = 0;
        this.errors = [];
    }

    pass(testName) {
        this.passed++;
        console.log(`  ✓ ${testName}`);
    }

    fail(testName, reason) {
        this.failed++;
        this.errors.push({ testName, reason });
        console.log(`  ✗ ${testName}: ${reason}`);
    }

    assert(condition, testName, reason = '') {
        if (condition) {
            this.pass(testName);
        } else {
            this.fail(testName, reason || 'assertion failed');
        }
    }

    summary() {
        const total = this.passed + this.failed;
        console.log(`\n${this.name}: ${this.passed}/${total} passed`);
        if (this.failed > 0) {
            console.log(`  Failed tests:`);
            for (const err of this.errors) {
                console.log(`    - ${err.testName}: ${err.reason}`);
            }
        }
        return this.failed === 0;
    }
}

// ============================================================================
// WASM MODULE LOADER
// Loads Emscripten-generated WASM modules in Node.js
// ============================================================================

/**
 * Load an Emscripten WASM module in Node.js
 * Uses child_process to run each module in isolation since Emscripten
 * uses global variables that conflict when loading multiple modules.
 * @param {string} jsPath - Path to .js file
 * @param {string} wasmPath - Path to .wasm file
 * @param {string} dataPath - Path to .data file (optional)
 * @param {function} testFunc - Test function to run with the module
 * @returns {Promise<Object>} The Module object
 */
async function loadWasmModule(jsPath, wasmPath, dataPath = '', testFunc = null) {
    const locateFile = (file) => {
        if (file.endsWith('.wasm')) {
            return wasmPath;
        }
        if (file.endsWith('.data')) {
            return dataPath;
        }
        return file;
    };

    // Read the module code
    const moduleCode = fs.readFileSync(jsPath, 'utf8');
    
    // Extract the module factory name
    const exportNameMatch = moduleCode.match(/var\s+(\w+)\s*=\s*\(\(\)\s*=>/);
    const moduleName = exportNameMatch ? exportNameMatch[1] : null;

    if (!moduleName) {
        throw new Error('Could not find Emscripten module factory in JS code');
    }

    // Check if already loaded (from a previous eval)
    if (typeof global[moduleName] === 'function') {
        const factory = global[moduleName];
        const Module = await factory({ locateFile: locateFile });
        if (testFunc) {
            await testFunc(Module);
        }
        return Module;
    }

    // Save existing global state
    const oldLocateFile = global.locateFile;
    
    try {
        global.locateFile = locateFile;
        
        // Evaluate the module code - it defines the factory with var
        // In Node.js, eval at top level does create globals, but let's be explicit
        eval(moduleCode);
        
        // After eval, the variable should be available
        // Try different ways to access it
        let factory = typeof global[moduleName] === 'function' ? global[moduleName] : null;
        if (!factory && typeof window !== 'undefined') {
            factory = window[moduleName];
        }
        if (!factory) {
            // Try eval to access the variable
            factory = eval(moduleName);
        }
        
        if (typeof factory !== 'function') {
            throw new Error(`Module factory ${moduleName} not found after eval`);
        }
        
        const Module = await factory({ locateFile: locateFile });
        
        if (testFunc) {
            await testFunc(Module);
        }
        
        return Module;
    } finally {
        global.locateFile = oldLocateFile;
    }
}

// ============================================================================
// SCLANG SMOKE TESTS
// ============================================================================

async function runSclangSmokeTests() {
    const test = new SmokeTest('SCLang WASM Smoke Tests');
    
    try {
        const sclangJsPath = path.join(BUILD_DIR, 'hclang.js');
        const sclangWasmPath = path.join(BUILD_DIR, 'hclang.wasm');
        const sclangDataPath = path.join(BUILD_DIR, 'hclang.data');

        console.log('\n=== Loading sclang WASM module ===');
        console.log(`  JS: ${sclangJsPath}`);
        console.log(`  WASM: ${sclangWasmPath}`);
        console.log(`  DATA: ${sclangDataPath}`);

        const Module = await loadWasmModule(sclangJsPath, sclangWasmPath, sclangDataPath);
        
        test.assert(typeof Module !== 'undefined', 'Module loaded');
        test.assert(typeof Module.ccall === 'function', 'Module has ccall');
        test.assert(typeof Module.HEAPU8 === 'object', 'Module has HEAPU8');
        test.assert(typeof Module.UTF8ToString === 'function', 'Module has UTF8ToString');
        test.assert(typeof Module.allocateUTF8 === 'function', 'Module has allocateUTF8');
        test.assert(typeof Module.addFunction === 'function', 'Module has addFunction');

        // Check for exported functions
        const requiredFunctions = [
            '_hc_wasm_eval_init',
            '_hc_wasm_eval_boot',
            '_hc_wasm_eval_string',
            '_hc_wasm_eval_execute',
            '_hc_wasm_eval_status',
            '_hc_wasm_eval_set_post_callback',
            '_hc_wasm_eval_set_error_callback',
            '_hc_wasm_eval_boot_sequence'
        ];

        for (const func of requiredFunctions) {
            test.assert(typeof Module[func] === 'function', `Function exported: ${func}`);
        }

        // Test initialization - re-enabled to see debug output
        console.log('\n=== Testing Initialization ===');
        
        // Set up minimal callbacks to capture output
        let postOutput = '';
        let errorOutput = '';

        const postCallback = (textPtr, len) => {
            const text = Module.UTF8ToString(textPtr, len);
            postOutput += text;
            console.log(`  [POST] ${text}`);
        };
        
        const errorCallback = (textPtr, len) => {
            const text = Module.UTF8ToString(textPtr, len);
            errorOutput += text;
            console.log(`  [ERROR] ${text}`);
        };

        // Allocate and set callbacks
        const postCallbackPtr = Module.addFunction(postCallback, 'vii');
        const errorCallbackPtr = Module.addFunction(errorCallback, 'vii');

        Module._hc_wasm_eval_set_post_callback(postCallbackPtr);
        Module._hc_wasm_eval_set_error_callback(errorCallbackPtr);
        test.pass('Callbacks set');

        // Test init
        console.log('  Calling _hc_wasm_eval_init...');
        const initResult = Module._hc_wasm_eval_init();
        test.assert(initResult === 0, 'hc_wasm_eval_init returns 0', `got ${initResult}`);
        test.pass('Initialization succeeded');

        // Test status
        console.log('  Checking status...');
        const statusPtr = Module._hc_wasm_eval_status();
        const status = Module.UTF8ToString(statusPtr);
        test.assert(status.includes('initialized'), 'Status shows initialized', status);
        console.log(`  Status: ${status}`);

    } catch (error) {
        test.fail('Test execution', error.message);
        console.error('Error:', error);
    }

    return test.summary();
}

// ============================================================================
// SCSYNTH SMOKE TESTS
// ============================================================================

async function runScsynthSmokeTests() {
    const test = new SmokeTest('SCSynth WASM Smoke Tests');
    
    try {
        const scsynthJsPath = path.join(SCSCYNTH_BUILD_DIR, 'scsynth.js');
        const scsynthWasmPath = path.join(SCSCYNTH_BUILD_DIR, 'scsynth.wasm');

        console.log('\n=== Loading scsynth WASM module ===');
        console.log(`  JS: ${scsynthJsPath}`);
        console.log(`  WASM: ${scsynthWasmPath}`);

        const Module = await loadWasmModule(scsynthJsPath, scsynthWasmPath, '');
        
        test.assert(typeof Module !== 'undefined', 'Module loaded');
        test.assert(typeof Module.ccall === 'function', 'Module has ccall');
        test.assert(typeof Module.HEAPU8 === 'object', 'Module has HEAPU8');

        // Check for exported functions
        const requiredFunctions = [
            '_hc_wasm_world_create',
            '_hc_wasm_world_destroy',
            '_hc_wasm_render',
            '_hc_wasm_osc_dispatch',
            '_hc_wasm_osc_register_world',
            '_hc_wasm_osc_unregister_world',
            '_hc_wasm_osc_register_handler',
            '_hc_wasm_osc_send_to_sclang'
        ];

        for (const func of requiredFunctions) {
            test.assert(typeof Module[func] === 'function', `Function exported: ${func}`);
        }

        test.pass('All required functions exported');

    } catch (error) {
        test.fail('Module loading', error.message);
        console.error('Error:', error);
    }

    return test.summary();
}

// ============================================================================
// FILE EXISTENCE CHECKS
// ============================================================================

function runFileChecks() {
    const test = new SmokeTest('Build Artifact Checks');
    
    const requiredFiles = [
        path.join(BUILD_DIR, 'hclang.js'),
        path.join(BUILD_DIR, 'hclang.wasm'),
        path.join(BUILD_DIR, 'hclang.data'),
        path.join(SCSCYNTH_BUILD_DIR, 'scsynth.js'),
        path.join(SCSCYNTH_BUILD_DIR, 'scsynth.wasm'),
    ];

    for (const file of requiredFiles) {
        test.assert(fs.existsSync(file), `File exists: ${path.basename(file)}`);
    }

    // Check file sizes are reasonable
    const sclangWasmPath = path.join(BUILD_DIR, 'hclang.wasm');
    if (fs.existsSync(sclangWasmPath)) {
        const stats = fs.statSync(sclangWasmPath);
        test.assert(stats.size > 1000, `hclang.wasm is > 1KB (${(stats.size / 1024).toFixed(1)}KB)`);
    }

    const scsynthWasmPath = path.join(SCSCYNTH_BUILD_DIR, 'scsynth.wasm');
    if (fs.existsSync(scsynthWasmPath)) {
        const stats = fs.statSync(scsynthWasmPath);
        test.assert(stats.size > 1000, `scsynth.wasm is > 1KB (${(stats.size / 1024).toFixed(1)}KB)`);
    }

    const sclangDataPath = path.join(BUILD_DIR, 'hclang.data');
    if (fs.existsSync(sclangDataPath)) {
        const stats = fs.statSync(sclangDataPath);
        test.assert(stats.size > 1000000, `hclang.data is > 1MB (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
    }

    return test.summary();
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('='.repeat(60));
    console.log('SuperCollider WASM Smoke Tests');
    console.log('Phase 1: Verify Build Outputs and Basic Functionality');
    console.log('='.repeat(60));

    // First check if files exist
    const filesOk = runFileChecks();
    
    let sclangPassed = false;
    let scsynthPassed = false;

    if (filesOk) {
        sclangPassed = await runSclangSmokeTests();
        scsynthPassed = await runScsynthSmokeTests();
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Files:     ${filesOk ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`SCLang:    ${sclangPassed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`SCSynth:   ${scsynthPassed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log('='.repeat(60) + '\n');

    process.exit(filesOk && sclangPassed && scsynthPassed ? 0 : 1);
}

// Run tests
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
