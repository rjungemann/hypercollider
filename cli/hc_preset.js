'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PRESET_DIR = path.join(os.homedir(), '.sc_presets');

/**
 * CLI preset manager — persists named SC code snippets as JSON files in a
 * directory (default ~/.sc_presets/).
 *
 * Each preset: { name, code, synthDefName, params, createdAt }
 * - code:        SC expression to evaluate when the preset is loaded
 * - synthDefName: optional label / SynthDef name
 * - params:      optional key→value map (informational only)
 *
 * Usage:
 *   const pm = new PresetManager();
 *   pm.save('kick', { code: 'Synth("kick", [\\amp, 0.8])', synthDefName: 'kick' });
 *   const p = pm.load('kick');   // → { name, code, ... }
 *   pm.delete('kick');
 *   pm.list();                   // → [{ name, code, ... }, ...]
 *   pm.exportFile('/tmp/presets.json');
 *   pm.importFile('/tmp/presets.json');  // → count imported
 */
class PresetManager {
  constructor({ dir = DEFAULT_PRESET_DIR } = {}) {
    this._dir = dir;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this._dir)) {
      fs.mkdirSync(this._dir, { recursive: true });
    }
  }

  _filePath(name) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this._dir, `${safeName}.json`);
  }

  save(name, { code = '', synthDefName = '', params = {} } = {}) {
    const preset = { name, code, synthDefName, params, createdAt: Date.now() };
    fs.writeFileSync(this._filePath(name), JSON.stringify(preset, null, 2), 'utf8');
    return preset;
  }

  load(name) {
    try {
      return JSON.parse(fs.readFileSync(this._filePath(name), 'utf8'));
    } catch (_) { return null; }
  }

  delete(name) {
    try { fs.unlinkSync(this._filePath(name)); return true; }
    catch (_) { return false; }
  }

  list() {
    try {
      return fs.readdirSync(this._dir)
        .filter(f => f.endsWith('.json'))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(this._dir, f), 'utf8')); } catch (_) { return null; } })
        .filter(Boolean)
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch (_) { return []; }
  }

  exportFile(destPath) {
    fs.writeFileSync(destPath, JSON.stringify(this.list(), null, 2), 'utf8');
  }

  importFile(srcPath) {
    const records = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    if (!Array.isArray(records)) throw new Error('Expected an array of presets');
    let count = 0;
    for (const r of records) {
      if (!r || typeof r.name !== 'string') continue;
      this.save(r.name, { code: r.code || '', synthDefName: r.synthDefName || '', params: r.params || {} });
      count++;
    }
    return count;
  }
}

module.exports = { PresetManager, DEFAULT_PRESET_DIR };
