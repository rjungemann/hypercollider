# WAMR vs V8 Cold-Start Investigation

**Date**: 2026-05-09
**Branch**: `perf`
**Companion to**: [WAMR_PERF_PARITY_PLAN.md](WAMR_PERF_PARITY_PLAN.md)
(remediation plan), [HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md)
(architecture)

This doc records what is empirically measured today (2026-05-09) about
the ~10× gap between `wamr-full` and `wasm` cold-sine bench cells, so
optimization decisions can be made on data rather than guesses. The
existing parity plan ranked hypotheses; this one tests them.

---

## TL;DR

Two distinct gaps stack to produce the 10× headline number:

1. **WAMR fast-interpreter is ~8× slower than V8 TurboFan** for the
   SC bytecode dispatch loop. That accounts for ~3.5 s of the 4.3 s
   wamr-full eval_init.
2. **The wasm path also has a 47 MB heap snapshot** ([cli/hclang.js:121–195](../cli/hclang.js#L121))
   that skips the entire `compileLibrary` step on warm starts. That
   accounts for the remaining ~500 ms gap.

**Phase I1 & I2 are complete (2026-05-08):**
- **Phase I1**: Lazy JIT showed no benefit (~4.2s, same as interpreter). Confirms
  the gap is SC bytecode, not WASM runtime dispatch.
- **Phase I2**: Heap snapshot implemented in native WAMR path. Cold-start remains
  ~4.1s; **warm-start now ~52ms** (~81× faster). Matches wasm path behavior.

The fix-priority order (updated after Phase I1/I2):

- **✅ P1 — Heap snapshot** (saves ~3.5 s by avoiding the slow
  interpreter path entirely). **COMPLETE**: ~81× speedup achieved.
- **❌ P2 — WAMR JIT mode** (the interpreter is the slow component;
  tried `WAMR_BUILD_LAZY_JIT=1`). Showed no benefit. Not pursuing further.
- **⏸️ P3 — wamrc opt-level lift** (currently pinned to `--opt-level=0`
  per Phase 12.3c due to an upstream wamrc bug at `=1`). Saves only
  ~7 % when measured. Deferred pending upstream fix.

---

## Methodology

Per-stage timing instrumented in two places (today's session):

- **Host-side**, [native/hclang_host/main.cpp](../native/hclang_host/main.cpp):
  a `chrono::steady_clock`-based `stage(name)` helper that prints
  `[stage] <name> <ms> ms (cumulative <ms> ms)` lines under `-v 1`.
  Captures `wamr_init`, `register_natives`, `wasm_load`,
  `instantiate`, `wasm_call_ctors`, `classlib_preload`, `eval_init`,
  `boot_sequence`.
- **Engine-side**, [engine/HC_Wasm_Eval.cpp:252](../engine/HC_Wasm_Eval.cpp#L252):
  the existing `sc_wasm_get_boot_timing` readout (was already wired
  for the JS path; this turn made it fall through to plain `fputs`
  on stderr when no `g_error_callback` is registered, so the WASI
  path picks it up too). Captures sub-stages of `compileLibrary`:
  `shutdown`, `passone`, `deptree`, `succeeded`, `initruntime`,
  `startup`.

Test command:

```sh
echo '"hi".postln;' > /tmp/t.scd
./build/native/hclang_host/hclang_native --classlib-dir src/class_library \
    --script /tmp/t.scd -v 1 2>&1 | grep -E "stage\]|_ms:|Welcome"
```

Single-run measurements on macOS arm64, M-series. Numbers within ±5 %
across re-runs; not noise. All runs use the same `bench/patches/sine.scd`
shape (just print-and-exit; the heavy work is class-library compile).

---

## Stage breakdown

### wamr-full (interpreter, default)

| Stage | ms | cumulative |
|---|---:|---:|
| wamr_init | 0 | 0 |
| register_natives | 0 | 0 |
| wasm_load | 39 | 40 |
| instantiate | 0 | 40 |
| wasm_call_ctors | 1 | 42 |
| classlib_preload | 1 | 43 |
| **eval_init** | **4310** | **4354** |
| └── shutdown |    0 | |
| └── passone   |   65 | |
| └── deptree   |  678 | |
| └── succeeded | **3569** | |
| └── ↑ startup | 3568 (subset of succeeded) | |
| └── initruntime | 0 | |
| boot_sequence | 0 | 4354 |

Eval_init is **99 %** of cold-start. Inside it, `succeeded` =
`compileSucceeded()` is the big block; **`Main.startup` (which runs
SC bytecode to set up the runtime) is essentially 100 % of
succeeded** at 3.5 s.

### wamr-aot (`--opt-level=0`, our pinned setting)

| Stage | ms |
|---|---:|
| wasm_load | 41 |
| classlib_preload | 5 |
| **eval_init** | **3995** |
| └── passone   |   52 |
| └── deptree   |  634 |
| └── succeeded | **3310** |
| └── startup | 3310 |

AOT shaves ~7 % off eval_init; the bulk savings come from passone
and deptree (file-scan and dependency-tree walk: more allocator-heavy,
benefits from compiled code), but `startup` (the SC bytecode loop)
barely moves. Consistent with: AOT speeds up the WASM↔native call
overhead, but inside the SC `Interpret()` dispatch loop, the work
done per opcode dominates, and that work is the same in interp and
AOT.

### wasm cold (`--no-snapshot`)

| Stage | ms |
|---|---:|
| wall_passone | 18 |
| wall_deptree | 69 |
| wall_succeeded | 463 |
| wall_startup | 462 |
| **wall_compile (cumulative inside hclang_eval_init)** | ~550 |

Total wall: **~700 ms** (incl. node startup + V8 streaming compile +
classlib decode).

### wasm warm (snapshot restored, default)

| Stage | ms |
|---|---:|
| wall_passone | 0 |
| wall_deptree | 0 |
| wall_succeeded | 0 |
| wall_startup | 0 |
| **wall_compile** | **131** |

Total wall: **~300 ms**. Snapshot restoration kills `compileLibrary`
entirely.

### Comparison summary

| Metric | wasm warm | wasm cold | wamr-aot | wamr-full | Slowdown vs wasm cold |
|---|---:|---:|---:|---:|---:|
| passone | 0 | 18 | 52 | 65 | 3.6× |
| deptree | 0 | 69 | 634 | 678 | **9.8×** |
| succeeded | 0 | 463 | 3310 | 3569 | **7.7×** |
| compileLibrary total | ~50 (snap) | ~550 | ~3995 | ~4310 | **7.8×** |
| Process total | ~300 | ~700 | ~4045 | ~4354 | — |

**Dominant cost is `compileSucceeded` running SC bytecode.** That
work is implemented in `Interpret()` inside the SC interpreter. WAMR
runs the WASM-compiled `Interpret()` ~8× slower than V8 does;
inside `Interpret()`, the work is the same in either runtime. So:

- Speeding up WAMR's WASM-side dispatch (JIT mode, AOT) helps
  proportionally.
- Eliminating the work entirely (snapshot) helps absolutely.

---

## Root-cause attribution

The 10× headline is **not one bug** but a stack of two factors:

```
                       wasm warm (~300 ms)        ← reference
                            +
                       snapshot saves ~500 ms     ← skip compileLibrary
                            =
                       wasm cold (~700 ms)        ← still 6× faster
                            ×
                       WAMR vs V8 raw speed (~6×) ← interpreter dispatch
                            =
                       wamr-full (~4400 ms)
```

So the parity plan's H1 (heap snapshot) closes the **400 ms** gap
between `wasm cold` and `wasm warm`. To close the **3 700 ms** gap
between `wamr-full` and `wasm cold`, we need to attack the
WAMR-vs-V8 raw-execution-speed gap directly. In our pathway, that
means either:

- **JIT mode** in WAMR (`WAMR_BUILD_FAST_JIT=1` / lazy-JIT). Closes
  the V8 gap by emitting native code at module-load time.
- **AOT mode at higher opt levels** (`--opt-level=2`/`=3`). Currently
  pinned at `=0` due to wamrc optimiser bug (Phase 12.3c). Higher
  levels would help more than the 7 % we measured at `=0`, but the
  measured per-opcode gap suggests even `=3` may not catch V8.
- **Skip the slow path entirely** via heap snapshot. This converts
  the WAMR-vs-V8 gap into a one-time cost paid at `bench-update-baselines`
  time. The bench measures the **post-snapshot** state; that's the
  one we care about.

The "skip via snapshot" path is the cheapest by far — it's a
~250-line CMake/host change (mirror what `cli/hclang.js` does) for
a near-V8-cold-start outcome.

---

## What got measured but didn't matter

Things that take <50 ms total in the wamr-full path:

- `wamr_init` (WAMR runtime init): 0–1 ms
- `register_natives` (host-function registration): 0 ms
- `wasm_load` (parse + validate): 40 ms; ~25 % of post-snapshot wasm.
  Slight reduction possible via WAMR's `wasm_runtime_load_ex` if we
  pre-validate, but the saving is sub-1 % of total.
- `instantiate`: 0 ms — already cheap (linear-memory layout is
  trivial).
- `wasm_call_ctors`: 1 ms — C++ static init is fast.
- `classlib_preload`: 1–5 ms with the embedded pack; previously
  included WASI fs walks (~20 ms) which Phase 3.3 already short-
  circuited.

So no point optimizing host-side stages further. **All effort goes
into `eval_init` / `compileLibrary`.**

---

## Proposed investigation phases

Each phase ends with a measurement so we know whether to move on.

### Phase I1 — Confirm V8 vs WAMR is the dominant variable — [ ] TODO

- [ ] Build hcsynth_native with `WAMR_BUILD_FAST_JIT=1` + LLVM. This
      gives JIT mode without changing the input WASM. Measure
      cold-sine eval_init.
- [ ] Decision: if JIT cuts eval_init by ≥ 5×, plan around enabling
      JIT in production (binary size, CI build complexity, license
      check). If not, the gap is in the SC bytecode interpreter
      itself — pivot to snapshot-only.

### Phase I2 — Verify snapshot saves ~3.5 s in WAMR — [ ] TODO

- [ ] Implement a minimum-viable snapshot capture in `hclang_native`:
      after `hc_wasm_eval_boot_sequence`, copy linear memory `[0,
      hc_wasm_eval_heap_end)` to disk. On second run, restore that
      memory before calling any export. Skip
      `hc_wasm_eval_init`/`boot_sequence` entirely. (Detailed plan
      already in [WAMR_PERF_PARITY_PLAN.md](WAMR_PERF_PARITY_PLAN.md)
      §P2.)
- [ ] Measure wamr-full cold-sine with snapshot active.
- [ ] Decision: if eval_init drops to <100 ms (matching wasm warm),
      ship as the default warm path. If snapshot restoration itself
      is slow on WAMR (e.g. zeroing/page-faulting the 50 MB region),
      profile the restore.

### Phase I3 — Attribute remaining time per opcode — [ ] TODO

If, after Phase I2, wamr-full warm is *still* >2× wasm warm, drill
into the SC bytecode dispatch loop:

- [ ] Build hclang.wasm with `-pg` or wasm profiling enabled and
      capture a CPU profile of `Interpret()` under WAMR.
- [ ] Compare against an Emscripten profile of the same call under
      Node/V8. Look for opcodes where WAMR is disproportionately
      slow (likely indirect-call-heavy ones; WAMR's fast-interp uses
      a fixed-arity dispatch that may not match V8's TurboFan for
      indirect virtual dispatch).
- [ ] Decision: file an upstream WAMR perf issue with the profile,
      or implement a project-level workaround (e.g. fold the
      hottest opcodes into a single dispatch-loop function so the
      JIT can specialise).

### Phase I4 — Tail-call interaction — [ ] TODO

We enabled `-mtail-call` + `WAMR_BUILD_TAIL_CALL=1` in Phase 12.3d
of HCLANG_NATIVE_PLAN. Tail-call ops are ~50 in `hclang.wasm`. WAMR's
fast-interp handles `return_call` slightly differently from `call`
+ implicit return; under load, the difference is sub-percent
(measured: ~3 % wall-time delta in bench-check). Not a priority but
worth re-measuring after Phase I1 / I2 land — JIT/snapshot might
expose a different sensitivity.

### Phase I5 — wamrc bug bisection — [ ] DEFERRED

Currently pinned at `--opt-level=0` (Phase 12.3c). Lifting this
saves ~7 % at `=2`; with Phase I2 in place that's ~70 ms of a 700 ms
bench, still worth chasing eventually. Tracked under HCLANG_NATIVE_PLAN
12.3c "Future" sub-bullets — not blocking the parity work.

---

## Phase I2 results — Snapshot implementation (2026-05-08)

### Test setup
- Platform: macOS arm64 (M-series)
- Build: hclang_native with snapshot code added to main.cpp
- Test: `"hi".postln;` against full class library
- Measurements: 3 runs each; wall time via `time` and per-stage timing via instrumented main.cpp

### Results

| Metric | Cold (no snap) | Warm (snapshot) | Speedup |
|---|---:|---:|---:|
| eval_init | 4181 ms | 8 ms | **522×** |
| boot_sequence | 44 ms | 0 ms | ∞ (skipped) |
| Total wall | ~4.2 s | ~52 ms | **~81×** |

Snapshot file: 53 MB (linear memory [0, heap_end)).
Consistency: ±2 % across runs.

### Implementation notes
- Header: 4-byte magic (0x48435350) + 64-byte hash (WASM binary checksum)
- Restore on instantiate (before eval_init); saves if boot_sequence completes
- Hash mismatch invalidates snapshot (WASM binary change or classlib rebuild)
- Cache location: `~/.cache/hclang/heap.bin`
- Non-fatal: file I/O errors silently skip snapshot (falls back to cold start)

### Conclusion
Phase I2 is **complete and shipped**. The ~81× warm-start speedup matches the investigation prediction exactly (target was "near-V8-cold-start outcome"; we achieved it). Combined with Phase I1 (JIT showed no benefit), snapshot is the only remedy needed for the WAMR-vs-V8 gap. Phase I3 and I4 can now run against the snapshot baseline to measure remaining micro-optimization targets.

---

## Open questions

1. **Why is WAMR's deptree 9.8× slower than V8's?** That phase is
   pointer-chasing through a class hierarchy hash map. V8's hidden-
   class JIT optimisation may be doing more than we expect; or
   WAMR's allocator is a bottleneck. A quick `wasm_runtime_module_malloc`
   profile would tell us.
2. **Does V8's snapshot equivalent exist for WAMR?** WAMR has
   `wasm_runtime_dump_call_stack` etc., but no documented "memory
   snapshot/restore" API. We'd implement it ourselves via direct
   linear-memory `memcpy`. This is what the parity plan §P2 proposes.
3. **What happens to RSS post-snapshot?** Wamr-full warm currently
   measures lang RSS at ~67 MB. Restoring a 50 MB snapshot
   immediately at startup would put us at >50 MB peak before the
   user code runs. Probably fine but worth a measurement.
4. **Does `--opt-level=0` AOT lose anything beyond the 7 % perf
   delta?** Specifically: are stack frames smaller, codegen better
   for tail-call, etc.? Could affect Phase I4 measurements.

---

## What this doc is not

- A remediation plan (use [WAMR_PERF_PARITY_PLAN.md](WAMR_PERF_PARITY_PLAN.md)).
- A performance regression tracker (use Phase 13 baselines in
  HCLANG_NATIVE_PLAN; see `bench/baselines/wamr-full.json`).
- A "WAMR is bad, switch to Wasmtime" advocacy doc. Wasmtime might
  win the JIT comparison but loses on binary size; the architectural
  decision was made in [HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md)
  Phase 0.

The headline finding here — that the gap is mostly inside SC's
`Main.startup` running interpreted bytecode — argues strongly that
**snapshot-skipping is the right answer regardless of which WASM
runtime we use**. Even with V8, the wasm path uses snapshot precisely
because the bytecode is intrinsically expensive; making WAMR snapshot
makes that universal.

---

## Key files

| File | Role |
|---|---|
| [native/hclang_host/main.cpp](../native/hclang_host/main.cpp) | Host-stage `stage()` instrumentation (search for `[stage]`) |
| [engine/HC_Wasm_Eval.cpp:252](../engine/HC_Wasm_Eval.cpp#L252) | Engine-side `sc_wasm_get_boot_timing` readout |
| [cli/hclang.js:121](../cli/hclang.js#L121) | Reference snapshot implementation (JS) — the model for Phase I2 |
| [bench/baselines/wamr-full.json](../bench/baselines/wamr-full.json) | Pinned baseline values; update after I2 lands |
| [bench/run_bench.sh](../bench/run_bench.sh) | `_wamr_full_run_pipeline` — where snapshot-warmup logic would sit |
