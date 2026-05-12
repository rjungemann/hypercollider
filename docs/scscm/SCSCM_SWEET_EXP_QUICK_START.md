# scscm Sweet-Expression Quick Start

**Version**: 0.2 (M2 Phase)  
**Date**: 2026-05-10  

This guide will get you started with sweet-expression syntax in scscm. Sweet-exp provides a more readable, indentation-friendly surface syntax for Lisp-style code while maintaining 100% backward compatibility with existing s-expression `.scscm` files.

---

## What is Sweet-Expression Syntax?

Sweet-exp is a family of surface syntaxes for s-expression languages that uses indentation and familiar infix notation to make Lisp code more readable for newcomers. Originally developed for Racket, sweet-exp has been adapted for scscm with the following features:

### Supported Features (M1 + M2)

| Feature | Example | S-Expression Equivalent |
|---------|---------|------------------------|
| **Curly Infix** | `{a + b}` | `(+ a b)` |
| **Neoteric Calls** | `sin(x)` | `(sin x)` |
| **Bracket Calls** | `foo[x]` | `(foo x)` |
| **Brace Calls** | `bar{a b}` | `(bar a b)` |
| **Indentation Grouping** | `play\n  Synth:new` | `(play (Synth:new ...))` |

---

## Quick Examples

### Basic Arithmetic

```scscm
; Traditional s-expressions
(+ 1 2)
(* 3 4)

; With curly infix
{ 1 + 2 }
{ 3 * 4 }
```

### Function Calls

```scscm
; Traditional
(sin 440.0)
(printf "Hello")

; Neoteric sugar
sin(440.0)
printf("Hello")

; Bracket/brace variants
sin[440.0]
printf{a b}
```

### Indentation-Based Grouping

```scscm
; Traditional
(defn kick
  (freq amp)
  (+ freq 100))

; With indentation grouping
defn kick
  freq amp
  + freq 100
```

### Mixed Mode

You can freely mix all syntax styles:

```scscm
; All valid and equivalent
(+ 1 add(2 3))
(+ 1 (add 2 3))
(+ {1 + 2} 3)

; Indentation with sugar
defn play-note
  freq
  Synth:new(\kick [\freq freq])
```

---

## Syntax Reference

### Curly-Infix Forms (M1)

Curly braces allow infix notation for operators:

```scscm
{ a + b }      ; → (+ a b)
{ x * y }      ; → (* x y)
{ a - b }      ; → (- a b)
{ a / b }      ; → (/ a b)
{ a = b }      ; → (= a b)
{ a < b }      ; → (< a b)
{ a > b }      ; → (> a b)
{ a <= b }     ; → (<= a b)
{ a >= b }     ; → (>= a b)

; Chained operators (left-associative)
{ a + b + c }  ; → (+ a b c)
{ x * y * z }  ; → (* x y z)
```

**Important**: All operators in a single curly form must be the same type. Mixed operators like `{a + b * c}` will produce an error.

### Neoteric Call Sugar (M1)

Function calls can use familiar syntax without spaces between the function name and parentheses:

```scscm
; Parentheses
sin(x)
add(1 2)
printf("value: %f" x)

; Square brackets
foo[x y]

; Curly braces
bar{a b}

; Nested calls
f(g(x))
outer(inner(a b) c)

; Empty arguments
f()  ; → (f)
```

**Note**: With a space, it's NOT neoteric:
```scscm
sin (x)  ; → (sin (x)) - sin is called with argument (x), which is a list
sin(x)   ; → (sin x)    - sin is called with argument x
```

### Indentation Grouping (M2)

Lines indented relative to a previous line become arguments to that line's form:

```scscm
; Single indented line
play
  Synth:new(\kick)
; → (play (Synth:new \kick))

; Multiple indented lines (same level)
defn add
  x y
  + x y
; → (defn add (x y) (+ x y))

; Nested indentation
play
  Synth:new(\kick)
    [\freq 440]
; → (play (Synth:new \kick ( [\freq 440] )))
```

**Indentation Rules:**
- Use spaces (recommended: 2 spaces per level)
- Consistent indentation is required
- Tabs are converted to spaces
- Empty lines are ignored

### Line Continuation

Long lines can be broken with backslash:

```scscm
play Synth:new \
  \kick 
  [\freq 440]
; → (play (Synth:new \kick [\freq 440]))
```

---

## Using Sweet-Exp with scscm

### Command-Line

The `--syntax` flag controls which syntax mode to use:

```bash
# Use sweet-expression syntax
scscm --syntax sweet my_file.scscm -o my_file.sc

# Use traditional s-expressions (default)
scscm my_file.scscm -o my_file.sc

# Auto mode (currently same as sexpr)
scscm --syntax auto my_file.scscm -o my_file.sc
```

### With hclang (One-Step Compilation)

```bash
# Offline compilation
hclang --script sweet_file.scscm --output commands.json --syntax sweet

# Live routing
hclang --script sweet_file.scscm --scsynth-host 127.0.0.1 --scsynth-port 57110 --syntax sweet
```

### Programmatic API (Node.js)

```javascript
const { compileScscmText } = require('./lhc_compile');

// Compile with sweet syntax
const sclangCode = compileScscmText(`
  defn kick
    freq 60
    Synth:new(\kick [\freq freq])
`, 'kick.scscm', { syntax: 'sweet' });

// Compile with traditional s-expressions
const sclangCode = compileScscmText(`
  (defn kick (freq) (Synth:new \kick [\freq freq]))
`, 'kick.scscm', { syntax: 'auto' });
```

---

## Complete Examples

### Example 1: Kick Drum Synth

**Traditional s-expressions:**
```scscm
(defn kick
  (freq 60)
  (amp 0.5)
  (let* ((env (Env:new \perc 0.01 0.5))
         (sig (SinOsc:ar freq 0.5))
         (filtered (RLPF:ar sig (* freq 2) 0.3))
    (Pan2:ar (* amp env filtered))))
```

**Sweet-expression version:**
```scscm
defn kick
  freq 60
  amp 0.5
  let*
    env (Env:new \perc 0.01 0.5)
    sig (SinOsc:ar freq 0.5)
    filtered (RLPF:ar sig { freq * 2 } 0.3)
    Pan2:ar (* amp env filtered)
```

### Example 2: Using Curly Infix

```scscm
defn scale-freq
  base
  ratio
  { base * ratio }

; Equivalent to:
; (defn scale-freq (base ratio) (* base ratio))
```

### Example 3: Mixed Mode

```scscm
; All valid in the same file
defn process
  input
  gain
  { input * gain }

play
  Synth:new(\sine [\freq 440 \amp 0.5])
```

---

## Common Patterns

### Function Definitions

```scscm
; Traditional
defn name (arg1 arg2) (body)

; Sweet-exp
defn name
  arg1 arg2
  body
```

### Let Bindings

```scscm
; Traditional
(let ((x 10) (y 20)) (+ x y))

; Sweet-exp
let
  x 10
  y 20
  + x y
```

### Conditional Logic

```scscm
; Traditional
(if (> x 0) (sin x) 0)

; Sweet-exp (using curly for condition)
if { x > 0 }
  sin(x)
  0
```

---

## Error Handling

Common errors and how to fix them:

### Error: Mixed operators in curly form

```scscm
{ a + b * c }  ; ERROR: Mixed operators
```

**Fix**: Use homogeneous operators or break into separate forms:
```scscm
; Option 1: Use same operator
{ a + b + c }

; Option 2: Use explicit parens
(+ a (* b c))
```

### Error: Unclosed delimiter

```scscm
sin(x  ; ERROR: Unclosed parenthesis
```

**Fix**: Close all parentheses, brackets, and braces:
```scscm
sin(x)
```

### Error: Invalid indentation

```scscm
defn foo
 x  ; ERROR: Inconsistent indentation
  y
```

**Fix**: Use consistent indentation (recommended 2 spaces):
```scscm
defn foo
  x
  y
```

---

## Best Practices

1. **Start with s-expressions**: If you're new to Lisp, start with traditional s-expressions to understand the core concepts.

2. **Use curly infix for readability**: Curly infix is great for mathematical expressions and comparisons.

3. **Use neoteric sugar sparingly**: Neoteric call sugar (`f(x)`) can make code more familiar, but mixing it with regular s-expressions can be confusing.

4. **Be consistent with indentation**: Stick to 2 spaces per indentation level for best results.

5. **Test in both modes**: Verify your code compiles in both `syntax: sweet` and `syntax: auto` modes to ensure portability.

6. **Use comments**: Sweet-exp strips line comments, so use them freely:
   ```scscm
   ; This is a comment
   defn foo
     x  ; parameter
     sin(x)  ; call sin
   ```

---

## Migration Guide

### Converting s-expressions to sweet-exp

| S-Expression | Sweet-Exp |
|---------------|----------|
| `(+ a b)` | `{a + b}` |
| `(sin x)` | `sin(x)` or `sin x` |
| `(f a b c)` | `f(a b c)` or `f a b c` |
| `(defn f (x) (+ x 1))` | `defn f\n  x\n  { x + 1 }` |

### Converting sweet-exp to s-expressions

Just compile with `syntax: sweet` - the output is always valid s-expressions that can be used anywhere.

---

## Known Limitations

The current implementation (M2 phase) has the following limitations:

1. **Indentation-only grouping**: The M2 indentation support is a simplified implementation. Complex nested indentation patterns may not work as expected.

2. **No advanced sweet-exp features**: Features like `GROUP`, `SPLIT`, and collecting lists are not yet implemented.

3. **Line comments only**: Block comments (`/* ... */`) are not supported. Use line comments (`;`) instead.

4. **No automatic mode detection**: The `syntax: auto` mode does not currently auto-detect sweet syntax. You must explicitly use `syntax: sweet`.

These limitations will be addressed in future phases.

---

## Reference

- [SCSCM Sweet-Expression Specification](SCSCM_SWEET_EXP_SPEC.md) - Complete syntax definition
- [SCSCM Language Reference](../SCSCM_LANGUAGE_REFERENCE.md) - Core scscm language
- [scscm Quick Start](../SCSCM_QUICK_START.md) - General scscm introduction

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-05-10 | 0.1 | Initial draft (M1 phase) |
| 2026-05-10 | 0.2 | Added M2 indentation support |
