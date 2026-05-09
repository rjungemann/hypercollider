# scscm Language Reference

**Version**: 1.0  
**Last Updated**: 2026-05-09  
**Status**: Authoritative reference for the scscm language

> scscm (pronounced "ess-cee-skim") is a Scheme-like surface syntax that compiles to native sclang (SuperCollider). It lets you write SuperCollider scripts using s-expressions: regular, paren-balanced trees that are easy to read, edit, and generate programmatically.

For a quick syntax lookup, see [SCSCM_CHEAT_SHEET.md](SCSCM_CHEAT_SHEET.md).  
For a guided introduction, see [SCSCM_QUICK_START.md](SCSCM_QUICK_START.md).

---

## Table of Contents

1. [Lexical Structure](#1-lexical-structure)
2. [Types & Values](#2-types--values)
3. [Variables & Binding](#3-variables--binding)
4. [Functions](#4-functions)
5. [Operators](#5-operators)
6. [Control Flow](#6-control-flow)
7. [Method Calls](#7-method-calls)
8. [Collections](#8-collections)
9. [Patterns & Synthesis Shorthands](#9-patterns--synthesis-shorthands)
10. [Macros](#10-macros)
11. [Standard-Library Macros](#11-standard-library-macros)
12. [Name Conversion](#12-name-conversion)
13. [Compilation & Output](#13-compilation--output)
14. [Error Handling](#14-error-handling)
15. [Limitations](#15-limitations)
16. [Appendix A: BNF Grammar](#appendix-a-bnf-grammar)
17. [Appendix B: Reserved Symbols](#appendix-b-reserved-symbols)
18. [Appendix C: sclang → scscm Migration](#appendix-c-sclang--scscm-migration)

---

## 1. Lexical Structure

scscm source is a sequence of **forms** (atoms or s-expressions) separated by whitespace. Whitespace and comments are non-significant.

### 1.1 Comments

```scheme
; Single-line comment extends to end of line
(+ 1 2) ; Inline comments work too
```

There is **no block-comment syntax** — every comment line begins with `;`.

### 1.2 Tokens

| Token        | Regex                          | Examples              |
|--------------|--------------------------------|-----------------------|
| INTEGER      | `-?[0-9]+`                     | `42`, `-5`, `0`       |
| FLOAT        | `-?[0-9]+\.[0-9]+`             | `3.14`, `-2.5`, `0.0` |
| STRING       | `"([^"\\]|\\.)*"`              | `"hello"`, `"a\nb"`   |
| SYMBOL       | `[a-zA-Z_-][a-zA-Z0-9_-]*`     | `foo`, `bar-baz`      |
| KEYWORD      | `:[a-zA-Z_-][a-zA-Z0-9_-]*`    | `:freq`, `:doneAction`|
| LPAREN/RPAREN| `(` `)`                        |                       |
| LBRACKET/RBRACKET | `[` `]`                   |                       |
| QUOTE        | `'`                            |                       |
| QUASIQUOTE   | `` ` ``                        |                       |
| UNQUOTE      | `~`                            |                       |
| UNQUOTE-SPLICING | `~@`                       |                       |

### 1.3 String Escapes

| Escape | Meaning            |
|--------|--------------------|
| `\"`   | Literal quote      |
| `\\`   | Literal backslash  |
| `\n`   | Newline            |
| `\t`   | Tab                |

---

## 2. Types & Values

scscm types map directly to sclang types. Type checking happens in sclang, not scscm.

### 2.1 Type Mapping

| scscm Type | sclang Type | Examples            |
|-----------|-------------|---------------------|
| Integer   | Integer     | `42`, `-5`          |
| Float     | Float       | `3.14`, `2.0`       |
| String    | String      | `"hello"`           |
| Symbol    | Symbol/var  | `foo`, `SinOsc`     |
| Keyword   | Symbol      | `:freq` → `\freq`   |
| List      | Array       | `(list 1 2 3)`      |
| Vector    | Array       | `[1 2 3]`           |
| Dict      | Event/Dict  | `(dict :a 1 :b 2)`  |

### 2.2 Special Constants

```scheme
nil         ; null value
true        ; boolean true
false       ; boolean false
inf         ; infinity (used in patterns)
this        ; self reference (in methods)
super       ; superclass reference (in methods)
```

---

## 3. Variables & Binding

### 3.1 `var` — declare local variables

```scheme
(var x 10)                  ; → var x = 10;
(var x 10 y 20 z 30)        ; → var x = 10, y = 20, z = 30;
(var name "Alice")
(var values (list 1 2 3))
```

`var` can declare multiple variables in one form. The right-hand value is optional (declares an uninitialized variable):

```scheme
(var x)                     ; → var x;
(var x y z)                 ; → var x, y, z;
```

### 3.2 `set!` — assign to a variable

```scheme
(set! x 20)                 ; → x = 20;
(set! obj.property 42)      ; → obj.property = 42;
```

The first argument is a symbol or member-access; the second is the new value.

### 3.3 `let` — local binding scope

```scheme
(let ((x 10) (y 20))
  (+ x y))
; → { |x, y| x + y }.value(10, 20)
```

`let` introduces a new lexical scope with the given bindings. The body is a sequence of expressions; the last expression's value is returned.

---

## 4. Functions

### 4.1 `fn` — anonymous functions

```scheme
(fn (x) (+ x 1))
; → { |x| x + 1 }

(fn (x y) (* x y))
; → { |x, y| x * y }

(fn () (Post.put "hello"))
; → { Post.put("hello") }
```

#### Default arguments

```scheme
(fn (freq 440 amp 0.1)
  (* (SinOsc.ar freq 0) amp))
; → { |freq=440, amp=0.1| SinOsc.ar(freq, 0) * amp }
```

Default values follow the parameter name in the parameter list.

### 4.2 `defn` — named function definition

```scheme
(defn double (x)
  (* x 2))
; → double = { |x| x * 2 };

(defn add (a b)
  (+ a b))
; → add = { |a, b| a + b };
```

A `defn` is shorthand for `(var name (fn ...))`.

### 4.3 Multi-statement bodies

Function bodies are a sequence of expressions; the last expression is the return value:

```scheme
(fn (x)
  (var doubled (* x 2))
  (Post.put doubled)
  doubled)
; → { |x|
;     var doubled = x * 2;
;     Post.put(doubled);
;     doubled
;   }
```

### 4.4 Closures

Functions close over their lexical scope:

```scheme
(defn make-adder (n)
  (fn (x) (+ x n)))

(var add5 (make-adder 5))
(add5 10)                   ; → 15
```

---

## 5. Operators

All sclang binary operators are exposed as prefix forms.

### 5.1 Arithmetic

| scscm        | sclang     | Description       |
|--------------|------------|-------------------|
| `(+ a b)`    | `a + b`    | Addition          |
| `(- a b)`    | `a - b`    | Subtraction       |
| `(* a b)`    | `a * b`    | Multiplication    |
| `(/ a b)`    | `a / b`    | Division          |
| `(% a b)`    | `a % b`    | Modulo            |
| `(** a b)`   | `a ** b`   | Exponentiation    |

### 5.2 Comparison

| scscm        | sclang     |
|--------------|------------|
| `(== a b)`   | `a == b`   |
| `(!= a b)`   | `a != b`   |
| `(< a b)`    | `a < b`    |
| `(> a b)`    | `a > b`    |
| `(<= a b)`   | `a <= b`   |
| `(>= a b)`   | `a >= b`   |

### 5.3 Logical

| scscm           | sclang        |
|-----------------|---------------|
| `(and a b)`     | `a && b`      |
| `(or a b)`      | `a \|\| b`    |
| `(not a)`       | `a.not`       |

### 5.4 Array operators

| scscm          | sclang    |
|----------------|-----------|
| `(++ arr1 arr2)` | `arr1 ++ arr2` (concatenate) |
| `(<> arr1 arr2)` | `arr1 <> arr2` (interleave)  |

### 5.5 Variadic forms

`+`, `*` and other arithmetic operators accept any number of arguments:

```scheme
(+ 1 2 3 4)           ; → ((1 + 2) + 3) + 4
(* 2 3 4)             ; → (2 * 3) * 4
```

---

## 6. Control Flow

### 6.1 `if`

```scheme
(if test then-expr else-expr)
```

```scheme
(if (> x 5)
    "big"
    "small")
; → if (x > 5) { "big" } { "small" }
```

The `else-expr` is optional:

```scheme
(if (> x 5) (Post.put "big"))
; → if (x > 5) { Post.put("big") }
```

### 6.2 `cond` — multi-branch conditional

```scheme
(cond
  ((< x 0)  "negative")
  ((== x 0) "zero")
  (else     "positive"))
; → cond({ x < 0 -> "negative" }
;        { x == 0 -> "zero" }
;        { true -> "positive" })
```

### 6.3 `when` / `unless` — single-armed `if`

```scheme
(when (> freq 20)
  (play freq))
; → if (freq > 20) { play.value(freq) }

(unless muted
  (play freq))
; → if (muted.not) { play.value(freq) }
```

### 6.4 `do` — sequence multiple expressions

```scheme
(do
  (set! x 1)
  (set! y 2)
  (+ x y))
; → { var _; _ = x = 1; _ = y = 2; x + y }.value()
```

`do` returns the last expression's value.

### 6.5 `doseq` / `dotimes` — iteration

```scheme
(doseq (n (list 440 550 660))
  (play n))
; → [440, 550, 660].do({ |n| play.value(n) })

(dotimes (i 4)
  (play (* i 110)))
; → 4.do({ |i| play.value(i * 110) })
```

---

## 7. Method Calls

### 7.1 `.` — instance method calls

```scheme
(. object method)              ; → object.method
(. object method arg1 arg2)    ; → object.method(arg1, arg2)
(. array length)               ; → array.length
(. string toUpper)             ; → string.toUpper
```

### 7.2 `.dot` — class method calls

```scheme
(.dot Synth new (dict :freq 440))
; → Synth.new((freq: 440))

(.dot Array fill 10 5)
; → Array.fill(10, 5)
```

### 7.3 `Class.method` shorthand

For convenience, `ClassName.methodName` form (no `.dot`) is recognised:

```scheme
(SinOsc.ar 440 0 0.1)         ; → SinOsc.ar(440, 0, 0.1)
(EnvGen.kr env)               ; → EnvGen.kr(env)
(Out.ar 0 sig)                ; → Out.ar(0, sig)
```

### 7.4 Threading macros

Thread-first (`->`) and thread-last (`->>`) chain method calls:

```scheme
; Thread-first: pipe through as FIRST argument
(-> 440
    (. midicps)
    (. mul 0.5))
; → 440.midicps.mul(0.5)

; Thread-last: pipe through as LAST argument
(->> [1 2 3]
     (collect (fn (x) (* x 2)))
     (select (fn (x) (> x 3))))
; → select(collect([1, 2, 3], { |x| x * 2 }), { |x| x > 3 })
```

---

## 8. Collections

### 8.1 Lists / Arrays

```scheme
(list 1 2 3)              ; → [1, 2, 3]
(array 1 2 3)             ; → [1, 2, 3]   (alias)
[1 2 3]                   ; → [1, 2, 3]   (vector literal)
```

### 8.2 Dictionaries / Events

```scheme
(dict :freq 440 :amp 0.1)
; → (freq: 440, amp: 0.1)
```

Dictionaries are sclang `Event` objects. Keys are typically keywords (`:foo`), values are arbitrary.

### 8.3 Common operations

```scheme
(. arr length)             ; arr.length
(. arr at 0)               ; arr.at(0)
(. arr add x)              ; arr.add(x)
(. arr collect (fn (x) (* x 2)))   ; arr.collect({ |x| x * 2 })
(. arr select (fn (x) (> x 5)))    ; arr.select({ |x| x > 5 })
(. arr inject 0 (fn (a b) (+ a b))) ; arr.inject(0, { |a, b| a + b })
```

### 8.4 List comprehensions

```scheme
(icollect (i (list 1 2 3 4))
  (* i i))
; → [1, 2, 3, 4].collect({ |i| i * i })

(collect (k v mydict)
  (values k (+ v 1)))
; → keysValuesDo over the dictionary
```

---

## 9. Patterns & Synthesis Shorthands

### 9.1 `defsynth` — named SynthDef

```scheme
(defsynth sine (freq 440 amp 0.1 gate 1)
  (Out.ar 0
    (* (SinOsc.ar freq 0)
       (EnvGen.kr (Env.adsr 0.01 0.1 0.8 0.1) gate (dict :doneAction 2))
       amp)))
```

Equivalent to:

```scheme
(. (SynthDef "sine"
     (fn (freq 440 amp 0.1 gate 1) ...))
   add)
```

### 9.2 `definst` — single-output instrument

Wraps body in `Out.ar 0 (! 2 body)` (stereo), appends `.add`, and binds the
name to a `{ |args| Synth(name, args) }` factory.

```scheme
(definst sine (freq 440 amp 0.1)
  (* (SinOsc.ar freq 0) amp))

; Use as:
(sine :freq 660 :amp 0.05)
```

### 9.3 `routine` — sequence with `wait`

```scheme
(routine
  (Post.put "tick") (Post.nl) (wait 1)
  (Post.put "tock") (Post.nl) (wait 1))
```

`wait` inside a `routine` emits `<duration>.wait`.

### 9.4 `pbind` — pattern player

```scheme
(pbind
  :instrument "sine"
  :freq (pseq (list 440 550 660 880) 4)
  :dur  (pseq (list 0.25 0.25 0.5) inf)
  :amp  0.3)
```

Lowercase aliases are provided for common pattern classes:

| scscm      | sclang     |
|------------|------------|
| `pseq`     | `Pseq`     |
| `prand`    | `Prand`    |
| `pwhite`   | `Pwhite`   |
| `pgeom`    | `Pgeom`    |
| `pbind`    | `Pbind`    |

### 9.5 `ctl` / `kill` — running synth control

```scheme
(ctl my-synth :freq 880 :amp 0.5)
; → my_synth.set(\freq, 880, \amp, 0.5)

(kill my-synth)
; → my_synth.free
```

### 9.6 `metronome` / `in` — timing helpers

```scheme
(var metro (metronome 140))    ; 140 BPM clock

(in 2.0 (kill mysynth))        ; do something after 2 seconds
```

---

## 10. Macros

### 10.1 `defmacro` — define a compile-time macro

```scheme
(defmacro when (condition body)
  `(if ~condition ~body nil))

(when (> freq 0)
  (. freq postln))
; expands to: (if (> freq 0) (. freq postln) nil)
```

### 10.2 Macro evaluator

Macro bodies run in scscm's macro evaluator (compile time, not at sclang
runtime). Available primitives:

- **Special forms**: `if`, `let`, `fn`, `quote`, `quasiquote`, `unquote`, `unquote-splicing`
- **Predicates**: `null?`, `symbol?`, `pair?`, `list?`, `number?`, `string?`
- **List operations**: `car`, `cdr`, `cons`, `list`, `append`, `length`
- **Hygiene**: `gensym` returns a fresh unique symbol
- **Errors**: `error` raises a compile-time error

### 10.3 Quasiquote, unquote, splicing

```scheme
`(a b c)            ; quote whole list (treats as data)
`(a ~x c)           ; unquote: insert value of x into list
`(a ~@xs c)         ; unquote-splicing: spread elements of xs into list
```

### 10.4 Parameter list syntax

```scheme
(defmacro name (a b)       ...) ; two fixed params
(defmacro name (a . rest)  ...) ; one fixed + variadic rest
(defmacro name ()          ...) ; no params
```

---

## 11. Standard-Library Macros

### 11.1 Functional

| Macro       | Purpose                                       |
|-------------|-----------------------------------------------|
| `comp`      | Function composition (right-to-left)          |
| `partial`   | Partial application (with keyword args)       |
| `accumulate`| Fold over a sequence                          |
| `icollect`  | List comprehension                            |
| `collect`   | Dictionary comprehension                      |

```scheme
(var process (comp reverb delay gain))
; process = { |x| reverb(delay(gain(x))) }

(var quiet-sine (partial sine :amp 0.05))
; quiet-sine = { |...args| sine(:amp, 0.05, *args) }

(accumulate (sum 0 v (list 1 2 3 4 5))
  (+ sum v))
; → [1, 2, 3, 4, 5].inject(0, { |sum, v| sum + v })
```

### 11.2 Threading

| Macro   | Behaviour                                              |
|---------|--------------------------------------------------------|
| `->`    | Thread-first (insert as 1st arg of next call)          |
| `->>`   | Thread-last (insert as last arg of next call)          |

### 11.3 Conditionals

| Macro    | Behaviour                                |
|----------|------------------------------------------|
| `when`   | One-armed `if`; runs body if cond true   |
| `unless` | One-armed `if`; runs body if cond false  |

### 11.4 Iteration

| Macro      | Behaviour                                          |
|------------|----------------------------------------------------|
| `doseq`    | Iterate over a sequence                            |
| `dotimes`  | Iterate N times                                    |
| `do`       | Sequence multiple expressions, return last         |

---

## 12. Name Conversion

scscm uses Scheme-style identifiers (lowercase with hyphens). At code-gen time, names are converted:

| Pattern        | Conversion          | Example                       |
|----------------|---------------------|-------------------------------|
| `foo-bar`      | hyphen → underscore | `foo-bar` → `foo_bar`         |
| `is-empty?`    | `?` → `_q` suffix   | `is-empty?` → `is_empty_q`    |
| `set-now!`     | `!` removed         | `set-now!` → `set_now`        |
| `CamelCase`    | unchanged           | `SinOsc` → `SinOsc`           |
| `:freq`        | keyword → symbol    | `:freq` → `\freq`             |

This means `my-synth` and `mySynth` are different scscm identifiers but produce the same sclang identifier (`my_synth` vs `mySynth`).

---

## 13. Compilation & Output

### 13.1 CLI usage

```bash
# Compile to stdout
node lhc.js script.scscm

# Compile to file
node lhc.js -i script.scscm -o script.sc

# Verbose (show compilation steps)
node lhc.js -i script.scscm -v

# Pipe to sclang
node lhc.js script.scscm | sclang
```

The compiler is available two ways:

| Form | Path | When to use |
|------|------|-------------|
| Source-tree | `cli/lhc.js` | You have the repo checked out |
| Standalone bundle | `dist/lhc.js` | Distributing to users; no repo / `npm install` needed |

Build the bundle locally with `just bundle-lhc`, or download the latest from the GitHub release page (`lhc-standalone-vX.Y.Z` artifact). The standalone bundle is byte-for-byte equivalent to the source-tree compiler — only how it's packaged differs.

### 13.2 CLI options

| Flag              | Description                                  |
|-------------------|----------------------------------------------|
| `-i, --input`     | Input `.scscm` file (required)               |
| `-o, --output`    | Output `.sc` file (default: stdout)          |
| `--to-sc`         | Compile only; do not invoke sclang           |
| `-v, --verbose`   | Print detailed compilation steps             |
| `-h, --help`      | Show help                                    |

### 13.3 What gets emitted

scscm emits human-readable sclang. To inspect what your script becomes:

```bash
node lhc.js -i script.scscm -o /tmp/out.sc
cat /tmp/out.sc
```

---

## 14. Error Handling

### 14.1 Lexer errors

- Unterminated string literal
- Invalid number format
- Invalid escape sequence

### 14.2 Parser errors

- Unclosed parenthesis or bracket
- Unexpected token
- Mismatched brackets (`[` closed by `)`, etc.)

### 14.3 Codegen errors

- Invalid special form (e.g., `fn` without parameter list)
- Type mismatch (e.g., `var` expects a symbol, got a number)
- Unrecognized special form

### 14.4 Macro errors

- Unbound symbol in macro body
- `error` form raised explicitly

Macro errors surface at compile time with file:line:col location.

---

## 15. Limitations

1. **No tail calls in syntax** — handled by sclang at compile time.
2. **No higher-order macros** — cannot generate new special forms at compile time.
3. **No pattern matching / destructuring** — bind via positional `var` only.
4. **No type annotations** — types are inferred by sclang at runtime.
5. **No module system** — each file is independent; share code by concatenation.
6. **No inline sclang escape hatch** — for sclang-only constructs, write a `.sc` file directly.
7. **No block comments** — every comment line begins with `;`.

---

## Appendix A: BNF Grammar

```
program     = expr*

expr        = atom
            | list
            | vector
            | quote
            | quasiquote
            | unquote
            | unquote-splicing

atom        = number | string | symbol | keyword
number      = integer | float
integer     = "-"? digit+
float       = "-"? digit+ "." digit+
string      = "\"" (\\ . | [^"])* "\""
symbol      = (letter | "-" | "_") (letter | digit | "-" | "_")*
keyword     = ":" symbol

list        = "(" expr* ")"
vector      = "[" expr* "]"

quote               = "'" expr
quasiquote          = "`" expr
unquote             = "~" expr
unquote-splicing    = "~@" expr
```

### Special forms

```
fn-expr     = "(" "fn" param-list body ")"
param-list  = "(" (symbol expr?)* ")"
body        = expr+

defn-expr   = "(" "defn" symbol param-list body ")"

var-expr    = "(" "var" (symbol expr?)* ")"

set-expr    = "(" "set!" target expr ")"
target      = symbol | method-call

let-expr    = "(" "let" "(" binding* ")" body ")"
binding     = "(" symbol expr ")"

if-expr     = "(" "if" expr expr expr? ")"

cond-expr   = "(" "cond" clause* ")"
clause      = "(" expr expr ")" | "(" "else" expr ")"

dot-expr    = "(" "." expr symbol expr* ")"
class-expr  = "(" "." class-method-symbol expr* ")"

defmacro-expr = "(" "defmacro" symbol param-spec body ")"
param-spec    = "(" symbol* ")"
              | "(" symbol+ "." symbol ")"
```

---

## Appendix B: Reserved Symbols

These symbols have special meaning and cannot be used as regular function names:

```
fn            ; anonymous function
defn          ; named function definition
var           ; variable declaration
set!          ; assignment
let           ; local binding
if            ; conditional
cond          ; multi-branch conditional
.             ; method call
.dot          ; class method/constructor call
class         ; class definition
list          ; array literal
array         ; array literal (alias)
dict          ; dictionary literal
quote         ; quote form
quasiquote    ; quasiquote form (`)
unquote       ; unquote form (~)
unquote-splicing ; splicing form (~@)
super         ; superclass reference
this          ; self reference
defmacro      ; macro definition
```

Also reserved at the macro level:
- `gensym`, `error`, `null?`, `symbol?`, `pair?`, `list?`, `number?`, `string?`
- `car`, `cdr`, `cons`, `append`, `length`

---

## Appendix C: sclang → scscm Migration

Side-by-side translations of common SuperCollider idioms, useful when porting existing sclang code to scscm.

### 1. Basic sine tone

```supercollider
{ SinOsc.ar(440, 0, 0.1) }.play;
```

```scheme
(. (fn ()
     (SinOsc.ar 440 0 0.1))
   play)
```

### 2. Two-channel detuned sine

```supercollider
{ [SinOsc.ar(440, 0, 0.1), SinOsc.ar(442, 0, 0.1)] }.play;
```

```scheme
(. (fn ()
     [(SinOsc.ar 440 0 0.1) (SinOsc.ar 442 0 0.1)])
   play)
```

### 3. SynthDef and Synth

```supercollider
SynthDef("tone", { |freq = 440, amp = 0.1|
  Out.ar(0, SinOsc.ar(freq, 0, amp));
}).add;

Synth("tone", [\freq, 660, \amp, 0.08]);
```

```scheme
(. (SynthDef "tone"
     (fn (freq 440 amp 0.1)
       (Out.ar 0 (SinOsc.ar freq 0 amp))))
   add)

(Synth "tone" (dict :freq 660 :amp 0.08))
```

### 4. Perc envelope with `doneAction`

```supercollider
{
  var env = EnvGen.kr(Env.perc(0.01, 0.3), doneAction: 2);
  SinOsc.ar(440, 0, 0.15) * env
}.play;
```

```scheme
(. (fn ()
     (var env (EnvGen.kr (Env.perc 0.01 0.3) (dict :doneAction 2)))
     (* (SinOsc.ar 440 0 0.15) env))
   play)
```

### 5. Mouse-controlled frequency

```supercollider
{
  var f = MouseX.kr(200, 1200);
  SinOsc.ar(f, 0, 0.1)
}.play;
```

```scheme
(. (fn ()
     (var f (MouseX.kr 200 1200))
     (SinOsc.ar f 0 0.1))
   play)
```

### 6. Bus writer + reader

```supercollider
SynthDef("writer", { |bus = 0, freq = 440|
  Out.ar(bus, SinOsc.ar(freq, 0, 0.1));
}).add;

SynthDef("reader", { |inBus = 0|
  Out.ar(0, In.ar(inBus, 1));
}).add;

b = Bus.audio(s, 1);
x = Synth("writer", [\bus, b, \freq, 660]);
y = Synth("reader", [\inBus, b]);
```

```scheme
(. (SynthDef "writer"
     (fn (bus 0 freq 440)
       (Out.ar bus (SinOsc.ar freq 0 0.1))))
   add)

(. (SynthDef "reader"
     (fn (inBus 0)
       (Out.ar 0 (In.ar inBus 1))))
   add)

(var b (Bus.audio s 1))
(var x (Synth "writer" (dict :bus b :freq 660)))
(var y (Synth "reader" (dict :inBus b)))
```

### 7. Group ordering

```supercollider
g = Group.new;
h = Group.head(g);
x = Synth.tail(h, "default");
```

```scheme
(var g (Group.new))
(var h (Group.head g))
(var x (Synth.tail h "default"))
```

### 8. Pseq stream values

```supercollider
p = Pseq([0, 2, 4, 7], 2).asStream;
p.nextN(8);
```

```scheme
(var p (. (Pseq (list 0 2 4 7) 2) asStream))
(. p nextN 8)
```

### 9. Basic Pbind pattern

```supercollider
Pbind(\degree, Pseq([0, 2, 4, 7], inf), \dur, 0.25, \amp, 0.08).play;
```

```scheme
(. (Pbind
     :degree (Pseq (list 0 2 4 7) inf)
     :dur 0.25
     :amp 0.08)
   play)
```

### 10. Randomized frequency via LFNoise1

```supercollider
{
  var f = LFNoise1.kr(2).exprange(200, 1200);
  SinOsc.ar(f, 0, 0.08)
}.play;
```

```scheme
(. (fn ()
     (var f (. (LFNoise1.kr 2) exprange 200 1200))
     (SinOsc.ar f 0 0.08))
   play)
```

### 11. Pan a saw wave

```supercollider
{
  Pan2.ar(Saw.ar(220, 0.1), 0)
}.play;
```

```scheme
(. (fn ()
     (Pan2.ar (Saw.ar 220 0.1) 0))
   play)
```

### 12. Chord with mixed frequencies

```supercollider
{
  Mix(SinOsc.ar([220, 330, 440], 0, 0.03))
}.play;
```

```scheme
(. (fn ()
     (Mix (SinOsc.ar (list 220 330 440) 0 0.03)))
   play)
```

### Quick mapping reference

| sclang                 | scscm                          |
|------------------------|--------------------------------|
| `{ \|x\| x + 1 }`      | `(fn (x) (+ x 1))`             |
| `f = { \|x\| x };`     | `(defn f (x) x)`               |
| `var x = 10;`          | `(var x 10)`                   |
| `x = 20;`              | `(set! x 20)`                  |
| `if (a) { b } { c }`   | `(if a b c)`                   |
| `obj.method`           | `(. obj method)`               |
| `obj.method(a, b)`     | `(. obj method a b)`           |
| `Class.method`         | `(.dot Class method)` or `Class.method` |
| `[1, 2, 3]`            | `(list 1 2 3)` or `[1 2 3]`    |
| `(a: 1, b: 2)`         | `(dict :a 1 :b 2)`             |
| `1 + 2`                | `(+ 1 2)`                      |
| `x == 5`               | `(== x 5)`                     |
| `a && b`               | `(and a b)`                    |

---

*See also: [SCSCM_CHEAT_SHEET.md](SCSCM_CHEAT_SHEET.md) for one-page lookup, [SCSCM_QUICK_START.md](SCSCM_QUICK_START.md) for a guided introduction.*
