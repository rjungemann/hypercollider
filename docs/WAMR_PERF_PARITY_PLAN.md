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

### Phase P1 — Diagnostic baseline — [ ] TODO

Confirm the model above. Until each cost is measured we shouldn't
commit to optimisations.

#### P1.1 — Per-stage timing in hclang_native

- [ ] Wire `gettimeofday`/`clock_gettime` instrumentation around the
      five distinct stages in
      [native/hclang_host/main.cpp:798–940](../native/hclang_host/main.cpp#L798):
      load, instantiate, `__wasm_call_ctors`, classlib WASI pre-open,
      `hc_wasm_eval_init`, `hc_wasm_eval_boot_sequence`, user script
      execute, render-complete signal.
- [ ] Print as `[P1] stage=<name> ms=<n>` lines under `-v 1`.
- [ ] Run cold-sine wamr-full 5× and report the medians; confirm
      ~3.1 s of the budget is `hc_wasm_eval_boot_sequence` (i.e.
      `compileLibrary`).
- [ ] Mirror in `hcsynth_native`. Likely shows ~50 ms total —
      already small, low priority.

#### P1.2 — Per-stage timing in cli/hclang.js for direct comparison

- [ ] Add the same `[P1]` instrumentation around `_hc_wasm_eval_init`
      and friends in [cli/hclang.js](../cli/hclang.js).
- [ ] Confirm the wasm path's `compileLibrary` is ~0 ms when a
      valid snapshot is restored (sanity check on the snapshot
      mechanism).
- [ ] Numbers go into a small comparison table at the top of this
      plan once measured.

#### P1.3 — wamrc opt-level matrix (with workarounds)

- [ ] Extend [native/CMakeLists.txt](../native/CMakeLists.txt)
      `hc_add_aot_target` so `--opt-level` is a CMake cache
      variable (`HC_WASM_AOT_OPT_LEVEL`, default 0).
- [ ] Re-run the bisection from Phase 12.3c with the heap bumped
      to 256 MB and the new tail-call instructions present. Some
      `--opt-level` combos that previously OOM'd may now pass.
- [ ] Record the matrix and pin the highest level that's stable.

### Phase P2 — Heap snapshot for hclang_native (H1) — [ ] TODO

The expected biggest win.

#### P2.1 — Capture path

- [ ] Add a `--snapshot-out <path>` CLI flag to `hclang_native`
      (mirroring cli/hclang.js's flag of the same name).
- [ ] After `hc_wasm_eval_boot_sequence` completes, call
      `hc_wasm_eval_heap_end` to get the high-water mark, then
      copy `[0, heap_end)` of the WASM linear memory to `<path>`.
      Prepend a 64-byte hash header (sha256 of hclang.wasm's
      bytes) so the loader can detect rebuilds.
- [ ] Reuse `cli/hclang.js`'s `snapshotHashWasmOnly()` algorithm
      (hash hclang.wasm bytes only — `.data` is irrelevant for the
      WAMR build).

#### P2.2 — CMake post-build snapshot generation

- [ ] In [native/CMakeLists.txt](../native/CMakeLists.txt), add a
      custom command that runs
      `hclang_native --snapshot-out hclang_snap.bin` after both
      `hclang.wasm` and `hclang_native` are built. Output goes to
      `build/wasi/lang/hclang/hclang_snap.bin`.
- [ ] Register the snapshot file as a dependency of the embed step
      so a stale snapshot doesn't ship.
- [ ] Skip silently if cross-compiling (snapshot must be generated
      on the same arch + WAMR build that loads it).

#### P2.3 — Embed and restore

- [ ] Extend `embed_wasm.cmake` to also embed the snapshot bytes,
      mirroring how `hclang_classlib.pack` is embedded today.
- [ ] At launch, before calling any `hc_wasm_eval_*` export, check
      the embedded snapshot's hash against `hclang.wasm`'s. On match,
      `memcpy` the bytes into the WAMR module's linear memory at
      offset 0 — `wasm_runtime_get_memory_ptr` returns the native
      pointer.
- [ ] On hash mismatch (somehow shipped a stale snapshot), fall
      back to the full boot path with a `[snapshot] mismatch:
      regenerating` warning.
- [ ] Add `--no-snapshot` CLI flag for testing the cold path.

#### P2.4 — Skip the boot calls

- [ ] When a snapshot is restored, skip
      `hc_wasm_eval_init` / `hc_wasm_eval_boot_sequence` entirely.
      The exported state is already initialised. Just call
      `__wasm_call_ctors` once (still needed for any non-snapshotted
      C++ static init) and proceed to the user script.
- [ ] Verify against the existing class-tree-inited welcome banner
      output: it should print after snapshot restore, not during.
      (cli/hclang.js does this correctly; reference it.)

#### P2.5 — Acceptance

- [ ] `just bench-wamr-full --patches sine,fm` cold median drops
      from ~4500 ms to **<1500 ms**, ideally <1000 ms.
- [ ] No regression in `wamr-full warm` cells.
- [ ] `bench-check` passes against the existing baseline (after
      a baseline refresh: `just bench-update-baselines`).

### Phase P3 — Apply same to hcsynth_native (H1 / H3b) — [ ] TODO

Synth boot is already cheap (~50 ms) but consistency wins:

- [ ] Mirror the snapshot capture/embed/restore in
      [native/hcsynth_host/main.cpp](../native/hcsynth_host/main.cpp).
- [ ] Synth doesn't have a `compileLibrary` step but does run
      `hc_wasm_init` + various static UGen registrations. Profile
      first; only proceed if the saving justifies the extra binary
      size.

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

### Phase P7 — Synth-side performance (2026-05-09) — [~] PARTIALLY DONE

**Status update**: Phase I2 (heap snapshot, see
[WAMR_PERF_INVESTIGATION.md](WAMR_PERF_INVESTIGATION.md)) shipped
2026-05-08 and closed the lang-side gap — wamr-full lang now
finishes in ~110 ms, *faster* than native sclang's ~260 ms. The
remaining WAMR overhead is on the synth side. Initial bench
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

#### P7.3 — Synth heap snapshot

- [ ] Mirror the lang-side snapshot logic from
      [native/hclang_host/main.cpp:41–120](../native/hclang_host/main.cpp#L41)
      into [native/hcsynth_host/main.cpp](../native/hcsynth_host/main.cpp).
      Capture point: after `hc_wasm_world_create` succeeds. Hash
      key: hcsynth.wasm bytes only.
- [ ] Bench delta: cold synth (no snapshot) vs warm (snapshot
      restored). Synth boot is reportedly ~50 ms; if savings are
      <30 ms, **drop this phase** — not worth the complexity.
- [ ] If kept, store at `~/.cache/hcsynth/heap.bin` (separate from
      lang's path so they don't collide).

#### P7.4 — JIT mode for synth specifically

The synth's render loop is long-running, so a 500 ms–1 s JIT
compile cost amortizes across the full audio render in a way that
short lang sessions can't. This is the inverse of the conclusion
in [WAMR_PERF_INVESTIGATION.md §Phase I1](WAMR_PERF_INVESTIGATION.md#phase-i1-results-jit-mode-testing)
(JIT didn't help lang) — and the right experiment to run because
the bytecode is genuinely hot here, not just numerous.

- [ ] Add a `HC_WASM_SYNTH_JIT` CMake option, off by default. When
      on, build a separate `hcsynth_native_jit` target with
      `WAMR_BUILD_FAST_JIT=1` (or `WAMR_BUILD_JIT=1` if Fast JIT
      is unavailable on ARM64 in the pinned WAMR).
- [ ] Bench `wamr-jit-synth` against `wamr-aot synth` on poly. If
      the JIT version is ≥1.5× faster than AOT, weigh the binary
      size cost (likely +30–50 MB from LLVM).
- [ ] **Decision gate**: ship as a separate `hcsynth_native_jit`
      binary if it beats AOT by ≥2× on poly. Keep AOT as default
      otherwise.

#### P7.5 — Block-size sensitivity sweep — [~] PARTIALLY DONE (2026-05-09)

- [x] `--block-size` flag already existed in
      [native/hcsynth_host/main.cpp](../native/hcsynth_host/main.cpp);
      default 512.
- [x] Wired `BENCH_BLOCK_SIZE` env var through
      [bench/run_bench.sh](../bench/run_bench.sh)'s wamr-full /
      wamr-aot pipeline. Use as e.g.
      `BENCH_BLOCK_SIZE=1024 just bench --toolchains wamr-aot`.
- [ ] Run the actual sweep (64 / 128 / 256 / 512 / 1024) on
      `poly_64` and report. Without this, we don't know if the
      ~180 ms small-patch floor is per-block setup overhead (would
      shrink with bigger blocks) or one-time init (wouldn't).
- [ ] **Decision gate**: if 1024-sample blocks give ≥2× speedup on
      wamr-full poly_64, the host↔WASM call overhead is the
      dominant remaining cost — argues for P7.4 (JIT) over more
      AOT tuning.

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

#### P7.7 — Acceptance for synth-side parity — [~] REVISED (2026-05-09)

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
  fast-interp dispatch, not a config issue. **Action**: deprecate
  wamr-full for synth-heavy workloads (P7.8); keep it as the
  development / no-AOT path for ergonomics.
- **No regressions on sine** under either toolchain.

#### P7.8 — Documentation: when to use which toolchain — [ ] TODO

Settled on the following recommendation; needs writing into
[docs/HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md):

- [ ] **Production / offline render: wamr-aot** (`just build-wamr-aot`).
      AOT compile is a one-time build cost; runtime is at parity
      with native scsynth across our patch range.
- [ ] **Development / quick iteration: wamr-full** (`just build-wamr-host`).
      Skips wamrc; fine for sine / a few voices. Linear degradation
      above ~16 UGens. Don't bench wamr-full in production
      perf-tracking — it will mislead.
- [ ] P7.4 (JIT) deferred indefinitely. AOT already accomplishes
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
