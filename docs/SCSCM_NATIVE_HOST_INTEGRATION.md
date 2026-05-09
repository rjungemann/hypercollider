# SCSCM Native Host Integration - Phase H3

This document describes the integration of scscm (Scheme-like SuperCollider) support into the native hclang host (`hclang_native`).

## Overview

The native hclang host is a C++ application that uses WAMR (WebAssembly Micro Runtime) to run SuperCollider sclang code compiled to WASM. Phase H3 adds support for compiling and running scscm code directly.

## Current Implementation (Contingency Approach 4a)

The current implementation uses a **subprocess approach** where the native binary calls out to Node.js to run the scscm compiler (`cli/lhc.js`). This is the contingency approach mentioned in the plan (Option 4a).

### Key Features

1. **CLI Support**: The `--script` option now accepts `.scscm` files
2. **Language Detection**: Automatic detection from file extension (.scscm → scscm mode)
3. **Language Override**: Use `--lang scscm` or `--lang scd` to force a specific language
4. **Debug Output**: Use `--scscm-debug` to write the compiled sclang to a `.compiled.sc` file
5. **REPL Support**: Use `.scscm` to enter scscm mode, `.sc` to return to sclang mode

### Usage Examples

```bash
# Run a scscm file (auto-detected from extension)
hclang_native --script piece.scscm

# Force scscm mode for a file without .scscm extension
hclang_native --script piece.txt --lang scscm

# Write compiled sclang output for debugging
hclang_native --script piece.scscm --scscm-debug

# REPL with scscm support
hclang_native --repl
# Type .scscm to enter scscm mode
# Type .sc to return to sclang mode
```

### Implementation Details

The subprocess approach is implemented in `native/hclang_host/main.cpp`:

- **`detect_lang_from_filename()`**: Detects language from file extension
- **`compile_scscm_to_sclang()`**: Calls `node cli/lhc.js` to compile scscm to sclang
- **Updated script execution**: Compiles scscm before passing to WASM
- **Updated REPL loop**: Handles `.scscm` and `.sc` commands, compiles scscm code in scscm mode

## Future Implementation (Preferred Approach 4b)

The preferred long-term solution is to bundle the scscm compiler as a WASM module using QuickJS-NG as the JavaScript runtime. This will allow the native binary to work without requiring Node.js to be installed.

### Planned Architecture

1. **QuickJS-NG Runtime**: Vendor QuickJS-NG via CPM/FetchContent
2. **Bundle Compiler JS**: Use esbuild to bundle the four pure-JS compiler modules (`lhc_lexer.js`, `lhc_parser.js`, `lhc_codegen.js`, `lhc_macros.js`) into a single `lhc_bundle.js`
3. **C Wrapper**: Create a thin C wrapper (`native/scscm_wasm/wrapper.c`) that:
   - Initializes QuickJS runtime
   - Evaluates `lhc_bundle.js` into the QuickJS context
   - Exposes `compile_scscm()` function callable from C
4. **CMake Integration**: Add `native/scscm_wasm/CMakeLists.txt` to compile the wrapper + QuickJS + bundled JS to `scscm_compiler.wasm`
5. **WAMR Host Integration**: Extend `WasmHost` to manage multiple modules, load the compiler module lazily, and call into it for scscm compilation

### Directory Structure

```
native/
├── CMakeLists.txt                    # Parent CMake file
├── scscm_wasm/
│   ├── CMakeLists.txt                # Compiler WASM build rules (placeholder)
│   └── wrapper.c                     # C wrapper for QuickJS (placeholder)
└── hclang_host/
    ├── CMakeLists.txt
    └── main.cpp                      # Updated with scscm support
```

## Testing

### Parity Tests

Parity tests verify that the scscm compilation produces the same output across different implementations.

- **Test Location**: `test/fixtures/scscm_parity/`
- **Test Runner**: `test/scscm_parity.sh`
- **Current Fixtures**:
  - `hello.scscm`: Basic variable and function test
  - `defn.scscm`: Function definition test
  - `var.scscm`: Variable definition test
  - `if.scscm`: Conditional test

Run the tests:
```bash
./test/scscm_parity.sh
```

### Adding New Fixtures

1. Create a new `.scscm` file in `test/fixtures/scscm_parity/`
2. Run the test to verify it compiles correctly
3. Commit the fixture

## Building

### Prerequisites

For the current subprocess approach:
- Node.js (for running the scscm compiler)
- Standard C++ build toolchain

For the future WASM-bundled approach:
- Emscripten (for compiling to WASM)
- QuickJS-NG (will be vendored)
- esbuild (for bundling JS modules)

### Build Options

The native binary currently uses subprocess for scscm compilation. When the WASM-bundled compiler is implemented, it will be embedded by default with an option to disable it.

## Known Limitations

1. **Node.js Dependency**: The current implementation requires Node.js to be installed for scscm compilation
2. **Subprocess Overhead**: Each scscm file compilation spawns a new Node.js process (mitigated by caching in REPL mode)
3. **No WASM Bundle Yet**: The WASM-bundled compiler (4b) is not yet implemented

## Related Documents

- [HCLANG_SCSCM_INTEGRATION_PLAN.md](./HCLANG_SCSCM_INTEGRATION_PLAN.md) - Main integration plan
- [HCLANG_NATIVE_PLAN.md](./HCLANG_NATIVE_PLAN.md) - Native host plan
- [scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md](../scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md) - Future language features
