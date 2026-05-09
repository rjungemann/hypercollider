/**
 * PresetManager — save/recall/undo named synth states in the browser IDE.
 *
 * Presets are persisted in IndexedDB (`hc_presets` database).
 * Each preset stores: name, code (SC expression), synthDefName, params {}, createdAt.
 *
 * Undo/redo is a client-side ring buffer (max 50 entries) of arbitrary state
 * objects pushed by the caller.  The IDE uses it to restore the code that was
 * in the editor before a preset was loaded.
 *
 * Usage:
 *   const pm = new PresetManager();
 *   pm.onPresetsChanged = () => renderList();
 *   pm.save('kick', { code: 'Synth("kick", [\\amp, 0.8])', synthDefName: 'kick', params: { amp: 0.8 } });
 *   const preset = pm.load('kick');  // → { name, code, synthDefName, params, createdAt }
 *   pm.delete('kick');
 *   pm.list();                       // → [{ name, code, ... }, ...]
 *   const json = pm.exportAll();     // JSON string
 *   pm.importAll(json);
 *   pm.pushUndo({ code: '...' });
 *   const prev = pm.undo();          // null when stack is exhausted
 *   const next = pm.redo();
 */
class PresetManager {
  constructor() {
    this._db = null;
    this._presets = new Map();
    this._undoStack = [];
    this._undoIndex = -1;
    this.onPresetsChanged = null;
    this._initDb();
  }

  _initDb() {
    if (typeof indexedDB === 'undefined') return;
    const req = indexedDB.open('hc_presets', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('presets', { keyPath: 'name' });
    };
    req.onsuccess = (e) => {
      this._db = e.target.result;
      this._loadFromDb();
    };
    req.onerror = () => {};
  }

  _loadFromDb() {
    if (!this._db) return;
    const req = this._db.transaction('presets', 'readonly').objectStore('presets').getAll();
    req.onsuccess = (e) => {
      for (const preset of e.target.result) this._presets.set(preset.name, preset);
      if (this.onPresetsChanged) this.onPresetsChanged();
    };
  }

  _dbPut(preset) {
    if (!this._db) return;
    this._db.transaction('presets', 'readwrite').objectStore('presets').put(preset);
  }

  _dbDelete(name) {
    if (!this._db) return;
    this._db.transaction('presets', 'readwrite').objectStore('presets').delete(name);
  }

  save(name, { code = '', synthDefName = '', params = {} } = {}) {
    const preset = { name, code, synthDefName, params, createdAt: Date.now() };
    this._presets.set(name, preset);
    this._dbPut(preset);
    if (this.onPresetsChanged) this.onPresetsChanged();
  }

  load(name) {
    return this._presets.get(name) || null;
  }

  delete(name) {
    const had = this._presets.delete(name);
    if (had) {
      this._dbDelete(name);
      if (this.onPresetsChanged) this.onPresetsChanged();
    }
    return had;
  }

  list() {
    return [...this._presets.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  exportAll() {
    return JSON.stringify(this.list(), null, 2);
  }

  importAll(json) {
    let records;
    try { records = JSON.parse(json); } catch (_) { throw new Error('Invalid JSON'); }
    if (!Array.isArray(records)) throw new Error('Expected an array of presets');
    for (const r of records) {
      if (!r || typeof r.name !== 'string') continue;
      const preset = {
        name: r.name,
        code: r.code || '',
        synthDefName: r.synthDefName || '',
        params: r.params || {},
        createdAt: r.createdAt || Date.now(),
      };
      this._presets.set(preset.name, preset);
      this._dbPut(preset);
    }
    if (this.onPresetsChanged) this.onPresetsChanged();
  }

  // Undo/redo — caller pushes arbitrary state objects; ring buffer depth = 50.
  pushUndo(state) {
    if (this._undoIndex < this._undoStack.length - 1) {
      this._undoStack.splice(this._undoIndex + 1);
    }
    this._undoStack.push(state);
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._undoIndex = this._undoStack.length - 1;
  }

  undo() {
    if (this._undoIndex > 0) return this._undoStack[--this._undoIndex];
    return null;
  }

  redo() {
    if (this._undoIndex < this._undoStack.length - 1) return this._undoStack[++this._undoIndex];
    return null;
  }

  canUndo() { return this._undoIndex > 0; }
  canRedo() { return this._undoIndex < this._undoStack.length - 1; }
}
