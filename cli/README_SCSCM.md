# scscm CLI - Scheme-like SuperCollider Compiler

Compile Scheme-like syntax to SuperCollider code.

## Usage

```bash
node lhc.js [OPTIONS] INPUT

Options:
  -i, --input FILE        Input .scscm file
  -o, --output FILE       Output .sc file (optional, stdout if not set)
  --to-sc                 Only compile to .sc, don't run sclang
  -v, --verbose           Verbose output
  -h, --help              Show help
```

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

## Files

- `scscm_lexer.js` - Tokenizer
- `scscm_parser.js` - Parser (lexer output → AST)
- `scscm_codegen.js` - Code generator (AST → sclang)
- `lhc.js` - CLI entry point
- `test_scscm.js` - Test suite
- `examples/` - Example .scscm files

## Documentation

- `docs/scscm/SCSCM_GUIDE.md` - Comprehensive guide and examples
- `docs/scscm/SCSCM_SPEC.md` - Formal syntax specification
- `docs/scscm/SCSCM_LANGUAGE_FEATURES.md` - Macro and shorthand reference

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

1. **Read** `docs/SCSCM_GUIDE.md` for detailed syntax and patterns
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

## More Information

- SuperCollider: https://supercollider.github.io/
- Scheme language: https://en.wikipedia.org/wiki/Scheme_(programming_language)
- Lisp tutorial: http://www.gigamonkeys.com/book/

---

**Version 1.0** - Initial public release
