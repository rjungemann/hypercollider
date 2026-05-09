/**
 * SuperCollider WASM JavaScript API
 *
 * High-level JavaScript interface to the SuperCollider WASM engine.
 * Provides user-friendly wrappers around the low-level Emscripten bindings.
 */

class SuperColliderWasm {
    /**
     * Initialize the SuperCollider WASM module
     *
     * @param {string} wasmPath - Path to the .wasm file (e.g., './hcsynth.wasm')
     * @returns {Promise<SuperColliderWasm>} Initialized module
     */
    static async initialize(wasmPath = './hcsynth.wasm') {
        if (typeof HCsynthModule === 'undefined') {
            throw new Error('Emscripten module not loaded. Ensure hcsynth-engine.js is included.');
        }
        // HCsynthModule() returns a Promise that resolves with the fully-initialised
        // Module — do NOT use onRuntimeInitialized here, because that callback fires
        // synchronously inside HCsynthModule() before the outer `const Module`
        // binding is assigned, causing a Temporal Dead Zone ReferenceError.
        const Module = await HCsynthModule({
            locateFile: (file) => {
                if (file === 'hcsynth.wasm') {
                    return wasmPath;
                }
                return file;
            },
        });

        if (globalThis.SCWasmBrowserSupport && typeof globalThis.SCWasmBrowserSupport.setupPersistentFilesystem === 'function') {
            try {
                await globalThis.SCWasmBrowserSupport.setupPersistentFilesystem(Module, {
                    mountPoint: '/sc_persist',
                });
            } catch (error) {
                console.warn('Persistent browser filesystem setup failed:', error);
            }
        }

        return new SuperColliderWasm(Module);
    }

    /**
     * @param {object} Module - The Emscripten Module object
     */
    constructor(Module) {
        this.Module = Module;
        this.worlds = new Map();
        this.nextWorldId = 1;

        // Overwrite Emscripten's unexported-symbol abort getters with real polyfills.
        // Must use Object.defineProperty to avoid triggering the abort getter during
        // the typeof check (the getter throws instead of returning a value).
        Object.defineProperty(this.Module, 'UTF8ToString', {
            configurable: true,
            writable: true,
            value: function utf8ToString(ptr, maxBytesToRead) {
                if (!ptr) return '';
                const h = this.HEAPU8;
                let end = ptr;
                const limit = (maxBytesToRead !== undefined) ? ptr + maxBytesToRead : h.length;
                while (end < limit && h[end]) end++;
                return new TextDecoder().decode(h.subarray(ptr, end));
            },
        });
        Object.defineProperty(this.Module, 'allocateUTF8', {
            configurable: true,
            writable: true,
            value: function allocateUTF8(str) {
                const bytes = new TextEncoder().encode(str);
                const ptr = this._malloc(bytes.length + 1);
                this.HEAPU8.set(bytes, ptr);
                this.HEAPU8[ptr + bytes.length] = 0;
                return ptr;
            },
        });

        // Initialize the WASM module
        if (typeof this.Module._hc_wasm_init === 'function') {
            this.Module._hc_wasm_init();
        }
    }

    /**
     * Create a new audio engine world
     *
     * @param {number} sampleRate - Sample rate in Hz (default 48000)
     * @param {number} blockSize - Block size in samples (default 512)
     * @returns {World} New World instance
     */
    createWorld(sampleRate = 48000, blockSize = 512) {
        const world = new World(this, sampleRate, blockSize);
        this.worlds.set(world.id, world);
        return world;
    }

    /**
     * Get memory buffer for audio output
     *
     * @param {number} size - Size in samples
     * @returns {Float32Array} Float32 array backed by WASM memory
     */
    allocateAudioBuffer(size) {
        const ptr = this.Module._malloc(size * 4); // 4 bytes per float32
        return new Float32Array(this.Module.HEAPF32.buffer, ptr, size);
    }

    /**
     * Free an allocated buffer
     *
     * @param {number} ptr - Pointer from allocateAudioBuffer
     */
    freeAudioBuffer(ptr) {
        this.Module._free(ptr);
    }

    async syncPersistentFilesystem() {
        if (!globalThis.SCWasmBrowserSupport || typeof globalThis.SCWasmBrowserSupport.flushPersistentFilesystem !== 'function') {
            return false;
        }
        try {
            return await globalThis.SCWasmBrowserSupport.flushPersistentFilesystem(this.Module);
        } catch (_) {
            return false;
        }
    }

    /**
     * Get version info
     *
     * @returns {string} Version string
     */
    getVersion() {
        if (typeof this.Module._hc_wasm_version !== 'function') {
            return 'unknown';
        }
        const cstr = this.Module._hc_wasm_version();
        return this.Module.UTF8ToString(cstr);
    }

    /**
     * Get build info
     *
     * @returns {string} Build info string
     */
    getBuildInfo() {
        if (typeof this.Module._hc_wasm_build_info !== 'function') {
            return 'unknown';
        }
        const cstr = this.Module._hc_wasm_build_info();
        return this.Module.UTF8ToString(cstr);
    }
}

/**
 * Represents a SuperCollider audio engine world
 */
class World {
    constructor(scwasm, sampleRate, blockSize) {
        this.scwasm = scwasm;
        this.sampleRate = sampleRate;
        this.blockSize = blockSize;
        this.id = this.scwasm.Module._hc_wasm_world_create(sampleRate, blockSize);

        if (this.id <= 0) {
            throw new Error(`Failed to create WASM world (id=${this.id})`);
        }

        this.synthdefs = new Map();
        this.nodes = new Map();
        this.nextNodeId = 1000;
    }

    /**
     * Destroy the world and free resources
     */
    destroy() {
        if (this.id > 0) {
            this.scwasm.Module._hc_wasm_world_destroy(this.id);
            this.id = 0;
            this.nodes.clear();
        }
    }

    /**
     * Load a SynthDef from binary data
     *
     * @param {ArrayBuffer|Uint8Array} data - SynthDef bytecode
     * @param {string} name - Optional name (if not in bytecode)
     * @returns {number} 0 on success, -1 on error
     */
    loadSynthDef(data, name = null) {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        const ptr = this.scwasm.Module._malloc(bytes.length);

        try {
            // Copy data to WASM memory
            this.scwasm.Module.HEAPU8.set(bytes, ptr);

            // Call the WASM function
            const namePtr = name
                ? this.scwasm.Module.allocateUTF8(name)
                : null;
            const result = this.scwasm.Module._hc_wasm_load_synthdef(this.id, ptr, bytes.length, namePtr);

            if (namePtr) {
                this.scwasm.Module._free(namePtr);
            }

            if (result === 0 && name) {
                this.synthdefs.set(name, { data: bytes, size: bytes.length });
            }

            return result;
        } finally {
            this.scwasm.Module._free(ptr);
        }
    }

    /**
     * List available SynthDefs
     *
     * @returns {string[]} Array of SynthDef names
     */
    listSynthDefs() {
        const bufSize = 4096;
        const bufPtr = this.scwasm.Module._malloc(bufSize);

        try {
            const result = this.scwasm.Module._hc_wasm_list_synthdefs(
                this.id,
                bufPtr,
                bufSize
            );

            if (result <= 0) {
                return [];
            }

            const names = this.scwasm.Module.UTF8ToString(bufPtr);
            return names.split(',').filter((n) => n.length > 0);
        } finally {
            this.scwasm.Module._free(bufPtr);
        }
    }

    /**
     * Create and start a new synth node
     *
     * @param {string} synthdefName - Name of the SynthDef
     * @param {object} args - Control arguments {controlName: value, ...}
     * @returns {Synth} New Synth instance
     */
    synth(synthdefName, args = {}) {
        const nodeId = this.nextNodeId++;
        // Must pass synthdefName as a null-terminated C string pointer.
        const namePtr = this.scwasm.Module.allocateUTF8(synthdefName);
        let result;
        try {
            result = this.scwasm.Module._hc_wasm_synth_new(
                this.id,
                namePtr,
                nodeId,
                1, // add_action: tail of group 1 (root)
                1  // target_id: root group
            );
        } finally {
            this.scwasm.Module._free(namePtr);
        }

        if (result !== 0) {
            throw new Error(`Failed to create synth: ${synthdefName}`);
        }

        const synth = new Synth(this, nodeId, synthdefName);
        this.nodes.set(nodeId, synth);

        // Set initial control values
        for (const [key, value] of Object.entries(args)) {
            synth.set(key, value);
        }

        return synth;
    }

    /**
     * Render one block of audio
     *
     * @param {number} numChannels - Number of channels (default 2 for stereo)
     * @returns {Float32Array} Audio output buffer [samples]
     */
    render(numChannels = 2) {
        const totalSamples = this.blockSize * numChannels;
        const bufPtr = this.scwasm.Module._malloc(totalSamples * 4);

        try {
            const result = this.scwasm.Module._hc_wasm_render(
                this.id,
                bufPtr,
                this.blockSize,
                numChannels
            );

            if (result !== 0) {
                throw new Error(`Render failed with code ${result}`);
            }

            // Create view into WASM memory
            const output = new Float32Array(
                this.scwasm.Module.HEAPF32.buffer,
                bufPtr,
                totalSamples
            );

            // Copy to JS-owned buffer (important!)
            return new Float32Array(output);
        } finally {
            this.scwasm.Module._free(bufPtr);
        }
    }

    /**
     * Render multiple blocks continuously
     *
     * @param {number} numBlocks - Number of blocks to render
     * @param {number} numChannels - Number of channels (default 2)
     * @returns {Float32Array} Concatenated audio output
     */
    renderBlocks(numBlocks, numChannels = 2) {
        const totalSamples = this.blockSize * numBlocks * numChannels;
        const output = new Float32Array(totalSamples);

        for (let block = 0; block < numBlocks; ++block) {
            const blockData = this.render(numChannels);
            const offset = block * this.blockSize * numChannels;
            output.set(blockData, offset);
        }

        return output;
    }

    /**
     * Reset the engine (free all nodes)
     *
     * @returns {number} 0 on success, -1 on error
     */
    reset() {
        const result = this.scwasm.Module._hc_wasm_reset(this.id);
        if (result === 0) {
            this.nodes.clear();
            this.nextNodeId = 1000;
        }
        return result;
    }

    /**
     * Get engine status
     *
     * @returns {object} Status JSON
     */
    getStatus() {
        const bufSize = 8192;
        const bufPtr = this.scwasm.Module._malloc(bufSize);

        try {
            const result = this.scwasm.Module._hc_wasm_get_status(this.id, bufPtr, bufSize);
            if (result <= 0) {
                return {};
            }

            const statusStr = this.scwasm.Module.UTF8ToString(bufPtr);
            return JSON.parse(statusStr);
        } finally {
            this.scwasm.Module._free(bufPtr);
        }
    }
}

/**
 * Represents a running synth node
 */
class Synth {
    constructor(world, nodeId, synthdefName) {
        this.world = world;
        this.nodeId = nodeId;
        this.synthdefName = synthdefName;
        this.controls = {};
    }

    /**
     * Set a control value
     *
     * @param {string|number} control - Control name or index
     * @param {number} value - New value
     */
    set(control, value) {
        const controlIndex = typeof control === 'string' ? this._getControlIndex(control) : control;

        const result = this.world.scwasm.Module._hc_wasm_synth_set(
            this.world.id,
            this.nodeId,
            controlIndex,
            value
        );

        if (result === 0) {
            this.controls[controlIndex] = value;
        }

        return result;
    }

    /**
     * Free (stop) this synth
     */
    free() {
        const result = this.world.scwasm.Module._hc_wasm_synth_free(this.world.id, this.nodeId);

        if (result === 0) {
            this.world.nodes.delete(this.nodeId);
        }

        return result;
    }

    /**
     * Get control index from control name
     * (Phase 1: stub implementation - real version would parse SynthDef)
     *
     * @param {string} controlName - Name of the control
     * @returns {number} Control index
     */
    _getControlIndex(controlName) {
        // Phase 1: Just return a hash of the name
        // Real implementation would parse SynthDef metadata
        let hash = 0;
        for (let i = 0; i < controlName.length; i++) {
            hash = ((hash << 5) - hash) + controlName.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash) % 128;
    }
}

// Export for use in Node.js or browsers
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SuperColliderWasm, World, Synth };
}

// Also expose browser globals so module scripts can reference the API via window/globalThis.
if (typeof globalThis !== 'undefined') {
    globalThis.SuperColliderWasm = SuperColliderWasm;
    globalThis.SCWorld = World;
    globalThis.SCSynth = Synth;
}
