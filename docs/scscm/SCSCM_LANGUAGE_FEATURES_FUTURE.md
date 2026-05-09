# SCSCM Language Features — Future Work

Features designed but not yet implemented. See
[SCSCM_LANGUAGE_FEATURES.md](SCSCM_LANGUAGE_FEATURES.md) for what shipped.

---

## 1. Destructuring in `let` and function params

Sequential and keyword-map destructuring in binding positions. sclang has no
native destructuring, so we expand to indexed/keyword lookups.

```scheme
; Sequential
(let (((a b c) (list 1 2 3)))
  (+ a b c))
; → var _tmp = [1, 2, 3]; var a = _tmp[0], b = _tmp[1], c = _tmp[2]; a + b + c

; Keyword map
(let (((freq: freq amp: amp) mydict))
  ...)
; → var freq = mydict[\freq]; var amp = mydict[\amp]; ...
```

**Effort:** Medium. Extend `let` codegen to detect vector/dict patterns in
binding LHS and emit destructured assignments.

---

## 2. `match` — structural pattern matching

More expressive than `cond` for dispatching on value shapes.

```scheme
(match x
  (0 :zero)
  ((list a b) (+ a b))
  (_ :other))
```

**Effort:** Large (~150 lines). Codegen special form. Scalar cases → sclang
`case`; list pattern cases → length check + destructure + guard.

---

## 3. `loop` / `recur` — tail-recursive iteration

sclang has no TCO, but the pattern maps to `whileTrue`.

```scheme
(loop ((i 0) (acc 0))
  (if (> i 10)
    acc
    (recur (+ i 1) (+ acc i))))
; → var i = 0, acc = 0;
;   { (i > 10).not }.whileTrue({ acc = acc + i; i = i + 1 });
;   acc
```

**Effort:** Large (~50–100 lines). Codegen special form. Track `recur` sites
to assign loop vars rather than recurse.

---

## 4. Auto-gensym in macros (`var#`)

Fennel-style: symbols ending in `#` inside a quasiquote get a per-expansion
unique name, avoiding variable capture without an explicit `gensym` call.

```scheme
; Current — explicit gensym
(defmacro swap! (a b)
  (var tmp (gensym))
  `(let ((~tmp ~a)) (set! ~a ~b) (set! ~b ~tmp)))

; Proposed — auto-gensym
(defmacro swap! (a b)
  `(let ((tmp# ~a)) (set! ~a ~b) (set! ~b tmp#)))
```

**Effort:** Medium. In the quasiquote expander, detect `#`-suffixed symbols
and replace per-expansion via `gensym`.

---

## 5. `with-recording` (Overtone-style)

Session recording macro from the Overtone API. All other Overtone-inspired
macros shipped; this one was deferred. Requires designing the
record-start/record-stop boundaries against scsynth's `s_save` /
`b_write` infrastructure.
