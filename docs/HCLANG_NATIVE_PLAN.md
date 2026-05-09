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

## Phase 12.1d — `wamrc` install docs in README — [ ] TODO

`build-wamr-aot` errors point users at "the readme" for the LLVM-17 + wamrc
install dance. README quickstart covers the rest of the toolchain
(brew/apt prerequisites, `_check-tools`, bench-quickstart) but not the wamrc
install dance specifically. Add it so AOT errors are actionable.

---

## Phase 12.3 — `wamr-aot` perf follow-ups — [ ] TODO

The row exercises real AOT now (12.3a/c/d done with `--opt-level=0` workaround).
Two upstream items remain:

- File a wamr bug with a minimal reproducer for the lang-side AOT crash at
  `--opt-level=1/2/3`. Extract a failing bytecode sequence from `hclang.wasm`,
  compile at each opt level, attach both crash modes (SIGSEGV at `=1`, "memory
  exhausted" at `=2/3`).
- Try WAMR 2.4.4 / 2.4.5 in [native/CMakeLists.txt](../native/CMakeLists.txt) —
  there may be wamrc fixes since 2.4.3 that let us bump the opt level. Locked
  at `--opt-level=0` until upstream is verified.

---

## Phase 12.4 — `wamr-full` patch coverage — [ ] TODO

Five stock patches now render real audio under `wamr-full` via the
`Server.boot` shim (`--no-server-boot` + `statusWatcher.instVarPut`). Two
items remain:

- Per-patch sanity check: each ported patch should `postln` the expected
  synthdef size so the bench harness can assert OSC was sent correctly.
  Currently we infer success from non-zero output_bytes only.
- `plugin_heavy` skipped on wamr/wamr-full/wamr-aot because the WASI hcsynth
  doesn't include sc3-plugins. Future option: build hcsynth with sc3-plugins
  linked into the WASI build (sibling CMake project; bigger lift).

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
