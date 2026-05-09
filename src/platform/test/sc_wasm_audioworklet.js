/**
 * SCsynthModule AudioWorklet Processor
 * 
 * Loads the WASM SuperCollider engine and processes audio in real-time
 * via the Web Audio API AudioWorklet interface.
 * 
 * Usage from main thread:
 *   const node = new AudioWorkletNode(audioContext, 'scsynth-processor');
 *   node.port.postMessage({type: 'load-synthdef', data: synthdefBytes, name: 'default'});
 *   node.port.postMessage({type: 'synth-new', synthName: 'default', args: {freq: 440}});
 */

class SCSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.wasmModule = null;
    this.world = null;
    this.synthCounter = 0;
    this.controlBus = {};
    this.meterLevel = 0;

    // Render state
    this.outputBuffer = null;
    this.blockSize = 512; // Default; will update after WASM init

    // Set up incoming message handler
    this.port.onmessage = (event) => this._handleMessage(event.data);

    // Log to main thread
    this._log('SCSynthProcessor initialized');
  }

  async _initializeWasm(wasmPath) {
    try {
      // AudioWorklet has limited APIs. Try XHR which should be available
      // Fetch the scsynth.js module
      const xhr = new XMLHttpRequest();
      await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve();
          } else {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('XHR failed'));
        xhr.onabort = () => reject(new Error('XHR aborted'));
        xhr.open('GET', wasmPath);
        xhr.send();
      });

      const scriptText = xhr.responseText;
      this._log(`Loaded ${(scriptText.length / 1024).toFixed(1)}KB of JS`, 'init');

      // Evaluate the script in the AudioWorklet global scope
      // This will define SCsynthModule in globalThis
      eval(scriptText);

      if (!globalThis.SCsynthModule) {
        throw new Error('SCsynthModule not defined after eval');
      }

      this._log('SCsynthModule loaded and available', 'init');

      // SCsynthModule is a factory function; call it with options
      const Module = await globalThis.SCsynthModule({
        print: (text) => this._log(`WASM: ${text}`),
        printErr: (text) => this._log(`WASM Error: ${text}`),
      });

      this.wasmModule = Module;

      // Query runtime parameters
      const sampleRate = Module._sc_wasm_world_sample_rate();
      const blockSize = Module._sc_wasm_world_block_size();
      this._log(`WASM initialized: SR=${sampleRate}, blockSize=${blockSize}`);

      // Allocate output buffer in WASM heap (stereo, worst case)
      const outputSamples = blockSize * 2; // stereo
      const bytesPerSample = 4; // float32
      this.outputBufferPtr = Module._malloc(outputSamples * bytesPerSample);
      this.outputBuffer = new Float32Array(Module.HEAPF32.buffer, this.outputBufferPtr, outputSamples);
      this.blockSize = blockSize;

      // Create the DSP world
      this.world = Module._sc_wasm_world_create();
      if (!this.world) {
        throw new Error('Failed to create SC World');
      }
      this._log('SC World created successfully');
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      const errMsg = `WASM init error: ${err.message}`;
      this._log(errMsg);
      this.port.postMessage({ type: 'error', error: errMsg });
    }
  }

  _handleMessage(msg) {
    if (!msg.type) return;

    try {
      switch (msg.type) {
        case 'init-wasm':
          this._initializeWasm(msg.wasmPath);
          break;

        case 'load-synthdef':
          this._loadSynthDef(msg.data, msg.name);
          break;

        case 'synth-new':
          this._synthNew(msg.synthName, msg.args || {});
          break;

        case 'synth-free':
          this._synthFree(msg.synthId);
          break;

        case 'synth-set':
          this._synthSet(msg.synthId, msg.args || {});
          break;

        case 'control-set':
          this.controlBus[msg.key] = msg.value;
          break;

        case 'get-status':
          this.port.postMessage({
            type: 'status',
            synthCount: this.synthCounter,
            meterLevel: this.meterLevel,
          });
          break;

        default:
          this._log(`Unknown message type: ${msg.type}`);
      }
    } catch (err) {
      this._log(`Message handler error: ${err.message}`);
    }
  }

  _loadSynthDef(synthdefBytes, name) {
    if (!this.wasmModule || !this.world) {
      throw new Error('WASM not initialized');
    }

    const Module = this.wasmModule;

    // Copy SynthDef bytes into WASM heap
    const defPtr = Module._malloc(synthdefBytes.length);
    const defHeap = new Uint8Array(Module.HEAPU8.buffer, defPtr, synthdefBytes.length);
    defHeap.set(new Uint8Array(synthdefBytes));

    // Call sc_wasm_load_synthdef with world handle, buffer, size, name
    const namePtr = Module.allocateUTF8(name);
    const result = Module._sc_wasm_load_synthdef(this.world, defPtr, synthdefBytes.length, namePtr);

    Module._free(defPtr);
    Module._free(namePtr);

    if (result !== 0) {
      throw new Error(`Failed to load synthdef: ${name}`);
    }

    this._log(`SynthDef loaded: ${name} (${synthdefBytes.length} bytes)`);
    this.port.postMessage({ type: 'synthdef-loaded', name });
  }

  _synthNew(synthName, args) {
    if (!this.wasmModule || !this.world) {
      throw new Error('WASM not initialized');
    }

    const Module = this.wasmModule;
    const synthId = ++this.synthCounter;

    const namePtr = Module.allocateUTF8(synthName);
    const result = Module._sc_wasm_synth_new(this.world, namePtr, synthId);
    Module._free(namePtr);

    if (result !== 0) {
      throw new Error(`Failed to create synth: ${synthName}`);
    }

    // Apply initial arguments
    for (const [key, value] of Object.entries(args)) {
      this._synthSetValue(synthId, key, value);
    }

    this._log(`Synth created: id=${synthId}, name=${synthName}`);
    this.port.postMessage({ type: 'synth-new', synthId, synthName });
  }

  _synthFree(synthId) {
    if (!this.wasmModule || !this.world) {
      throw new Error('WASM not initialized');
    }

    const result = this.wasmModule._sc_wasm_synth_free(this.world, synthId);
    if (result !== 0) {
      throw new Error(`Failed to free synth: ${synthId}`);
    }

    this._log(`Synth freed: id=${synthId}`);
    this.synthCounter = Math.max(0, this.synthCounter - 1);
  }

  _synthSet(synthId, args) {
    for (const [key, value] of Object.entries(args)) {
      this._synthSetValue(synthId, key, value);
    }
  }

  _synthSetValue(synthId, key, value) {
    if (!this.wasmModule || !this.world) return;

    const Module = this.wasmModule;
    const keyPtr = Module.allocateUTF8(key);
    Module._sc_wasm_synth_set(this.world, synthId, keyPtr, value);
    Module._free(keyPtr);
  }

  process(inputs, outputs, parameters) {
    if (!this.wasmModule || !this.world || !this.outputBuffer) {
      // No output yet; return silence
      for (let ch = 0; ch < outputs[0].length; ch++) {
        outputs[0][ch].fill(0);
      }
      return true; // Keep processor alive
    }

    const Module = this.wasmModule;
    const outputChannels = outputs[0];
    const numChannels = Math.min(outputChannels.length, 2); // Support mono/stereo
    const numSamples = outputChannels[0].length; // Usually 128

    try {
      // Render one block from the SC engine
      // Note: sc_wasm_render expects the full output buffer allocated for all channels
      const result = Module._sc_wasm_render(
        this.world,
        this.outputBufferPtr,
        numSamples,
        numChannels
      );

      if (result === 0) {
        // Success; copy from WASM heap to output channels
        let maxLevel = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          const offset = ch * numSamples;
          for (let i = 0; i < numSamples; i++) {
            const sample = this.outputBuffer[offset + i];
            outputChannels[ch][i] = sample;
            maxLevel = Math.max(maxLevel, Math.abs(sample));
          }
        }
        this.meterLevel = maxLevel;
      } else {
        // Render failed; output silence
        for (let ch = 0; ch < numChannels; ch++) {
          outputChannels[ch].fill(0);
        }
      }
    } catch (err) {
      this._log(`Render error: ${err.message}`);
      for (let ch = 0; ch < numChannels; ch++) {
        outputChannels[ch].fill(0);
      }
    }

    return true; // Keep processor alive
  }

  _log(msg) {
    // Send logs to main thread
    this.port.postMessage({ type: 'log', message: msg });
  }
}

registerProcessor('scsynth-processor', SCSynthProcessor);
