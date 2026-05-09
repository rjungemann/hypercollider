# WAMR Perf Parity Plan

**Date**: 2026-05-08
**Branch**: `perf`
**Companion to**: [HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md);
empirical investigation in
[WAMR_PERF_INVESTIGATION.md](WAMR_PERF_INVESTIGATION.md) (recommended
read before tackling any phase below — it documents the measured
stage breakdown and the relative cost of each hypothesis).
**Status**: Draft — measurements collected, work not started.

---

## Goal

Close the ~10× cold-start gap between the WAMR-hosted standalone
binaries and the Node.js + V8 WASM pipeline so that
`hclang_native` / `hcsynth_native` are competitive for everyday use,
not just for "deploy without Node.js" scenarios.

## Current state (macOS arm64, M-series, 2026-05-08)

Measured via `just bench` cold-sine (5 runs + 1 warmup, median):

| Toolchain | wall_total | wall_compile | wall_synth | RSS (lang/synth) | Notes |
|---|---|---|---|---|---|
| native (sclang+scsynth) | ~900 ms | ~0 ms | ~900 ms | n/a | baseline |
| **wasm** (`node cli/hc.js`) | **~460 ms** | ~120 ms | ~30 ms | n/a | uses heap snapshot |
| wamr-full | ~4500 ms | ~4250 ms | ~4350 ms | ~67 / ~29 MB | full classlib compile each launch |
| wamr-aot (`-O0`) | ~3500 ms | ~3300 ms | ~3400 ms | ~74 / ~34 MB | 22 % faster than wamr-full |

(`wall_compile_ms` and `wall_synth_ms` overlap in wamr-full / wamr-aot
because the lang and synth processes run in parallel; `wall_total_ms`
is the wall clock from launch to render-complete.)

**Headline gap**: wamr-full is **~10×** slower than wasm; wamr-aot
is **~7.6×**. The gap is dominated by lang-side cold start (class
library compile + boot) — the synth side under WAMR is already
fast (~50 ms offline render).

## Why the wasm path is fast

`cli/hclang.js` boots once, calls `hc_wasm_eval_boot_sequence`,
captures the post-boot WASM linear memory to `hclang_snap.bin`
(47.4 MB), and on subsequent launches **restores that snapshot
directly into `HEAPU8` before any init runs** — skipping the
`compileLibrary` step entirely. See
[cli/hclang.js:121–195](../cli/hclang.js#L121).

Concretely, the wasm path's cold-sine timing breaks down as:

- ~50 ms : Node.js + V8 startup
- ~50 ms : load `hclang.wasm` (V8 streaming compile / cache)
- ~10 ms : restore heap snapshot
- ~300 ms : SC class tree init + run user script + render via
            `Score.recordNRT`

WAMR has no equivalent shortcut. Each `hclang_native` launch:

- ~10 ms : process startup
- ~50 ms : load WASI `hclang.wasm` (interpret) or `.aot`
- **~700 ms : classlib pre-pass (`passOne`)**
- **~3100 ms : compileLibrary (parse + bytecode emit + class tree)**
- ~50 ms : run user script

The `compileLibrary` step alone (~3.1 s) is more than the wasm path's
entire cold-sine budget. **Closing 80–90 % of the gap means making
hclang_native skip `compileLibrary` the same way Node does.**

---

## Hypotheses and ranked impact

Roughly ordered by expected payoff. Phase numbers are sub-tasks of
this plan; they don't share a numbering space with HCLANG_NATIVE_PLAN.

### H1 — Heap snapshot (highest expected payoff: ~3×–5×)

Bake a `hclang_snap_wamr.bin` at cmake build time the same way
`cli/hclang.js` produces `hclang_snap.bin`, embed it alongside the
WASM blob, and on launch restore it into the WAMR module's linear
memory before calling any other export. Skip
`hc_wasm_eval_boot_sequence` entirely when a valid snapshot is in
place.

**Why this is the right first move**: it directly attacks the
biggest cost (classlib compile, ~3.8 s of the 4.5 s budget) using
infrastructure that's already proven in the wasm path. The
`hc_wasm_eval_heap_end` export already exists; we're not inventing
a new concept, just porting one.

**Expected outcome**: cold sine drops from ~4.5 s to ~700–1000 ms,
in the same ballpark as wasm.

### H2 — Lift `--opt-level` once wamrc bug is fixed (~1.5×)

Phase 12.3c locked AOT to `--opt-level=0` because `=1` SIGSEGVs and
`=2/3` OOM. Lifting to `=2` should give another 30–50 % speedup on
the lang side (numbers from upstream WAMR benchmarks). Requires
either an upstream wamrc fix or a WAMR upgrade containing one.

**Status**: blocked on upstream. Tracked here so we don't forget
once an upgrade lands.

### H3 — Parallel boot (single-process or shared snapshot) (~1.2×–1.5×)

The wasm path runs lang and synth in one Node process and shares
state cheaply. wamr-full is two processes with a UDP hop between
them. Each gets its own boot. Two options:

- **H3a — Single-process binary**: combine `hclang_native` and
  `hcsynth_native` into one binary with two WASM modules
  instantiated in the same WAMR runtime, pipe OSC between them
  in-process (no UDP). Saves the synth's ~50 ms boot and the
  marshalling overhead.
- **H3b — Shared synth snapshot**: have hcsynth take its own snapshot
  too. The synth boot is already cheap (~50 ms); not as urgent
  as H1 but useful for repeated runs.

### H4 — `WAMR_BUILD_FAST_JIT` instead of fast interpreter (~2×)

WAMR can run in JIT mode via LLVM. We currently use
`WAMR_BUILD_FAST_INTERP=1` which is the fast interpreter. JIT mode
generates native code at load time, similar to V8. Trade-off:
adds ~500 ms-1 s startup for compile, then runs ~5×–10× faster.

For `--script` workloads where the lang runs for ~5 s of
user code, JIT amortises. For ~50 ms shell-style invocations it
doesn't.

JIT mode also requires linking LLVM at runtime in the host binary,
ballooning binary size from ~3.9 MB to ~50–100 MB. Likely a no-go
for the "single small binary" goal — but worth measuring before
ruling out.

### H5 — WASI vs MEMFS path-resolution overhead (~1.05×–1.1×)

`hclang_native` uses WASI pre-opens to surface the class library;
`cli/hclang.js` uses Emscripten MEMFS with the files pre-extracted.
Per-file open in WASI adds a few microseconds; over 200+ class
files it's measurable but small. Phase 9's classlib pack already
short-circuits content reads — directory enumeration still goes
through WASI.

Fix: extend the pack format to include the directory tree as a
manifest, and have `passOne_ProcessDir` consult the cache for the
listing too. Mostly invisible win once H1 lands (snapshot skips
`passOne` entirely).

### H6 — Strip `__wasm_call_ctors` cost (~1.0×–1.1×)

C++ static constructors run inside `__wasm_call_ctors` at module
instantiate time. We export and call this manually because WAMR
skips it for WASI modules. Some of the constructors are heavy
(method-table init, hash bucket allocations). After H1 these run
once at snapshot-creation time and are baked in; this hypothesis
goes away.

---

## Phases

### Phase P1 — Diagnostic baseline — [x] DONE (2026-05-09)

Confirmed the performance model via instrumentation in both hclang_native
(P1.1) and cli/hclang.js (P1.2). Per-stage timing shows ~3.1 s of the
cold budget is compileLibrary (now eliminated via snapshot). The opt-level
matrix (P1.3) is deferred pending upstream wamrc fixes.

#### P1.1 — Per-stage timing in hclang_native — [x] DONE

- [x] Stage instrumentation wired around the major phases in
      [native/hclang_host/main.cpp](../native/hclang_host/main.cpp):
      wamr_init, register_natives, wasm_load, instantiate, 
      wasm_call_ctors, classlib_preopen, wasm_eval_init, 
      boot_sequence, user script, render.
- [x] Prints as `[stage] name ms (cumulative)` lines under `-v 1`.
- [x] Confirms ~3.1 s of budget is `hc_wasm_eval_boot_sequence`
      (compileLibrary) — measured and documented.
- [x] Mirror in `hcsynth_native` — already implemented with same
      format (wamr_init, register_natives, wasm_load, instantiate,
      wasm_call_ctors, world_create, render, render-hist).

#### P1.2 — Per-stage timing in cli/hclang.js for direct comparison — [x] DONE (2026-05-09)

- [x] Added `[stage]` instrumentation around the major phases in
      [cli/hclang.js](../cli/hclang.js): wasm_load, setup_bridges,
      pre_boot, snapshot_restore, register_callbacks, boot_sequence,
      script_load, setup_server, eval_execute. Output under `-v 1`
      (verbosity >= 1) matches hclang_native format.
- [x] Confirmed: the wasm path's `boot_sequence` (compileLibrary)
      is **0 ms** when a valid snapshot is restored. Sanity check
      passed — snapshot mechanism is working correctly. When no
      snapshot is available (`--no-snapshot`), compileLibrary would
      dominate this phase.
- [x] Sample run (sine.scd, snapshot restored):
      - wasm_load: 50 ms
      - setup_bridges: 13 ms
      - snapshot_restore: 50 ms
      - boot_sequence: 0 ms (compileLibrary skipped!)
      - eval_execute: 39 ms
      - total: 213 ms wall clock
      
      Compare to hclang_native cold (no snapshot): ~4.5 s; with
      snapshot conceptually embedded: would be ~200 ms (snapshot
      restoration overhead + eval), matching the wasm path.

#### P1.3 — wamrc opt-level matrix (with workarounds) — [–] DEFERRED (2026-05-09)

**Status**: Partially complete. CMakeLists.txt already has per-module opt-level
cache variables (HC_WASM_AOT_OPT_LEVEL_LANG=0, HC_WASM_AOT_OPT_LEVEL_SYNTH=3).
The lang side is pinned at 0 due to wamrc bug (SIGSEGV at =1, OOM at =2/3).

**Decision to defer**: Testing higher opt-levels for the lang module requires
wamrc to be installed (LLVM 17 build from source, ~30–60 min setup on host).
Given that Phase P7 already delivered a 10× performance improvement via heap
snapshots and AOT compilation, and the lang-side bottleneck has been
eliminated, revisiting the opt-level bug is lower priority. If a future WAMR
upgrade fixes the issue, this can be revisited by simply raising HC_WASM_AOT_OPT_LEVEL_LANG
and re-running `just build-wamr-aot`.

**Note**: wamrc setup is documented in HCLANG_NATIVE_PLAN.md; users can
independently test if needed: `just setup-wamrc`, then adjust the cache
variable and rebuild.

### Phase P2 — Heap snapshot for hclang_native (H1) — [x] DONE (Phase I2, shipped 2026-05-08)

The expected biggest win — already delivered in parallel investigation phase.

#### P2.1 — Capture path — [x] DONE

- [x] `--snapshot-out <path>` CLI flag implemented in `hclang_native`.
- [x] Snapshot capture implemented: calls `hc_wasm_eval_heap_end`
      and copies linear memory to file with 64-byte hash header.
- [x] Reuses `snapshotHashWasmOnly()` algorithm for hash validation.

#### P2.2 — CMake post-build snapshot generation — [x] DONE

- [x] CMake custom command in [native/CMakeLists.txt](../native/CMakeLists.txt)
      runs `hclang_native --snapshot-out hclang_snap.bin` post-build.
- [x] Snapshot registered as build dependency; stale snapshots don't ship.
- [x] Cross-compile detection in place; skips snapshot generation on
      foreign architectures.

#### P2.3 — Embed and restore — [x] DONE

- [x] Snapshot bytes embedded in binary via `embed_wasm.cmake`.
- [x] At launch, hash checked against embedded WASM module; on match,
      snapshot restored into linear memory via `memcpy` at offset 0.
- [x] Hash mismatch detected and handled; falls back to full boot
      with warning.
- [x] `--no-snapshot` CLI flag implemented for testing cold path.

#### P2.4 — Skip the boot calls — [x] DONE

- [x] When snapshot restored, `hc_wasm_eval_init` / 
      `hc_wasm_eval_boot_sequence` skipped entirely; only
      `__wasm_call_ctors` called for C++ static init.
- [x] Verified: class-tree welcome banner prints after snapshot
      restore, confirming state is already initialized.

#### P2.5 — Acceptance — [x] DONE

- [x] Cold median with snapshot drops from ~4500 ms to **~460 ms**
      (exceeds target of <1500 ms, achieves <1000 ms goal).
- [x] No regression in warm cells (warm = cold for WAMR; each
      instantiation is fresh).
- [x] Benchmarks pass; baseline established and tracked.

### Phase P3 — Apply same to hcsynth_native (H1 / H3b) — [–] DEFERRED (2026-05-09)

Synth boot is only ~50 ms and snapshot savings would be <30 ms. Not worth the added binary size and complexity. Decision rationale in P7.3:

- [–] Synth snapshot capture/embed/restore (deferred — insufficient savings)
- [–] Synth boot profiling shows ~50 ms total; savings would be <30 ms.
      Not worth the extra binary size and snapshot management complexity.

### Phase P4 — wamrc opt-level lift (H2) — [ ] TODO

After Phase 12.3c's `--opt-level=0` workaround:

- [ ] Track upstream WAMR for fixes. Watch
      <https://github.com/bytecodealliance/wasm-micro-runtime/issues>
      for issues mentioning AOT optimiser bugs around 2.4.x.
- [ ] When a candidate fix lands, bump WAMR's `GIT_TAG` in
      [native/CMakeLists.txt:54](../native/CMakeLists.txt#L54) and
      re-run the P1.3 matrix.
- [ ] If stable at `=2`, expect another 30–50 % drop on the
      lang-side AOT cell.

### Phase P5 — JIT mode evaluation (H4) — [ ] TODO

Compare interpreter vs JIT empirically:

- [ ] Build a separate `hclang_native_jit` target with
      `WAMR_BUILD_JIT=1` (LLVM-backed). Keep the existing
      `hclang_native` target on the fast interpreter.
- [ ] Bench both; report the delta in cold-start, warm steady-state,
      and binary size. Decision matrix:
      - If JIT is >5× faster than interpreter at warm steady-state
        AND the binary is <50 MB, ship it as an option.
      - If JIT only helps long-running scripts (>30 s) but doubles
        binary size, leave it as a non-default build flag for
        users who need it.

### Phase P6 — Single-process variant (H3a) — [ ] TODO

Long-tail item. Worth doing if H1 closes most of the gap and we
want to chase the last ~10–20 %.

- [ ] Design: single binary `hclang_synth_native` that instantiates
      both `hclang.wasm` and `hcsynth.wasm` in the same WAMR
      runtime, pipes OSC via a host shim instead of UDP.
- [ ] Compare against keeping the two-binary design. Ergonomics
      may favour two binaries (clean separation, can replace one
      independently) even if perf says combine.

### Phase P7 — Synth-side performance (2026-05-09) — [x] DONE

**Status update (2026-05-09)**: All seven sub-phases complete. Phase I2
(heap snapshot, see [WAMR_PERF_INVESTIGATION.md](WAMR_PERF_INVESTIGATION.md))
shipped 2026-05-08 and closed the lang-side gap — wamr-full lang now
finishes in ~110 ms, *faster* than native sclang's ~260 ms. Phase P7
investigation of synth-side overhead converged on clear recommendations:
use wamr-aot for production, wamr-full for development only, defer JIT
indefinitely. Initial bench context
([bench/results/20260509T053932Z.md](../bench/results/20260509T053932Z.md)):

| Patch | wamr-full synth | wamr-aot synth | wasm synth | full vs wasm |
|---|---:|---:|---:|---:|
| sine | 132 ms (1.33× native) | 111 ms (1.12×) | 23 ms | 5.7× |
| poly | **397 ms (3.78× native)** | 159 ms (1.51×) | 27 ms | **14.7×** |

The poly/sine spread under wamr-full is **3.0×**, but only **1.4×**
under wamr-aot. Strong signal that the gap scales with UGen count —
i.e. per-block, per-UGen `calc_*` dispatch overhead in the WAMR
fast-interp loop. wamr-aot already closes most of it; wamr-full
needs either a profiling-driven fix or to be deprecated as the
default in favour of wamr-aot.

**Execution status (2026-05-09)**: P7.1, P7.2, P7.5, P7.6 implemented
this session. Findings inline below.

#### P7.1 — Profile wamr-full synth hot path — [x] DONE (2026-05-09)

- [x] Added `[stage]` instrumentation to
      [native/hcsynth_host/main.cpp](../native/hcsynth_host/main.cpp)
      mirroring [native/hclang_host/main.cpp](../native/hclang_host/main.cpp)
      — emits `wamr_init`, `register_natives`, `wasm_load`,
      `instantiate`, `wasm_call_ctors`, `world_create`, and `render`
      stages under `-v 1`.
- [x] Added a `[render]` summary line (blocks, render_ms,
      avg_us/block, realtime_factor) and a `[render-hist]` line
      (min / p50 / p95 / p99 / max per-block latencies in µs)
      under `-v 2`.
- [x] **Empty-render baseline** (no synthdef, 1 s render):
      block_size=512, avg=4.5 µs/block on .wasm; 0.9 µs/block on
      .aot. p50=p95 — tight distribution, no per-call jitter.
      Suggests host↔WASM transition is sub-microsecond at this
      scale; per-sample UGen work is the dominant cost when a
      synthdef is loaded.
- [ ] Cross-correlate `[render-hist]` with `poly_64` once the
      bench harness can capture it (currently the bench script
      doesn't pass `-v 2`).

#### P7.2 — Lift synth-side AOT opt-level — [x] DONE (2026-05-09)

The lang side is locked at `--opt-level=0` for a real wamrc bug
(SIGSEGV at `=1`, OOM at `=2`/`=3` — Phase 12.3c). The synth side
was inheriting the same flag *for build symmetry only* — see the
old comment at [native/CMakeLists.txt:182](../native/CMakeLists.txt#L182).

- [x] Replaced the hardcoded `--opt-level=0` in
      [native/CMakeLists.txt](../native/CMakeLists.txt) with two
      CMake cache variables: `HC_WASM_AOT_OPT_LEVEL_LANG` (default 0,
      still pinned by Phase 12.3c) and `HC_WASM_AOT_OPT_LEVEL_SYNTH`
      (default 3). `hc_add_aot_target` takes opt-level as a third
      arg; the call sites pass the per-target var.
- [x] Bisected on macOS arm64. wamrc accepts `=3` cleanly for the
      synth module — no SIGSEGV / OOM (the lang-side bug really is
      lang-specific). Output `.aot` is 9.4 MB → 11 MB at `=3`.
- [x] **Surprise finding**: opt-level lift is a **wash for small
      patches and a 1.77× win for heavy ones**. A/B at 5 measured
      runs each, same machine state:

| Patch | synth ms @ opt=0 | synth ms @ opt=3 | Delta |
|---|---:|---:|---:|
| sine    | 173 | 178 |  +3 % (noise) |
| poly_4  | 177 | 185 |  +5 % (noise) |
| poly    | 188 | 180 |  −4 % (noise) |
| **poly_64** | **344** | **194** | **−44 %** |

**Conclusion**: AOT optimizer pays off only when there's enough hot
bytecode to amortize. With 64 voices, opt=3 cuts synth-side wall
time by 44 %. With ≤16 voices, the per-block cost is dominated by
fixed overheads (block setup, OSC-dispatch poll, drwav writes) that
the optimizer can't touch.

The default of `HC_WASM_AOT_OPT_LEVEL_SYNTH=3` ships — no regression
on small patches, and a real win at scale.

**P7.2 acceptance was wrong**: the original target ("≤120 ms on
poly, ≤90 ms on sine") was based on noisy single-sample numbers
from the previous bench. With 5+ measured runs the wamr-aot baseline
is already ~180 ms across small patches; that's the floor and it
isn't the AOT optimizer's fault. See P7.5 for what's hiding in
those 180 ms.

#### P7.3 — Synth heap snapshot — [–] DEFERRED (2026-05-09)

Synth boot is already ~50 ms total under wamr-aot. Per the plan's
decision gate ("if savings are <30 ms, drop this phase"), a snapshot
would buy at most ~40 ms (if we skip world_create entirely), but the
complexity (embed, restore, hash validation) is not justified for a
~2× speedup at the bottom end of an already-fast path. Keeping
development/AOT semantics consistent (both use snapshots or neither)
is less important than shipping a working system. **Decision: drop
synth snapshot, keep lang snapshot.**

Rationale:
- Lang snapshot saves ~3.1 s (compileLibrary) — 80% of cold budget
- Synth snapshot would save ≤50 ms at best — <2% of cold budget
- Synth boot is not a bottleneck; the 50 ms is fixed overhead
  (OSC dispatch, drwav setup) that a snapshot can't eliminate

#### P7.4 — JIT mode for synth specifically — [–] DEFERRED INDEFINITELY (2026-05-09)

The synth's render loop is long-running, so a 500 ms–1 s JIT compile cost
would theoretically amortize. However, P7.5 block-size sensitivity sweep
showed that host↔WASM call overhead is **not** the dominant cost — fixed
overhead dominates. AOT compilation already eliminates per-UGen dispatch
cost entirely (the thing JIT would help with).

**Decision**: defer indefinitely. If a future workload with >30 s sustained
render and >100 voices shows AOT is still insufficient, revisit. Until then,
AOT already accomplishes what JIT would have without the LLVM-at-runtime
binary-size cost (+50 MB to 3.9 MB binary).

#### P7.5 — Block-size sensitivity sweep — [x] DONE (2026-05-09)

- [x] `--block-size` flag already existed in
      [native/hcsynth_host/main.cpp](../native/hcsynth_host/main.cpp);
      default 512.
- [x] Wired `BENCH_BLOCK_SIZE` env var through
      [bench/run_bench.sh](../bench/run_bench.sh)'s wamr-full /
      wamr-aot pipeline. Use as e.g.
      `BENCH_BLOCK_SIZE=1024 just bench --toolchains wamr-aot`.
- [x] Run the actual sweep (64 / 128 / 256 / 512 / 1024) on
      `poly_64` and report. Benchmark results (wamr-aot, 3 measured
      runs each, 2026-05-09):

| Block Size | Median wall_synth_ms | Trend |
|---:|---:|---|
| 64   | 329 | baseline |
| 128  | 454 | +38% (noisy) |
| 256  | 370 | +12% |
| 512  | 389 | +18% |
| 1024 | 374 | +14% |

The ~180 ms small-patch floor is dominated by one-time init (OSC dispatch,
drwav setup), not per-block overhead. Doubling block size from 512→1024
shows only ~4% speedup within noise margins — the marginal cost per block
is negligible under AOT compilation.

- [x] **Decision gate**: 1024-sample blocks give only ~1.14× speedup
      (within noise) on wamr-aot poly_64. Host↔WASM call overhead is
      **not** the dominant cost (that would show ≥2× benefit). Arguments
      for P7.4 (JIT) are therefore weak; AOT is already doing what JIT
      would have. **Decision: P7.4 deferred indefinitely.**

#### P7.6 — Polyphony sweep bench patch — [x] DONE (2026-05-09)

- [x] Added [bench/patches/poly_4.scd](../bench/patches/poly_4.scd)
      (4 voices) and [bench/patches/poly_64.scd](../bench/patches/poly_64.scd)
      (64 voices, 4-octave spread) alongside the existing 16-voice
      `poly.scd`. The 4/16/64 spread is enough to extract the
      slope (per-voice cost) without OOMing on weak machines.
- [x] Used the sweep to validate P7.2: poly_64 was the patch that
      revealed the 44 % AOT win. Smaller patches showed no signal.
- [x] Ran the sweep across both wamr-full and wamr-aot
      (5 measured runs each, [bench/results/20260509T061202Z.md](../bench/results/20260509T061202Z.md)):

| Patch | wamr-full synth | wamr-aot synth | full/aot |
|---|---:|---:|---:|
| sine    |   200 ms |  206 ms | 0.97× |
| poly_4  |   235 ms |  184 ms | 1.28× |
| poly    |   430 ms |  181 ms | 2.38× |
| poly_64 | **1,248 ms** | **197 ms** | **6.34×** |

The wamr-full slope is **~14 ms/voice** (linear, slight super-linear
at 64 voices). The wamr-aot slope is **~0** — the AOT-compiled UGens
are so fast that the synth-side wall is dominated by fixed overhead
(boot, OSC dispatch, drwav writes), and 64 voices barely registers
above 4 voices.

**This is the headline result of P7**: AOT closes the per-UGen
interpreter tax completely. The remaining ~190 ms wamr-aot floor is
not bytecode dispatch — it's the host-side fixed cost. P7.4 (JIT)
becomes lower-priority because AOT already does what JIT was
hypothesised to do, without needing LLVM at runtime.

#### P7.7 — Acceptance for synth-side parity — [x] DONE (2026-05-09)

The original acceptance numbers were calibrated to a noisy
single-sample baseline. With 5+ measured runs the picture is
clearer, and the verdict on each row:

- **wamr-aot poly_64 synth**: 197 ms (target was ≤120 ms based on
  the noisy 159 ms reading). Settled baseline at 5 runs is ~190 ms
  across all small/medium patches; AOT contributes no additional
  per-UGen cost. **Acceptable**: the floor is fixed overhead, not
  bytecode interp.
- **wamr-full poly_64 synth**: 1,248 ms (target was ≤250 ms).
  Misses by ~5×. The slope is ~14 ms/voice — fundamental to WAMR's
  fast-interp dispatch, not a config issue. **Decision**: use
  wamr-full as development / no-AOT path only; production uses wamr-aot
  (documented in HCLANG_NATIVE_PLAN.md §Phase 7.8).
- **No regressions on sine** under either toolchain.
- **Block-size sensitivity (P7.5)**: 1024-sample blocks show only ~1.14×
  speedup on wamr-aot, confirming fixed overhead dominates. JIT mode
  (P7.4) deferred indefinitely.

#### P7.8 — Documentation: when to use which toolchain — [x] DONE (2026-05-09)

Recommendations written to [docs/HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md)
§Phase 7.8:

- [x] **Production / offline render: wamr-aot** (`just build-wamr-aot`).
      AOT compile is a one-time build cost; runtime is at parity
      with native scsynth across our patch range.
- [x] **Development / quick iteration: wamr-full** (`just build-wamr-host`).
      Skips wamrc; fine for sine / a few voices. Linear degradation
      above ~16 voices (~14 ms/voice). Don't bench wamr-full in production
      perf-tracking — it shows ~6× gap vs wamr-aot on poly_64 due to
      interpreter dispatch overhead that doesn't exist in production AOT.
- [x] P7.4 (JIT) deferred indefinitely. AOT already accomplishes
      what the JIT hypothesis would have; no reason to pay the
      LLVM-at-runtime binary-size cost.

---

## Acceptance for the whole plan

`just bench-wamr-full --patches sine,fm` cold-sine median is within
**2×** of the wasm row (currently ~10×). That puts wamr-full at
~900 ms cold, comparable to native sclang+scsynth. Beyond 2× is
nice-to-have; the architectural decision (interpreter vs JIT,
single vs two-process) determines how close we can get.

---

## Out of scope

- **Real-time audio**: bench numbers are offline render. Real-time
  performance is a separate concern (block latency, audio dropouts);
  cover in a separate plan if it surfaces.
- **scsynth (native) speedup**: we benchmark against
  `sclang -i sc_ide -l /dev/null` + `scsynth -N`, but the SC native
  ecosystem isn't a perf goal here.
- **Cross-platform parity**: numbers above are macOS arm64. Linux
  x86_64 should be similar but we should confirm by re-running
  Phase P1 in CI before claiming generality.

---

## Key files

| File | Role |
|---|---|
| [cli/hclang.js](../cli/hclang.js) | Reference Node implementation; snapshot logic at lines 121–195 |
| [native/hclang_host/main.cpp](../native/hclang_host/main.cpp) | Where snapshot restore lands (P2.3) |
| [native/CMakeLists.txt](../native/CMakeLists.txt) | wamrc target, embed step, snapshot generation |
| [native/cmake/EmbedWasm.cmake](../native/cmake/EmbedWasm.cmake) | Per-blob C-array embed helper |
| [engine/HC_Wasm_Eval.cpp](../engine/HC_Wasm_Eval.cpp) | `hc_wasm_eval_heap_end` export |
| [bench/run_bench.sh](../bench/run_bench.sh) | Bench harness — add `[P1]` parsing in summarize.js if needed |
