# scscm - Scheme-like SuperCollider Compiler Guide

## Quick Start

scscm lets you write SuperCollider scripts using Scheme-like s-expression syntax, compiling them to native sclang code.

### Installation

scscm is included with the SuperCollider WASM CLI tools:

```bash
cd platform/wasm/cli
npm install
```

### Your First Script

Create a file `sine.scscm`:

```scheme
(SynthDef "sine"
  (fn (freq 440 amp 0.1)
    (Out.ar 0 (* (SinOsc.ar freq 0) amp))))

(Synth "sine" (dict :freq 440 :amp 0.1))
```

Compile and run:

```bash
node hcl.js --input sine.scscm --output sine.sc
```

Or compile and play directly:

```bash
node hcl.js --input sine.scscm --to-sc | node hc.js --output sine.wav
```

---

## Syntax Reference

### Basic Expressions

#### Numbers

```scheme
42              ; Integer
3.14159         ; Float
-5              ; Negative numbers
```

#### Strings

```scheme
"hello world"   ; Double-quoted strings
"escaped \"quotes\" work"  ; Escape sequences work
```

#### Symbols

```scheme
foo             ; Symbol (identifier)
foo-bar         ; Hyphens are allowed (converted to underscores in sclang)
SinOsc          ; Class names
```

#### Keywords

```scheme
:freq           ; Keyword (for use in dictionaries)
:amp
:doneAction
```

#### Comments

```scheme
; This is a comment
; Comments extend to end of line
```

### Collections

#### Lists (Arrays)

```scheme
(list 1 2 3)    ; => [1, 2, 3]
(array 1 2 3)   ; => [1, 2, 3]
```

#### Vectors

```scheme
[1 2 3]         ; Vector literal => [1, 2, 3]
```

#### Dictionaries

```scheme
(dict :freq 440 :amp 0.1)  ; => (freq: 440, amp: 0.1)
(dict :x 1 :y 2)           ; => (x: 1, y: 2)
```

### Operators

All sclang binary operators work:

```scheme
(+ 1 2)         ; => 1 + 2
(* 3.14 2)      ; => 3.14 * 2
(- 10 5)        ; => 10 - 5
(/ 20 4)        ; => 20 / 4
(% 10 3)        ; => 10 % 3
(** 2 8)        ; => 2 ** 8

(== x 5)        ; => x == 5
(!= x 5)        ; => x != 5
(< x 10)        ; => x < 10
(> x 10)        ; => x > 10
(<= x 10)       ; => x <= 10
(>= x 10)       ; => x >= 10

(and cond1 cond2)   ; => cond1 && cond2
(or cond1 cond2)    ; => cond1 || cond2

(++ arr1 arr2)  ; => arr1 ++ arr2
(<> arr1 arr2)  ; => arr1 <> arr2
```

### Variable Declaration and Assignment

#### Declare variables

```scheme
(var x 10)                  ; => var x = 10;
(var x 10 y 20 z 30)        ; => var x = 10, y = 20, z = 30;
(var name "Alice" age 25)   ; Multiple declarations
```

#### Assign values

```scheme
(set! x 20)                 ; => x = 20;
(set! obj.property value)   ; => obj.property = value;
```

### Functions and Blocks

#### Anonymous functions (blocks)

```scheme
(fn (x) (+ x 1))            ; => { |x| x + 1 }
(fn (x y) (* x y))          ; => { |x, y| x * y }
(fn (x) (do-something x))   ; Multi-statement block
```

#### Named functions

```scheme
(defn add (a b)
  (+ a b))

; Compiles to:
; add = { |a, b| a + b };
```

### Control Flow

#### If expressions

```scheme
(if (> x 5)
  "x is big"
  "x is small")

; => if (x > 5) { "x is big" } { "x is small" }
```

#### Conditional expressions (cond)

```scheme
(cond
  ((< x 0) "negative")
  ((== x 0) "zero")
  (else "positive"))

; => cond(
;      { x < 0 -> "negative" }
;      { x == 0 -> "zero" }
;      { true -> "positive" }
;    )
```

#### Let bindings

```scheme
(let ((x 10) (y 20))
  (+ x y))

; => { |x, y| x + y }.value(10, 20)
```

### Method Calls

#### Call instance methods

```scheme
(. object method)           ; => object.method
(. object method 1 2)       ; => object.method(1, 2)
(. array length)            ; => array.length
(. string toUpper)          ; => string.toUpper
```

#### Call class methods and constructors

```scheme
(.dot Synth new (dict :freq 440))  ; => Synth.new((freq: 440))
(.dot Array fill 10 5)             ; => Array.fill(10, 5)
```

---

## Common Patterns

### SynthDef Definition

```scheme
(SynthDef "my-synth"
  (fn (freq 440 amp 0.1 gate 1)
    (var osc (SinOsc.ar freq 0))
    (var env (EnvGen.kr
               (Env.adsr 0.01 0.1 0.8 0.1)
               gate
               (dict :doneAction 2)))
    (Out.ar 0 (* osc env amp))))
```

### Playing a Synth

```scheme
(Synth "my-synth"
  (dict :freq 440 :amp 0.1))

(Synth "my-synth"
  (dict :freq 880 :amp 0.05 :gate 1))
```

### Working with Arrays

```scheme
(var notes (list 60 62 64 65 67))
(Post.put notes)

(. notes length)            ; Get length
(. notes at 0)              ; Get element at index

(list 1 2 3)                ; Create array
(array 1 2 3)               ; Create array (alias)
```

### Arithmetic and Math

```scheme
(var x 5)
(var y 10)
(var sum (+ x y))
(var product (* x y))
(var ratio (/ y x))

; Complex expressions
(var result
  (+ (* 2 x)
     (/ y 3)))
```

---

## Mapping Table: Scheme → sclang

| Scheme | sclang | Notes |
|--------|--------|-------|
| `(fn (x) (+ x 1))` | `{ \|x\| x + 1 }` | Anonymous function |
| `(defn foo (x) x)` | `foo = { \|x\| x };` | Named function |
| `(var x 10)` | `var x = 10;` | Variable declaration |
| `(set! x 20)` | `x = 20;` | Assignment |
| `(let ((x 10)) x)` | `{ \|x\| x }.value(10)` | Local binding |
| `(if a b c)` | `if (a) { b } { c }` | Conditional |
| `(cond (t1 e1) (else e2))` | `cond({ t1 -> e1 } { true -> e2 })` | Multi-branch |
| `(. obj method)` | `obj.method` | Method call |
| `(. obj m a b)` | `obj.m(a, b)` | Method with args |
| `(.dot Class method)` | `Class.method` | Class method |
| `(list 1 2 3)` | `[1, 2, 3]` | Array literal |
| `(dict :a 1 :b 2)` | `(a: 1, b: 2)` | Dictionary literal |
| `(+ 1 2)` | `1 + 2` | Binary operator |
| `(== x 5)` | `x == 5` | Comparison |
| `(and a b)` | `a && b` | Logical AND |

---

## CLI Usage

### Basic Compilation

Compile to .sc file:

```bash
node hcl.js --input script.scscm --output script.sc
```

Print to stdout:

```bash
node hcl.js --input script.scscm
```

### Options

- `--input FILE, -i FILE` - Input .scscm file (required)
- `--output FILE, -o FILE` - Output .sc file (optional, prints to stdout if not provided)
- `--to-sc` - Only compile to .sc, don't run through sclang
- `--verbose, -v` - Print detailed compilation steps
- `--help, -h` - Show help message

### Examples

```bash
# Compile to file
node hcl.js -i sine.scscm -o sine.sc

# Compile and display
node hcl.js sine.scscm

# Compile with verbose output
node hcl.js -i script.scscm -v

# Pipe to sclang
node hcl.js script.scscm | sclang
```

---

## Limitations & Notes

### Current Version (1.0)

- No macro system (planned for 2.0)
- No pattern matching / destructuring
- Classes must use s-expression syntax for members
- Method definitions in classes use `defn`
- No inline sclang escape hatch (use `.sc` files directly if needed)

### Performance

- scscm compiles to readable sclang code, which is then parsed by sclang
- No optimization happens at the scscm level
- sclang's tail-call optimization (if enabled) applies to compiled code
- Generated code has similar performance to hand-written sclang

### Naming Conventions

- Scheme uses lowercase with hyphens: `foo-bar`
- sclang uses camelCase: `fooBar`
- scscm automatically converts:
  - Hyphens → underscores: `foo-bar` → `foo_bar`
  - Trailing `?` → `_q`: `is-empty?` → `is_empty_q`
  - Trailing `!` → removed: `set-now!` → `set_now`

---

## Troubleshooting

### Error: "Unexpected token"

Check that your s-expressions are properly balanced:
- Every `(` has a matching `)`
- Every `[` has a matching `]`

```scheme
; ✗ Wrong - missing closing paren
(defn foo (x) (+ x 1)

; ✓ Correct
(defn foo (x) (+ x 1))
```

### Error: "Expected symbol after ':'"

Keywords must have a symbol following the colon:

```scheme
; ✗ Wrong
(dict :10 "value")

; ✓ Correct
(dict :key "value")
```

### Generated sclang doesn't run

Check the generated `.sc` file to see what was produced:

```bash
node hcl.js script.scscm -o script.sc
cat script.sc  # Review the generated code
```

Compare with equivalent hand-written sclang to spot differences.

### Syntax I want isn't supported

scscm is a minimal dialect. For unsupported syntax:

1. Write that part in native sclang directly
2. Use multiple `.scscm` files and combine outputs
3. Use the escape hatch: write `.sc` files for complex parts

---

## Examples

See `examples/` directory:

- `hello_scheme.scscm` - Basic expressions, variables, functions
- `sine_wave.scscm` - Simple SynthDef and synth creation
- `fm_synthesis.scscm` - More complex synthesis example

Run examples:

```bash
node hcl.js examples/sine_wave.scscm -o /tmp/sine.sc
node hcl.js examples/fm_synthesis.scscm --verbose
```

---

## SuperCollider Snippets Converted to scscm

Small examples adapted from official SuperCollider docs and rewritten in scscm.

### 1) Basic sine tone

```supercollider
{ SinOsc.ar(440, 0, 0.1) }.play;
```

```scheme
(. (fn ()
    (SinOsc.ar 440 0 0.1))
  play)
```

### 2) Two-channel detuned sine

```supercollider
{ [SinOsc.ar(440, 0, 0.1), SinOsc.ar(442, 0, 0.1)] }.play;
```

```scheme
(. (fn ()
    [(SinOsc.ar 440 0 0.1) (SinOsc.ar 442 0 0.1)])
  play)
```

### 3) Simple SynthDef and Synth

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

### 4) Perc envelope with doneAction

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

### 5) Mouse-controlled frequency

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

### 6) Write to bus and read back

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

### 7) Group ordering

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

### 8) Pseq stream values

```supercollider
p = Pseq([0, 2, 4, 7], 2).asStream;
p.nextN(8);
```

```scheme
(var p (. (Pseq (list 0 2 4 7) 2) asStream))
(. p nextN 8)
```

### 9) Basic Pbind pattern

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

### 10) Randomized frequency via LFNoise1

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

### 11) Pan a saw wave

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

### 12) Chord with mixed frequencies

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

---

## Next Steps

1. **Try the examples** - Start with `hello_scheme.scscm`
2. **Write your first synth** - Convert an existing `.sc` SynthDef to `.scscm`
3. **Combine with sc_cli** - Render audio to WAV files
4. **Explore macros** - Post-1.0 enhancement for advanced patterns

---

## More Information

- SuperCollider docs: https://supercollider.github.io/
- scscm grammar: see [SCSCM_SPEC.md](SCSCM_SPEC.md)
- Macros and shorthands: see [SCSCM_LANGUAGE_FEATURES.md](SCSCM_LANGUAGE_FEATURES.md)
- Report issues in the SuperCollider GitHub repository
