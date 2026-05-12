# scscm CLI - Scheme-like SuperCollider Compiler

Compile Scheme-like syntax to SuperCollider code.

## Usage

```bash
node lhc.js [OPTIONS] INPUT

Options:
  -i, --input FILE        Input .scscm file
  -o, --output FILE       Output .sc file (optional, stdout if not set)
  --to-sc                 Only compile to .sc, don't run sclang
  --syntax auto|sexpr|sweet  Syntax mode (default: auto)
  -v, --verbose           Verbose output
  -h, --help              Show help
```

### Syntax Modes

- `auto`: Detects syntax automatically (default, currently same as `sexpr`)
- `sexpr`: Standard s-expression syntax only (original behavior)
- `sweet`: Enables sweet-expression syntax support (indentation, curly-infix, neoteric)

## Examples

### Basic compilation

```bash
# Compile to file
node lhc.js sine.scscm --output sine.sc

# Print to stdout
node lhc.js sine.scscm
```

### With verbose output

```bash
node lhc.js script.scscm -v
```

### Integration with hc

```bash
# Compile and generate audio
node lhc.js sine.scscm | node hc.js --output sine.wav
```

### Sweet-Expression Syntax

Enable sweet-exp syntax with the `--syntax sweet` flag:

```bash
# Compile sweet-exp file
node lhc.js synth.scscm --syntax sweet -o synth.sc

# Pipe through hclang
node lhc.js sweet_synth.scscm --syntax sweet | node hc.js --output sweet.wav
```

See [docs/scscm/SCSCM_SWEET_EXP_QUICK_START.md](../docs/scscm/SCSCM_SWEET_EXP_QUICK_START.md) for a complete guide to sweet-expression syntax in scscm.

## Files

- `scscm_lexer.js` - Tokenizer
- `scscm_parser.js` - Parser (lexer output → AST)
- `scscm_codegen.js` - Code generator (AST → sclang)
- `lhc.js` - CLI entry point
- `test_scscm.js` - Test suite
- `examples/` - Example .scscm files

## Documentation

- `docs/scscm/SCSCM_QUICK_START.md` — 5-minute first-patch onboarding
- `docs/scscm/SCSCM_LIVE_CODING_TUTORIAL.md` — Hands-on guided ambient project
- `docs/scscm/SCSCM_PATTERN_TECHNIQUES.md` — Gallery of pattern strategies
- `docs/scscm/SCSCM_CHEAT_SHEET.md` — One-page syntax lookup
- `docs/scscm/SCSCM_LANGUAGE_REFERENCE.md` — Authoritative spec (BNF, macros, sclang→scscm migration appendix)
- `docs/scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md` — Roadmap (destructuring, match, loop/recur, …)
- `docs/scscm/SCSCM_SWEET_EXP_QUICK_START.md` — Sweet-expression syntax guide
- `docs/scscm/SCSCM_SWEET_EXP_SPEC.md` — Sweet-exp technical specification
- `docs/scscm/SCSCM_SWEET_EXP_PARITY_REPORT.md` — Parity report with turmeric/fith

## Example Scripts

- `examples/sine_wave.scscm` - Simple sine wave SynthDef
- `examples/fm_synthesis.scscm` - FM synthesis
- `examples/hello_scheme.scscm` - Basic language features

## Testing

```bash
node test_scscm.js
```

Runs lexer, parser, code generator, and integration tests.

## Implementation

scscm is a three-stage compiler:

1. **Lexer** (`scscm_lexer.js`) - Tokenizes Scheme source
2. **Parser** (`scscm_parser.js`) - Builds abstract syntax tree
3. **Code Generator** (`scscm_codegen.js`) - Emits sclang source

All components use only Node.js built-ins (no external dependencies).

## Integration with SuperCollider WASM CLI

scscm works with the existing WASM CLI tools:

```bash
# Compile and render audio
node lhc.js examples/sine_wave.scscm -o /tmp/sine.sc
node hc.js --script /tmp/sine.sc --output sine.wav

# One-liner with piping
node lhc.js examples/sine_wave.scscm | node hc.js --output sine.wav
```

## Project Structure

```
platform/wasm/cli/
├── scscm_lexer.js          # Scheme tokenizer
├── scscm_parser.js         # Scheme parser → AST
├── scscm_codegen.js        # AST → sclang code
├── lhc.js            # CLI entry point
├── test_scscm.js           # Test suite
├── package.json            # npm metadata
├── README_SCSCM.md         # This file
├── examples/
│   ├── sine_wave.scscm
│   ├── fm_synthesis.scscm
│   └── hello_scheme.scscm
└── ...
```

## Supported Constructs

### Core Language Features

- Numbers: `42`, `3.14`, `-5`
- Strings: `"hello"`
- Symbols: `foo`, `foo-bar`
- Keywords: `:freq`, `:amp`
- Comments: `; comment`

### Collections

- Arrays: `(list 1 2 3)` or `[1 2 3]`
- Dictionaries: `(dict :key value :key2 value2)`

### Functions

- Anonymous: `(fn (x) (+ x 1))`
- Named: `(defn add (a b) (+ a b))`

### Control Flow

- Conditionals: `(if cond then-expr else-expr)`
- Multi-branch: `(cond (test1 expr1) (test2 expr2) (else expr3))`
- Bindings: `(let ((x 10)) (+ x 5))`

### Method Calls

- Instance: `(. object method arg)`
- Class: `(.dot Class method arg)`

### Variables

- Declaration: `(var x 10)`
- Assignment: `(set! x 20)`

### Sweet-Expression Syntax (with `--syntax sweet`)

**Curly-Infix (M1 Tier):**
- Arithmetic: `{a + b}` → `(+ a b)`
- Comparison: `{x < y}` → `(< x y)`
- Logic: `{a and b}` → `(and a b)`

**Neoteric Call Sugar (M1 Tier):**
- Function calls: `f(x, y)` → `(f x y)`
- Bracket calls: `f[x, y]` → `(f x y)`
- Curly calls: `f{x y}` → `(f x y)`

**Indentation-Based Grouping (M2 Tier):**
- Indented blocks are automatically grouped into s-expressions
- Line continuation with backslash: `play \\`

## Limitations

- No macro system (planned for 2.0)
- No pattern matching / destructuring
- Classes must use s-expression syntax
- No inline sclang escape hatch (use .sc files directly if needed)

## Performance

- Compiles to readable sclang code
- sclang parser then compiles to bytecode
- sclang's tail-call optimization applies (if enabled)
- Generated code has similar performance to hand-written sclang

## Next Steps

1. **Read** `docs/scscm/SCSCM_QUICK_START.md` for 5-minute onboarding, then `docs/scscm/SCSCM_LANGUAGE_REFERENCE.md` for detailed syntax
2. **Try** examples in `examples/` directory
3. **Write** your first SynthDef in Scheme
4. **Run** tests to verify implementation: `node test_scscm.js`

## Troubleshooting

**Error: "Unexpected token"**
- Check for balanced parentheses and brackets

**Error: "Expected symbol"**
- Keywords like `:freq` must be followed by a space and not used as identifiers

**Generated code doesn't run**
- Check the generated .sc file: `node lhc.js input.scscm -o output.sc && cat output.sc`
- Compare with equivalent hand-written sclang

**Sweet-exp specific issues**
- Ensure you're using `--syntax sweet` flag
- Indentation must be consistent (2 spaces recommended)
- Mixed operators in curly-infix like `{a + b * c}` are not yet supported — use explicit parentheses
- See [SCSCM_SWEET_EXP_QUICK_START.md](../docs/scscm/SCSCM_SWEET_EXP_QUICK_START.md) for details

## More Information

- SuperCollider: https://supercollider.github.io/
- Scheme language: https://en.wikipedia.org/wiki/Scheme_(programming_language)
- Lisp tutorial: http://www.gigamonkeys.com/book/

---

**Version 1.0** - Initial public release
