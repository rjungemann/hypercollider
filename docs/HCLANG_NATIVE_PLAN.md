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
