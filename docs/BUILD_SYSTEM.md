# HyperCollider Build System Architecture

## Overview

HyperCollider compiles to multiple targets:
- **JS (WASM via Emscripten)** — Runs in browsers and Node.js
- **WASI (WebAssembly System Interface)** — Portable .wasm files for any WASM runtime
- **WAMR (WebAssembly Micro Runtime)** — Self-contained native binaries
- **AOT (Ahead-of-Time compiled)** — Pre-compiled native code for maximum performance

This complexity is intentional but non-obvious. This document explains why, the tradeoffs, and how the build system works.

---

## Why So Many Build Targets?

### The Problem

HyperCollider is a fork of SuperCollider (a 30-year-old native desktop audio language). The original codebase was designed to:
- Compile to native binaries (sclang, scsynth)
- Run on macOS, Linux, Windows
- Have tight OS integration

But the goal of HyperCollider is to run **everywhere**:
- In a web browser (AudioWorklet, WebAudio API)
- In Node.js CLI tools
- As standalone stateless binaries (CI, embedded systems, Raspberry Pi)
- With optional pre-compilation for speed

Running the same codebase in all these environments requires different compilation strategies.

### The Four Targets

| Target | Compilation | Runtime | Use Case |
|--------|-------------|---------|----------|
| **JS (WASM)** | Emscripten → .js + .wasm | Browser, Node.js v8 | Web IDE, CLI scripting |
| **WASI** | Emscripten → .wasm (WASI libc) | Any WASM VM (WASMTIME, WAMR, etc.) | Portable .wasm artifacts |
| **WAMR** | Emscripten → WASI .wasm, then link into native host | WAMR native runtime | Standalone CLI binaries |
| **WAMR AOT** | WAMR + wamrc (WAMR's AOT compiler) → native code | WAMR native runtime | Maximum performance |

---

## The wamrc Complexity Explained

### What is wamrc?

`wamrc` is the **WAMR AOT compiler** — a tool that compiles WebAssembly bytecode to native machine code. It's like `gcc` or `clang`, but for WASM.

### Why is it separate?

1. **It's not built by HyperCollider.** It's part of the BytecodeAlliance's WAMR project.
2. **It requires LLVM 17** — the compiler infrastructure. LLVM is:
   - ~500MB installed
   - Takes 5-10 min to build from source
   - Complex to get right on different platforms (macOS arm64, Linux x86_64, etc.)
3. **It's optional** — Not every user needs AOT compilation. Most development uses interpretation.

### Why LLVM 17 specifically?

WAMR 2.4.4 is pinned to LLVM 17 because:
- Different LLVM versions have incompatible C++ APIs
- Brew's default LLVM (v22) is too new and breaks wamrc
- The version must be coordinated with the WAMR release

### The Setup Dance

To build AOT binaries, the setup flow is:

```
1. Install LLVM 17 (system-wide, ~500MB)
   └─ brew install llvm@17  OR  apt install llvm-17

2. Clone WAMR from GitHub
   └─ Only happens when first WASM build is run (CMake fetch)

3. Build wamrc from WAMR source
   └─ Takes 2-3 minutes
   └─ Produces: build/native/_deps/wamr-src/wamr-compiler/build/wamrc

4. Symlink wamrc to PATH
   └─ ln -sf (build dir)/wamrc ~/.local/bin/wamrc

5. Add ~/.local/bin to PATH (shell profile change)
   └─ Requires reload: source ~/.zshrc
```

This is why `just setup-wamrc` automates all of it.

---

## Build System Tradeoffs

### Why Not Auto-Install LLVM on First Run?

**Pros:**
- Seamless experience, everything "just works"

**Cons:**
- First build of `just build-wamr-aot` takes 10-15 minutes (vs 2 min)
- Users who only want JS/browser builds are forced to install 500MB of LLVM
- Some environments don't have package managers (CI containers, custom setups)
- Surprising to users: they expect a build system to not auto-install system dependencies

**Decision:** Make it explicit with `just setup-wamrc`, but make the error message clear.

### Why Not Ship Pre-Built wamrc?

**Pros:**
- Avoid LLVM/build complexity entirely
- Faster first run

**Cons:**
- WAMR project releases new versions regularly (security, performance)
- Hard to support all architectures (macOS arm64, Linux x86_64, etc.)
- Repo size would grow significantly
- GitHub release artifacts can be outdated/deprecated

**Decision:** Build from source (requires LLVM but gives latest version).

### Why Three Separate Build Directories?

- `build/wasm` — JS pipeline (Emscripten)
- `build/wasi` — WASI pipeline (Emscripten with WASI libc)
- `build/native` — WAMR host binaries + AOT

**Why not merge them?**
Each uses different CMake presets, flags, and dependencies. The targets are largely independent:
- WASM JS builds only if you `just build`
- WASI only if you `just build-wasi`
- WAMR only if you `just build-wamr-host` or `just build-wamr-aot`

This keeps builds fast for users who only want one target.

---

## What Gets Cleaned?

When you run `just clean`, it deletes `build/wasm` (the JS pipeline). It **does not** delete:
- `build/wasi/` (WASI artifacts)
- `build/native/` (WAMR host + wamrc)

This is intentional: rebuilding the JS pipeline is fast (~2-3 min), but rebuilding WAMR artifacts takes much longer. However:

**If you want to fully clean:**
```bash
rm -rf build/
```

Then:
- WASI artifacts are gone (will rebuild on next `just build-wasi`)
- WAMR host is gone (will rebuild on next `just build-wamr-host`)
- **wamrc symlink breaks** (points to non-existent file)

To fix the broken wamrc symlink:
```bash
just setup-wamrc
```

The error message will tell you this automatically.

---

## Recommended Workflows

### I just want to test in the browser

```bash
source /path/to/emsdk/emsdk_env.sh   # One-time: set up Emscripten
just build                            # 2-3 min, produces JS + WASM
# Open src/platform/wasm/test/sc_ide.html in browser
```

### I want standalone CLI binaries

```bash
just build-all                        # 5-10 min, builds everything
./build/native/hclang_host/hclang_native --repl
```

### I want maximum performance (AOT)

```bash
just setup-wamrc                      # One-time: install LLVM, build wamrc (10 min)
just build-wamr-aot                   # 5-10 min, builds WASI + WAMR host + AOT
./build/native/hclang_host/hclang_native --repl
```

### I'm developing and iterating

```bash
just build                    # Fast JS rebuilds (2-3 min each)
# Test in browser or Node.js CLI
```

When you want to test standalone binaries:
```bash
just build-wamr-host          # Incremental (only rebuilds what changed)
./build/native/hclang_host/hclang_native --script test.sc
```

---

## The Ideal vs The Real

### What we'd like (but can't have):

```bash
just build-all    # Just works, everything auto-configures
```

### Why we can't:

1. System dependencies (LLVM, cmake, emcc) vary per platform
2. LLVM is heavyweight — don't want to force it on JS-only users
3. First-time setup takes 10-15 min, easy to surprise users
4. Some environments don't support package managers

### What we have instead:

```bash
just setup-wamrc           # Explicit one-time setup (idempotent)
just build-wamr-aot        # Requires setup, but fails clearly if missing
```

### Future improvements:

- [ ] Make `just build-wamr-aot` auto-run `just setup-wamrc` if needed
- [ ] Cache wamrc outside `build/` so `just clean` doesn't break it
- [ ] Pre-build and distribute wamrc binaries (hard, many architectures)
- [ ] Containerize the build (Dockerfile with LLVM pre-installed)

---

## For Contributors

### Adding a new build target

If you want to add another target (e.g., `wasm3` VM instead of WAMR):

1. Create a new CMake preset in `CMakePresets.json`
2. Create a new build directory `build/<target>`
3. Add a `just build-<target>` recipe
4. Document dependencies and setup requirements

### Debugging build issues

- `just _check-tools` — Shows what's installed
- `CMAKE_VERBOSE_MAKEFILE=1 just build` — See actual compiler commands
- `tail -f build/*/CMakeOutput.log` — CMake configuration logs

---

## See Also

- [HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md) — Open work on WAMR native host
- [HCLANG_NATIVE_REFERENCE.md](HCLANG_NATIVE_REFERENCE.md) — WAMR architecture & embedding API
- [WAMR_PERF_PARITY_PLAN.md](WAMR_PERF_PARITY_PLAN.md) — Performance optimization roadmap
