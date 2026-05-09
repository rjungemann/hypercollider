# WAMR Native Host — Open Work

Reference for everything that already shipped:
[HCLANG_NATIVE_REFERENCE.md](HCLANG_NATIVE_REFERENCE.md) (architecture,
embedding API, gotchas, key files, quick-start). For the cold-start gap vs
the Node.js + V8 path: [WAMR_PERF_PARITY_PLAN.md](WAMR_PERF_PARITY_PLAN.md).

This file tracks only outstanding TODOs.

---

## Phase 11.2 — REPL tab-completion — [ ] DEFERRED

Tab-complete class names from the loaded class tree. Needs a way to enumerate
class names from the running WASM module.

REPL polish that already shipped (multi-line input, persistent history, Ctrl-C
interrupts via `hc_host_poll_interrupt`, line-buffered stdout/stderr) covers
the daily workflow; tab-completion is the only nice-to-have remaining.

---

## Phase 12.1d — `wamrc` install docs in README — [x] DONE

wamrc installation instructions (LLVM-17 + build from source) have been added
to README.md under "wamrc setup (for AOT-compiled binaries)". Users can now
follow the platform-specific instructions (macOS and Debian/Ubuntu) to set up
wamrc for AOT compilation.

---

## Phase 12.3 — `wamr-aot` perf follow-ups — [ ] IN PROGRESS

The row exercises real AOT now (12.3a/c/d done with `--opt-level=0` workaround).

**Status:** Upgraded WAMR to 2.4.4 (from 2.4.3) in [native/CMakeLists.txt](../native/CMakeLists.txt)
to verify any upstream wamrc fixes. (2.4.5 doesn't exist; 2.4.4 is the latest available.)

**To test:**
```bash
# 1. Set up wamrc (one-time setup)
just setup-wamrc

# 2. Clear any stale fetch cache and build
rm -rf build/native/_deps/wamr*
just build-wamr-aot
```

Note: `just setup-wamrc` automates LLVM 17 installation, wamrc building, and PATH setup.
After that, `just build-wamr-aot` handles all intermediate builds (WASI, WAMR host) and creates
the `build/` directory structure automatically.

**Important:** wamrc is built into the `build/` directory. If you run `just clean`, the wamrc
symlink will break. Just re-run `just setup-wamrc` to rebuild it — the script detects the
broken symlink and guides you.

**Expected outcomes:**

1. **Build succeeds, lang AOT compiles at higher opt levels** → Bug is fixed upstream
   - Bump `HC_WASM_AOT_OPT_LEVEL_LANG` to 1, 2, or 3 as appropriate
   - Benchmark and report perf recovery vs current `--opt-level=0`
   - Mark this phase DONE

2. **Build succeeds, but lang AOT still crashes at `--opt-level > 0`** → Upstream bug persists
   - Keep workaround: `HC_WASM_AOT_OPT_LEVEL_LANG = 0`
   - File a WAMR issue with minimal reproducer:
     - Extract failing bytecode from `hclang.wasm` (can use `wasm-objdump`)
     - Attach both crash modes: SIGSEGV at `=1`, OOM at `=2/3`
     - Ask for guidance on root cause or upgrade path
   - Mark this phase DONE (issue filed, upstream owns it now)

3. **CMake fetch fails** (e.g., git tag not found)
   - Verify available WAMR tags and try the latest stable release
   - Update CMakeLists.txt and retry

---

## Phase 12.4 — `wamr-full` patch coverage — [~] PARTIAL

### Phase 12.4a — Per-patch validation — [x] DONE

All five core bench patches now emit postln markers at completion:
- `bench/patches/{sine,fm,reverb,poly,granular}.scd` each end with
  `"BENCH_PATCH_<name>: OK".postln;`
- `bench/run_bench.sh` captures `RES_LANG_LOG` from `_wamr_full_run_pipeline`
  and validates each patch via `_validate_patch_execution()`, which checks for
  the expected marker and warns on mismatch. Validation is skipped for
  `plugin_heavy` (not available on WAMR).

### Phase 12.4b — `plugin_heavy` integration decision — [x] DONE

sc3-plugins is now linked into `hcsynth.wasm` (commit "Integrate sc3-plugins"),
so the `plugin_heavy` patch runs on wasm, wamr-full, and wamr-aot toolchains
without any additional setup. On the `native` toolchain it still requires
`SC3plugins/` installed under the user's SuperCollider Extensions dir; the
bench harness skips that single cell when missing instead of skipping the
whole patch.

---

## Phase 7.8 — Toolchain recommendations — [x] DONE (2026-05-09)

### Summary

Phase 7 perf investigation (heap snapshot, AOT opt-level, block-size sensitivity)
has converged on clear recommendations for when to use each native WAMR toolchain.

**wamr-aot** is the production default. **wamr-full** is fine for development but
should not be used in perf-tracking or benchmarks (it reports misleading numbers).
JIT mode (P7.4) is deferred indefinitely — AOT already accomplishes what JIT would
have without the LLVM-at-runtime binary-size cost.

### Detailed recommendations

- **Production / offline render: `wamr-aot`** — use `just build-wamr-aot`
  - AOT compilation is a one-time build cost (40–60 s on M-series)
  - Runtime synth performance is at parity with native `scsynth` across
    sine/fm/reverb/poly benchmarks (~180 ms for poly_16, ~197 ms for poly_64)
  - Incurs no per-block dispatch overhead; synth-side wall is fixed overhead
    (OSC dispatch, drwav write) not per-UGen bytecode interpretation
  - Production builds should always use AOT

- **Development / quick iteration: `wamr-full`** — use `just build-wamr-host`
  - Skips wamrc entirely; rebuild in ~5–10 s instead of 40–60 s
  - Acceptable for interactive development and single-voice patches (sine, fm)
  - Fine for polyphony up to ~16 voices — per-voice cost under WAMR's fast
    interpreter is ~14 ms/voice, so 16 voices = ~224 ms (within 2× native)
  - **Do not use wamr-full for synth-heavy benchmarks** — shows ~6× gap vs
    wamr-aot on poly_64 due to interpreter dispatch overhead, which doesn't
    appear in production (AOT) workloads and would mislead perf tracking
  - For patches with >16 voices, either (a) develop on wamr-aot and accept
    the 40–60 s rebuild cost, or (b) stick with wamr-full knowing bench
    results won't extrapolate to production

- **JIT mode (WAMR_BUILD_JIT)** — deferred indefinitely
  - Phase I1 investigation showed JIT does not help short lang sessions
    (5–10 s of real code) even though it speeds up warm steady-state
  - Phase P7 investigation showed wamr-aot already closes the per-UGen
    interpreter tax that JIT was hypothesised to solve — synth-side wall
    is fixed overhead, not bytecode dispatch
  - Enabling JIT balloons binary size from ~3.9 MB to ~50–100 MB, defeating
    the "single small binary" goal
  - Reconsider only if a future workload shows sustained (>30 s) synth render
    with >100 voices where AOT steady-state still hits the interpreter slope

---

## Phase 13.3 — Bench baseline CI integration — [ ] DEFERRED

Recipes work locally (`just bench-check`, `just bench-update-baselines`).
CI gating is risky because GitHub macos-14 runners have different perf than
developer boxes. Sequencing:

1. Capture a baseline ON the macos-14 runner (run `bench-update-baselines`
   in CI on `main`, commit to `bench/baselines/wamr-full.ci-macos.json`).
2. Add `bench-check` step to `native-host.yml`, pointing `--baseline` at the
   CI-captured file.
3. Initially `continue-on-error: true` (informational only); flip to gating
   after baseline stabilises across 10+ runs.
4. Decision: only run on macos-14 (where baseline was captured), or maintain
   a parallel `wamr-full.ci-linux.json`.

Local recipes already let contributors run the check before submitting a PR.
