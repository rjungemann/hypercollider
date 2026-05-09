/**
 * SuperCollider WASM Web Worker
 *
 * Runs in a regular Web Worker context where fetch() and eval() are available.
 * Loads the scsynth WASM module and processes DSP commands from the main thread.
 *
 * Usage from main thread:
 *   const worker = new Worker('sc_wasm_worker.js');
 *   worker.postMessage({ type: 'init-wasm', wasmPath: './scsynth.js' });
 *   worker.postMessage({ type: 'load-synthdef', data: synthdefBytes, name: 'default' });
 */

let wasmModule = null;
let world = null;
let outputBuffer = null;
let outputBufferPtr = null;

/**
 * Initialize the WASM module and create a World instance
 */
async function initializeWasm(wasmPath) {
  try {
    if (!wasmModule) {
      console.log(`[Worker] Fetching WASM module from: ${wasmPath}`);

      // Use XMLHttpRequest to fetch the module script
      // (XMLHttpRequest is available in Worker contexts)
      const xhr = new XMLHttpRequest();
      
      await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve();
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.onabort = () => reject(new Error('Request aborted'));
        xhr.open('GET', wasmPath);
        xhr.send();
      });

      const scriptText = xhr.responseText;
      console.log(`[Worker] Loaded ${(scriptText.length / 1024).toFixed(1)}KB of JS`);

      // Create a non-strict eval context using Function constructor
      // This avoids issues with variable redeclaration in strict mode
      const evalFunc = new Function(scriptText + `; return typeof SCsynthModule !== 'undefined' ? SCsynthModule : (typeof module !== 'undefined' && module.exports ? module.exports : null);`);
      
      // Clear module object to avoid conflicts
      self.module = { exports: {} };
      
      const SCsynthModule = evalFunc.call(self);
      
      if (typeof SCsynthModule !== 'function') {
        throw new Error(`SCsynthModule is not a factory function. Got type: ${typeof SCsynthModule}`);
      }

      console.log('[Worker] SCsynthModule factory obtained');

      // Call the factory function with options
      wasmModule = await SCsynthModule({
        print: (text) => console.log(`[WASM] ${text}`),
        printErr: (text) => console.error(`[WASM Error] ${text}`),
      });

      // Query runtime parameters
      const sampleRate = wasmModule._sc_wasm_world_sample_rate();
      const blockSize = wasmModule._sc_wasm_world_block_size();
      console.log(`[Worker] WASM initialized: SR=${sampleRate}, blockSize=${blockSize}`);

      // Allocate output buffer for stereo
      const outputSamples = blockSize * 2;
      const bytesPerSample = 4; // float32
      outputBufferPtr = wasmModule._malloc(outputSamples * bytesPerSample);
      outputBuffer = new Float32Array(wasmModule.HEAPF32.buffer, outputBufferPtr, outputSamples);

      // Create the DSP world
      world = wasmModule._sc_wasm_world_create();
      if (!world) {
        throw new Error('Failed to create SC World');
      }

      console.log('[Worker] SC World created successfully');
      self.postMessage({ type: 'ready', sampleRate, blockSize });
    }
  } catch (err) {
    const errMsg = `WASM init error: ${err.message}`;
    console.error(`[Worker] ${errMsg}`);
    self.postMessage({ type: 'error', error: errMsg });
  }
}

/**
 * Load a compiled SynthDef binary
 */
function loadSynthDef(synthdefBytes, name) {
  if (!wasmModule || !world) {
    throw new Error('WASM not initialized');
  }

  // Copy SynthDef bytes into WASM heap
  const defPtr = wasmModule._malloc(synthdefBytes.length);
  const defHeap = new Uint8Array(wasmModule.HEAPU8.buffer, defPtr, synthdefBytes.length);
  defHeap.set(new Uint8Array(synthdefBytes));

  // Call sc_wasm_load_synthdef with world handle, buffer, size, name
  const namePtr = wasmModule.allocateUTF8(name);
  const result = wasmModule._sc_wasm_load_synthdef(world, defPtr, synthdefBytes.length, namePtr);

  wasmModule._free(defPtr);
  wasmModule._free(namePtr);

  if (result !== 0) {
    throw new Error(`Failed to load synthdef: ${name}`);
  }

  console.log(`[Worker] SynthDef loaded: ${name} (${synthdefBytes.length} bytes)`);
  self.postMessage({ type: 'synthdef-loaded', name });
}

/**
 * Create a new synth instance
 */
function synthNew(synthName, synthId, args = {}) {
  if (!wasmModule || !world) {
    throw new Error('WASM not initialized');
  }

  const namePtr = wasmModule.allocateUTF8(synthName);
  const result = wasmModule._sc_wasm_synth_new(world, namePtr, synthId);
  wasmModule._free(namePtr);

  if (result !== 0) {
    throw new Error(`Failed to create synth: ${synthName}`);
  }

  // Apply initial arguments
  for (const [key, value] of Object.entries(args)) {
    synthSetValue(synthId, key, value);
  }

  console.log(`[Worker] Synth created: id=${synthId}, name=${synthName}`);
  self.postMessage({ type: 'synth-new', synthId, synthName });
}

/**
 * Free a synth instance
 */
function synthFree(synthId) {
  if (!wasmModule || !world) {
    throw new Error('WASM not initialized');
  }

  const result = wasmModule._sc_wasm_synth_free(world, synthId);
  if (result !== 0) {
    throw new Error(`Failed to free synth: ${synthId}`);
  }

  console.log(`[Worker] Synth freed: id=${synthId}`);
}

/**
 * Set control values on a synth
 */
function synthSetValue(synthId, key, value) {
  if (!wasmModule || !world) return;

  const keyPtr = wasmModule.allocateUTF8(key);
  wasmModule._sc_wasm_synth_set(world, synthId, keyPtr, value);
  wasmModule._free(keyPtr);
}

/**
 * Render audio samples
 */
function render(numSamples, numChannels) {
  if (!wasmModule || !world || !outputBuffer) {
    // Return silence
    const silence = new Float32Array(numSamples * numChannels);
    return {
      samples: silence,
      maxLevel: 0,
    };
  }

  try {
    // Render one block from the SC engine
    const result = wasmModule._sc_wasm_render(world, outputBufferPtr, numSamples, numChannels);

    if (result === 0) {
      // Success; copy from WASM heap and compute metering
      let maxLevel = 0;
      const samples = new Float32Array(numSamples * numChannels);

      for (let ch = 0; ch < numChannels; ch++) {
        const offset = ch * numSamples;
        for (let i = 0; i < numSamples; i++) {
          const sample = outputBuffer[offset + i];
          samples[offset + i] = sample;
          maxLevel = Math.max(maxLevel, Math.abs(sample));
        }
      }

      return { samples, maxLevel };
    } else {
      // Render failed; return silence
      return {
        samples: new Float32Array(numSamples * numChannels),
        maxLevel: 0,
      };
    }
  } catch (err) {
    console.error(`[Worker] Render error: ${err.message}`);
    return {
      samples: new Float32Array(numSamples * numChannels),
      maxLevel: 0,
    };
  }
}

/**
 * Main message handler
 */
self.onmessage = (event) => {
  const msg = event.data;
  if (!msg.type) return;

  try {
    switch (msg.type) {
      case 'init-wasm':
        initializeWasm(msg.wasmPath);
        break;

      case 'load-synthdef':
        loadSynthDef(msg.data, msg.name);
        break;

      case 'synth-new':
        synthNew(msg.synthName, msg.synthId, msg.args);
        break;

      case 'synth-free':
        synthFree(msg.synthId);
        break;

      case 'synth-set':
        synthSetValue(msg.synthId, msg.key, msg.value);
        break;

      case 'render':
        const result = render(msg.numSamples, msg.numChannels);
        // Return samples as an array so it can be postMessage'd
        self.postMessage({
          type: 'render-result',
          samples: result.samples,
          maxLevel: result.maxLevel,
        });
        break;

      default:
        console.log(`[Worker] Unknown message type: ${msg.type}`);
    }
  } catch (err) {
    console.error(`[Worker] Message handler error: ${err.message}`);
    self.postMessage({ type: 'error', error: err.message });
  }
};

console.log('[Worker] SC WASM Worker initialized');
