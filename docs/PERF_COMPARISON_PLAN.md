# Perf Comparison Plan: Native sclang/scsynth vs. WASM hclang/hcsynth

**Date:** 2026-05-06  
**Goal:** End-to-end wall-time and peak-RAM comparison between the native SuperCollider toolchain and the WASM CLI toolchain using identical synthesis patches. Measurements are split into three phases so startup overhead can be separated from actual synthesis work.

---

## Timing Phases

Every metric is tagged with one of three phases:

| Phase | What it covers | Why it matters |
|-------|---------------|----------------|
| **A — Cold total** | Fresh process: JS/Node startup + WASM instantiation + class library compile + synthesis | Real CLI invocation cost; what a user waits for when running `just render` |
| **B — Startup only** | Time from process start to "ready" — the runtime is initialized but no patch has been submitted | Isolates the fixed overhead that can never be amortized in a one-shot render |
| **C — Warm (already running)** | Patch submitted to an already-initialized runtime; measures compile + synthesis only, with no process or module startup cost | Simulates interactive/REPL use and repeated renders in a long-running session; shows the ceiling achievable if startup is amortized |

The ratio `(Phase A − Phase B) / Phase C` should be close to 1.0 if there is no JIT warmup effect. If it is significantly less than 1.0 it means the cold synthesis path has additional overhead not present in the warm path (e.g., Node.js JIT needing more calls to reach full speed).

---

## What We're Measuring

| Metric | Phase(s) |
|--------|----------|
| **Wall time — total** | A |
| **Wall time — startup** | B |
| **Wall time — compile** (patch → OSC) | A and C |
| **Wall time — synth** (OSC → WAV) | A and C |
| **Peak RSS** | A and C |

We render each patch to a fixed-length WAV (5 seconds, 48 kHz, stereo, 16-bit). All rendering is non-realtime — we are measuring offline render throughput, not real-time scheduling.

## What We're Not Measuring

- Real-time audio I/O latency
- GUI / IDE startup
- Network latency between sclang and scsynth (native uses UDP; we measure total pipeline time)
- Correctness or audio quality (a separate regression suite covers that)
- Cold filesystem/page cache effects (handled by warmup runs before each phase)

---

## Toolchain Invocations

### Native: sclang + scsynth NRT

#### Phase A — Cold

```bash
# Step 1: sclang compiles the patch into a binary OSC score
/usr/bin/time -l sclang -u 57120 -i sc_ide -l /dev/null \
    bench/harness_native.scd bench/patches/<name>.scd /tmp/bench_<name>.osc

# Step 2: scsynth renders the score to WAV
/usr/bin/time -l scsynth -N /tmp/bench_<name>.osc _ /tmp/bench_<name>.wav \
    48000 WAVE int16 2
```

#### Phase B — Startup (sclang)

Measure time from `sclang` invocation to the first `->` prompt (class library compiled and first expression evaluated). Drive via a trivial expression:

```bash
/usr/bin/time -l sclang -e "nil.postln; 0.exit"
```

Capture time to first line on stdout. Repeat 10 times; the class library is re-compiled from scratch each run.

For scsynth startup, time from invocation to the first `SuperCollider 3 server ready` log line:

```bash
/usr/bin/time -l bash -c 'scsynth -u 57110 & pid=$!; \
    while ! nc -z 127.0.0.1 57110 2>/dev/null; do sleep 0.01; done; \
    kill $pid'
```

#### Phase C — Warm (sclang already running)

Start sclang once in interactive mode fed via stdin pipe. Submit the harness+patch as an expression and measure round-trip time via `Main.elapsedTime` printed to stdout:

```bash
echo "var t = Main.elapsedTime;
      load(\"bench/patches/<name>.scd\");
      (\"compile_ms: \" ++ ((Main.elapsedTime - t) * 1000).round(0.1)).postln;
      0.exit" | sclang
```

Parse `compile_ms:` from stdout. This gives compile time with a live, already-loaded class library. Repeat 10 times within the same sclang session using a persistent stdin pipe.

**Note:** Native scsynth NRT always spawns a fresh process — there is no persistent NRT server mode. Phase C warm timing for scsynth NRT is therefore estimated as `Phase A synth time − Phase B scsynth startup time` rather than a direct measurement.

---

### WASM: hclang + hcsynth

#### Phase A — Cold

```bash
/usr/bin/time -l node cli/hc.js \
    --script bench/patches/<name>.scd \
    --output /tmp/bench_<name>.wav \
    --duration 5 \
    --sample-rate 48000 \
    --channels 2 \
    --bit-depth 16
```

`hc.js` runs hclang and hcsynth as child processes; wall time and RSS are captured from the outer process.

#### Phase B — Startup (hclang)

Time from `node cli/hclang.js` to first eval-ready state. hclang prints a ready signal on stdout after WASM instantiation and class library compilation; time from process start to that line:

```bash
/usr/bin/time -l node -e "
  const {execFile} = require('child_process');
  const t = Date.now();
  const p = execFile('node', ['cli/hclang.js', '--print-ready']);
  p.stdout.once('data', () => {
    process.stderr.write('startup_ms: ' + (Date.now() - t) + '\n');
    p.kill();
  });
"
```

If `hclang.js` does not already emit a ready signal, add a `--print-ready` flag that prints a sentinel line after the class library finishes compiling.

For hcsynth startup, time from `node cli/hcsynth.js` to World-initialized (first block allocations done). hcsynth in server mode prints a ready line; time to that:

```bash
/usr/bin/time -l node -e "
  const {execFile} = require('child_process');
  const t = Date.now();
  const p = execFile('node', ['cli/hcsynth.js', '--server', '--port', '57110']);
  p.stderr.on('data', d => {
    if (d.includes('SuperCollider 3 server ready')) {
      process.stderr.write('startup_ms: ' + (Date.now() - t) + '\n');
      p.kill();
    }
  });
"
```

#### Phase C — Warm (hclang + hcsynth already running)

Start both hclang and hcsynth as persistent processes. hclang already has a REPL mode (`cli/hclang_repl.js`) that keeps the interpreter alive and times individual evaluations. For batch use, drive it via stdin pipe and parse timing output:

```bash
# Terminal 1 — persistent hcsynth server
node cli/hcsynth.js --server --port 57110 --profile 1 &
HCSYNTH_PID=$!

# Harness — warm compile+render loop
for RUN in $(seq 1 13); do
  echo "load(\"bench/patches/<name>.scd\")" \
    | node cli/hclang.js --scsynth-port 57110 --print-timing \
    > /tmp/warm_<name>_${RUN}.json
done

kill $HCSYNTH_PID
```

`--print-timing` is a flag to add to `hclang.js` that prints `compile_ms` and `synth_ms` to stderr after each eval. hcsynth's existing `--profile 1` flag already emits per-block render stats to stderr; parse those to get synth time.

This gives a true warm path: the WASM module is instantiated once, the class library is compiled once, and only the patch compile + render work is measured.

---

## Patch Suite

Six patches covering a range of computational profiles. All render to 5 seconds stereo. Each is written once; two thin harness wrappers adapt it for native vs. WASM (see §Patch Harness).

| ID | File | Synthesis | Expected load |
|----|------|-----------|---------------|
| `sine` | `bench/patches/sine.scd` | Single `SinOsc`, panned center | Trivial — baseline startup overhead |
| `fm` | `bench/patches/fm.scd` | 4-op FM (`SinOsc` carrier + 3 modulators with envelopes) | Light CPU, tests UGen graph depth |
| `reverb` | `bench/patches/reverb.scd` | `SinOsc` → `FreeVerb` + `CombC` feedback network | Tests delay-line memory and DSP complexity |
| `poly` | `bench/patches/poly.scd` | 16 simultaneous `Saw` voices with `RLPF` and `EnvGen` | Stresses polyphony and envelope tracking |
| `granular` | `bench/patches/granular.scd` | `TGrains` granulator over a short in-memory buffer | Tests buffer read and scheduling overhead |
| `plugin_heavy` | `bench/patches/plugin_heavy.scd` | `DWGBowed`, `JPverb`, `VBAPan2` | Tests sc3-plugin dispatch and the Faust reverb path |

For `sine`, Phase C warm times will be nearly identical between toolchains — startup dominates the cold number and the synthesis work is trivial. The warm/cold gap will be most visible on `sine` precisely because it shows how large the startup overhead is relative to actual work.

`plugin_heavy` requires sc3-plugins on the native side. Detect at script start; skip if not installed.

---

## Patch Harness Design

Each patch file contains only synthesis logic: SynthDef definitions and a note schedule as `[time, nodeID, defName, args]` tuples. No server-start or `s.waitForBoot` code.

### `bench/harness_wasm.scd`
Passthrough that `load`s the patch path from `thisProcess.argv[0]`. No changes needed.

### `bench/harness_native.scd`
Wraps the loaded patch in a `Score` object and calls `Score.recordNRT`. Receives the patch path and output OSC path as `thisProcess.argv`.

---

## Harness Script

```
bench/
  run_bench.sh          # orchestrates all patches × toolchains × phases
  harness_native.scd
  harness_wasm.scd
  patches/
    sine.scd
    fm.scd
    reverb.scd
    poly.scd
    granular.scd
    plugin_heavy.scd
  results/
    <timestamp>.json
    <timestamp>.md
```

`run_bench.sh` pseudocode:

```bash
for PHASE in cold startup warm; do
  for PATCH in sine fm reverb poly granular plugin_heavy; do
    for TOOLCHAIN in native wasm; do
      for RUN in $(seq 1 13); do   # 3 warmup + 10 measured
        measure_run $PHASE $PATCH $TOOLCHAIN $RUN
      done
    done
  done
done
emit_report results/<timestamp>.json
```

For Phase C, the persistent hcsynth server is started once per patch group and torn down after all 13 runs for that patch.

### Output JSON Schema

```json
{
  "timestamp": "2026-05-06T...",
  "system": { "node": "v22.x", "sclang": "3.x", "platform": "darwin arm64" },
  "results": [
    {
      "phase": "cold",
      "patch": "fm",
      "toolchain": "wasm",
      "run": 4,
      "warmup": false,
      "wall_total_ms": 1234,
      "wall_compile_ms": 210,
      "wall_synth_ms": 1024,
      "peak_rss_kb": 204800,
      "output_bytes": 960044,
      "exit_code": 0
    },
    {
      "phase": "startup",
      "patch": null,
      "toolchain": "wasm",
      "run": 4,
      "warmup": false,
      "wall_lang_startup_ms": 680,
      "wall_synth_startup_ms": 190,
      "peak_rss_kb": 190000,
      "exit_code": 0
    },
    {
      "phase": "warm",
      "patch": "fm",
      "toolchain": "wasm",
      "run": 4,
      "warmup": false,
      "wall_compile_ms": 55,
      "wall_synth_ms": 840,
      "peak_rss_kb": 204800,
      "exit_code": 0
    }
  ]
}
```

### Summary Table

```
Phase     Patch    Metric              Native (med)  WASM (med)  Ratio
--------- -------- ------------------- ------------- ----------- ------
cold      sine     wall total (ms)              140         890    6.4×
cold      sine     peak RSS (MB)                 28         220    7.9×
startup   —        lang startup (ms)             95         680    7.2×
startup   —        synth startup (ms)            30         190    6.3×
warm      sine     compile (ms)                   8          12    1.5×
warm      sine     synth (ms)                   110         130    1.2×
warm      fm       compile (ms)                  10          15    1.5×
warm      fm       synth (ms)                   420         510    1.2×
```

The warm rows show the actual synthesis cost with startup stripped away. A ratio near 1× in the warm rows means WASM synthesis performance is close to native once startup is paid.

---

## Implementation Steps

| # | Task | Status |
|---|------|--------|
| 1 | Write the 6 patch files (`bench/patches/*.scd`) | ✅ Done |
| 2 | Write `bench/harness_native.scd` and `bench/harness_wasm.scd` | ✅ Done |
| 3 | Add `--print-ready` to `cli/hclang.js` | ✅ Done |
| 4 | Add `--print-timing` to `cli/hclang.js` | ✅ Done |
| 5 | Write `bench/run_bench.sh` | ✅ Done |
| 6 | Add `bench` / `bench-quick` Justfile tasks | ✅ Done |
| 7 | Run baseline and commit `results/baseline_<date>.json` | ⬜ Pending — run `just bench` after WASM build |

### Notes on each step

**Step 1 — Patch files.** Six `.scd` files under `bench/patches/`. Each contains only SynthDef/Synth/play code — no server boot or class library lifecycle calls. `plugin_heavy` is present but guarded by a runtime skip in the harness when sc3-plugins are absent.

**Step 2 — Harness files.** `bench/harness_wasm.scd` is a passthrough `load` that reads the patch path from `thisProcess.argv[0]`. `bench/harness_native.scd` wraps the patch in a `Score` + `Score.recordNRT` call for scsynth NRT rendering.

**Step 3 — `--print-ready`.** `hclang.js` now accepts `--print-ready`; after `_hc_wasm_eval_boot_sequence()` completes it prints `hclang:ready` to stdout. Phase B startup timing waits for that line.

**Step 4 — `--print-timing`.** `hclang.js` now accepts `--print-timing`; after each `_hc_wasm_eval_execute()` call it prints `compile_ms: N` to stderr. Phase C warm timing greps for that line.

**Step 5 — `run_bench.sh`.** Full orchestration script at `bench/run_bench.sh`. Handles all phases × patches × toolchains, 3 warmup + 10 measured runs each. Uses `gtime` (macOS) / `/usr/bin/time` (Linux) for RSS. Emits `bench/results/<timestamp>.json` and `bench/results/<timestamp>.md`.

**Step 6 — Justfile.** `just bench` and `just bench-quick` tasks added.

**Step 7 — Baseline run.** Run `just bench` after the WASM artifacts are built and commit the resulting JSON as `bench/results/baseline_<date>.json`.

---

## Caveats and Fair-Comparison Notes

**Startup cannot be amortized for native scsynth NRT.** Each `scsynth -N` invocation is a fresh process. Phase C warm synth time for native is an estimate (`cold_synth − startup_synth`), not a direct measurement. Clearly label estimated vs. directly measured rows in the report.

**WASM startup dominates short patches.** For `sine`, Phase A cold time is almost entirely startup. The warm Phase C rows will show the synthesis-only comparison, which is where WASM performance is most competitive with native.

**Node.js JIT.** The first few warm-phase renders in the same Node.js process may be faster or slower than later ones as V8 JIT-compiles hot paths. The 3 warmup runs before the 10 measured runs account for this. If large variance is observed within the 10 measured runs (p95/median > 1.5×) it should be flagged.

**RAM comparisons differ by phase.** Phase A cold RSS includes Node.js heap + WASM linear memory. Phase C warm RSS in the WASM path captures both hclang and hcsynth together (same Node process). Native Phase A RSS is per-process (sclang and scsynth measured separately, summed). All RSS comparisons carry this caveat in the report.

**Determinism.** Both pipelines are deterministic (NRT). Output WAV sizes must be identical across runs within each toolchain. Flag any deviation as an invalid run.

