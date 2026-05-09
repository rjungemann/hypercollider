# SCSCM Language Features Reference

Macros and special forms beyond the [base spec](SCSCM_SPEC.md). All forms below
are implemented in [`scscm_macros.js`](../../cli/scscm_macros.js) (stdlib) and
[`scscm_codegen.js`](../../cli/scscm_codegen.js). Verified by 142 tests.

For features still in design, see [SCSCM_LANGUAGE_FEATURES_FUTURE.md](SCSCM_LANGUAGE_FEATURES_FUTURE.md).

---

## Clojure-derived

### `when` / `unless`

One-armed conditionals. Expand to `(if test body nil)`.

```scheme
(when (> freq 20) (play freq))    ; → if (freq > 20) { play.value(freq) }
(unless muted (play freq))        ; → if (muted.not) { play.value(freq) }
```

### `do`

Sequence expressions; return the last. Implemented as a macro
(`((fn () ...body)).value()`) rather than a codegen form.

```scheme
(do (set! x 1) (set! y 2) (+ x y))
```

### `doseq` / `dotimes`

Iteration shorthands.

```scheme
(doseq (n (list 440 550 660)) (play n))   ; → [440, 550, 660].do({ |n| play.value(n) })
(dotimes (i 4) (play (* i 110)))          ; → 4.do({ |i| play.value(i * 110) })
```

### `comp` / `partial`

Function composition / partial application.

```scheme
(var process (comp reverb delay gain))           ; right-to-left composition
(var quiet-sine (partial sine :amp 0.05))        ; closes over fixed kw args
```

`comp` re-expands during macro expansion to chain N functions; `partial`
uses sclang's `valueArray` for variadic dispatch.

### `accumulate`

Fold over a sequence.

```scheme
(accumulate (sum 0 v (list 1 2 3 4 5))
  (+ sum v))
; → [1, 2, 3, 4, 5].inject(0, { |sum, v| sum + v })
```

### `icollect` / `collect`

List comprehensions over sequences and dictionaries.

```scheme
(icollect (i (list 1 2 3 4)) (* i i))
; → [1, 2, 3, 4].collect({ |i| i * i })

(collect (k v mydict) (values k (+ v 1)))
; → var _out = (); mydict.keysValuesDo({ |k, v| _out[k] = v + 1 }); _out
```

---

## SuperCollider shorthands

### `defsynth` — named SynthDef

```scheme
(defsynth sine (freq 440 amp 0.1 gate 1)
  (Out.ar 0
    (* (SinOsc.ar freq 0)
       (EnvGen.kr (Env.adsr 0.01 0.1 0.8 0.1) gate (dict :doneAction 2))
       amp)))
```

The macro quotes the symbol as a name string and emits the `SynthDef` call.

### `definst` — single-output instrument

Wraps body in `Out.ar 0 (! 2 body)` for stereo, appends `.add`, and binds the
name to a `{ |...args| Synth(name, args) }` factory callable.

```scheme
(definst sine (freq 440 amp 0.1)
  (* (SinOsc.ar freq 0) amp))
```

Implementation note: uses `symbol->string` (a builtin in
`MacroExpander._setupBuiltins`) to convert the symbol name to a string.

### `routine` + context-sensitive `wait`

```scheme
(routine
  (Post.put "tick") (Post.nl) (wait 1)
  (Post.put "tock") (Post.nl) (wait 1))
```

`wait` inside a `routine` block emits `<n>.wait` on the duration literal.
Optional `times:` keyword for loop count.

### `pbind` + lowercase pattern aliases

`pbind` flattens key-value pairs directly (no wrapping `list`). Common pattern
classes get lowercase aliases (`pseq`, `prand`, `pwhite`, `pgeom`).

```scheme
(pbind
  :instrument "sine"
  :freq (pseq (list 440 550 660 880) 4)
  :dur  (pseq (list 0.25 0.25 0.5) inf)
  :amp  0.3)
```

### `ctl` / `kill` — running synth control

```scheme
(ctl my-synth :freq 880 :amp 0.5)   ; → my_synth.set(\freq, 880, \amp, 0.5)
(kill my-synth)                     ; → my_synth.free
```

---

## Codegen fix that landed alongside

`fn` in [scscm_codegen.js](../../cli/scscm_codegen.js) was fixed to correctly
emit `{ |param=default, ...rest| body }`. The previous codegen produced broken
output for multiple params and threw on default values.
