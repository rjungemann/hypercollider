'use strict';

const fs = require('node:fs');
const path = require('node:path');

function allocCString(Module, str) {
  const len = Module.lengthBytesUTF8(str);
  const ptr = Module._malloc(len + 1);
  Module.stringToUTF8(str, ptr, len + 1);
  return ptr;
}

async function instantiateEmscriptenModule(jsPath, options) {
  const absPath = path.resolve(jsPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Module JS not found: ${absPath}`);
  }

  const moduleDir = path.dirname(absPath);
  const oldCwd = process.cwd();
  process.chdir(moduleDir);
  try {
    const Factory = require(absPath);
    return await Factory(options || {});
  } finally {
    process.chdir(oldCwd);
  }
}

function readU32BE(arr, offset) {
  return ((((arr[offset] << 24) >>> 0)
    | (arr[offset + 1] << 16)
    | (arr[offset + 2] << 8)
    | arr[offset + 3]) >>> 0);
}

function readOscString(arr, offset) {
  let end = offset;
  while (end < arr.length && arr[end] !== 0) end++;
  const text = Array.from(arr.subarray(offset, end)).map((b) => String.fromCharCode(b)).join('');
  const next = ((end + 4) & ~3);
  return { text, next };
}

function writeU32BE(arr, offset, val) {
  arr[offset + 0] = (val >>> 24) & 0xFF;
  arr[offset + 1] = (val >>> 16) & 0xFF;
  arr[offset + 2] = (val >>> 8) & 0xFF;
  arr[offset + 3] = val & 0xFF;
}

function writeOscString(arr, offset, str) {
  const bytes = Buffer.from(str, 'utf8');
  let p = offset;
  arr.set(bytes, p);
  p += bytes.length;
  arr[p++] = 0;
  while (p % 4 !== 0) arr[p++] = 0;
  return p - offset;
}

function maybeConvertInternalCommandToOsc(bytesView) {
  if (bytesView.length < 8) return bytesView;
  const cmdInt = readU32BE(bytesView, 0);
  if (cmdInt !== 9) return bytesView;
  const tagsInfo = readOscString(bytesView, 4);
  const tagsStr = tagsInfo.text;
  if (!tagsStr.startsWith(',s')) return bytesView;

  let q = tagsInfo.next;
  const readOscArgString = () => {
    const r = readOscString(bytesView, q);
    q = r.next;
    return r.text;
  };
  const readOscArgInt = () => {
    if (q + 4 > bytesView.length) return null;
    const v = readU32BE(bytesView, q) | 0;
    q += 4;
    return v;
  };
  const readOscArgFloat = () => {
    if (q + 4 > bytesView.length) return null;
    const view = new DataView(bytesView.buffer, bytesView.byteOffset + q, 4);
    const v = view.getFloat32(0, false);
    q += 4;
    return v;
  };

  const synthName = readOscArgString();
  const synthId = readOscArgInt();
  const addAction = readOscArgInt();
  const targetId = readOscArgInt();

  const oscMsg = new Uint8Array(bytesView.length + 32);
  let p = 0;
  p += writeOscString(oscMsg, p, '/s_new');
  p += writeOscString(oscMsg, p, tagsStr);
  p += writeOscString(oscMsg, p, synthName);
  writeU32BE(oscMsg, p, synthId); p += 4;
  writeU32BE(oscMsg, p, addAction); p += 4;
  writeU32BE(oscMsg, p, targetId); p += 4;

  for (let ti = 5; ti < tagsStr.length; ti++) {
    const tag = tagsStr[ti];
    if (tag === 's') {
      const str = readOscArgString();
      p += writeOscString(oscMsg, p, str);
    } else if (tag === 'i') {
      const val = readOscArgInt();
      writeU32BE(oscMsg, p, val); p += 4;
    } else if (tag === 'f') {
      const val = readOscArgFloat();
      const view = new DataView(oscMsg.buffer, oscMsg.byteOffset + p, 4);
      view.setFloat32(0, val, false); p += 4;
    }
  }
  return oscMsg.subarray(0, p);
}

function maybeRewriteDrecvTarget(bytesView) {
  const size = bytesView.length | 0;
  if (size < 32) return bytesView;

  const inspectSlice = bytesView.subarray(0, Math.min(size, 2048));
  if (inspectSlice.length >= 8 && inspectSlice[0] !== 35) {
    const a = readOscString(inspectSlice, 0);
    const t = readOscString(inspectSlice, a.next);
    if (a.text === '/d_recv' && t.text === ',bb') {
      let p = t.next;
      if (p + 4 <= inspectSlice.length) {
        const b1 = readU32BE(inspectSlice, p);
        const b1Padded = ((Math.max(0, b1) + 3) & ~3);
        p += 4 + b1Padded;
        if (p + 4 <= inspectSlice.length) {
          const b2 = readU32BE(inspectSlice, p);
          p += 4;
          if (b2 > 0 && p + b2 <= inspectSlice.length) {
            const msg = inspectSlice.subarray(p, p + b2);
            const cmdInt = (msg.length >= 4) ? readU32BE(msg, 0) : -1;
            if (cmdInt === 9) {
              const tagsInfo = readOscString(msg, 4);
              let q = tagsInfo.next;
              const readOscArgString = () => {
                const r = readOscString(msg, q);
                q = r.next;
                return r.text;
              };
              const readOscArgInt = () => {
                if (q + 4 > msg.length) return null;
                const v = readU32BE(msg, q) | 0;
                q += 4;
                return v;
              };

              if ((tagsInfo.text || '').startsWith(',siii')) {
                readOscArgString();
                readOscArgInt();
                readOscArgInt();
                const targetOffsetInMsg = q;
                const targetId = readOscArgInt();
                if (targetId === 1) {
                  const absTargetOffset = p + targetOffsetInMsg;
                  if (absTargetOffset + 4 <= bytesView.length) {
                    const patched = new Uint8Array(bytesView);
                    patched[absTargetOffset + 0] = 0;
                    patched[absTargetOffset + 1] = 0;
                    patched[absTargetOffset + 2] = 0;
                    patched[absTargetOffset + 3] = 0;
                    return patched;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return bytesView;
}

function setupNativeFsForCli(moduleInstance) {
  const out = {
    enabled: false,
    mountPoint: '/native',
    reason: '',
  };

  const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
  if (!isNode) {
    out.reason = 'not running under Node.js';
    return out;
  }

  if (!moduleInstance || !moduleInstance.FS || !moduleInstance.NODEFS) {
    out.reason = 'FS/NODEFS runtime methods are unavailable in this build';
    return out;
  }

  const FS = moduleInstance.FS;
  try {
    const mountPoint = out.mountPoint;
    const nativeRoot = process.cwd();

    const exists = FS.analyzePath(mountPoint).exists;
    if (!exists) {
      FS.mkdir(mountPoint);
    }

    try {
      FS.mount(moduleInstance.NODEFS, { root: nativeRoot }, mountPoint);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e || '');
      if (!msg.includes('busy') && !msg.includes('already mounted')) {
        throw e;
      }
    }

    if (typeof FS.chdir === 'function') {
      FS.chdir(mountPoint);
    }

    if (typeof moduleInstance._hc_wasm_diskio_backend_configure_nativefs === 'function') {
      const ptr = moduleInstance.allocateUTF8(mountPoint);
      try {
        moduleInstance._hc_wasm_diskio_backend_configure_nativefs(ptr);
      } finally {
        moduleInstance._free(ptr);
      }
    } else if (typeof moduleInstance.ccall === 'function') {
      moduleInstance.ccall('hc_wasm_diskio_backend_configure_nativefs', null, ['string'], [mountPoint]);
    }

    out.enabled = true;
    return out;
  } catch (e) {
    out.reason = String(e && e.message ? e.message : e || 'failed to set up native FS');
    return out;
  }
}

module.exports = {
  allocCString,
  instantiateEmscriptenModule,
  maybeRewriteDrecvTarget,
  maybeConvertInternalCommandToOsc,
  setupNativeFsForCli,
};
