/**
 * SuperCollider WASM AudioWorklet Processor
 *
 * Runs in the AudioWorklet thread for real-time audio processing.
 * Communicates with main thread via MessagePort.
 */

class HCSynthProcessor extends AudioWorkletProcessor {
    /**
     * Constructor
     *
     * Options:
     *   - wasmModule: The SuperCollider WASM Module instance
     *   - worldId: The world handle from hc_wasm_world_create
     *   - channels: Number of output channels (default 2)
     *   - blockSize: scsynth world block size (default 128)
     *   - renderBlockSize: samples per _hc_wasm_render call (default = blockSize).
     *       Must be a power-of-two divisor of 128 (i.e. 128, 64, 32, or 16).
     *       Smaller values reduce control latency at the cost of more WASM calls
     *       per AudioWorklet quantum.  Set to 64 for ~1.3 ms latency at 48 kHz
     *       (vs ~2.7 ms at the default 128).  Requires the WASM build to be
     *       stable at smaller block sizes — test before shipping.
     */
    constructor(options) {
        super();

        const processorOptions = options && options.processorOptions ? options.processorOptions : null;
        if (!processorOptions || !processorOptions.wasmBinary) {
            throw new Error('Missing processor options for ScSynthProcessor (wasmBinary required)');
        }

        // wasmBinary / wasmDataBinary are pre-loaded ArrayBuffers from the main thread.
        this.wasmBinary = processorOptions.wasmBinary;
        this.wasmDataBinary = processorOptions.wasmDataBinary || null;
        // baseUrl provides the absolute base for any remaining file lookups.
        this.baseUrl = processorOptions.baseUrl || (globalThis._scWasmBaseUrl || './');
        this.worldBlockSize = processorOptions.blockSize || 128;
        this.channels = processorOptions.channels || 2;
        // When the main thread passes the AudioContext's nominal sample rate we can
        // detect the case where the browser assigned a different hardware rate.
        this.expectedSampleRate = processorOptions.sampleRate || 0;
        this.wasmModule = null;
        this.worldId = 0;
        this.ready = false;

        // Performance tracking
        this.metrics = {
            xruns: 0,
            blocksProcessed: 0,
            totalRenderTime: 0,
            peakRenderTime: 0,
            underruns: 0,
        };

        // AudioWorklet quantum — always 128 samples, fixed by the Web Audio API.
        this.samplesPerBlock = 128;

        // renderBlockSize: how many samples per _hc_wasm_render call.
        // Must divide the 128-sample quantum evenly; clamped to [1, 128].
        const requested = processorOptions.renderBlockSize || this.worldBlockSize;
        this.renderBlockSize = this._clampRenderBlockSize(requested);
        // Number of render calls per AudioWorklet process() invocation.
        this.subBlockCount = this.samplesPerBlock / this.renderBlockSize;

        // Output buffer covers one renderBlockSize worth of interleaved samples.
        this.totalOutputSamples = this.renderBlockSize * this.channels;
        this.outputBufferPtr = 0;
        this.outputBuffer = null;

        // Set up message handler for control messages from main thread
        this.port.onmessage = (event) => this._handleMessage(event);

        this._initPromise = this._initializeWasm().catch((error) => {
            this.port.postMessage({ type: 'error', message: error.message || String(error) });
        });
    }

    /**
     * Return the largest value <= requested that is a power-of-two divisor of
     * the 128-sample AudioWorklet quantum and at least 1.
     */
    _clampRenderBlockSize(requested) {
        const quantum = 128;
        const clamped = Math.max(1, Math.min(quantum, requested));
        // Walk down from requested to find a clean divisor.
        for (let s = clamped; s >= 1; s--) {
            if (quantum % s === 0) return s;
        }
        return quantum;
    }

    async _initializeWasm() {
        this.port.postMessage({ type: 'diagnostic', step: 'init-start' });

        // HCsynthModule is injected into the worklet's global scope by the main thread,
        // which concatenates scsynth-engine.js + HCSynthAudioWorklet.js into a single
        // blob module before calling audioContext.audioWorklet.addModule().
        const createModule = globalThis.HCsynthModule;
        if (typeof createModule !== 'function') {
            throw new Error('HCsynthModule not found in AudioWorklet scope (engine script not concatenated)');
        }
        this.port.postMessage({ type: 'diagnostic', step: 'engine-found' });

        // Pre-define runtime methods in the module arg so that Emscripten's
        // unexportedRuntimeSymbol() does not install abort()-throwing getters for them.
        // Real implementations are patched below once the module is fully initialised.
        const moduleArg = {
            wasmBinary: this.wasmBinary,  // pre-loaded ArrayBuffer; skip in-worklet fetch
            // Provide locateFile so any remaining file lookups (e.g. scsynth.data)
            // resolve against the page origin rather than the blob URL.
            locateFile: (file, _scriptDir) => this.baseUrl + file,
            // Supply the pre-loaded data package to skip an in-worklet fetch of scsynth.data.
            getPreloadedPackage: (_name, _size) => this.wasmDataBinary || null,
            print: () => {},
            printErr: () => {},
            // Stubs to prevent abort getters from being installed by Emscripten.
            UTF8ToString: () => '',
            allocateUTF8: () => 0,
        };

        this.wasmModule = await createModule(moduleArg);
        this.port.postMessage({ type: 'diagnostic', step: 'module-ready' });

        // Patch with real implementations backed by live WASM memory.
        const wasmMod = this.wasmModule;
        wasmMod.UTF8ToString = function utf8ToString(ptr, maxBytesToRead) {
            if (!ptr) return '';
            const h = this.HEAPU8;
            let end = ptr;
            const limit = (maxBytesToRead !== undefined) ? ptr + maxBytesToRead : h.length;
            while (end < limit && h[end]) end++;
            return new TextDecoder().decode(h.subarray(ptr, end));
        }.bind(wasmMod);
        wasmMod.allocateUTF8 = function allocateUTF8(str) {
            const bytes = new TextEncoder().encode(str);
            const ptr = this._malloc(bytes.length + 1);
            this.HEAPU8.set(bytes, ptr);
            this.HEAPU8[ptr + bytes.length] = 0;
            return ptr;
        }.bind(wasmMod);

        // World is created with the render block size so scsynth's internal
        // scheduling matches the per-render-call frame count.
        this.worldId = this.wasmModule._hc_wasm_world_create(sampleRate, this.renderBlockSize);
        this.port.postMessage({ type: 'diagnostic', step: 'world-created', worldId: this.worldId });
        if (!this.worldId) {
            throw new Error('Failed to create SC world in AudioWorklet');
        }

        // Warn when the browser-assigned sample rate differs from what was requested.
        // This can happen when the hardware doesn't support 48 kHz (rare but real).
        if (this.expectedSampleRate && sampleRate !== this.expectedSampleRate) {
            this.port.postMessage({
                type: 'sample-rate-mismatch',
                data: { requested: this.expectedSampleRate, actual: sampleRate },
            });
        }

        // Allocate output buffer once for a single renderBlockSize block.
        this.outputBufferPtr = this.wasmModule._malloc(this.totalOutputSamples * 4);
        if (!this.outputBufferPtr) {
            throw new Error('Failed to allocate output buffer in AudioWorklet WASM memory');
        }

        this.outputBuffer = new Float32Array(
            this.wasmModule.HEAPF32.buffer,
            this.outputBufferPtr,
            this.totalOutputSamples
        );

        this.ready = true;
        this.port.postMessage({
            type: 'ready',
            data: { sampleRate, blockSize: this.worldBlockSize, renderBlockSize: this.renderBlockSize },
        });
    }


    /**
     * Handle messages from main thread
     */
    _handleMessage(event) {
        const { type, data } = event.data;

        switch (type) {
            case 'control':
                // Enqueue control message for next render
                this._enqueueControl(data);
                break;

            case 'synth-new':
                this._createSynth(data);
                break;

            case 'synth-free':
                this._freeSynth(data);
                break;

            case 'synth-set':
                this._setSynthControls(data);
                break;

            case 'load-synthdef':
                this._loadSynthDef(data);
                break;

            case 'metrics-request':
                this._sendMetrics();
                break;

            case 'reset-metrics':
                this._resetMetrics();
                break;

            case 'status-request':
                this._sendStatus();
                break;
        }
    }

    /**
     * Enqueue a control message for the audio thread
     */
    _enqueueControl(data) {
        if (!this.ready) return;
        const { messageType, nodeId, controlIndex, value } = data;

        const result = this.wasmModule._hc_wasm_enqueue_control(
            this.worldId,
            messageType,
            nodeId,
            controlIndex,
            value
        );

        if (result !== 0) {
            // Queue full - log but don't crash
            console.warn('Control queue full, message dropped');
        }
    }

    _createSynth(data) {
        if (!this.ready) return;
        const { synthdefName, nodeId } = data;
        // Must pass synthdefName as a null-terminated C string pointer, not a JS string.
        const namePtr = this.wasmModule.allocateUTF8(synthdefName);
        try {
            const result = this.wasmModule._hc_wasm_synth_new(this.worldId, namePtr, nodeId, 1, 1);
            if (result !== 0) {
                throw new Error(`Failed to create synth '${synthdefName}' (code=${result})`);
            }
        } finally {
            this.wasmModule._free(namePtr);
        }
    }

    _freeSynth(data) {
        if (!this.ready) return;
        const { nodeId } = data;
        this.wasmModule._hc_wasm_synth_free(this.worldId, nodeId);
    }

    _setSynthControls(data) {
        if (!this.ready || !data || !Array.isArray(data.controls)) return;
        const nodeId = data.nodeId;
        for (const control of data.controls) {
            if (!control) continue;
            this.wasmModule._hc_wasm_synth_set(this.worldId, nodeId, control.controlIndex, control.value);
        }
    }

    _loadSynthDef(data) {
        if (!this.ready) return;
        const { name, bytes } = data;
        if (!bytes || !name) return;

        const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const ptr = this.wasmModule._malloc(source.length);
        this.wasmModule.HEAPU8.set(source, ptr);
        const namePtr = this.wasmModule.allocateUTF8(name);
        try {
            const result = this.wasmModule._hc_wasm_load_synthdef(this.worldId, ptr, source.length, namePtr);
            if (result !== 0) {
                throw new Error(`Failed to load SynthDef '${name}' (code=${result})`);
            }
        } finally {
            this.wasmModule._free(namePtr);
            this.wasmModule._free(ptr);
        }
    }

    /**
     * Render audio block
     *
     * Called by the browser at a regular interval (always 128 samples = AudioWorklet quantum).
     * When renderBlockSize < 128, this calls _hc_wasm_render subBlockCount times, each time
     * processing controls and rendering renderBlockSize samples.  This reduces the latency
     * between a synth.set() call and when the control change is audible.
     *
     * @param {Float32Array[][]} inputs - Input channels (typically empty for synthesis)
     * @param {Float32Array[][]} outputs - Output channels to fill
     * @param {object} parameters - Automation parameters (unused)
     * @returns {boolean} true to keep processing, false to release
     */
    process(inputs, outputs, parameters) {
        const outputChannels = outputs[0] || [];
        if (!this.ready || !this.wasmModule || !this.outputBufferPtr) {
            for (const channel of outputChannels) {
                channel.fill(0);
            }
            return true;
        }

        const startTime = this._now();
        let anyUnderrun = false;

        for (let sub = 0; sub < this.subBlockCount; sub++) {
            // Process pending control changes once per sub-block so that
            // control updates are applied at the sub-block boundary rather
            // than once per full 128-sample AudioWorklet quantum.
            const maxControls = 32;
            this.wasmModule._hc_wasm_process_controls(this.worldId, maxControls);

            const result = this.wasmModule._hc_wasm_render(
                this.worldId,
                this.outputBufferPtr,
                this.renderBlockSize,
                this.channels
            );

            if (result !== 0) {
                anyUnderrun = true;
                this.metrics.underruns++;
            } else {
                // Copy renderBlockSize samples from the interleaved WASM output buffer
                // into the correct output frame range for this sub-block.
                const frameOffset = sub * this.renderBlockSize;
                for (let ch = 0; ch < this.channels; ch++) {
                    const output = outputChannels[ch];
                    if (!output) continue;
                    for (let i = 0; i < this.renderBlockSize; i++) {
                        output[frameOffset + i] = this.outputBuffer[i * this.channels + ch];
                    }
                }
            }
        }

        if (anyUnderrun) {
            for (const channel of outputChannels) {
                channel.fill(0);
            }
        }

        // Update metrics — measured against the full 128-sample block budget.
        const renderTime = this._now() - startTime;
        this.metrics.blocksProcessed++;
        this.metrics.totalRenderTime += renderTime;
        if (renderTime > this.metrics.peakRenderTime) {
            this.metrics.peakRenderTime = renderTime;
        }

        const blockDuration = (this.samplesPerBlock / sampleRate) * 1000; // ms
        if (renderTime > blockDuration * 0.8) {
            // Render took > 80% of block time — log as xrun and notify main thread
            // immediately so the UI can react without waiting for the next metrics poll.
            this.metrics.xruns++;
            this.port.postMessage({
                type: 'xrun-alert',
                data: {
                    renderTime: renderTime.toFixed(2),
                    blockDuration: blockDuration.toFixed(2),
                    blocksProcessed: this.metrics.blocksProcessed,
                },
            });
        }

        // Push render-time sample to main thread every 10 blocks for histogram.
        // Posting every block would flood the message channel; 10-block cadence
        // gives ~750 Hz at 48 kHz / 128-sample blocks — more than enough.
        if (this.metrics.blocksProcessed % 10 === 0) {
            this.port.postMessage({
                type: 'render-time-sample',
                data: { renderTime },
            });
        }

        return true; // Continue processing
    }

    _now() {
        return (globalThis.performance && typeof globalThis.performance.now === 'function')
            ? globalThis.performance.now()
            : Date.now();
    }

    /**
     * Send current metrics to main thread
     */
    _sendMetrics() {
        const avgRenderTime =
            this.metrics.blocksProcessed > 0
                ? this.metrics.totalRenderTime / this.metrics.blocksProcessed
                : 0;

        const blockDuration = (this.samplesPerBlock / sampleRate) * 1000;
        const cpuPercent = (avgRenderTime / blockDuration) * 100;

        // Report WASM heap size so the main-thread UI can display memory usage.
        const heapBytes = (this.wasmModule && this.wasmModule.HEAPU8)
            ? this.wasmModule.HEAPU8.buffer.byteLength
            : 0;

        this.port.postMessage({
            type: 'metrics',
            data: {
                xruns: this.metrics.xruns,
                blocksProcessed: this.metrics.blocksProcessed,
                avgRenderTime: avgRenderTime.toFixed(2),
                peakRenderTime: this.metrics.peakRenderTime.toFixed(2),
                cpuPercent: cpuPercent.toFixed(1),
                underruns: this.metrics.underruns,
                heapBytes,
            },
        });
    }

    /**
     * Reset all metrics
     */
    _resetMetrics() {
        this.metrics = {
            xruns: 0,
            blocksProcessed: 0,
            totalRenderTime: 0,
            peakRenderTime: 0,
            underruns: 0,
        };
    }

    /**
     * Send status information
     */
    _sendStatus() {
        this.port.postMessage({
            type: 'status',
            data: {
                running: true,
                sampleRate: sampleRate,
                samplesPerBlock: this.samplesPerBlock,
                renderBlockSize: this.renderBlockSize,
                subBlockCount: this.subBlockCount,
                channels: this.channels,
            },
        });
    }

    /**
     * Clean up resources
     */
    releaseResources() {
        if (this.outputBufferPtr && this.wasmModule) {
            this.wasmModule._free(this.outputBufferPtr);
            this.outputBufferPtr = null;
        }
        if (this.worldId && this.wasmModule) {
            this.wasmModule._hc_wasm_world_destroy(this.worldId);
            this.worldId = 0;
        }
    }
}

// Register the processor
registerProcessor('sc-synth-processor', ScSynthProcessor);
