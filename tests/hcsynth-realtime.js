/**
 * SuperCollider WASM Real-Time Audio Interface
 *
 * Extends the offline API with real-time audio playback via AudioWorklet.
 * Handles:
 * - AudioContext initialization
 * - AudioWorklet processor setup
 * - Real-time control messaging
 * - Performance monitoring
 */

/**
 * Persistent IndexedDB cache for compiled SynthDef binaries.
 *
 * Caching workflow:
 *   1. After SynthDefs are compiled by sclang, call cache.put(name, bytes).
 *   2. On the next page load, call SynthDefCache.open() then
 *      SynthDefCache.populateWorld(offlineWorld) before creating a RealtimeWorld.
 *      This restores the compiled bytes so sclang compilation can be skipped.
 *
 * Usage:
 *   const cache = await SynthDefCache.open();
 *   await SynthDefCache.populateWorld(offlineWorld, cache);
 *   // ... create RealtimeWorld normally ...
 *
 * The cache is opt-in and fails silently when IndexedDB is unavailable (e.g.
 * in private-browsing mode or non-secure contexts).
 */
class SynthDefCache {
    static DB_NAME = 'sc-synthdef-cache';
    static STORE = 'synthdefs';
    static VERSION = 1;

    /**
     * Open (or create) the SynthDef cache.
     * Returns null when IndexedDB is not available.
     */
    static async open() {
        if (typeof indexedDB === 'undefined') return null;
        return new Promise((resolve) => {
            const req = indexedDB.open(SynthDefCache.DB_NAME, SynthDefCache.VERSION);
            req.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(SynthDefCache.STORE);
            };
            req.onsuccess = (e) => resolve(new SynthDefCache(e.target.result));
            req.onerror = () => resolve(null);
        });
    }

    /**
     * Pre-populate an offline World's synthdefs map from the cache.
     * Entries that are already present in offlineWorld.synthdefs are NOT overwritten,
     * so freshly compiled defs take precedence over stale cached ones.
     *
     * @param {World} offlineWorld
     * @param {SynthDefCache} cache
     */
    static async populateWorld(offlineWorld, cache) {
        if (!cache || !offlineWorld?.synthdefs) return;
        const all = await cache.getAll();
        for (const [name, bytes] of Object.entries(all)) {
            if (!offlineWorld.synthdefs.has(name)) {
                offlineWorld.synthdefs.set(name, { data: bytes });
            }
        }
    }

    constructor(db) {
        this._db = db;
    }

    /** Retrieve compiled bytes for a named SynthDef, or null if not cached. */
    async get(name) {
        return new Promise((resolve) => {
            try {
                const tx = this._db.transaction(SynthDefCache.STORE, 'readonly');
                const req = tx.objectStore(SynthDefCache.STORE).get(name);
                req.onsuccess = () => resolve(req.result instanceof Uint8Array ? req.result : null);
                req.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
    }

    /** Store compiled bytes for a named SynthDef. */
    async put(name, bytes) {
        return new Promise((resolve) => {
            try {
                const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                const tx = this._db.transaction(SynthDefCache.STORE, 'readwrite');
                tx.objectStore(SynthDefCache.STORE).put(data, name);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (_) {
                resolve();
            }
        });
    }

    /** Retrieve all cached SynthDefs as { [name]: Uint8Array }. */
    async getAll() {
        return new Promise((resolve) => {
            try {
                const results = {};
                const tx = this._db.transaction(SynthDefCache.STORE, 'readonly');
                const store = tx.objectStore(SynthDefCache.STORE);
                const keysReq = store.getAllKeys();
                keysReq.onsuccess = () => {
                    const keys = keysReq.result;
                    let pending = keys.length;
                    if (pending === 0) { resolve(results); return; }
                    for (const key of keys) {
                        const vReq = store.get(key);
                        vReq.onsuccess = () => {
                            if (vReq.result instanceof Uint8Array) results[key] = vReq.result;
                            if (--pending === 0) resolve(results);
                        };
                        vReq.onerror = () => { if (--pending === 0) resolve(results); };
                    }
                };
                keysReq.onerror = () => resolve(results);
            } catch (_) {
                resolve({});
            }
        });
    }

    /** Remove a single entry from the cache. */
    async delete(name) {
        return new Promise((resolve) => {
            try {
                const tx = this._db.transaction(SynthDefCache.STORE, 'readwrite');
                tx.objectStore(SynthDefCache.STORE).delete(name);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (_) {
                resolve();
            }
        });
    }

    /** Clear all cached SynthDefs. */
    async clear() {
        return new Promise((resolve) => {
            try {
                const tx = this._db.transaction(SynthDefCache.STORE, 'readwrite');
                tx.objectStore(SynthDefCache.STORE).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (_) {
                resolve();
            }
        });
    }

    close() {
        this._db.close();
    }
}

class RealtimeWorld {
    /**
     * Create a real-time audio world
     *
     * @param {World} offlineWorld - The offline world from SC.createWorld()
     * @param {AudioContext} audioContext - Web Audio API context
     * @param {object} [options]
     * @param {number} [options.renderBlockSize] - Samples per _hc_wasm_render call.
     *   Must be a power-of-two divisor of 128 (e.g. 64 or 128).
     *   64 gives ~1.3 ms latency at 48 kHz; 128 (default) gives ~2.7 ms.
     *   Smaller values reduce control-update latency but increase WASM call overhead.
     *   Test your synths for stability before lowering this value.
     * @param {SynthDefCache|null} [options.synthDefCache] - Pre-opened SynthDefCache
     *   instance.  When provided, newly synced SynthDefs are persisted to the cache
     *   so they can be restored across page loads without recompilation.
     * @returns {Promise<RealtimeWorld>} Initialized real-time world
     */
    static async create(offlineWorld, audioContext, options = {}) {
        const rtWorld = new RealtimeWorld(offlineWorld, audioContext, options);
        await rtWorld._initialize();
        return rtWorld;
    }

    constructor(offlineWorld, audioContext, options = {}) {
        this.offlineWorld = offlineWorld;
        this.audioContext = audioContext;
        this.workletNode = null;
        this.workletPort = null;
        this.workletReady = false;

        this._renderBlockSize = options.renderBlockSize || null;
        this._synthDefCache = options.synthDefCache || null;

        // Performance metrics
        this.metrics = {
            running: false,
            startTime: 0,
            xruns: 0,
            cpuPercent: 0,
            heapBytes: 0,
        };

        // Ring buffer of raw render times (ms) pushed from the AudioWorklet
        // for the block render time histogram.  Capped at 500 samples.
        this._renderTimes = [];

        // Synth management
        this.activeSynths = new Map();

        // Event callbacks — set these before or after create().
        // onXrun(data)   — called immediately when the worklet detects an xrun.
        // onError(msg)   — called for audio device errors (e.g. sample-rate mismatch).
        this.onXrun = null;
        this.onError = null;

        // Batched control dispatch — accumulates per-synth control changes and
        // flushes them all in a single postMessage per microtask checkpoint.
        // This collapses rapid successive synth.set() calls (e.g. slider drag
        // events) into one message instead of N, reducing postMessage overhead.
        this._pendingControls = new Map(); // nodeId -> Map<controlIndex, value>
        this._flushPending = false;
    }

    /**
     * Initialize the AudioWorklet
     */
    async _initialize() {
        try {
            // Cache-bust worklet/runtime assets during iterative browser IDE development.
            const cacheBust = `v=${Date.now()}`;

            // AudioWorkletGlobalScope does not reliably support importScripts() or
            // fetch() in all browsers.  Instead we pre-load all resources on the main
            // thread and inject them into the worklet via a combined Blob module.
            const baseUrl = new URL('./', location.href).href;

            const [engineText, workletText, wasmBuffer, dataBuffer] = await Promise.all([
                fetch(`./hcsynth-engine.js?${cacheBust}`).then((r) => r.text()),
                fetch(`./ScSynthAudioWorklet.js?${cacheBust}`).then((r) => r.text()),
                fetch(`./scsynth.wasm?${cacheBust}`).then((r) => r.arrayBuffer()),
                fetch(`./scsynth.data?${cacheBust}`).then((r) => r.arrayBuffer()).catch(() => null),
            ]);

            // Inject base URL so locateFile can resolve any remaining relative paths.
            const baseUrlLine = `globalThis._scWasmBaseUrl = ${JSON.stringify(baseUrl)};\n`;
            // Firefox AudioWorklet can miss a global performance object in some contexts.
            // Provide a minimal monotonic-ish now() fallback before loading Emscripten glue.
            const perfShimLine = `if (!globalThis.performance || typeof globalThis.performance.now !== 'function') { globalThis.performance = { now: () => Date.now() }; }\n`;
            // Concatenate: engine script first so HCsynthModule is in scope when the
            // processor class file registers itself with registerProcessor().
            // Explicitly assign to globalThis in case addModule runs the script in
            // a module context where top-level var declarations are not global.
            const combinedScript = baseUrlLine + perfShimLine + engineText + '\nglobalThis.HCsynthModule = HCsynthModule;\n;\n' + workletText;
            const blobUrl = URL.createObjectURL(
                new Blob([combinedScript], { type: 'application/javascript' })
            );
            await this.audioContext.audioWorklet.addModule(blobUrl);
            URL.revokeObjectURL(blobUrl);

            const processorOptions = {
                // Pass WASM binary directly — no fetch needed inside the worklet.
                wasmBinary: wasmBuffer,
                wasmDataBinary: dataBuffer,
                baseUrl,
                // Default world/render block size aligned to AudioWorklet quantum (128).
                // The old default of 512 caused a mismatch between the world block size
                // and the per-render-call frame count.  Pass renderBlockSize explicitly
                // to opt in to lower-latency 64-sample sub-block rendering.
                blockSize: this.offlineWorld.blockSize || 128,
                // Pass the AudioContext's nominal sample rate so the worklet can
                // detect when the browser assigns a different hardware rate.
                sampleRate: this.audioContext.sampleRate,
                channels: 2,
            };
            if (this._renderBlockSize != null) {
                processorOptions.renderBlockSize = this._renderBlockSize;
            }

            this.workletNode = new AudioWorkletNode(this.audioContext, 'sc-synth-processor', {
                processorOptions,
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });

            // Set up message port
            this.workletPort = this.workletNode.port;
            this.workletPort.onmessage = (event) => this._handleWorkletMessage(event);

            await this._awaitWorkletReady();
            this._syncSynthDefsToWorklet();

            // Start processing
            this.workletNode.connect(this.audioContext.destination);

            this.metrics.running = true;
            this.metrics.startTime = performance.now();

            console.log('Real-time audio initialized');
        } catch (error) {
            console.error('Failed to initialize AudioWorklet:', error);
            throw error;
        }
    }

    _awaitWorkletReady(timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const start = performance.now();
            // Attach a one-time error fast-path so we reject immediately instead of
            // waiting for the full timeout when the worklet reports an error.
            const prevOnMessage = this.workletPort.onmessage;
            this.workletPort.onmessage = (event) => {
                if (event.data?.type === 'error') {
                    this.workletPort.onmessage = prevOnMessage;
                    reject(new Error('AudioWorklet reported error: ' + (event.data.message || '(unknown)')));
                    return;
                }
                if (prevOnMessage) prevOnMessage(event);
            };
            const check = () => {
                if (this.workletReady) {
                    this.workletPort.onmessage = prevOnMessage;
                    resolve();
                    return;
                }
                if ((performance.now() - start) >= timeoutMs) {
                    this.workletPort.onmessage = prevOnMessage;
                    reject(new Error('AudioWorklet did not report ready in time'));
                    return;
                }
                setTimeout(check, 50);
            };
            check();
        });
    }

    _syncSynthDefsToWorklet() {
        if (!this.workletPort || !this.offlineWorld?.synthdefs) return;
        for (const [name, info] of this.offlineWorld.synthdefs.entries()) {
            const bytes = info?.data;
            if (!bytes) continue;
            const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            this.workletPort.postMessage({
                type: 'load-synthdef',
                data: { name, bytes: payload },
            });
            // Persist to IndexedDB cache when one has been provided so the
            // compiled bytes survive page reloads.
            if (this._synthDefCache) {
                this._synthDefCache.put(name, payload).catch(() => {});
            }
        }
    }

    /**
     * Handle messages from AudioWorklet processor
     */
    _handleWorkletMessage(event) {
        const { type, data } = event.data;

        switch (type) {
            case 'ready':
                this.workletReady = true;
                console.log(`AudioWorklet ready at ${data.sampleRate}Hz`);
                break;

            case 'error':
                console.error('AudioWorklet error:', data?.message || event.data.message);
                break;

            case 'diagnostic':
                console.log(`[AudioWorklet diagnostic] step=${event.data.step}`, event.data);
                break;

            case 'metrics':
                this.metrics.xruns = data.xruns;
                this.metrics.cpuPercent = parseFloat(data.cpuPercent);
                this.metrics.avgRenderTime = parseFloat(data.avgRenderTime);
                this.metrics.peakRenderTime = parseFloat(data.peakRenderTime);
                this.metrics.underruns = data.underruns;
                if (data.heapBytes != null) this.metrics.heapBytes = data.heapBytes;
                break;

            case 'render-time-sample':
                // Push raw block render time into the ring buffer for the histogram.
                this._renderTimes.push(data.renderTime);
                if (this._renderTimes.length > 500) this._renderTimes.shift();
                break;

            case 'xrun-alert':
                // Fired immediately on each xrun — don't wait for the next metrics poll.
                // The authoritative xrun count is still owned by the periodic 'metrics' message.
                if (typeof this.onXrun === 'function') this.onXrun(data);
                break;

            case 'sample-rate-mismatch':
                console.warn(
                    `[RealtimeWorld] Sample rate mismatch: requested ${data.requested} Hz, ` +
                    `browser assigned ${data.actual} Hz. Audio may be pitched incorrectly.`
                );
                if (typeof this.onError === 'function') {
                    this.onError(`Sample rate mismatch: requested ${data.requested} Hz, got ${data.actual} Hz`);
                }
                break;

            case 'status':
                console.log('AudioWorklet status:', data);
                break;
        }
    }

    /**
     * Create and start a real-time synth
     *
     * @param {string} synthdefName - Name of the SynthDef
     * @param {object} args - Initial control arguments
     * @returns {RealtimeSynth} Real-time synth node
     */
    synth(synthdefName, args = {}) {
        const synth = new RealtimeSynth(this, synthdefName, args);
        this.activeSynths.set(synth.nodeId, synth);
        return synth;
    }

    /**
     * Get real-time metrics
     *
     * @returns {object} Metrics including CPU, xruns, uptime
     */
    getMetrics() {
        const uptime = performance.now() - this.metrics.startTime;

        return {
            running: this.metrics.running,
            cpuPercent: this.metrics.cpuPercent,
            xruns: this.metrics.xruns,
            uptime: uptime / 1000, // seconds
            activeSynths: this.activeSynths.size,
            avgRenderTime: this.metrics.avgRenderTime || 0,
            peakRenderTime: this.metrics.peakRenderTime || 0,
            underruns: this.metrics.underruns || 0,
            heapBytes: this.metrics.heapBytes || 0,
        };
    }

    /**
     * Return a copy of the raw render-time ring buffer (in ms).
     * Values are pushed by the AudioWorklet every 10 blocks.
     *
     * @returns {number[]} Array of render times in milliseconds
     */
    getRenderTimes() {
        return this._renderTimes.slice();
    }

    /**
     * Bucket the render-time ring buffer into a histogram.
     *
     * @param {number} [binWidthMs=0.1]  Width of each bin in milliseconds
     * @param {number} [maxBins=30]      Maximum number of bins to return
     * @returns {{ bins: number[], binWidthMs: number, maxRenderTime: number }}
     *   bins[i] = count of samples whose render time falls in
     *   [i * binWidthMs, (i+1) * binWidthMs).
     */
    getRenderHistogram(binWidthMs = 0.1, maxBins = 30) {
        const bins = new Array(maxBins).fill(0);
        let maxRenderTime = 0;
        for (const t of this._renderTimes) {
            if (t > maxRenderTime) maxRenderTime = t;
            const idx = Math.min(Math.floor(t / binWidthMs), maxBins - 1);
            bins[idx]++;
        }
        return { bins, binWidthMs, maxRenderTime };
    }

    /**
     * Request metrics update from AudioWorklet
     */
    requestMetricsUpdate() {
        if (!this.workletPort) return;
        this.workletPort.postMessage({ type: 'metrics-request' });
    }

    /**
     * Reset all metrics
     */
    resetMetrics() {
        if (!this.workletPort) return;
        this.workletPort.postMessage({ type: 'reset-metrics' });
        this.metrics.startTime = performance.now();
        this.metrics.xruns = 0;
    }

    /**
     * Stop real-time audio and clean up
     */
    stop() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        this.metrics.running = false;

        // Flush any pending batched control messages before tearing down.
        this._flushControls();

        // Free all synths
        for (const synth of this.activeSynths.values()) {
            synth._free();
        }
        this.activeSynths.clear();
        this.workletReady = false;

        console.log('Real-time audio stopped');
    }

    // -------------------------------------------------------------------------
    // Batched control dispatch
    // -------------------------------------------------------------------------

    /**
     * Schedule a microtask to flush all pending control changes.
     * Called by RealtimeSynth.set(); collapsed so at most one flush queues per
     * microtask checkpoint regardless of how many set() calls are made.
     */
    _scheduleFlush() {
        if (this._flushPending) return;
        this._flushPending = true;
        queueMicrotask(() => this._flushControls());
    }

    /**
     * Send one batched synth-set message per synth that has pending changes,
     * then clear the pending map.
     */
    _flushControls() {
        this._flushPending = false;
        if (!this.workletPort || this._pendingControls.size === 0) return;
        for (const [nodeId, controlMap] of this._pendingControls) {
            const controls = [];
            for (const [controlIndex, value] of controlMap) {
                controls.push({ controlIndex, value });
            }
            this.workletPort.postMessage({
                type: 'synth-set',
                data: { nodeId, controls },
            });
        }
        this._pendingControls.clear();
    }
}

/**
 * Real-time synth node
 */
class RealtimeSynth {
    // Class-level cache: control name -> index hash.
    // Shared across all instances because the hash is deterministic and
    // independent of which SynthDef or world is in use.
    static _controlIndexCache = new Map();

    constructor(realtimeWorld, synthdefName, args) {
        this.realtimeWorld = realtimeWorld;
        this.synthdefName = synthdefName;

        // Get unique node ID
        this.nodeId = realtimeWorld.offlineWorld.nextNodeId++;

        // Create in AudioWorklet world
        this.realtimeWorld.workletPort.postMessage({
            type: 'synth-new',
            data: {
                synthdefName: this.synthdefName,
                nodeId: this.nodeId,
                args,
            },
        });

        // Set initial controls via the batched path so the constructor call
        // also benefits from deduplication when multiple keys share a microtask.
        this.controls = {};
        for (const [key, value] of Object.entries(args)) {
            this.set(key, value);
        }
    }

    /**
     * Set a control parameter in real-time.
     *
     * Multiple calls within the same microtask checkpoint are coalesced: the
     * last value written for a given control wins, and only one postMessage is
     * sent to the AudioWorklet per synth per flush rather than one per call.
     *
     * @param {string|number} control - Control name or index
     * @param {number} value - New value
     */
    set(control, value) {
        const controlIndex = typeof control === 'string' ? this._getControlIndex(control) : control;

        // Accumulate into the pending batch for this node.
        let nodeControls = this.realtimeWorld._pendingControls.get(this.nodeId);
        if (!nodeControls) {
            nodeControls = new Map();
            this.realtimeWorld._pendingControls.set(this.nodeId, nodeControls);
        }
        nodeControls.set(controlIndex, value);
        this.realtimeWorld._scheduleFlush();

        // Mirror in local state for getMetrics / introspection.
        this.controls[controlIndex] = value;
    }

    /**
     * Stop and free this synth
     */
    free() {
        this.realtimeWorld.workletPort.postMessage({
            type: 'synth-free',
            data: {
                nodeId: this.nodeId,
            },
        });

        // Remove from tracking
        this.realtimeWorld.activeSynths.delete(this.nodeId);
    }

    /**
     * Internal free (without messaging)
     */
    _free() {
        this.realtimeWorld.offlineWorld.nodes.delete(this.nodeId);
    }

    /**
     * Map a control name to a numeric index via a djb2-style hash.
     * Results are cached in the class-level Map so the hash is only computed
     * once per unique name across all synth instances.
     */
    _getControlIndex(controlName) {
        const cached = RealtimeSynth._controlIndexCache.get(controlName);
        if (cached !== undefined) return cached;
        let hash = 0;
        for (let i = 0; i < controlName.length; i++) {
            hash = ((hash << 5) - hash) + controlName.charCodeAt(i);
            hash = hash & hash;
        }
        const index = Math.abs(hash) % 128;
        RealtimeSynth._controlIndexCache.set(controlName, index);
        return index;
    }
}

// Export for use in browsers
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RealtimeWorld, RealtimeSynth, SynthDefCache };
}

if (typeof globalThis !== 'undefined') {
    globalThis.RealtimeWorld = RealtimeWorld;
    globalThis.RealtimeSynth = RealtimeSynth;
    globalThis.SynthDefCache = SynthDefCache;
}
