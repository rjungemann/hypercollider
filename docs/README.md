# HyperCollider Documentation

Index of reference and planning documents for HyperCollider (WASM-only
SuperCollider fork).

## Reference

- **[CLI_QUICKSTART.md](CLI_QUICKSTART.md)** — Getting started with CLI audio rendering
- **[CLI_REFERENCE.md](CLI_REFERENCE.md)** — Complete CLI flag reference for all tools
- **[WASM_FEATURE_MATRIX.md](WASM_FEATURE_MATRIX.md)** — Feature support matrix (sclang + scsynth)
- **[WASM_REALTIME_AUDIO_GUIDE.md](WASM_REALTIME_AUDIO_GUIDE.md)** — Real-time audio in browser IDE and CLI
- **[WASM_HEAP_SNAPSHOT.md](WASM_HEAP_SNAPSHOT.md)** — Heap snapshot boot optimization (7.4× speedup)
- **[SCOPE_BUFFER.md](SCOPE_BUFFER.md)** — Lock-free scope buffer design
- **[HCLANG_NATIVE_REFERENCE.md](HCLANG_NATIVE_REFERENCE.md)** — WAMR native host architecture, embedding API, gotchas
- **[PERF_COMPARISON_PLAN.md](PERF_COMPARISON_PLAN.md)** — Benchmark methodology (native vs WASM)

### scscm — Scheme-like SuperCollider dialect

Documentation suite (read in order, or pick the entry point that matches your goal):

- **[scscm/SCSCM_QUICK_START.md](scscm/SCSCM_QUICK_START.md)** — 5-minute first-patch onboarding
- **[scscm/SCSCM_LIVE_CODING_TUTORIAL.md](scscm/SCSCM_LIVE_CODING_TUTORIAL.md)** — Hands-on guided ambient project (1–2 hours)
- **[scscm/SCSCM_PATTERN_TECHNIQUES.md](scscm/SCSCM_PATTERN_TECHNIQUES.md)** — Gallery of 17 pattern strategies (Euclidean, polyrhythms, Markov, cellular automata, L-systems, logic ops, …)
- **[scscm/SCSCM_CHEAT_SHEET.md](scscm/SCSCM_CHEAT_SHEET.md)** — One-page syntax lookup
- **[scscm/SCSCM_LANGUAGE_REFERENCE.md](scscm/SCSCM_LANGUAGE_REFERENCE.md)** — Complete language spec including BNF grammar and sclang→scscm migration appendix (authoritative)

The scscm compiler ships two ways: as `cli/lhc.js` (from the repo) and as a single-file standalone bundle `dist/lhc.js` produced by `just bundle-lhc` and uploaded to each GitHub release (artifact name: `lhc-standalone-vX.Y.Z`). The standalone bundle requires only a stock Node.js install — no `npm install`, no adjacent files.

### Plugins

- **[PLUGIN_INVENTORY_WASM.md](PLUGIN_INVENTORY_WASM.md)** — sc3-plugins WASM compatibility by tier
- **[SC3_PLUGINS_LICENSES.md](SC3_PLUGINS_LICENSES.md)** — Attribution and license compliance

## Active Plans

- **[HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md)** — WAMR native host: open work (REPL tab-completion, AOT opt-level upstream fix, frequency-offset bug, CI baseline gating)
- **[WAMR_PERF_PARITY_PLAN.md](WAMR_PERF_PARITY_PLAN.md)** — Closing the cold-start gap vs Node.js + V8
- **[WAMR_PERF_INVESTIGATION.md](WAMR_PERF_INVESTIGATION.md)** — Empirical perf data and findings
- **[SC3_PLUGINS_INTEGRATION_PLAN.md](SC3_PLUGINS_INTEGRATION_PLAN.md)** — sc3-plugins tree dissolve into root (Phase 4 deferred)
- **[WASM_POST_LAUNCH_ENHANCEMENTS.md](WASM_POST_LAUNCH_ENHANCEMENTS.md)** — Remaining post-MVP work (LSP server)
- **[BONJOUR_PLAN.md](BONJOUR_PLAN.md)** — Zeroconf advertising for hcsynth
- **[QUARKS_CLI_PLAN.md](QUARKS_CLI_PLAN.md)** — Quarks package management (CLI)
- **[QUARKS_BROWSER_PLAN.md](QUARKS_BROWSER_PLAN.md)** — Quarks package management (browser IDE)
- **[SCSCM_SUPERCOLLIDER_IMPLEMENTATION_PLAN.md](SCSCM_SUPERCOLLIDER_IMPLEMENTATION_PLAN.md)** — sclang-hosted scscm compiler implementation for differential stress testing
- **[scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md](scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md)** — Destructuring, `match`, `loop`/`recur`, auto-gensym `#`, `with-recording`

## Current State

- **WASM sclang** — Full class library, PyrInterpreter evaluation
- **WASM scsynth** — Real-time capable
- **Browser IDE** — `sc_ide.html` with real-time audio, diagnostics, presets, MIDI learn, synth tree inspector
- **CLI audio** — `.scd` → WAV rendering; `hclang_repl` real-time audio
- **CLI networking** — `hcsynth` UDP + TCP server; external scsynth routing
- **Native binaries** — `hclang_native` / `hcsynth_native` via embedded WAMR (single statically-linked executable, no Node.js required)
- **scscm** — Scheme-like SuperCollider dialect: compiler, REPL, Overtone-style API, 142 tests
- **sc3-plugins** — All Tier 1/2/3 (including StkUGens, JoshUGens, MCLDUGens)
- **Heap snapshot** — 7.4× boot speedup (627ms → 85ms cold→warm)
- **MIDI learn** — CLI `.midi-map` commands + browser IDE MIDI Learn panel
- **OSCQuery** — `hcsynth --oscquery-port` HTTP namespace server
- **Preset management** — CLI `.preset` commands + browser IDE Preset panel
- **Multi-device routing** — CLI `--device-route`; browser `DeviceRouter`
- **Profiling tools** — CPU timeline, render histogram, `hcsynth --profile`
- **Boost-free** — Project no longer depends on Boost (header-only `boost::math` via CPM is the only remnant)
- **CPM dependencies** — All third-party C++ deps fetched via CPM.cmake (WAMR, Asio, miniaudio, dr_libs, tinyosc, CLI11, boost::math)
