# scscm Sweet-Expression Syntax Specification

**Date**: 2026-05-10  
**Version**: 0.1 (Draft)  
**Status**: Active Development  

This document defines the sweet-expression syntax supported by scscm, following the staged rollout model observed in the `fith` reference implementation. The goal is to provide an optional, more readable surface syntax while maintaining 100% backward compatibility with existing s-expression `.scscm` code.

---

## 1. Syntax Tiers

The implementation follows a phased approach mirroring `../fith`:

| Tier | Name | Description | Status |
|------|------|-------------|--------|
| M1 | Curly/Neoteric Subset | Curly-infix `{a + b}` + neoteric `f(x)` sugar | MVP - Phase 1 |
| M2 | Full Sweet-Exp | Indentation-based grouping | MVP - Phase 2 |
| Deferred | Advanced Forms | Quasiquote interactions, exotic operators | Post-MVP |

---

## 2. Grammar Reference

### 2.1 Lexical Structure

#### Whitespace
- Spaces, tabs, and newlines are generally insignificant except where they affect token boundaries
- Indentation (spaces/tabs at start of line) is significant for M2 tier grouping

#### Comments
- Line comments: `; comment text` (same as s-expressions)
- Block comments: Not supported in MVP (deferred)

#### Atoms
All s-expression atoms remain valid:
- **Symbols**: `foo`, `bar-123`, `+`, `-`, `*`, `/`, `%`, `->`, `=>`, etc.
- **Numbers**: `42`, `-3.14`, `0.5`
- **Strings**: `"hello"`, `"line1\nline2"`
- **Booleans**: `#t`, `#f`
- **Keywords**: `:freq`, `:amp` (same `:` prefix syntax)
- **Special**: `nil` / `'()`

#### Parentheses
- `(` and `)` for explicit lists (always valid, can be mixed with sugar)
- `[` and `]` for vectors
- `{` and `}` for curly-infix forms (M1)

---

## 3. Tier M1: Curly/Neoteric Subset

### 3.1 Curly-Infix Forms

**Purpose**: Allow infix notation for homogeneous operators within curly braces.

**Syntax**:
```
{ left OP right }
{ a + b }
{ x * y + z }
```

**Semantics**: 
- Homogeneous operators only (all operators in a curly form must be the same type)
- Left-associative by default
- Lowered to s-expression form: `{a + b}` → `(+ a b)`
- Mixed operators in a single curly form produce an error in M1

**Supported operators**:
| Operator | S-Expression Equivalent |
|----------|------------------------|
| `+` | `(+ a b)` |
| `-` | `(- a b)` |
| `*` | `(* a b)` |
| `/` | `(/ a b)` |
| `=` | `(= a b)` |
| `<` | `(< a b)` |
| `>` | `(> a b)` |
| `<=` | `(<= a b)` |
| `>=` | `(>= a b)` |

**Examples**:
```scscm
; Valid M1:
{ a + b }           ; → (+ a b)
{ x * y * z }       ; → (* x y z)  (left-associative)
{ freq = 440 }      ; → (= freq 440)

; Invalid M1 (mixed operators - error):
{ a + b * c }       ; ERROR: mixed operators in curly form
```

### 3.2 Neoteric Call Sugar

**Purpose**: Allow function call syntax without spaces between function name and parentheses.

**Syntax**:
```
f(args)        ; → (f args)
f[args]        ; → (f args)  (bracket variant)
f{args}        ; → (f args)  (brace variant)
```

**Trigger condition**: No whitespace between function name and opening delimiter.

**Examples**:
```scscm
; Valid M1:
printf("hello")      ; → (printf "hello")
add(1 2)          ; → (add 1 2)
sin(x)           ; → (sin x)

; With spaces (regular s-expression):
printf ("hello")     ; → (printf "hello")  (same, but parsed differently)
add (1 2)         ; → (add (1 2))  (different! space breaks the sugar)

; Bracket variants:
foo[x y]          ; → (foo x y)
bar{a b}          ; → (bar a b)
```

**Edge cases**:
- Empty argument list: `f()` → `(f)`
- Nested: `f(g(x))` → `(f (g x))`
- Mixed: `f(x (g y))` → `(f x (g y))`

---

## 4. Tier M2: Full Sweet-Expression Syntax

### 4.1 Indentation-Based Grouping

**Purpose**: Allow s-expression nesting based on indentation rather than explicit parentheses.

**Rules**:
1. Each top-level form is separated by one or more newlines
2. Indentation increase starts a new nested group
3. Indentation decrease closes one or more groups
4. Same indentation level continues the current group

**Syntax**:
```scscm
; Top-level forms separated by newlines
defn add
  x y
  + x y

defn mul
  x y
  * x y

; Equivalent to:
(defn add (x y) (+ x y))
(defn mul (x y) (* x y))
```

**Indentation levels**:
- Use spaces only (tabs converted to spaces internally)
- Recommended: 2 spaces per indentation level
- Required: consistent indentation within a block

### 4.2 Grouping Examples

```scscm
; Single-level nesting
play
  Synth:new \kick

; Multi-level nesting
defn nested
  x
  defn inner
    y
    + x y
  inner 5

; Mixed explicit and implicit
(defn mixed
  (x y)
  + x
    * y 2)
```

### 4.3 Line Joining

**Purpose**: Allow breaking long lines while maintaining grouping.

**Syntax**:
- Backslash at end of line: `\`
- Lines joined before indentation parsing

**Examples**:
```scscm
; Without line join (two separate forms):
a
b

; With line join (one form with two elements):
a \
  b

; In function calls:
printf \
  "long string \
   that spans lines"
```

---

## 5. Mixed Mode

Explicit parentheses can be mixed freely with sweet-exp syntax:

```scscm
; All equivalent:
(+ 1 (add 2 3))
+ 1 (add 2 3)
{1 + (add 2 3)}

; Nested mixing:
(defn foo
  (x y)
  { x + 
    (mul y 
      { a + b }) })
```

---

## 6. Parity Table

This table defines the expected behavior of scscm sweet-exp compared to Racket sweet-exp and the `fith`/turmeric reference implementation.

### 6.1 Core Syntax

| Feature | Racket sweet-exp | turmeric/fith | scscm Target | Status |
|---------|-----------------|---------------|--------------|--------|
| Curly infix `{a + b}` | Yes | Yes (M1) | Yes | MVP |
| Neoteric `f(x)` | Yes | Yes (M1) | Yes | MVP |
| Neoteric `f[x]` | Yes | Yes (M1) | Yes | MVP |
| Neoteric `f{x}` | Yes | Yes (M1) | Yes | MVP |
| Indentation grouping | Yes | Planned | Yes | MVP |
| Line joining with `\` | Yes | Yes | Yes | MVP |
| Top-level newline separation | Yes | Yes | Yes | MVP |
| Explicit parens | Yes | Yes | Yes | MVP |
| Mixed explicit + implicit | Yes | Yes | Yes | MVP |

### 6.2 Operators

| Operator | Racket | turmeric | scscm | Notes |
|----------|--------|----------|-------|-------|
| `+` | Homogeneous | Homogeneous | Homogeneous | MVP |
| `-` | Homogeneous | Homogeneous | Homogeneous | MVP |
| `*` | Homogeneous | Homogeneous | Homogeneous | MVP |
| `/` | Homogeneous | Homogeneous | Homogeneous | MVP |
| `=` | Homogeneous | Homogeneous | Homogeneous | MVP |
| `<`, `>`, `<=`, `>=` | Homogeneous | Homogeneous | Homogeneous | MVP |
| Mixed operators in `{}` | Error | Error | Error | MVP |
| Heterogeneous operators | Supported | Deferred | Deferred | Post-MVP |

### 6.3 Advanced Forms

| Feature | Racket | turmeric | scscm | Status |
|---------|--------|----------|-------|--------|
| `GROUP` operator | Yes | Deferred | Deferred | Post-MVP |
| `SPLIT` operator | Yes | Deferred | Deferred | Post-MVP |
| Collecting lists `[a b, c]` | Yes | Deferred | Deferred | Post-MVP |
| Quasiquote sweet interactions | Yes | Deferred | Deferred | Post-MVP |
| Reader macros | Yes | Partial | Deferred | Post-MVP |

### 6.4 Error Handling

| Case | Racket | turmeric | scscm | Notes |
|------|--------|----------|-------|-------|
| Invalid dedent | Error with context | Error | Error with line/col | MVP |
| Mixed operators in `{}` | Error | Error | Error | MVP |
| Unclosed `{` | Error | Error | Error | MVP |
| Unclosed `(` | Error | Error | Error | MVP |
| Invalid neoteric syntax | Error | Error | Error | MVP |

---

## 7. MVP Feature Examples

### 7.1 Positive Examples (Must Work)

```scscm
; Curly infix
{ a + b }
{ x * y + z }
{ freq = 440.0 }

; Neoteric
sin(x)
printf("value: %f" x)
add[1 2 3]

; Indentation grouping
defn kick
  freq 60
  amp 0.5
  env (Env:new \perc 0.01 0.3)

; Mixed mode
(defn play-note
  (freq amp)
  { Synth:new \kick 
    [\freq freq \amp amp] })

; Line joining
play Synth:new \
  \kick 
  [\freq 440 \amp 0.5]
```

### 7.2 Negative Examples (Must Error)

```scscm
; Mixed operators in curly (M1)
{ a + b * c }     ; ERROR: mixed operators

; Invalid dedent
  defn foo
 x                ; ERROR: inconsistent indentation

; Unclosed delimiters
{ a + b          ; ERROR: unclosed curly
f(x              ; ERROR: unclosed paren
```

---

## 8. Canonical Equivalences

This section shows sweet-exp forms and their exact s-expression equivalents.

| Sweet-exp | S-expression |
|-----------|--------------|
| `{a + b}` | `(+ a b)` |
| `{a + b + c}` | `(+ a b c)` |
| `{a = b}` | `(= a b)` |
| `f(x)` | `(f x)` |
| `f(x y)` | `(f x y)` |
| `f[x]` | `(f x)` |
| `f{x}` | `(f x)` |
| `f()` | `(f)` |
| `f(g(x))` | `(f (g x))` |
|
```
defn add
  x y
  + x y
```| `(defn add (x y) (+ x y))` |
|
```
play
  Synth:new \kick
```| `(play (Synth:new \kick))` |

---

## 9. Implementation Notes

### 9.1 Normalization Contract

The sweet reader must:
1. Accept any valid s-expression as input (pass-through)
2. Transform sweet-exp syntax to canonical s-expressions
3. Preserve line/column information for error reporting via source maps
4. Handle edge cases: strings containing `{` or `}`, comments with sugar-like content

### 9.2 Source Map Requirements

The `normalizeSweetToSexpr` function returns:
```javascript
{
  source: string,  // Canonical s-expression text
  map: SourceMap   // Maps sweet source positions to output positions
}
```

Where `SourceMap` provides:
- `getOriginalPosition(line, column)` → `{ line, column }` in sweet source
- `getGeneratedPosition(line, column)` → `{ line, column }` in output

### 9.3 Error Reporting

Errors from the sweet reader must include:
- Error type (syntax error, indentation error, etc.)
- Line and column in sweet source
- Contextual message describing the issue

---

## 10. Deferred Features

The following are explicitly out of scope for MVP:

1. **Advanced sweet group forms**: `GROUP`, `SPLIT`, collecting lists
2. **Quasiquote interactions**: Special handling of quasiquotes with sweet grouping
3. **Heterogeneous infix**: Mixed operators like `{a + b * c}` with proper precedence
4. **Reader macros**: Custom reader extensions
5. **Block comments**: `/* ... */` style (use `;` for now)
6. **Custom indentation rules**: Non-standard indentation behaviors

These may be added in post-MVP phases based on user feedback and parity requirements.

---

## 11. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-05-10 | 0.1 | - | Initial draft based on SCSCM_SWEET_EXP_PLAN.md |
