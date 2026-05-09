'use strict';

// ---------------------------------------------------------------------------
// AST helpers — construct plain objects that match the parser's AST shape
// ---------------------------------------------------------------------------

function makeNil() {
  return { type: 'atom', value: null };
}

function makeBool(v) {
  return { type: 'atom', value: !!v };
}

function makeList(elems) {
  return { type: 'list', elements: [...elems] };
}

function makeSymbol(name) {
  return { type: 'symbol', name };
}

function isNil(node) {
  if (!node) return true;
  return node.type === 'atom' && node.value === null;
}

function isTruthy(node) {
  if (!node) return false;
  if (node.type === 'atom') return node.value !== null && node.value !== false;
  return true;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'number': return a.value === b.value;
    case 'string': return a.value === b.value;
    case 'atom':   return a.value === b.value;
    case 'symbol': return a.name === b.name;
    case 'list':
      return a.elements.length === b.elements.length &&
        a.elements.every((e, i) => deepEqual(e, b.elements[i]));
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Built-in threading macros defined in scscm source.
// These are loaded at construction time so users never need to re-declare them.
// ---------------------------------------------------------------------------

const STDLIB = `
; ── Threading macros ─────────────────────────────────────────────────────────

(defmacro -> (val . steps)
  (if (null? steps)
    val
    (let ((step (car steps)))
      \`(-> ~(if (symbol? step)
               \`(. ~val ~step)
               \`(~(car step) ~val ~@(cdr step)))
           ~@(cdr steps)))))

(defmacro ->> (val . steps)
  (if (null? steps)
    val
    (let ((step (car steps)))
      \`(->> ~(if (symbol? step)
                \`(~step ~val)
                \`(~(car step) ~@(cdr step) ~val))
            ~@(cdr steps)))))

; ── Sequential evaluation ─────────────────────────────────────────────────────

(defmacro do (. body)
  \`((fn () ~@body)))

; ── Control flow ──────────────────────────────────────────────────────────────

(defmacro when (c . body)
  \`(if ~c (do ~@body) nil))

(defmacro unless (c . body)
  \`(if (. ~c not) (do ~@body) nil))

; ── Iteration ─────────────────────────────────────────────────────────────────

(defmacro doseq (binding . body)
  (let ((sym  (car binding))
        (coll (car (cdr binding))))
    \`(. ~coll do (fn (~sym) ~@body))))

(defmacro dotimes (binding . body)
  (let ((sym (car binding))
        (n   (car (cdr binding))))
    \`(. ~n do (fn (~sym) ~@body))))

; ── Collection transforms ─────────────────────────────────────────────────────

(defmacro collect (binding . body)
  (let ((sym  (car binding))
        (coll (car (cdr binding))))
    \`(. ~coll collect (fn (~sym) ~@body))))

(defmacro icollect (binding . body)
  (let ((sym  (car binding))
        (coll (car (cdr binding))))
    \`(. ~coll collect (fn (~sym) ~@body))))

(defmacro accumulate (binding . body)
  (let ((acc  (car binding))
        (init (car (cdr binding)))
        (sym  (car (cdr (cdr binding))))
        (coll (car (cdr (cdr (cdr binding))))))
    \`(. ~coll inject ~init (fn (~acc ~sym) ~@body))))

; ── Function helpers ──────────────────────────────────────────────────────────

(defmacro comp (. fns)
  (if (null? fns)
    \`(fn (__x) __x)
    (if (null? (cdr fns))
      (car fns)
      (let ((f    (car fns))
            (rest (cdr fns)))
        \`(fn (__x) (~f ((comp ~@rest) __x)))))))

(defmacro partial (f . fixed-args)
  \`(fn (. __extra)
     (. ~f valueArray (. (list ~@fixed-args) ++ __extra))))

; ── SuperCollider shorthands ──────────────────────────────────────────────────

(defmacro defsynth (name params . body)
  (let ((name-str (symbol->string name)))
    \`(SynthDef ~name-str (fn ~params ~@body))))

(defmacro definst (name params . body)
  (let ((name-str (symbol->string name)))
    \`(do
       (. (SynthDef ~name-str (fn ~params (Out.ar 0 (. (do ~@body) dup 2)))) add)
       (set! ~name (fn (. __args) (Synth ~name-str __args))))))

(defmacro routine (. body)
  \`(. (Routine (fn () ~@body)) play))

(defmacro wait (n)
  \`(. ~n wait))

(defmacro pbind (. pairs)
  \`(.dot Pbind new (list ~@pairs)))

(defmacro pseq (items repeats)
  \`(.dot Pseq new ~items ~repeats))

(defmacro prand (items repeats)
  \`(.dot Prand new ~items ~repeats))

(defmacro pwhite (lo hi repeats)
  \`(.dot Pwhite new ~lo ~hi ~repeats))

(defmacro pgeom (start grow repeats)
  \`(.dot Pgeom new ~start ~grow ~repeats))

(defmacro ctl (node . pairs)
  \`(. ~node set ~@pairs))

(defmacro kill (node)
  \`(. ~node free))

; ── Overtone-style API ────────────────────────────────────────────────────────

(defmacro now ()
  \`(. (.dot TempoClock default) beats))

(defmacro metronome (bpm)
  \`(.dot TempoClock new (/ ~bpm 60)))

(defmacro at (time . body)
  \`(. (.dot TempoClock default) schedAbs ~time (fn () ~@body)))

(defmacro in (delay . body)
  \`(. (.dot TempoClock default) sched ~delay (fn () ~@body)))

(defmacro demo (dur . body)
  \`(. (fn ()
        (var __sig (do ~@body))
        (var __env (EnvGen.kr (.dot Env new (list 1 0) (list ~dur)) (dict :doneAction 2)))
        (Out.ar 0 (* (* __sig __env) (list 1 1))))
      play))

(defmacro midi->hz (note)
  \`(. ~note midicps))

(defmacro hz->midi (freq)
  \`(. ~freq cpsmidi))

(defmacro db->amp (db)
  \`(. ~db dbamp))

(defmacro amp->db (amp)
  \`(. ~amp ampdb))

(defmacro adsr (gate attack decay sustain release)
  \`(EnvGen.kr (.dot Env adsr ~attack ~decay ~sustain ~release) ~gate (dict :doneAction 2)))

(defmacro perc (attack release)
  \`(EnvGen.kr (.dot Env perc ~attack ~release) (dict :doneAction 2)))

(defmacro env-line (attack sustain release)
  \`(EnvGen.kr (.dot Env new (list 0 1 1 0) (list ~attack ~sustain ~release)) (dict :doneAction 2)))

(defmacro chord (root quality)
  \`(.dot Chord basicNew ~root ~quality))

(defmacro degrees->pitches (degrees scale root)
  \`(. (. (.dot Scale ~scale) degreeToKey ~degrees) + ~root))
`;

// ---------------------------------------------------------------------------
// MacroExpander
// ---------------------------------------------------------------------------

class MacroExpander {
  constructor() {
    this.macros = new Map();
    this._gensymCounter = 0;
    this._builtins = this._setupBuiltins();
    this._loadStdlib();
  }

  // -------------------------------------------------------------------------
  // Built-in functions available during macro evaluation
  // -------------------------------------------------------------------------

  _setupBuiltins() {
    const self = this;
    const builtin = (fn) => ({ type: 'builtin', fn });

    return {
      'null?':    builtin(([x]) => makeBool(
                    isNil(x) || (x.type === 'list' && x.elements.length === 0)
                  )),
      'symbol?':  builtin(([x]) => makeBool(x && x.type === 'symbol')),
      'pair?':    builtin(([x]) => makeBool(x && x.type === 'list' && x.elements.length > 0)),
      'list?':    builtin(([x]) => makeBool(x && x.type === 'list')),
      'number?':  builtin(([x]) => makeBool(x && x.type === 'number')),
      'string?':  builtin(([x]) => makeBool(x && x.type === 'string')),

      'car': builtin(([x]) => {
        if (!x || x.type !== 'list' || x.elements.length === 0)
          throw new Error('car: not a pair');
        return x.elements[0];
      }),
      'cdr': builtin(([x]) => {
        if (!x || x.type !== 'list')
          throw new Error('cdr: not a list');
        return makeList(x.elements.slice(1));
      }),
      'cons': builtin(([a, b]) => {
        if (b && b.type === 'list') return makeList([a, ...b.elements]);
        return makeList([a]);
      }),
      'list':   builtin((args) => makeList(args)),
      'append': builtin((args) => makeList(args.flatMap(a =>
                  a.type === 'list' ? a.elements : []
                ))),
      'length': builtin(([x]) => ({
                  type: 'number',
                  value: x && x.type === 'list' ? x.elements.length : 0,
                })),

      'not':    builtin(([x]) => makeBool(!isTruthy(x))),
      'equal?': builtin(([a, b]) => makeBool(deepEqual(a, b))),

      'gensym': builtin(() => makeSymbol(`__g${self._gensymCounter++}__`)),

      'error': builtin(([msg]) => {
        throw new Error(
          msg && msg.type === 'string' ? msg.value : 'macro error'
        );
      }),

      'symbol->string': builtin(([x]) => ({
        type: 'string',
        value: x && x.type === 'symbol' ? x.name : String(x && x.value),
      })),
      'string->symbol': builtin(([x]) => makeSymbol(
        x && x.type === 'string' ? x.value : String(x && x.value)
      )),
    };
  }

  // -------------------------------------------------------------------------
  // Load stdlib (-> and ->>) from scscm source
  // -------------------------------------------------------------------------

  _loadStdlib() {
    const { Lexer }  = require('./lhc_lexer');
    const { Parser } = require('./lhc_parser');
    const tokens = new Lexer(STDLIB).tokenize();
    const ast    = new Parser(tokens).parse();
    for (const expr of ast) {
      if (
        expr.type === 'list' &&
        expr.elements.length > 0 &&
        expr.elements[0].type === 'symbol' &&
        expr.elements[0].name === 'defmacro'
      ) {
        this._registerMacro(expr.elements.slice(1));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Parse (a b . rest) style parameter lists
  // -------------------------------------------------------------------------

  _parseParamSpec(paramList) {
    if (!paramList || paramList.type !== 'list') {
      return { params: [], restParam: null };
    }
    const elements = paramList.elements;
    const dotIdx = elements.findIndex(
      (e) => e.type === 'symbol' && e.name === '.'
    );
    if (dotIdx >= 0) {
      if (dotIdx + 1 >= elements.length)
        throw new Error('defmacro: dot notation requires a symbol after the dot');
      return {
        params:    elements.slice(0, dotIdx).map((e) => e.name),
        restParam: elements[dotIdx + 1].name,
      };
    }
    return {
      params:    elements.map((e) => e.name),
      restParam: null,
    };
  }

  // -------------------------------------------------------------------------
  // Register a defmacro definition
  // -------------------------------------------------------------------------

  _registerMacro(args) {
    if (args.length < 2)
      throw new Error('defmacro requires a name, a parameter list, and a body');
    const name = args[0].name;
    const { params, restParam } = this._parseParamSpec(args[1]);
    const body = args.slice(2);
    this.macros.set(name, { params, restParam, body });
  }

  // -------------------------------------------------------------------------
  // Apply a registered macro: bind args, evaluate body, return AST node
  // -------------------------------------------------------------------------

  _applyMacro(name, argNodes) {
    const { params, restParam, body } = this.macros.get(name);
    const env = {};
    for (let i = 0; i < params.length; i++) {
      env[params[i]] = argNodes[i] !== undefined ? argNodes[i] : makeNil();
    }
    if (restParam !== null) {
      env[restParam] = makeList(argNodes.slice(params.length));
    }
    let result = makeNil();
    for (const expr of body) {
      result = this.eval(expr, env);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Evaluator — evaluates scscm AST nodes in the macro environment
  // -------------------------------------------------------------------------

  eval(expr, env) {
    if (!expr) return makeNil();

    switch (expr.type) {
      case 'number':
      case 'string':
        return expr;

      case 'atom':
        return expr;

      case 'symbol': {
        const n = expr.name;
        if (Object.prototype.hasOwnProperty.call(env, n)) return env[n];
        if (n === 'nil')   return makeNil();
        if (n === 'true')  return makeBool(true);
        if (n === 'false') return makeBool(false);
        if (n in this._builtins) return this._builtins[n];
        // Unknown symbol: treat as a literal symbol (sclang identifier)
        return expr;
      }

      case 'quote':
        return expr.expr;

      case 'quasiquote':
        return this.evalQuasiquote(expr.expr, env);

      case 'unquote':
        // Top-level unquote outside a quasiquote — just evaluate
        return this.eval(expr.expr, env);

      case 'list':
        return this.evalList(expr, env);

      case 'vector':
        return makeList(expr.elements.map((e) => this.eval(e, env)));

      default:
        return expr;
    }
  }

  evalList(expr, env) {
    const { elements } = expr;
    if (elements.length === 0) return makeList([]);

    const head = elements[0];

    if (head.type === 'symbol') {
      const n = head.name;

      // --- Special forms ---

      if (n === 'if') {
        const cond = this.eval(elements[1], env);
        if (isTruthy(cond)) {
          return this.eval(elements[2], env);
        }
        return elements[3] ? this.eval(elements[3], env) : makeNil();
      }

      if (n === 'let') {
        const bindings = elements[1];
        const body     = elements.slice(2);
        const newEnv   = Object.assign({}, env);
        for (const binding of (bindings ? bindings.elements : [])) {
          const bname = binding.elements[0].name;
          const bval  = this.eval(binding.elements[1], newEnv);
          newEnv[bname] = bval;
        }
        let result = makeNil();
        for (const e of body) result = this.eval(e, newEnv);
        return result;
      }

      if (n === 'fn') {
        const paramList = elements[1];
        const body      = elements.slice(2);
        const { params, restParam } = this._parseParamSpec(paramList);
        return { type: 'closure', params, restParam, body, capturedEnv: Object.assign({}, env) };
      }

      if (n === 'quote') return elements[1];

      if (n === 'quasiquote') return this.evalQuasiquote(elements[1], env);

      if (n === 'and') {
        for (let i = 1; i < elements.length; i++) {
          if (!isTruthy(this.eval(elements[i], env))) return makeBool(false);
        }
        return makeBool(true);
      }

      if (n === 'or') {
        for (let i = 1; i < elements.length; i++) {
          const v = this.eval(elements[i], env);
          if (isTruthy(v)) return v;
        }
        return makeBool(false);
      }
    }

    // --- Function call ---
    const fn   = this.eval(head, env);
    const args = elements.slice(1).map((a) => this.eval(a, env));
    return this.applyFn(fn, args);
  }

  // -------------------------------------------------------------------------
  // Quasi-quote evaluation: handles ~ (unquote) and ~@ (unquote-splicing)
  // -------------------------------------------------------------------------

  evalQuasiquote(expr, env) {
    if (!expr) return makeNil();

    if (expr.type === 'list') {
      const result = [];
      for (const elem of expr.elements) {
        if (elem.type === 'unquote') {
          result.push(this.eval(elem.expr, env));
        } else if (elem.type === 'unquote-splicing') {
          const val = this.eval(elem.expr, env);
          if (val.type === 'list') {
            result.push(...val.elements);
          } else if (!isNil(val)) {
            result.push(val);
          }
        } else {
          result.push(this.evalQuasiquote(elem, env));
        }
      }
      return makeList(result);
    }

    if (expr.type === 'vector') {
      const result = [];
      for (const elem of expr.elements) {
        if (elem.type === 'unquote') {
          result.push(this.eval(elem.expr, env));
        } else if (elem.type === 'unquote-splicing') {
          const val = this.eval(elem.expr, env);
          if (val.type === 'list') result.push(...val.elements);
        } else {
          result.push(this.evalQuasiquote(elem, env));
        }
      }
      return { type: 'vector', elements: result };
    }

    if (expr.type === 'unquote') {
      return this.eval(expr.expr, env);
    }

    // Nested quasiquote or other node types: return as-is
    return expr;
  }

  applyFn(fn, args) {
    if (fn.type === 'builtin') return fn.fn(args);

    if (fn.type === 'closure') {
      const callEnv = Object.assign({}, fn.capturedEnv);
      for (let i = 0; i < fn.params.length; i++) {
        callEnv[fn.params[i]] = args[i] !== undefined ? args[i] : makeNil();
      }
      if (fn.restParam !== null) {
        callEnv[fn.restParam] = makeList(args.slice(fn.params.length));
      }
      let result = makeNil();
      for (const expr of fn.body) result = this.eval(expr, callEnv);
      return result;
    }

    throw new Error(`Not a function: ${JSON.stringify(fn)}`);
  }

  // -------------------------------------------------------------------------
  // Macro expansion pass — runs over an AST before code generation
  // -------------------------------------------------------------------------

  expandExpr(expr) {
    if (!expr || expr.type !== 'list' || expr.elements.length === 0) return expr;

    const head = expr.elements[0];

    if (head.type === 'symbol') {
      const n = head.name;

      // defmacro: register and remove from output
      if (n === 'defmacro') {
        this._registerMacro(expr.elements.slice(1));
        return null;
      }

      // User-defined (or stdlib) macro call: expand recursively until stable
      if (this.macros.has(n)) {
        const expanded = this._applyMacro(n, expr.elements.slice(1));
        return this.expandExpr(expanded);
      }
    }

    // Recursively expand sub-expressions
    const newElements = [];
    for (const elem of expr.elements) {
      const expanded = this.expandExpr(elem);
      if (expanded !== null) newElements.push(expanded);
    }
    return Object.assign({}, expr, { elements: newElements });
  }

  expand(ast) {
    const result = [];
    for (const expr of ast) {
      const expanded = this.expandExpr(expr);
      if (expanded !== null) result.push(expanded);
    }
    return result;
  }
}

module.exports = { MacroExpander };
