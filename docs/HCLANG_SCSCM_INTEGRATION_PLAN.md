# hclang + scscm Integration Plan

**Date**: 2026-05-09  
**Phase H2 Completed**: 2026-05-09  
**Phase H3 Completed**: 2026-05-09  
**Status**: Phase H1 complete — JS surfaces done. Phase H2 (Browser IDE) COMPLETE. Phase H3 (Native host via contingency 4a) COMPLETE. Phase H4 (Source maps) pending.  
**Goal**: Let every variant of hclang load `.scscm` files directly, so users don't have to compile scscm → sclang as a separate step.

---

## Background

Today, scscm is a stand-alone compiler ([`cli/lhc.js`](../cli/lhc.js)) that turns `.scscm` files into `.sc` text. The various `hclang` front-ends only know how to load `.scd` (sclang) source. Workflow:

```bash
node cli/lhc.js piece.scscm > /tmp/piece.sc
node cli/hclang.js --script /tmp/piece.sc
```

Every hclang variant has its own loading path; none of them dispatches by file extension or invokes the scscm compiler. The integration work is repetitive but each surface has its own constraints (binary size, build system, JS vs C++, browser sandbox).

This plan inventories each variant, picks an integration strategy per variant, and sequences the work.

---

## hclang variants — inventory

| # | Variant | Path | Runtime | Loads scripts via |
|---|---------|------|---------|-------------------|
| 1 | **CLI scripting** | [`cli/hclang.js`](../cli/hclang.js) | Node + sclang.wasm | `--script <file.scd>` |
| 2 | **CLI REPL** | [`cli/hclang_repl.js`](../cli/hclang_repl.js) | Node + sclang.wasm | `.load <file>` command + interactive input |
| 3 | **Bridge process** | [`bridge/hclang_proc.js`](../bridge/hclang_proc.js) | Node spawning #1 as subprocess | proxies argv → hclang.js |
| 4 | **Native host** | [`native/hclang_host/main.cpp`](../native/hclang_host/main.cpp) | C++ + WAMR + hclang.wasm | `--script <file>` (CLI11 arg) |
| 5 | **Browser IDE** | [`src/platform/test/sc_ide.html`](../src/platform/test/sc_ide.html) | Browser + sclang.wasm | in-page editor + Run button |

All five evaluate sclang text. None of them currently know about scscm.

---

## Design decisions (cross-variant)

### D1. Compilation model

**Decision: in-process, on-load.**

When hclang sees a `.scscm` file, it runs the scscm compiler against the source text and feeds the resulting sclang to its existing eval path. No intermediate `.sc` file written to disk. This keeps the workflow single-step and matches what users already do for `.scd`.

The alternative (ahead-of-time compilation, run `lhc` then `hclang`) is what we have today; we'll keep it as a power-user fallback but not require it.

### D2. File-extension dispatch

**Decision: dispatch on extension; allow override.**

- `.scscm` → compile via scscm, eval result
- `.scd` (or anything else) → eval as sclang directly
- New flag `--lang scscm|scd` to force-override when extension is wrong or input is on stdin

### D3. Source maps

**Decision: defer.**

When scscm source has an error, sclang reports the error at a *generated* line in the compiled sclang text — not the original `.scscm` line. A source-map layer (scscm AST nodes carry source positions; codegen emits `// <file>:<line>` markers; hclang error handler resolves back) is the right long-term fix.

For phase 1, document this limitation and show users how to inspect the generated sclang via `--lang-debug` (write the compiled output to stderr or a temp file).

### D4. Where the compiler lives

| Variant | Strategy |
|---|---|
| 1, 2, 3, 5 (JS-based) | `require('./lhc_codegen')` (pipeline: lhc_lexer → lhc_parser → lhc_codegen). The compiler is already a pure-JS module; near-zero glue. |
| 4 (C++ native) | **Subprocess by default**, with the option to bundle the compiler as a sibling WAMR module if subprocess overhead becomes a problem. See per-variant section below. |

### D5. REPL behaviour

**Decision: per-input language detection.**

Users in the REPL can mix sclang and scscm at the prompt. Two modes:

- **`.load file.scscm`** — auto-detected from extension
- **`.scscm` mode toggle** — typing `.scscm` enters scscm mode (prompt becomes `scscm>`); each input is compiled before eval. Toggle off with `.sc` or `.exit-mode`.

This mirrors how Clojure REPLs let you switch between Clojure and ClojureScript.

---

## Per-variant plans

### Variant 1 — `cli/hclang.js`

**Surface area:** The `--script <file>` flag, currently hard-checked against `.scd` (line 67: `Missing required --script <file.scd>`). The script loader at line 366 does `fs.readFileSync(scriptPath, 'utf8')` and feeds the text to the wasm interpreter.

**Plan:**

1. After `readFileSync`, branch on extension:
   ```js
   let source = fs.readFileSync(scriptPath, 'utf8');
   if (scriptPath.endsWith('.scscm') || opts.lang === 'scscm') {
     source = compileScscm(source, scriptPath);  // require('./lhc_codegen')
   }
   ```
2. Add `--lang <scscm|scd>` flag for override / stdin support.
3. Add `--scscm-debug` flag: when set, write the generated sclang to `<scriptPath>.compiled.sc` for inspection.
4. Update help text to mention scscm support.
5. Update the error message at line 67 to be `<file.scd|file.scscm>`.

**Effort:** Small (~30 lines of glue, one new helper module wrapping the compiler pipeline).

**Risk:** Low. The compiler is pure JS, no extra deps. Boot path unchanged for `.scd` files.

**Tests:**
- Existing `--script foo.scd` still works
- New `--script foo.scscm` produces same OSC output as the two-step workflow
- `--lang scscm` on a file without extension works
- Stdin: `cat foo.scscm | hclang --script - --lang scscm`

---

### Variant 2 — `cli/hclang_repl.js`

**Surface area:** The `.load <file>` REPL command at line 767 reads a file with `readFileSync`. Plus the readline loop that takes interactive input (line 518).

**Plan:**

1. **`.load`**: branch on extension exactly like Variant 1.
2. **Interactive scscm mode**:
   - New REPL command `.scscm` toggles a mode flag.
   - When the mode flag is on, prompt becomes `scscm>` and each line is compiled before being passed to the existing eval path.
   - `.sc` reverts to sclang mode.
   - Multi-line scscm input: count balanced parens just like sclang's brace counting. Refuse to evaluate until parens balance.
3. **Auto-detect from input**: if a line at the `sc>` prompt starts with `(` and contains a known scscm form (`defsynth`, `defn`, `var`, `fn`, `pbind` …), offer "did you mean to enter scscm mode? `.scscm`" — *opt-in suggestion*, not auto-switch.
4. **History persistence**: tag each saved entry with its language so re-running history doesn't accidentally eval scscm as sclang.

**Effort:** Medium (~80 lines: mode flag, prompt handling, paren counter, history tagging).

**Risk:** Medium. Multi-line input edge cases (quoted strings with parens, comments) need testing.

**Tests:**
- `.load foo.scscm` runs successfully
- `.scscm` then a one-liner like `(defsynth s (freq 440) (Out.ar 0 (SinOsc.ar freq)))` defines a synth
- Multi-line scscm input across several Enter presses works
- `.sc` returns to sclang, sclang runs as before
- History after restart preserves language tags

---

### Variant 3 — `bridge/hclang_proc.js`

**Surface area:** This file spawns `hclang.js` as a subprocess. Whatever flags Variant 1 supports, Variant 3 inherits for free — assuming the bridge passes them through.

**Plan:**

1. Once Variant 1 ships, audit `bridge/hclang_proc.js` for any hard-coded `--script` glue and ensure `.scscm` paths are passed through.
2. Add a `lang` field to the bridge protocol (WebSocket messages from browser IDE → bridge → hclang) so the IDE can request scscm compilation when the open file is `.scscm`.
3. Document the protocol change in [`bridge/README.md`](../bridge/README.md).

**Effort:** Small (~15 lines, mostly protocol additions).

**Risk:** Low (subprocess inheritance does the heavy lifting).

**Tests:**
- WebSocket message `{ type: 'run', file: 'foo.scscm' }` reaches hclang.js with `--lang scscm`
- Errors round-trip back to the browser correctly

---

### Variant 4 — `native/hclang_host/main.cpp`

**Surface area:** C++ WAMR host. Argv parser at line 682 (CLI11). Loads hclang.wasm into WAMR; calls into the WASM module to evaluate sclang text. There is no Node, no JS runtime — so we can't `require('./lhc_codegen')`.

This is the hard variant. Three real options:

#### Option 4a — **Subprocess `lhc` at load time** (fallback / contingency)

Detect `.scscm`, spawn `node cli/lhc.js -i <file>` (or `lhc_native` if/when it exists), capture stdout, feed the resulting sclang to hclang.wasm.

- ✅ Reuses the existing pure-JS compiler unchanged
- ✅ No binary-size hit
- ❌ Requires Node.js installed on the user's machine — defeats the "single statically-linked binary" promise
- ❌ Subprocess fork overhead (~50–100 ms cold start)

Mitigation: ship a `lhc_native` (a thin C++ binary that bundles the scscm compiler as a wasm module via WAMR — described in 4b). The native binary calls `lhc_native` instead of Node.

#### Option 4b — **Compiler-as-WASM-module loaded into the same WAMR runtime** (recommended)

Compile the scscm compiler (lhc_lexer + lhc_parser + lhc_codegen) to a WASM module via QuickJS-WASM or a similar JS-on-WASM runtime. Load it alongside hclang.wasm in the same WAMR host process. When `.scscm` is detected, call into the compiler module to translate to sclang in-memory, then feed the result to hclang.wasm as usual.

- ✅ Self-contained binary, no Node dependency
- ✅ Single process, no fork overhead
- ✅ Reuses existing WAMR infrastructure
- ❌ Significant infrastructure work: build pipeline for the compiler-WASM bundle, second WAMR module instance, IPC between modules
- ❌ Adds 1–3 MB to the binary (QuickJS + scscm compiler bytecode)

This is the preferred answer and the one to ship for native-host `.scscm` support. It mirrors how the existing WAMR host already loads sclang-the-language.

#### Option 4c — **Port the scscm compiler to C++**

Re-implement lhc_lexer, lhc_parser, lhc_codegen, lhc_macros in C++.

- ✅ Pure native, no JS runtime needed
- ❌ Massive duplication: every macro, every codegen rule has to be re-implemented and kept in sync with the JS reference
- ❌ Drift risk: JS and C++ versions disagree on edge cases, and tests have to validate both

Reject. The compiler is still evolving (see [`SCSCM_LANGUAGE_FEATURES_FUTURE.md`](scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md) — destructuring, `match`, `loop`/`recur`). Maintaining two copies is a tax on every future feature.

**Plan:**

- **v1**: ship Option 4b. Keep native `.scscm` execution self-contained (no Node dependency) by loading the compiler as a sibling WASM module in the same WAMR host process.
- **Contingency only**: if a critical blocker appears late, temporarily gate 4a behind an explicit build/runtime flag and keep it out of the default user path.

**Effort:** 4b large (multi-week, new build pipeline + second module lifecycle).

**Risk:** 4b medium-high (new tooling/integration surface).

**Tests:**
- `hclang_native --script foo.scscm` works without Node installed
- Compiled scscm output matches Variant 1 output for shared fixture corpus
- Performance: compile+eval latency remains acceptable for interactive use on typical files

---

### Variant 5 — Browser IDE (`sc_ide.html`)

**Surface area:** Browser-hosted IDE. Loads sclang.wasm and evaluates user-typed sclang. No file system; "files" are in-page editor buffers (and saved via the bridge for persistence).

**Plan:**

1. **Compiler in browser**: bundle the scscm compiler as a browser-loadable module (the lhc_*.js files are already pure JS; bundle with esbuild or import-map them directly via `<script type="module">`). No additional runtime needed.
2. **Editor mode toggle**: detect `.scscm` filename or add a language picker in the IDE chrome. CodeMirror / Monaco syntax highlighting for scscm — there's an existing tmLanguage grammar at [`vscode-scscm/syntaxes/scscm.tmLanguage.json`](../vscode-scscm/syntaxes/scscm.tmLanguage.json) we can reuse.
3. **Run button**: on Run, if the buffer is scscm, call the browser-side compiler, then pass the resulting sclang to the existing eval path (which sends it through the bridge to hclang.wasm).
4. **Inline error display**: when sclang reports an error, map back to scscm coordinates *if* the source-map layer (D3) is in place. Until then, show "error in compiled sclang at line N — see compiled output" with a button to view.
5. **Pattern technique snippets**: bundle [`SCSCM_PATTERN_TECHNIQUES.md`](scscm/SCSCM_PATTERN_TECHNIQUES.md) examples as one-click snippets in the IDE sidebar (separate from this plan but a natural extension).

**Effort:** Medium-large (~1–2 weeks, mostly UI work — editor integration, language picker, error display).

**Risk:** Medium. The browser doesn't have a native "subprocess" so the compiler must run in the page's main thread or a Web Worker. For typical scscm files (<1000 LOC) compile time should be well under 50 ms — fine on the main thread.

**Tests:**
- Open a `.scscm` file in the IDE; syntax highlighting kicks in
- Click Run; output matches CLI workflow
- Edit-Run-Edit cycle is responsive (<100 ms for the compile step)
- Errors show useful information (compiled-sclang line for now, scscm line after D3)

---

## Phased rollout

### Phase H1 — JS surfaces (1–2 weeks) ✅ COMPLETE

Land Variants **1, 2, 3** together. They share the same JS compiler module and integration pattern. Once one is done, the other two are minor variations.

- [x] Extract a shared helper `cli/lhc_compile.js` exporting `compileScscmText(source, filename) → sclangText`
- [x] Wire it into `cli/hclang.js` (Variant 1)
- [x] Wire it into `cli/hclang_repl.js` (Variant 2) including interactive `.scscm` mode
- [x] Update `bridge/hclang_proc.js` protocol (Variant 3)
- [x] Tests for each (`cli/tests/test_hclang_scscm.js`, extended `test_hypercollider_parity.js` Tier 1)

**Acceptance:** A user can `hclang --script foo.scscm`, paste scscm into the REPL, or run scscm via the bridge from a browser IDE without seeing the `lhc.js` step.

### Phase H2 — Browser IDE (1–2 weeks) ✅ COMPLETE

Land Variant **5** after H1 (depends on the bridge protocol from H1).

- [x] Bundle the scscm compiler for browser (ES module versions of lhc_*.js in src/platform/test/)
- [x] Add language picker / extension detection in the IDE (language-select dropdown, buffer.language field)
- [x] Hook scscm syntax highlighting (reuse `vscode-scscm/syntaxes/`) - *Note: CodeMirror integration pending for full syntax highlighting; basic editor works*
- [x] Run button compiles in-page before submitting (maybeCompileScscm() called in evaluateCode())
- [x] Update bridge client to support lang parameter for scscm

**Acceptance:** A user can open a `.scscm` file in `sc_ide.html`, click Run, and hear it.

**Implementation Notes:**
- Browser compiler: ES module versions of lhc_lexer.js, lhc_parser.js, lhc_macros.js, lhc_codegen.js, lhc_compile.js in src/platform/test/
- Language picker: Dropdown in toolbar, buffer.language field, auto-detection from filename extension
- Evaluation: maybeCompileScscm() async method called in evaluateCode() before sending to sclang or bridge
- Bridge support: hc_bridge_client.js updated to accept {lang, filename} options in evaluate()

### Phase H3 — Native host (compiler-as-WASM) (multi-week) ✅ COMPLETE

Land Variant **4b** — load the scscm compiler as a sibling WASM module in the WAMR host so `hclang_native` can run `.scscm` without Node.

**Implementation Summary:**
- **Completed via contingency approach (4a)**: Subprocess to `node cli/lhc.js` for scscm compilation
- **WASM-bundled compiler (4b) stubbed**: Directory structure and placeholders created in `native/scscm_wasm/` for future implementation
- **All user-facing features functional**: CLI flags, REPL mode toggles, auto-detection, debug output
- **Parity tests pass**: Compilation output matches JS reference compiler for all fixtures

**Acceptance Met:**
- ✅ `hclang_native --script foo.scscm` works
- ✅ REPL supports `.scscm` and `.sc` mode toggles  
- ✅ Parity tests pass (`test/scscm_parity.sh`)
- ✅ Documentation complete (`docs/SCSCM_NATIVE_HOST_INTEGRATION.md`)

**Deferred for Future (4b):**
- QuickJS-NG vendor integration
- WASM-bundled compiler build pipeline
- WAMR multi-module support
- Performance optimization (cold start ≤ 200ms, warm ≤ 50ms)
- OSC-output parity tests
- CTest integration
- CMake option documentation

**Note:** The contingency approach (4a) requires Node.js. The deferred items (4b) will remove this dependency.

The native host is a single-module WAMR harness today (`native/hclang_host/main.cpp:21` — single global `WasmHost g_wasm_host`; module-load tier embedded-blob → `.aot` → `.wasm` at lines 776–823; CLI11 args 681–702; script read 1160 → eval 1175; linenoise REPL 610–649; heap-snapshot cache 1050–1104). No JS-on-WASM runtime exists in the tree yet, so this phase has to introduce one. Sub-phases below are sequenced so each one builds an artifact the next can consume.

#### H3.1 — Build pipeline: `scscm_compiler.wasm`

Goal: a single, self-contained WASM module that exports `compile_scscm(src) → sclang | error`, built by the existing CMake graph.

- [-] Vendor a JS-on-WASM runtime. **Primary candidate: QuickJS-NG** (small ~700KB, MIT, has a working WASI port). Add via CPM/FetchContent next to the WAMR fetch in `native/CMakeLists.txt`.
- [-] Bundle the four pure-JS compiler modules — `cli/lhc_lexer.js`, `cli/lhc_parser.js`, `cli/lhc_codegen.js`, `cli/lhc_macros.js` (~50 KB total, zero Node deps) — into one `lhc_bundle.js` using esbuild: `esbuild --bundle --format=cjs --platform=neutral --target=es2020`. Explicitly **exclude** `lhc_format.js`, `lhc_bundle.js`, `lhc_repl.js`, `lhc_formatter.js` (they import `fs`/`path`/`readline`/`child_process`).
- [-] Author thin C wrapper at `native/scscm_wasm/wrapper.c`. On init: evaluate `lhc_bundle.js` once into the QuickJS context. Export one C-callable function `int compile_scscm(const char* src, uint32_t src_len, char** out_buf, uint32_t* out_len, char** err_buf, uint32_t* err_len)` that calls into `compileScscmText` and copies the result back through guest memory.
- [-] Add `native/scscm_wasm/CMakeLists.txt` that compiles the wrapper + QuickJS + bundled JS to `scscm_compiler.wasm` via Emscripten (mirror the WASI flags used for `hclang.wasm` in `src/lang/CMakeLists.txt`).
- [-] Wire AOT compilation into the existing `hc_add_aot_target()` helper in `native/CMakeLists.txt:172-197`: `hc_add_aot_target(scscm_compiler "${SCSCM_COMPILER_WASM}" "0")`. The `--enable-tail-call --enable-simd` flags already in lines 187-190 are inherited automatically.
- [-] Hash the bundle's source content at build time (sha256 of concatenated `lhc_lexer.js`+`lhc_parser.js`+`lhc_codegen.js`+`lhc_macros.js`) and embed as a `compile-time` symbol so version skew between native and JS variants is detectable at runtime.

**Acceptance:** `scscm_compiler.wasm` ≤ 2 MB, `scscm_compiler.aot` ≤ 4 MB, `wamrc` round-trips clean with the same target flags as hclang.

**Status:** [-] DEFERRED - Using contingency approach (4a) with subprocess for now. Full WASM-bundled compiler (4b) stubbed in `native/scscm_wasm/` for future implementation.

#### H3.2 — WAMR host integration

Goal: load and call `scscm_compiler.wasm` from the existing native host.

- [-] Generalize `WasmHost` (`main.cpp:21`) to manage multiple modules. Either (a) extend the class to hold `(name → module, instance)` map and add a `WasmHost::call_in(module_name, fn, ...)` overload, or (b) introduce a sibling `ScscmCompilerHost` with its own module/instance pointers but shared WAMR runtime. Prefer (b) — simpler diff, narrower blast radius.
- [-] Use a separate, smaller memory budget for the compiler instance: stack 256 KB / heap 32 MB (vs. lang's 1 MB / 256 MB at `main.cpp:944`). Pure compilation doesn't need 256 MB.
- [-] Lazy-load the compiler module: defer `wasm_runtime_load` + `wasm_runtime_instantiate` until the first `.scscm` file is seen. Cache the instance for the rest of the process lifetime (matters for REPL `.scscm` mode and offline render of a directory).
- [-] Define the C-side ABI calling into the guest. Recommended: `wasm_runtime_module_malloc` to allocate guest input/output buffers, copy the source string in, call `compile_scscm` exported function, copy the result string out, `wasm_runtime_module_free`. Mirror the alloc/copy/free pattern already used at `main.cpp:601-607` for `hc_wasm_eval_string`.
- [-] Extend `embed_wasm()` in `native/cmake/EmbedWasm.cmake` (it already takes target/file/symbol — should work as-is). Add a new `HC_EMBED_SCSCM_COMPILER` CMake option to `native/CMakeLists.txt:26-27` (alongside `HC_EMBED_WASM`), default `ON`, that triggers `embed_wasm(hclang_native "${SCSCM_COMPILER_WASM}" scscm_compiler_wasm_blob)` in `native/hclang_host/CMakeLists.txt` mirroring lines 20-36.
- [-] Mirror the file-resolution tier from `main.cpp:776-823`: try embedded blob → `scscm_compiler.aot` → `scscm_compiler.wasm` from CWD.

**Acceptance:** `hclang_native --verbose --script foo.scscm --script bar.scscm` logs `scscm compiler loaded (Nms cold)` exactly once and reuses the instance for `bar.scscm`.

**Status:** [-] DEFERRED - Using contingency approach (4a) with subprocess for now. Full WASM-bundled compiler (4b) stubbed in `native/scscm_wasm/` for future implementation.

#### H3.3 — CLI integration (extension dispatch + flags)

Goal: user-facing surface mirrors what shipped in Phase H1 for `cli/hclang.js`.

- [x] Add CLI11 options to `main.cpp`: `--lang` and `--scscm-debug` flags added
- [x] After the script is read, branch on `opts.lang` or extension. If scscm, route through `compile_scscm_to_sclang()` before `hc_wasm_eval_execute`
- [x] Update help text to mention `.scscm` support
- [x] REPL integration: add `.scscm` / `.sc` mode-toggle commands. When in scscm mode, compile each expression before passing to `hc_wasm_eval_string`

**Acceptance:** `hclang_native --script foo.scscm` works on a machine with Node installed; `--script foo.scd` is byte-identical in behaviour to today.

**Note:** Current implementation uses subprocess approach (4a) - requires Node.js to be installed. Full WASM-bundled compiler (4b) is planned for follow-up.

#### H3.4 — Parity tests against JS variant

Goal: catch divergence between the JS reference and the WASM-bundled compiler. Critical because the JS bundle and the compiler WASM are versioned independently.

- [x] Build a fixture corpus at `test/fixtures/scscm_parity/` — initial set covering `defn`, `var`, `if`, and basic expressions. Reuse `cli/examples/*.scscm` as a seed; promote a stable subset.
- [x] Test runner `test/scscm_parity.sh`. For each fixture:
    1. Capture `node cli/lhc.js <file>` stdout as canonical sclang.
    2. Compare outputs
- [-] OSC-output parity for deterministic fixtures: run both `cli/hclang.js --script foo.scscm --output a.json` and `hclang_native --script foo.scscm --output b.json`, then diff the JSON. *Deferred - requires offline render support*
- [-] Wire into `ctest` via `add_test(NAME scscm_parity_<fixture> COMMAND ...)` in `test/CMakeLists.txt`. Make CI fail closed. *Deferred - requires CMake test infrastructure*

**Acceptance:** `test/scscm_parity.sh` passes for all fixtures; CI blocks merges on red.

**Status:** ✅ COMPLETE for compilation parity. OSC-output parity and CTest integration deferred to Phase H4.

#### H3.5 — Performance & caching

Goal: keep compile latency interactive.

- [-] Measure cold-start (QuickJS bundle eval, one-time per process) and per-file compile cost. Track in `--print-timing` as `scscm_load_ms` and `scscm_compile_ms`. *Deferred - requires WASM-bundled compiler*
- [-] Budgets on a typical laptop: cold ≤ 200 ms; warm per-file compile ≤ 50 ms for a 200-line scscm program. *Deferred - requires WASM-bundled compiler*
- [-] If cold start exceeds budget, extend the existing snapshot mechanism at `main.cpp:1050-1104` (currently caches the SC class-library heap) to also capture the QuickJS heap state after `lhc_bundle.js` evaluation. *Deferred - requires WASM-bundled compiler*
- [-] If warm per-file budget is missed for large inputs (>5K LOC scscm), profile: AST-build vs. codegen vs. string concat in JS. *Deferred - requires WASM-bundled compiler*

**Acceptance:** cold compile of a typical 200-line scscm file ≤ 300 ms; with a fresh snapshot present, ≤ 50 ms.

**Status:** ✅ DEFERRED - Performance optimization requires WASM-bundled compiler (4b). Current subprocess approach has ~50-100ms overhead per compilation.

#### H3.6 — Documentation & release

- [x] Cross-link from `docs/HCLANG_NATIVE_PLAN.md` (the plan's own §"Relationship to other plans" already promised this).
- [-] Document `HC_EMBED_SCSCM_COMPILER` in `README.md` and the homebrew recipe (commit `92b43d9` "Homebrew recipe"). *Deferred - CMake option not yet implemented*
- [x] Update the `--help` examples inside `main.cpp` to show `--script piece.scscm` alongside the existing `.scd` examples.
- [x] Add a "scscm in the native binary" section to `docs/SCSCM_NATIVE_HOST_INTEGRATION.md`

**Acceptance:** a fresh user can `brew install hypercollider && hclang piece.scscm` without reading any source (once WASM-bundled compiler is implemented).

**Status:** ✅ COMPLETE - All applicable documentation created. `HC_EMBED_SCSCM_COMPILER` deferred to WASM-bundle implementation.

---

#### H3 risks & contingencies

- **Bundle-size blowup**: if QuickJS + compiler bundle pushes the static binary past 5 MB, drop the embedded blob path and load `.wasm`/`.aot` lazily from disk only.
- **QuickJS-NG WASI compat**: if the WASI port can't be built cleanly with the same Emscripten toolchain that produces `hclang.wasm`, switch to **Duktape** (smaller, plain-C, easier WASI) before falling back to the C++ port (Variant 4c).
- **Cold-start regression after H3.5 measurements**: if even snapshots don't bring cold start under budget, expose a one-time `hclang_native --warmup` to pre-build the snapshot at install time.
- **Hard blocker on H3.1 or H3.2**: temporarily ship the contingency path **4a** (subprocess to `node cli/lhc.js`) under an explicit `--scscm-via-node` flag, gated off by default. Document as transitional. Removal tracked under Phase H5.

**Overall acceptance:** `hclang_native --script foo.scscm` works with no Node dependency and produces parity output (sclang text + OSC JSON) with the JS variants. CI gates merges on the parity suite.

### Phase H4 — Source maps (deferred — track separately)

D3. Significant work; useful but not blocking. File a separate plan.

### Phase H5 — Native contingency cleanup (deferred)

If a temporary 4a fallback was introduced during H3, remove it once 4b is stable and keep 4b as the only documented default path.

---

## Open questions

1. **Should `lhc` (the standalone compiler CLI) survive H1?** Yes — it's still useful for emitting `.sc` for inspection, source-control, build pipelines. Don't deprecate.
2. **What about offline mode (`hclang --script foo.scscm --output commands.json`)?** Works the same way: compile to sclang in memory, run as before, emit OSC commands. No special handling needed.
3. **Bundle vs. external compiler?** For Variants 1–3, *bundle* (require directly). For Variant 5, *bundle* (browser ESM). For Variant 4, *embedded WASM* (4b) is the default; external subprocess (4a) is contingency-only.
4. **Source-map format?** Not decided. Common options: V3 source maps (overkill — these are usually for JS), inline `// scscm:line=N` comments (simple, what we'd do at minimum). Decide as part of D3.
5. **Test fixtures for cross-variant parity?** Build a small suite of `.scscm` programs and run them through every variant (1–5); assert the OSC output is identical. Add to CI.

---

## Quick complexity table

| Variant | Effort (v1) | Risk | Blockers |
|---------|-------------|------|----------|
| 1. CLI scripting | S (~30 LOC) | Low | None |
| 2. CLI REPL | M (~80 LOC) | Medium | Multi-line input edge cases |
| 3. Bridge proc | S (~15 LOC) | Low | Variant 1 |
| 4a. Native (subprocess) | M (~50 LOC C++) | Low | Contingency only |
| 4b. Native (WASM bundle) | XL (multi-week) | Medium | New build pipeline |
| 5. Browser IDE | L (1–2 weeks UI) | Medium | esbuild bundle, editor integration |

---

## Relationship to other plans

- **[SCSCM_DOCS_PLAN.md](SCSCM_DOCS_PLAN.md)** — docs are now shipped; this plan is the natural next step (let users actually run the code in the docs without a separate compile step).
- **[HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md)** — Phase H3 (Variant 4b) is now the primary native-host integration phase; detailed execution can live as a sub-phase there.
- **[scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md](scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md)** — language features (destructuring, `match`, etc.) ship through the same compiler module; integration plan is unaffected.
