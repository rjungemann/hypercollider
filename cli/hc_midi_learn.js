'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MAP_PATH = path.join(os.homedir(), '.sc_midi_mappings.json');

class MidiLearnManager {
  constructor(evalFn, { mapPath = DEFAULT_MAP_PATH } = {}) {
    this.evalFn = evalFn;
    this.mapPath = mapPath;
    this.mappings = new Map();
    this._load();
  }

  _key(ch, cc) { return `${ch | 0}:${cc | 0}`; }

  _load() {
    try {
      if (fs.existsSync(this.mapPath)) {
        const obj = JSON.parse(fs.readFileSync(this.mapPath, 'utf8'));
        for (const [k, v] of Object.entries(obj)) {
          if (typeof k === 'string' && typeof v === 'string') this.mappings.set(k, v);
        }
      }
    } catch (_) {}
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.mapPath), { recursive: true });
      fs.writeFileSync(this.mapPath, JSON.stringify(Object.fromEntries(this.mappings), null, 2));
    } catch (_) {}
  }

  map(ch, cc, expr) {
    this.mappings.set(this._key(ch, cc), expr);
    this._save();
  }

  unmap(ch, cc) {
    const deleted = this.mappings.delete(this._key(ch, cc));
    if (deleted) this._save();
    return deleted;
  }

  list() {
    const result = [];
    for (const [key, expr] of this.mappings) result.push({ key, expr });
    return result;
  }

  // Intercepts a MIDI message. Evaluates a mapped SC expression when a CC matches.
  // Always returns false — WASM dispatch is not blocked, so SC's own CC handlers still fire.
  process(_src, status, data1, data2) {
    if ((status & 0xF0) !== 0xB0) return false;
    const ch = status & 0x0F;
    const expr = this.mappings.get(this._key(ch, data1));
    if (!expr) return false;
    // ~val is substituted with the CC value (0–127) before evaluation
    const code = expr.replace(/~val/g, String(data2));
    try { this.evalFn(code); } catch (_) {}
    return false;
  }
}

module.exports = { MidiLearnManager, DEFAULT_MAP_PATH };
