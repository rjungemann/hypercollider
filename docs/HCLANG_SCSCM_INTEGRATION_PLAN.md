# hclang + scscm Integration Plan

**Date**: 2026-05-09  
**Status**: Planned (not yet started)  
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

#### Option 4a — **Subprocess `lhc` at load time** (recommended for v1)

Detect `.scscm`, spawn `node cli/lhc.js -i <file>` (or `lhc_native` if/when it exists), capture stdout, feed the resulting sclang to hclang.wasm.

- ✅ Reuses the existing pure-JS compiler unchanged
- ✅ No binary-size hit
- ❌ Requires Node.js installed on the user's machine — defeats the "single statically-linked binary" promise
- ❌ Subprocess fork overhead (~50–100 ms cold start)

Mitigation: ship a `lhc_native` (a thin C++ binary that bundles the scscm compiler as a wasm module via WAMR — described in 4b). The native binary calls `lhc_native` instead of Node.

#### Option 4b — **Compiler-as-WASM-module loaded into the same WAMR runtime** (recommended for v2)

Compile the scscm compiler (lhc_lexer + lhc_parser + lhc_codegen) to a WASM module via QuickJS-WASM or a similar JS-on-WASM runtime. Load it alongside hclang.wasm in the same WAMR host process. When `.scscm` is detected, call into the compiler module to translate to sclang in-memory, then feed the result to hclang.wasm as usual.

- ✅ Self-contained binary, no Node dependency
- ✅ Single process, no fork overhead
- ✅ Reuses existing WAMR infrastructure
- ❌ Significant infrastructure work: build pipeline for the compiler-WASM bundle, second WAMR module instance, IPC between modules
- ❌ Adds 1–3 MB to the binary (QuickJS + scscm compiler bytecode)

This is the *right* long-term answer. It mirrors how the existing WAMR host already loads sclang-the-language.

#### Option 4c — **Port the scscm compiler to C++**

Re-implement lhc_lexer, lhc_parser, lhc_codegen, lhc_macros in C++.

- ✅ Pure native, no JS runtime needed
- ❌ Massive duplication: every macro, every codegen rule has to be re-implemented and kept in sync with the JS reference
- ❌ Drift risk: JS and C++ versions disagree on edge cases, and tests have to validate both

Reject. The compiler is still evolving (see [`SCSCM_LANGUAGE_FEATURES_FUTURE.md`](scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md) — destructuring, `match`, `loop`/`recur`). Maintaining two copies is a tax on every future feature.

**Plan:**

- **v1**: ship Option 4a. Document the Node.js dependency for scscm support; emit a clear error if Node isn't on `$PATH` and the user opens a `.scscm`.
- **v2**: replace 4a with 4b once Variants 1–3 are in production. Track as a future phase.

**Effort:** 4a small (~50 lines C++, mostly process spawning). 4b large (multi-week, new build pipeline).

**Risk:** 4a low (subprocess pattern is well understood). 4b medium-high (new tooling).

**Tests:**
- `hclang_native --script foo.scscm` works when Node is on PATH (v1)
- Error message is helpful when Node is missing
- Performance: scscm load time < 200 ms for typical files (subprocess + compile)

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

### Phase H1 — JS surfaces (1–2 weeks)

Land Variants **1, 2, 3** together. They share the same JS compiler module and integration pattern. Once one is done, the other two are minor variations.

- [ ] Extract a shared helper `cli/lhc_compile.js` exporting `compileScscmText(source, filename) → sclangText`
- [ ] Wire it into `cli/hclang.js` (Variant 1)
- [ ] Wire it into `cli/hclang_repl.js` (Variant 2) including interactive `.scscm` mode
- [ ] Update `bridge/hclang_proc.js` protocol (Variant 3)
- [ ] Tests for each

**Acceptance:** A user can `hclang --script foo.scscm`, paste scscm into the REPL, or run scscm via the bridge from a browser IDE without seeing the `lhc.js` step.

### Phase H2 — Browser IDE (1–2 weeks)

Land Variant **5** after H1 (depends on the bridge protocol from H1).

- [ ] Bundle the scscm compiler for browser
- [ ] Add language picker / extension detection in the IDE
- [ ] Hook scscm syntax highlighting (reuse `vscode-scscm/syntaxes/`)
- [ ] Run button compiles in-page before submitting

**Acceptance:** A user can open a `.scscm` file in `sc_ide.html`, click Run, and hear it.

### Phase H3 — Native host v1 (subprocess) (3–5 days)

Land Variant **4a**.

- [ ] Detect `.scscm` extension in `native/hclang_host/main.cpp`
- [ ] Spawn `lhc.js` (or system-installed `lhc`) via `popen`-style API
- [ ] Capture stdout, feed to existing eval path
- [ ] Helpful error if Node not found

**Acceptance:** `hclang_native --script foo.scscm` works when Node is installed; clear error when not.

### Phase H4 — Source maps (deferred — track separately)

D3. Significant work; useful but not blocking. File a separate plan.

### Phase H5 — Native host v2 (compiler-as-WASM) (multi-week, deferred)

Variant **4b**. Reconsider once H1–H3 are stable and we have data on whether the Node dependency is friction for native-binary users.

---

## Open questions

1. **Should `lhc` (the standalone compiler CLI) survive H1?** Yes — it's still useful for emitting `.sc` for inspection, source-control, build pipelines. Don't deprecate.
2. **What about offline mode (`hclang --script foo.scscm --output commands.json`)?** Works the same way: compile to sclang in memory, run as before, emit OSC commands. No special handling needed.
3. **Bundle vs. external compiler?** For Variants 1–3, *bundle* (require directly). For Variant 5, *bundle* (browser ESM). For Variant 4, *external subprocess* in v1, *embedded WASM* in v2.
4. **Source-map format?** Not decided. Common options: V3 source maps (overkill — these are usually for JS), inline `// scscm:line=N` comments (simple, what we'd do at minimum). Decide as part of D3.
5. **Test fixtures for cross-variant parity?** Build a small suite of `.scscm` programs and run them through every variant (1–5); assert the OSC output is identical. Add to CI.

---

## Quick complexity table

| Variant | Effort (v1) | Risk | Blockers |
|---------|-------------|------|----------|
| 1. CLI scripting | S (~30 LOC) | Low | None |
| 2. CLI REPL | M (~80 LOC) | Medium | Multi-line input edge cases |
| 3. Bridge proc | S (~15 LOC) | Low | Variant 1 |
| 4a. Native (subprocess) | M (~50 LOC C++) | Low | Node on PATH at runtime |
| 4b. Native (WASM bundle) | XL (multi-week) | Medium | New build pipeline |
| 5. Browser IDE | L (1–2 weeks UI) | Medium | esbuild bundle, editor integration |

---

## Relationship to other plans

- **[SCSCM_DOCS_PLAN.md](SCSCM_DOCS_PLAN.md)** — docs are now shipped; this plan is the natural next step (let users actually run the code in the docs without a separate compile step).
- **[HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md)** — Phase H3 (Variant 4a) is a small addition to native host work; H5 (Variant 4b) probably belongs there as a sub-phase rather than here.
- **[scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md](scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md)** — language features (destructuring, `match`, etc.) ship through the same compiler module; integration plan is unaffected.
