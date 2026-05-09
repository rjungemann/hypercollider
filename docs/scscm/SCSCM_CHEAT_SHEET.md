# scscm Cheat Sheet

One-page reference for syntax. For detailed semantics see [SCSCM_LANGUAGE_REFERENCE.md](SCSCM_LANGUAGE_REFERENCE.md).

---

## Literals

```scheme
42          3.14        -5             ; numbers
"hello"     "a\nb"                     ; strings
foo         SinOsc      bar-baz        ; symbols
:freq       :amp        :doneAction    ; keywords
nil         true        false          ; constants
inf                                    ; infinity (in patterns)
'expr       `expr       ~expr   ~@xs   ; quote, quasi, unquote, splice
; comment to end of line                ; comments
```

## Variables & Assignment

```scheme
(var x 10)                  ; var x = 10
(var x 1 y 2 z 3)           ; var x = 1, y = 2, z = 3
(var arr (list 1 2 3))      ; var arr = [1, 2, 3]
(set! x 20)                 ; x = 20
```

## Functions

```scheme
(fn (x) (+ x 1))                 ; { |x| x + 1 }
(fn (x y) (* x y))               ; { |x, y| x * y }
(fn (freq 440 amp 0.1) ...)      ; { |freq=440, amp=0.1| ... }
(defn double (x) (* x 2))        ; double = { |x| x * 2 }
```

## Operators

| Arithmetic | Comparison | Logical | Array |
|------------|-----------|---------|-------|
| `(+ a b)`  | `(== a b)` | `(and a b)` | `(++ a b)` concat |
| `(- a b)`  | `(!= a b)` | `(or a b)`  | `(<> a b)` interleave |
| `(* a b)`  | `(< a b)`  | `(not a)`   |       |
| `(/ a b)`  | `(> a b)`  |             |       |
| `(% a b)`  | `(<= a b)` |             |       |
| `(** a b)` | `(>= a b)` |             |       |

Variadic: `(+ 1 2 3 4)` → `((1+2)+3)+4`.

## Control Flow

```scheme
(if test then else)                    ; if (test) {then} {else}
(if test then)                         ; (else is optional)

(cond
  ((< x 0) "neg")
  ((== x 0) "zero")
  (else "pos"))

(when cond body)                       ; if cond run body
(unless cond body)                     ; if !cond run body

(let ((x 10) (y 20)) body)             ; local scope

(do expr1 expr2 expr3)                 ; sequence; return last

(doseq (n xs) body)                    ; iterate over list
(dotimes (i 4) body)                   ; iterate N times
```

## Method Calls

```scheme
(. obj method)                         ; obj.method
(. obj method a b)                     ; obj.method(a, b)
(.dot Class method args)               ; Class.method(args)
(SinOsc.ar 440 0 0.1)                  ; SinOsc.ar(440, 0, 0.1)

(-> 440 (. midicps) (. mul 0.5))       ; thread-first
(->> [1 2 3] (collect ...) (select ...)) ; thread-last
```

## Collections

```scheme
(list 1 2 3)                  ; [1, 2, 3]
[1 2 3]                       ; [1, 2, 3] (vector literal)
(dict :freq 440 :amp 0.1)     ; (freq: 440, amp: 0.1)

(. arr length)                ; arr.length
(. arr at 0)                  ; arr.at(0)
(. arr collect (fn (x) ...))  ; arr.collect({ |x| ... })
(. arr select (fn (x) ...))   ; arr.select({ |x| ... })

(icollect (i xs) (* i i))     ; xs.collect({ |i| i*i })
```

## SuperCollider

```scheme
; Named SynthDef
(defsynth sine (freq 440 amp 0.1)
  (Out.ar 0 (* (SinOsc.ar freq 0) amp)))

; Single-output instrument (auto .add)
(definst pluck (freq 440 amp 0.5)
  (* (SinOsc.ar freq 0) amp))

; Spawn a synth
(Synth "sine" (dict :freq 660 :amp 0.05))

; Pattern player
(pbind
  :instrument "sine"
  :freq (pseq (list 440 550 660) inf)
  :dur 0.25
  :amp 0.3)

; Lowercase pattern aliases
pseq    prand    pwhite    pgeom    pbind

; Live control
(ctl my-synth :freq 880)         ; my_synth.set(\freq, 880)
(kill my-synth)                  ; my_synth.free

; Routine + wait
(routine
  (Post.put "tick") (wait 1)
  (Post.put "tock") (wait 1))

; Timing
(metronome 140)                  ; 140-BPM clock
(in 2.0 body)                    ; run after 2 sec
```

## Macros

```scheme
(defmacro when (cond body)
  `(if ~cond ~body nil))

(defmacro for-each (var xs . body)
  `(. ~xs do (fn (~var) ~@body)))
```

Available inside macro bodies:
`if let fn quote quasiquote unquote unquote-splicing
gensym error null? symbol? pair? list? number? string?
car cdr cons list append length`

## Name Conversion

| Source         | Becomes         |
|----------------|-----------------|
| `foo-bar`      | `foo_bar`       |
| `is-empty?`    | `is_empty_q`    |
| `set-now!`     | `set_now`       |
| `:freq`        | `\freq`         |
| `SinOsc`       | `SinOsc` (kept) |

## Common Mistakes

```scheme
; ✗ Unbalanced parens
(defn foo (x) (+ x 1)

; ✓ Balanced
(defn foo (x) (+ x 1))

; ✗ Keyword without symbol
(dict :10 "v")

; ✓ Symbol after colon
(dict :ten "v")

; ✗ Missing parens around `let` binding
(let (x 10) (+ x 1))

; ✓ Each binding in its own list
(let ((x 10)) (+ x 1))

; ✗ Default values out of order
(fn (freq amp 0.1 440) ...)   ; can't default `amp` while leaving `freq` unset

; ✓ Defaults follow each name
(fn (freq 440 amp 0.1) ...)
```

## CLI

```bash
node lhc.js script.scscm                        # to stdout
node lhc.js -i script.scscm -o script.sc        # to file
node lhc.js -i script.scscm -v                  # verbose
node lhc.js script.scscm | sclang               # pipe
```

## Quick Templates

**Beep**
```scheme
(. (fn () (SinOsc.ar 440 0 0.1)) play)
```

**SynthDef + play**
```scheme
(defsynth sine (freq 440 amp 0.1)
  (Out.ar 0 (* (SinOsc.ar freq 0) amp)))
(Synth "sine" (dict :freq 660))
```

**Pattern**
```scheme
(. (pbind
     :instrument "sine"
     :midinote (pseq (list 60 62 64 67) inf)
     :dur 0.25
     :amp 0.2)
   play)
```

---
*See [SCSCM_LANGUAGE_REFERENCE.md](SCSCM_LANGUAGE_REFERENCE.md) for full details, [SCSCM_QUICK_START.md](SCSCM_QUICK_START.md) for a hands-on intro.*
