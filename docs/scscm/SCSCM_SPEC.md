# scscm Syntax Specification

## Notation

```
expr        = s-expression
list        = "(" expr* ")"
atom        = number | string | symbol | keyword
number      = integer | float
integer     = "-"? digit+
float       = "-"? digit+ "." digit+
string      = "\"" (\\ . | [^"])* "\""
symbol      = (letter | "-" | "_") (letter | digit | "-" | "_")*
keyword     = ":" symbol
```

## Grammar (BNF)

### Top-level

```
program     = expr*
expr        = atom
            | list
            | vector
            | quote
            | quasiquote
            | unquote

atom        = number | string | symbol | keyword

list        = "(" element* ")"
element     = expr

vector      = "[" element* "]"

quote       = "'" expr
quasiquote  = "`" expr
unquote     = "~" expr
```

### Special Forms

```
fn-expr     = "(" "fn" param-list body ")"
param-list  = "(" symbol* ")"
body        = expr*

defn-expr   = "(" "defn" symbol param-list body ")"

var-expr    = "(" "var" (symbol expr?)* ")"

set-expr    = "(" "set!" symbol expr ")"
            | "(" "set!" method-call expr ")"

let-expr    = "(" "let" bindings body ")"
bindings    = "(" binding* ")"
binding     = "(" symbol expr ")"

if-expr     = "(" "if" expr expr expr? ")"

cond-expr   = "(" "cond" clause* ")"
clause      = "(" expr expr ")"
            | "(" "else" expr ")"

dot-expr    = "(" "." expr symbol expr* ")"

class-expr  = "(" "class" symbol symbol member* ")"
member      = var-decl
            | classvar-decl
            | method-def

defmacro-expr = "(" "defmacro" symbol param-spec body ")"
param-spec    = "(" symbol* ")"             ; fixed params only
              | "(" symbol+ "." symbol ")"  ; fixed params + rest
body          = expr+
```

## Type Mapping

| Scheme Type | sclang Type | Example |
|------------|------------|---------|
| number     | Number     | 42, 3.14 |
| string     | String     | "hello" |
| symbol     | Symbol     | foo |
| keyword    | Symbol     | :freq |
| list       | Array      | [1, 2, 3] |
| vector     | Array      | [1, 2, 3] |

## Operator Precedence

All operators in scscm have the same precedence as function calls. Parentheses determine order of evaluation:

```scheme
(+ 1 (* 2 3))       ; Multiplication first: 1 + (2*3) = 7
(* (+ 1 2) 3)       ; Addition first: (1+2)*3 = 9
```

## Special Variables

```scheme
nil         ; null value
true        ; boolean true
false       ; boolean false
this        ; self reference (in methods)
super       ; superclass reference
```

## Comments

```scheme
; Single-line comment extends to end of line
; Every comment starts with semicolon

(+ 1 2) ; inline comments work too
```

## Name Conversion Rules

When compiling Scheme to sclang:

| Pattern | Conversion | Example |
|---------|-----------|---------|
| `foo-bar` | Hyphen to underscore | `foo_bar` |
| `is-empty?` | `?` suffix to `_q` | `is_empty_q` |
| `set-now!` | `!` suffix removed | `set_now` |
| `CamelCase` | Unchanged | `SinOsc` |

## Reserved Words (Special Forms)

These symbols have special meaning and cannot be used as regular function names:

```
fn          ; anonymous function
defn        ; named function definition
var         ; variable declaration
set!        ; assignment
let         ; local binding
if          ; conditional
cond        ; multi-branch conditional
.           ; method call
.dot        ; class method/constructor call
class       ; class definition
list        ; array literal
array       ; array literal (alias)
dict        ; dictionary literal
quote       ; quote form
quasiquote  ; quasiquote form
unquote     ; unquote form
super       ; superclass reference
this        ; self reference
defmacro    ; macro definition
```

## Macro System

`defmacro` defines a compile-time transformation. Macro bodies are evaluated by the scscm macro evaluator (not by sclang) before code generation runs. They have access to:

- `if`, `let`, `fn`, `quote`, `quasiquote` (`\`expr`), `unquote` (`~expr`), `unquote-splicing` (`~@expr`)
- Built-in predicates: `null?`, `symbol?`, `pair?`, `list?`, `number?`, `string?`
- List operations: `car`, `cdr`, `cons`, `list`, `append`, `length`
- `gensym` — returns a fresh unique symbol (for hygienic macros)
- `error` — raises a compile-time error

Parameter list syntax:

```scheme
(defmacro name (a b)       ...) ; two fixed params
(defmacro name (a . rest)  ...) ; one fixed + variadic rest
(defmacro name ()          ...) ; no params
```

The built-in `->` and `->>` threading macros are implemented in the stdlib using `defmacro`:

```scheme
; Thread-first: each step gets the accumulated value as its FIRST argument
(-> 440 (. midicps) (. mul 0.5))
; expands to: 440.midicps.mul(0.5)

; Thread-last: each step gets the accumulated value as its LAST argument
(->> [1 2 3] (collect (fn (x) (* x 2))) (select (fn (x) (> x 3))))
; expands to: select(collect([1, 2, 3], { |x| x * 2 }), { |x| x > 3 })
```

User-defined example:

```scheme
(defmacro when (condition body)
  `(if ~condition ~body nil))

(when (> freq 0)
  (. freq postln))
; compiles to: if (freq > 0) { freq.postln } { nil }
```

## Lexical Tokens

| Token | Regex | Example |
|-------|-------|---------|
| INTEGER | `-?[0-9]+` | 42, -5 |
| FLOAT | `-?[0-9]+\.[0-9]+` | 3.14, -2.5 |
| STRING | `"([^"\\]|\\.)*"` | "hello" |
| SYMBOL | `[a-zA-Z_-][a-zA-Z0-9_-]*` | foo, bar-baz |
| KEYWORD | `:[a-zA-Z_-][a-zA-Z0-9_-]*` | :freq, :doneAction |
| LPAREN | `(` | |
| RPAREN | `)` | |
| LBRACKET | `[` | |
| RBRACKET | `]` | |
| QUOTE | `'` | |
| QUASIQUOTE | `` ` `` | |
| UNQUOTE | `~` | |
| COLON | `:` | (for keywords) |

## Error Handling

Lexer errors:

```
- Unterminated string
- Invalid number format
- Invalid escape sequence
```

Parser errors:

```
- Unclosed parenthesis
- Unexpected token
- Mismatched brackets
```

Code generator errors:

```
- Invalid special form syntax
- Type mismatch (e.g., expecting symbol, got number)
- Unrecognized special form
```

## Examples

### Minimal valid program

```scheme
; Empty program (compiles to nothing)
```

```scheme
42  ; Single number
```

### Valid constructs

```scheme
; Variables
(var x 10)
(var x 10 y 20)
(var myArray (list 1 2 3))

; Functions
(fn (x) (+ x 1))
(defn double (x) (* x 2))

; Method calls
(. obj method)
(. obj method arg1 arg2)
(.dot Synth new)

; Control flow
(if (> x 10) "big" "small")
(let ((x 5)) (+ x 1))

; Collections
(list 1 2 3)
[1 2 3]
(dict :x 1 :y 2)

; Complex expressions
(SynthDef "sine"
  (fn (freq 440)
    (Out.ar 0 (SinOsc.ar freq 0))))

; Threading macros (stdlib defmacro)
(-> 440
  (. midicps)
  (. mul 0.5))
; compiles to: 440.midicps.mul(0.5)

(->> [1 2 3]
  (collect (fn (x) (* x 2)))
  (select (fn (x) (> x 3))))
; compiles to: select(collect([1, 2, 3], { |x| x * 2 }), { |x| x > 3 })

; User-defined macros
(defmacro when (c body)
  `(if ~c ~body nil))

(when (> freq 0)
  (. freq postln))
```

## Limitations

1. **No tail calls in syntax** — tail calls are recognized by sclang at compile time
2. **No higher-order macros** — cannot generate new special forms at compile time
3. **No pattern matching** — simple binding only
4. **No type annotations** — all types are inferred by sclang
5. **No module system** — each file is independent

---

*This specification describes scscm version 1.0*
