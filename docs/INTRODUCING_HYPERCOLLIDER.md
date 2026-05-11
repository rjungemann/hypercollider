# Introducing HyperCollider

**SuperCollider in the browser, in Node.js, and as standalone binaries — compiled to WebAssembly.**

---

## What and Why

HyperCollider is a fork of SuperCollider that removes all native desktop targets and compiles exclusively to WebAssembly. The goal: run SuperCollider **everywhere** — in browsers, in CI, on embedded devices, in serverless environments — without a native install.

In the way that Ruby has alternative implementations like JRuby and Rubinius, I hope HyperCollider can be an alternative implementation to SuperCollider, and maybe find some ideas worth contributing back. By targeting WASM, we get:

- **Portability**: Same build runs on macOS, Linux, Windows, ARM, x86, browser, Node.js
- **Zero-install**: No `brew install supercollider`, no plugin directories, no JACK/ALSA/PulseAudio wrangling
- **Embeddability**: Drop `hcsynth.wasm` into any JS project and you have a synth server
- **Reproducibility**: CI can render audio with bit-identical results across platforms

---

## hclang and hcsynth

The SuperCollider architecture splits into two processes: the language interpreter (`sclang`) and the audio server (`scsynth`). HyperCollider preserves this model with WASM builds:

| Component | SuperCollider | HyperCollider | Purpose |
|-----------|---------------|----------------|---------|
| Language | `sclang` | `hclang` | Interpret SC code, compile SynthDefs, send OSC |
| Server | `scsynth` | `hcsynth` | Real-time audio synthesis, UGens |

Both compile to WASM and run in two primary modes:

### JS/WASM (Browser + Node.js)
```bash
# Build
emcmake cmake -B build -DSC_WASM=ON -DAUDIOAPI=wasm
cmake --build build --target hclang hcsynth

# Run in Node.js
node cli/hclang.js --repl           # Interactive REPL
node cli/hcsynth.js --udp-port 57110 &  # Audio server
node cli/hclang.js --script patch.scd --scsynth-host 127.0.0.1
```

Audio output in Node.js uses `node-speaker` (or renders to WAV). In browsers, `hcsynth` runs as an AudioWorklet processor, feeding the WebAudio graph directly.

### WAMR Native Binaries
For users who want standalone executables without Node.js:
```bash
just build-all  # Produces hclang_native, hcsynth_native

# Single-file, statically-linked, zero-dependency binaries
./build/native/hclang_host/hclang_native --script patch.scd
./build/native/hcsynth_host/hcsynth_native --output out.wav --duration 10
```

These embed WAMR (WebAssembly Micro Runtime) and the entire SC class library. No `.wasm` sidecars, no `.js` files, no Node.js — just a binary.

---

## scscm

SuperCollider's syntax is powerful but idiosyncratic: a mix of braces, brackets, and parentheses with significant whitespace and punctuation-sensitive parsing. For programmatic generation and tooling, this is a liability.

**scscm** is a Scheme-like surface syntax that compiles to sclang:

```scheme
; scscm
(defsynth sine (freq 440 amp 0.1)
  (Out.ar 0
    (* (SinOsc.ar freq 0)
       (EnvGen.kr (Env.adsr 0.01 0.1 0.8 0.1) 1
                  (dict :doneAction 2))
       amp)))

(Synth "sine" (dict :freq 440 :amp 0.1))
```

Compiles to:
```supercollider
// sclang
SynthDef("sine", { |freq = 440, amp = 0.1|
  Out.ar(0,
    SinOsc.ar(freq, 0) *
    EnvGen.kr(Env.adsr(0.01, 0.1, 0.8, 0.1), 1, doneAction: 2) *
    amp
  )
})

Synth("sine", [freq: 440, amp: 0.1])
```

Why this matters:

1. **Regular syntax** — s-expressions are trivial to parse, generate, and transform
2. **Tooling** — the compiler (`lhc.js`) is a 200-line JS file; no C++ modifications to sclang
3. **Overtone-style API** — familiar to Clojure users (Overtone was a major inspiration)
4. **Self-contained** — standalone `lhc.js` bundle published with releases; no `npm install`

```bash
# From source
node cli/lhc.js -i patch.scscm -o patch.sc

# Standalone bundle (from GitHub releases)
node lhc.js -i patch.scscm | node cli/hc.js --output patch.wav
```

The compiler has 142 tests, supports the full sclang grammar subset used in practice, and is the recommended way to generate SC code programmatically.

---

## Browser IDE

A self-contained HTML5 IDE at `src/platform/test/sc_ide.html`. Open it in a browser — no server, no install, no build step required (pre-built WASM binaries are included in the repo).

**Features:**

- Real-time audio via AudioWorklet (Chrome, Edge, Safari)
- Diagnostics panel: node tree, OSC messages, errors
- Synth tree inspector with mutable parameters
- MIDI Learn panel for CC/HCC mapping
- Preset management (save/recall parameter states)
- Device Router for multi-output routing
- OSCQuery HTTP namespace server
- Profiling: CPU timeline, render histogram

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│  sc_ide.html (ACE editor + custom UI)                      │
├─────────────────────────────────────────────────────────┤
│  hclang.wasm (PyrInterpreter)                               │
│  hcsynth.wasm (AudioWorklet processor)                     │
│  WASM <-> JS bridge (emscripten, COMlink)                  │
└─────────────────────────────────────────────────────────┘
              │
              ▼
      WebAudio API (destination)
```

The IDE runs the entire SC stack in-browser: language interpretation, SynthDef compilation, OSC routing, and audio synthesis. All state is client-side — refresh the page and your patch is gone (by design; it's a scratchpad, not a DAW).

**Try it:**
```bash
npx serve .
# Open http://localhost:3000/src/platform/test/sc_ide.html
```

---

## Performance

### Current State

| Metric | Native SC | HyperCollider (WASM + Node.js) | Notes |
|--------|-----------|--------------------------------|-------|
| Cold start | ~200ms | ~600ms | Class library load dominates |
| Warm start | ~20ms | ~50ms | WASM instantiation overhead |
| Synth allocation | <1ms | ~2-3ms | OSC parsing + WASM boundary |
| Audio latency | <1ms | 2-5ms | AudioWorklet buffering |

### Heap Snapshot Optimization

The biggest win to date: **7.4× cold-start improvement** via heap snapshots.

The SuperCollider class library is ~5MB of compiled code. Loading it from scratch on every startup means:
1. Parse and compile 1000+ classes
2. Allocate millions of objects
3. Run static initialization

With Emscripten's heap snapshot, we capture the post-init heap state and restore it on startup:

```
Before: 627ms cold start
After:  85ms cold start
```

This is enabled by default in the JS build. See `docs/WASM_HEAP_SNAPSHOT.md` for the full writeup.

### Native Binaries (WAMR)

For latency-sensitive or embedded use cases, the WAMR-native binaries close the gap:

```
Toolchain          | Cold Start | Warm Start | Notes
------------------|------------|------------|------
JS (Node + WASM)   | 600ms      | 50ms       | Full feature set
WAMR (interpreted)  | 150ms      | 15ms       | No Node.js, single binary
WAMR AOT           | 80ms       | 5ms        | Ahead-of-time compiled
```

AOT compilation with `wamrc` (WAMR's LLVM-based compiler) gets us within 2× of native. The remaining gap is tracked in `docs/WAMR_PERF_PARITY_PLAN.md`.

### Known Gaps

1. **Frequency offset bug** — rendered sine measures ~468 Hz instead of 440 Hz; pipeline is otherwise correct
2. **AOT lang side crash** — `hclang.aot` hits SIGSEGV at `--opt-level > 0`; synth side AOT works fine
3. **Cold start still > native** — heap snapshot helps but class library initialization remains the bottleneck

See `docs/WAMR_PERF_INVESTIGATION.md` for the empirical breakdown.

---

## Where We're Going

HyperCollider is stable and usable today for CLI audio rendering, browser experimentation, and embedded deployment. The roadmap:

- **Phase 1 (done):** WASM port, browser IDE, basic CLI
- **Phase 2 (done):** Heap snapshots, WAMR native binaries, scscm compiler
- **Phase 3 (active):** Performance parity, AOT fixes, LSP server
- **Phase 4:** Zeroconf discovery, Quarks package management, sc3-plugins integration

The project is a work in progress, but the core thesis holds: **SuperCollider can run anywhere, and it can run well.**

---

## Try It

```bash
# Clone and build
git clone https://github.com/anthropics/hypercollider
cd hypercollider
source ./hypercollider.rc
just build

# Render a sine wave to WAV
node cli/hc.js --script cli/examples/sine_wave.scd --output /tmp/sine.wav

# Open browser IDE
npx serve .
# http://localhost:3000/src/platform/test/sc_ide.html

# Standalone binary
just build-all
./build/native/hclang_host/hclang_native --repl
```

---

*Documentation: see `docs/` for deep dives on each component.*
