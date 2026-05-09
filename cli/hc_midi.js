'use strict';

function createDisabledBridge(reason) {
  return {
    provider: 'none',
    reason,
    init() { return 0; },
    initClient() { return -1; },
    disposeClient() { return 0; },
    restart() { return 0; },
    listEndpoints() {
      return { sources: [], destinations: [] };
    },
    connectInput() { return -1; },
    disconnectInput() { return 0; },
    sendShort() { return -1; },
    sendSysexFromHeap() { return -1; },
  };
}

function createNodeMidiBridge(moduleInstance, logger) {
  let midiPkg;
  try {
    midiPkg = require('midi');
  } catch (e) {
    return createDisabledBridge("npm package 'midi' is not installed");
  }

  const inputHandles = new Map();
  const outputHandles = new Map();

  function closeInput(uid) {
    const handle = inputHandles.get(uid);
    if (!handle) return;
    try {
      handle.closePort();
    } catch (_) {
      // ignore close failures
    }
    inputHandles.delete(uid);
  }

  function closeOutput(uid) {
    const handle = outputHandles.get(uid);
    if (!handle) return;
    try {
      handle.closePort();
    } catch (_) {
      // ignore close failures
    }
    outputHandles.delete(uid);
  }

  function ensureOutput(uid) {
    let out = outputHandles.get(uid);
    if (out) return out;

    out = new midiPkg.Output();
    out.openPort(uid);
    outputHandles.set(uid, out);
    return out;
  }

  const hooks = { onBeforeDispatch: null };

  function dispatchShort(src, status, data1, data2) {
    if (hooks.onBeforeDispatch && hooks.onBeforeDispatch(src, status, data1, data2)) return;
    if (typeof moduleInstance._hc_wasm_midi_receive_short !== 'function') return;
    try {
      moduleInstance._hc_wasm_midi_receive_short(src | 0, status | 0, data1 | 0, data2 | 0);
    } catch (e) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`MIDI inbound dispatch failed: ${e.message || e}`);
      }
    }
  }

  return {
    provider: 'node-midi',
    setOnBeforeDispatch(fn) { hooks.onBeforeDispatch = fn; },

    init(_numIn, _numOut) {
      return 0;
    },

    initClient() {
      return 0;
    },

    disposeClient() {
      for (const uid of Array.from(inputHandles.keys())) closeInput(uid);
      for (const uid of Array.from(outputHandles.keys())) closeOutput(uid);
      return 0;
    },

    restart() {
      return this.disposeClient();
    },

    listEndpoints() {
      const srcReader = new midiPkg.Input();
      const dstReader = new midiPkg.Output();
      const sources = [];
      const destinations = [];

      try {
        const inCount = srcReader.getPortCount();
        for (let i = 0; i < inCount; i++) {
          const name = String(srcReader.getPortName(i) || `input-${i}`);
          sources.push({ id: i, name, device: name });
        }
      } finally {
        try { srcReader.closePort(); } catch (_) { /* ignore */ }
      }

      try {
        const outCount = dstReader.getPortCount();
        for (let i = 0; i < outCount; i++) {
          const name = String(dstReader.getPortName(i) || `output-${i}`);
          destinations.push({ id: i, name, device: name });
        }
      } finally {
        try { dstReader.closePort(); } catch (_) { /* ignore */ }
      }

      return { sources, destinations };
    },

    connectInput(_inport, uid) {
      try {
        closeInput(uid);
        const input = new midiPkg.Input();
        input.ignoreTypes(false, false, false);
        input.on('message', (_deltaTime, msg) => {
          const m = Array.isArray(msg) ? msg : [];
          const status = (m[0] || 0) & 0xff;
          const data1 = (m[1] || 0) & 0xff;
          const data2 = (m[2] || 0) & 0xff;
          dispatchShort(uid, status, data1, data2);
        });
        input.openPort(uid);
        inputHandles.set(uid, input);
        return 0;
      } catch (e) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`MIDI input connect failed for uid=${uid}: ${e.message || e}`);
        }
        return -1;
      }
    },

    disconnectInput(_inport, uid) {
      closeInput(uid);
      return 0;
    },

    sendShort(uid, len, hiStatus, loStatus, a, b, _latency) {
      try {
        const out = ensureOutput(uid);
        const status = (((hiStatus | 0) & 0xf0) | ((loStatus | 0) & 0x0f)) & 0xff;
        const bytes = [status];
        if ((len | 0) >= 2) bytes.push((a | 0) & 0x7f);
        if ((len | 0) >= 3) bytes.push((b | 0) & 0x7f);
        out.sendMessage(bytes);
        return 0;
      } catch (e) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`MIDI output send failed for uid=${uid}: ${e.message || e}`);
        }
        return -1;
      }
    },

    sendSysexFromHeap(uid, ptr, len) {
      try {
        const out = ensureOutput(uid);
        const bytes = Array.from(new Uint8Array(moduleInstance.HEAPU8.buffer, ptr >>> 0, len >>> 0));
        out.sendMessage(bytes);
        return 0;
      } catch (e) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`MIDI sysex send failed for uid=${uid}: ${e.message || e}`);
        }
        return -1;
      }
    },
  };
}

function createMidiBridge(moduleInstance, logger) {
  if (!moduleInstance) {
    return createDisabledBridge('module instance is required');
  }

  const bridge = createNodeMidiBridge(moduleInstance, logger);
  if (bridge.provider === 'none' && logger && typeof logger.warn === 'function') {
    logger.warn(`MIDI bridge disabled: ${bridge.reason}`);
  }
  if (bridge.provider !== 'none' && logger && typeof logger.info === 'function') {
    logger.info(`MIDI bridge enabled: ${bridge.provider}`);
  }
  return bridge;
}

module.exports = {
  createMidiBridge,
};
