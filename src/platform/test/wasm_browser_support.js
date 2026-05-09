'use strict';

(function attachBrowserSupport(globalThisRef) {
  function formatError(err) {
    if (!err) return 'unknown error';
    return String(err.message || err.name || err);
  }

  function createDisabledMidiBridge(reason) {
    return {
      provider: 'none',
      reason,
      async prepare() { return false; },
      async requestSysexAccess() { return false; },
      init() { return -1; },
      initClient() { return -1; },
      disposeClient() { return 0; },
      restart() { return -1; },
      listEndpoints() { return { sources: [], destinations: [] }; },
      connectInput() { return -1; },
      disconnectInput() { return 0; },
      sendShort() { return -1; },
      sendSysexFromHeap() { return -1; },
    };
  }

  function ensureDir(FS, mountPoint) {
    try {
      FS.mkdir(mountPoint);
    } catch (err) {
      const message = formatError(err);
      if (!message.includes('File exists') && !message.includes('exists')) {
        throw err;
      }
    }
  }

  async function setupPersistentFilesystem(moduleInstance, options = {}) {
    const mountPoint = options.mountPoint || '/sc_persist';
    const out = {
      enabled: false,
      backend: 'none',
      mountPoint,
      reason: '',
      synced: false,
    };

    if (!moduleInstance || !moduleInstance.FS || !moduleInstance.IDBFS) {
      out.reason = 'FS/IDBFS runtime methods are unavailable in this build';
      return out;
    }
    if (typeof indexedDB === 'undefined') {
      out.reason = 'IndexedDB is unavailable in this browser context';
      return out;
    }
    if (moduleInstance.__sc_persistent_fs_state && moduleInstance.__sc_persistent_fs_state.enabled) {
      return moduleInstance.__sc_persistent_fs_state;
    }

    const FS = moduleInstance.FS;
    ensureDir(FS, mountPoint);

    try {
      FS.mount(moduleInstance.IDBFS, { autoPersist: true }, mountPoint);
    } catch (err) {
      const message = formatError(err);
      if (!message.includes('busy') && !message.includes('already mounted')) {
        throw err;
      }
    }

    await new Promise((resolve, reject) => {
      FS.syncfs(true, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    if (typeof moduleInstance._sc_wasm_diskio_backend_configure_idbfs === 'function') {
      moduleInstance.ccall('sc_wasm_diskio_backend_configure_idbfs', null, ['string'], [mountPoint]);
    } else if (typeof moduleInstance.ccall === 'function') {
      try {
        moduleInstance.ccall('sc_wasm_diskio_backend_configure_idbfs', null, ['string'], [mountPoint]);
      } catch (_) {
        // Ignore modules that do not expose the scsynth DiskIO backend symbol.
      }
    }

    out.enabled = true;
    out.backend = 'idbfs';
    out.synced = true;
    moduleInstance.__sc_persistent_fs_state = out;

    if (!moduleInstance.__sc_persistent_fs_flush_bound && globalThisRef.addEventListener) {
      const flush = () => {
        try {
          FS.syncfs(false, () => {});
        } catch (_) {
          // Best-effort flush only.
        }
      };
      globalThisRef.addEventListener('beforeunload', flush);
      moduleInstance.__sc_persistent_fs_flush_bound = true;
    }

    return out;
  }

  async function flushPersistentFilesystem(moduleInstance) {
    if (!moduleInstance || !moduleInstance.FS || !moduleInstance.__sc_persistent_fs_state) {
      return false;
    }
    await new Promise((resolve, reject) => {
      moduleInstance.FS.syncfs(false, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    return true;
  }

  function createBrowserMidiBridge(moduleInstance, logger = console) {
    if (!globalThisRef.navigator || typeof globalThisRef.navigator.requestMIDIAccess !== 'function') {
      return createDisabledMidiBridge('Web MIDI API is unavailable in this browser');
    }

    const state = {
      midiAccess: null,
      accessPromise: null,
      sysexEnabled: false,
      inputPorts: [],
      outputPorts: [],
      connectedInputs: new Map(),
      lastReason: '',
    };

    function refreshPorts() {
      if (!state.midiAccess) {
        state.inputPorts = [];
        state.outputPorts = [];
        return;
      }
      state.inputPorts = Array.from(state.midiAccess.inputs.values());
      state.outputPorts = Array.from(state.midiAccess.outputs.values());
    }

    async function prepare(options = {}) {
      const wantSysex = !!options.sysex;
      if (state.midiAccess && (!wantSysex || state.sysexEnabled)) {
        refreshPorts();
        return true;
      }
      if (state.accessPromise) {
        return state.accessPromise;
      }

      state.accessPromise = globalThisRef.navigator.requestMIDIAccess({ sysex: wantSysex })
        .then((access) => {
          state.midiAccess = access;
          state.sysexEnabled = wantSysex;
          refreshPorts();
          if (logger && typeof logger.info === 'function') {
            logger.info(`Web MIDI ready${wantSysex ? ' (SysEx enabled)' : ''}`);
          }
          return true;
        })
        .catch((err) => {
          state.lastReason = formatError(err);
          if (logger && typeof logger.warn === 'function') {
            logger.warn(`Web MIDI unavailable: ${state.lastReason}`);
          }
          return false;
        })
        .finally(() => {
          state.accessPromise = null;
        });

      return state.accessPromise;
    }

    function listPorts(kind) {
      refreshPorts();
      const ports = kind === 'input' ? state.inputPorts : state.outputPorts;
      return ports.map((port, index) => {
        const name = String(port.name || `${kind}-${index}`);
        const manufacturer = port.manufacturer ? `${port.manufacturer} ` : '';
        return {
          id: index,
          name,
          device: `${manufacturer}${name}`.trim(),
        };
      });
    }

    function dispatchShort(src, status, data1, data2) {
      if (typeof moduleInstance._sc_wasm_midi_receive_short !== 'function') return;
      moduleInstance._sc_wasm_midi_receive_short(src | 0, status | 0, data1 | 0, data2 | 0);
    }

    function dispatchSysex(src, bytes) {
      if (typeof moduleInstance._sc_wasm_midi_receive_sysex !== 'function') return;
      const ptr = moduleInstance._malloc(bytes.length);
      try {
        moduleInstance.HEAPU8.set(bytes, ptr);
        moduleInstance._sc_wasm_midi_receive_sysex(src | 0, ptr | 0, bytes.length | 0);
      } finally {
        moduleInstance._free(ptr);
      }
    }

    return {
      provider: 'web-midi',
      async prepare() { return prepare({ sysex: false }); },
      async requestSysexAccess() { return prepare({ sysex: true }); },
      init() { return state.midiAccess ? 0 : -1; },
      initClient() { return state.midiAccess ? 0 : -1; },
      disposeClient() {
        for (const [uid, port] of state.connectedInputs.entries()) {
          port.onmidimessage = null;
          try { port.close(); } catch (_) {}
          state.connectedInputs.delete(uid);
        }
        return 0;
      },
      restart() {
        this.disposeClient();
        refreshPorts();
        return state.midiAccess ? 0 : -1;
      },
      listEndpoints() {
        return {
          sources: listPorts('input'),
          destinations: listPorts('output'),
        };
      },
      connectInput(_inport, uid) {
        refreshPorts();
        const port = state.inputPorts[uid | 0];
        if (!port) return -1;
        port.onmidimessage = (event) => {
          const data = Array.from(event.data || []);
          if (data.length > 3 && data[0] === 0xF0) {
            dispatchSysex(uid, Uint8Array.from(data));
            return;
          }
          dispatchShort(uid, data[0] || 0, data[1] || 0, data[2] || 0);
        };
        try { port.open(); } catch (_) {}
        state.connectedInputs.set(uid, port);
        return 0;
      },
      disconnectInput(_inport, uid) {
        const port = state.connectedInputs.get(uid | 0);
        if (!port) return 0;
        port.onmidimessage = null;
        try { port.close(); } catch (_) {}
        state.connectedInputs.delete(uid | 0);
        return 0;
      },
      sendShort(uid, len, hiStatus, loStatus, a, b) {
        refreshPorts();
        const port = state.outputPorts[uid | 0];
        if (!port) return -1;
        const status = ((((hiStatus | 0) & 0xF0) | ((loStatus | 0) & 0x0F)) & 0xFF);
        const bytes = [status];
        if ((len | 0) >= 2) bytes.push((a | 0) & 0x7F);
        if ((len | 0) >= 3) bytes.push((b | 0) & 0x7F);
        try {
          port.send(bytes);
          return 0;
        } catch (_) {
          return -1;
        }
      },
      sendSysexFromHeap(uid, ptr, len) {
        if (!state.sysexEnabled) return -1;
        refreshPorts();
        const port = state.outputPorts[uid | 0];
        if (!port) return -1;
        try {
          const bytes = Array.from(new Uint8Array(moduleInstance.HEAPU8.buffer, ptr >>> 0, len >>> 0));
          port.send(bytes);
          return 0;
        } catch (_) {
          return -1;
        }
      },
    };
  }

  function attachBrowserMidiBridge(moduleInstance, logger) {
    const bridge = createBrowserMidiBridge(moduleInstance, logger);
    moduleInstance.__sc_wasm_midi_bridge = bridge;
    globalThisRef.__sc_wasm_midi_bridge = bridge;
    globalThisRef.__sc_prepare_midi_from_user_gesture = async () => {
      if (bridge && typeof bridge.prepare === 'function') {
        return bridge.prepare();
      }
      return false;
    };
    globalThisRef.__sc_request_midi_sysex_from_user_gesture = async () => {
      if (bridge && typeof bridge.requestSysexAccess === 'function') {
        return bridge.requestSysexAccess();
      }
      return false;
    };
    return bridge;
  }

  globalThisRef.SCWasmBrowserSupport = {
    setupPersistentFilesystem,
    flushPersistentFilesystem,
    attachBrowserMidiBridge,
  };
})(globalThis);
