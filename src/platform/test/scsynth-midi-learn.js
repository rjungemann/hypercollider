/**
 * MidiLearnBrowser — MIDI CC → SC expression mapping for the browser IDE.
 *
 * Mappings are persisted in IndexedDB (`hc_midi_learn` database).
 * In "learn" mode the next incoming CC event is captured as a new mapping key.
 *
 * Usage:
 *   const learn = new MidiLearnBrowser();
 *   learn.setEvalFn(code => sclangModule._hc_wasm_eval_execute(...));
 *   learn.onMappingsChanged = () => renderMappingList();
 *
 *   // Route Web MIDI CC messages through here:
 *   learn.handleMidiMessage(status, data1, data2);
 *
 *   // Enter learn mode — next CC will be captured for key `"0:7"`, for example:
 *   learn.startLearn((ch, cc) => { console.log(`Captured ch${ch} CC${cc}`); });
 *
 *   learn.map(0, 7, '~freq = (~val / 127) * 2000; x.set(\\freq, ~freq)');
 *   learn.unmap(0, 7);
 *   learn.list(); // → [{ key: '0:7', expr: '...' }, ...]
 */
class MidiLearnBrowser {
  constructor() {
    this._evalFn = null;
    this.mappings = new Map();
    this._learnMode = false;
    this._learnCb = null;
    this._db = null;
    this.onMappingsChanged = null;
    this._initDb();
  }

  setEvalFn(fn) { this._evalFn = fn; }

  _initDb() {
    if (typeof indexedDB === 'undefined') return;
    const req = indexedDB.open('hc_midi_learn', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('mappings', { keyPath: 'key' });
    };
    req.onsuccess = (e) => {
      this._db = e.target.result;
      this._loadFromDb();
    };
    req.onerror = () => {};
  }

  _loadFromDb() {
    if (!this._db) return;
    const req = this._db.transaction('mappings', 'readonly').objectStore('mappings').getAll();
    req.onsuccess = (e) => {
      for (const { key, expr } of e.target.result) this.mappings.set(key, expr);
      if (this.onMappingsChanged) this.onMappingsChanged();
    };
  }

  _dbPut(key, expr) {
    if (!this._db) return;
    this._db.transaction('mappings', 'readwrite').objectStore('mappings').put({ key, expr });
  }

  _dbDelete(key) {
    if (!this._db) return;
    this._db.transaction('mappings', 'readwrite').objectStore('mappings').delete(key);
  }

  _key(ch, cc) { return `${ch}:${cc}`; }

  map(ch, cc, expr) {
    const key = this._key(ch, cc);
    this.mappings.set(key, expr);
    this._dbPut(key, expr);
    if (this.onMappingsChanged) this.onMappingsChanged();
  }

  unmap(ch, cc) {
    const key = this._key(ch, cc);
    const had = this.mappings.delete(key);
    if (had) {
      this._dbDelete(key);
      if (this.onMappingsChanged) this.onMappingsChanged();
    }
    return had;
  }

  list() {
    const result = [];
    for (const [key, expr] of this.mappings) result.push({ key, expr });
    return result;
  }

  // Enter learn mode. When the next CC arrives, `callback(ch, cc)` is called and learn mode exits.
  startLearn(callback) {
    this._learnMode = true;
    this._learnCb = callback;
  }

  cancelLearn() {
    this._learnMode = false;
    this._learnCb = null;
  }

  isLearning() { return this._learnMode; }

  // Call from a Web MIDI onmidimessage or similar handler.
  handleMidiMessage(status, data1, data2) {
    if ((status & 0xF0) !== 0xB0) return;
    const ch = status & 0x0F;
    const cc = data1;
    const val = data2;

    if (this._learnMode) {
      const cb = this._learnCb;
      this._learnMode = false;
      this._learnCb = null;
      if (cb) cb(ch, cc);
      return;
    }

    const expr = this.mappings.get(this._key(ch, cc));
    if (expr && this._evalFn) {
      const code = expr.replace(/~val/g, String(val));
      try { this._evalFn(code); } catch (_) {}
    }
  }
}
