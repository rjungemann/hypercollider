# CLI Reference

Complete flag reference for the SuperCollider WASM CLI tools.

All tools live in `src/platform/wasm/cli/`. Run `npm install` there once before first use.

---

## `hc.js` — Unified offline renderer

Evaluates a `.scd` file through WASM sclang and renders the result to an audio file (or routes live OSC to a running scsynth).

```
node src/platform/wasm/cli/hc.js --script <file> [options]
```

### Required

| Flag | Description |
|------|-------------|
| `--script <file>` | Input `.scd` file to evaluate |

### Offline render options

| Flag | Default | Description |
|------|---------|-------------|
| `--output <file>` | — | Output audio file (`.wav`, `.aiff`, or `.raw`) |
| `--duration <seconds>` | `2.0` | Render duration |
| `--channels <n>` | `2` | Number of output channels |
| `--bit-depth <n>` | `16` | Output bit depth: `16`, `24`, or `32` (float) |
| `--output-format <fmt>` | inferred | Format: `wav`, `aiff`, `raw` |

### Live routing options

| Flag | Default | Description |
|------|---------|-------------|
| `--scsynth-host <addr>` | — | Remote scsynth host |
| `--scsynth-port <port>` | — | Remote scsynth UDP port |
| `--lang-udp-port <port>` | — | Local UDP port for scsynth replies |

### Shared options

| Flag | Default | Description |
|------|---------|-------------|
| `--sample-rate <hz>` | `48000` | Sample rate |
| `--block-size <samples>` | `512` | Render block size |
| `--verbosity <level>` | `0` | `-2` silent → `2` debug |
| `--sclang-js <path>` | auto | Path to `hclang.js` |
| `--scsynth-js <path>` | auto | Path to `scsynth.js` |
| `--verbose` | off | Print sclang post output (legacy) |
| `-- <args>` | — | Extra args passed via `thisProcess.argv` |

### Examples

```bash
# Basic render
node src/platform/wasm/cli/hc.js --script sine.scd --output sine.wav

# 30-second 48 kHz render
node src/platform/wasm/cli/hc.js --script piece.scd --output out.wav \
  --duration 30 --sample-rate 48000

# 24-bit AIFF
node src/platform/wasm/cli/hc.js --script piece.scd --output out.aiff \
  --bit-depth 24

# Route live OSC to a running scsynth
node src/platform/wasm/cli/hc.js --script live.scd \
  --scsynth-host 127.0.0.1 --scsynth-port 57110
```

---

## `hclang.js` — sclang-only evaluator

Evaluates a `.scd` file and writes the captured OSC command payload to JSON, or routes OSC live to a running scsynth.

```
node src/platform/wasm/cli/hclang.js --script <file> [options]
```

### Required

| Flag | Description |
|------|-------------|
| `--script <file>` | Input `.scd` file to evaluate |

### Offline options

| Flag | Description |
|------|-------------|
| `--output <file>` | Output `.json` file containing OSC command payload |

### Live routing options

| Flag | Default | Description |
|------|---------|-------------|
| `--scsynth-host <addr>` | — | Remote scsynth host |
| `--scsynth-port <port>` | — | Remote scsynth UDP port |
| `--lang-udp-port <port>` | — | Local UDP port for scsynth replies |
| `--call-stop` | off | Evaluate `Main.stop` after script finishes |

### Shared options

| Flag | Default | Description |
|------|---------|-------------|
| `--verbosity <level>` | `0` | `-2` silent → `2` debug |
| `--sclang-js <path>` | auto | Path to `hclang.js` |
| `--verbose` | off | Print sclang post output (legacy) |

### Examples

```bash
# Capture commands to JSON
node src/platform/wasm/cli/hclang.js --script sine.scd --output commands.json

# Route directly to running scsynth
node src/platform/wasm/cli/hclang.js --script live.scd \
  --scsynth-host 127.0.0.1 --scsynth-port 57110
```

---

## `hcsynth.js` — scsynth-only renderer / server

Replays a captured OSC command payload (from `hclang`) and renders to audio, or runs as a network OSC server.

```
node src/platform/wasm/cli/hcsynth.js --commands <json> --output <file> [options]
node src/platform/wasm/cli/hcsynth.js --server [options]
```

### Offline render options

| Flag | Default | Description |
|------|---------|-------------|
| `--commands <json>` | — | OSC command payload from `hclang` |
| `--output <file>` | — | Output audio file |
| `--duration <seconds>` | `2.0` | Render duration |
| `--channels <n>` | `2` | Output channels |
| `--bit-depth <n>` | `16` | `16`, `24`, or `32` (float) |
| `--output-format <fmt>` | inferred | `wav`, `aiff`, `raw` |

### Server options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--server` | | off | Run as network OSC server |
| `--udp-port <port>` | `-u` | `57110` | UDP listen port |
| `--tcp-port <port>` | `-t` | off | TCP listen port |
| `--bind-address <addr>` | `-B` | `127.0.0.1` | Bind address |
| `--max-logins <n>` | `-l` | `64` | Max TCP connections |
| `--tcp-password <pass>` | `-p` | none | TCP session password |
| `--realtime-audio` | | off | Stream audio to speakers via `node-speaker` |

### Shared options

| Flag | Default | Description |
|------|---------|-------------|
| `--sample-rate <hz>` | `48000` | Sample rate |
| `--block-size <samples>` | `512` | Render block size |
| `--profile <n>` | off | Emit CPU/timing profile every N blocks |
| `--verbosity <level>` | `0` | `-2` silent → `2` debug |
| `--scsynth-js <path>` | auto | Path to `scsynth.js` |

### Examples

```bash
# Two-stage offline render
node src/platform/wasm/cli/hclang.js --script sine.scd --output commands.json
node src/platform/wasm/cli/hcsynth.js --commands commands.json --output sine.wav

# UDP server
node src/platform/wasm/cli/hcsynth.js --server --udp-port 57110

# UDP + TCP server with auth
node src/platform/wasm/cli/hcsynth.js --server -u 57110 -t 57120 \
  -B 0.0.0.0 --tcp-password secret

# Real-time audio output
node src/platform/wasm/cli/hcsynth.js --server --udp-port 57110 --realtime-audio
```

---

## `hclang_repl.js` — Interactive SuperCollider REPL

Starts an interactive session with WASM sclang + WASM scsynth and real-time audio output via `node-speaker`.

```
node src/platform/wasm/cli/hclang_repl.js
```

| REPL command | Description |
|---|---|
| `.quit` | Exit the REPL |
| `.help` | Show available commands |
| `.load <file.scd>` | Load and evaluate a `.scd` file |

Requires `node-speaker` to be buildable on the host platform (macOS and Linux; Windows support is untested).

---

## `hcl_repl.js` — Interactive scscm REPL

Same as `hclang_repl.js` but accepts the [scscm](../src/platform/wasm/cli/README_SCSCM.md) Scheme-like dialect.

```
node src/platform/wasm/cli/hcl_repl.js [--show-compiled] [--wasm-sclang | --native-sclang]
```

| Flag | Description |
|------|-------------|
| `--show-compiled` | Print generated SC code before evaluating |
| `--wasm-sclang` | Force WASM sclang backend (default) |
| `--native-sclang` | Use system sclang instead of WASM |

| REPL command | Description |
|---|---|
| `.quit` | Exit |
| `.help` | Show available commands |
| `.load <file.scscm>` | Load a `.scscm` file |
| `.load-sc <file.scd>` | Load a `.scd` file directly |

---

## `lhc.js` — scscm to SC compiler

Compiles a `.scscm` (Scheme-like dialect) file to SuperCollider sclang code.

```
node cli/lhc.js [options] <input>
```

Two equivalent forms:

| Form | Path | When to use |
|------|------|-------------|
| Source-tree | `cli/lhc.js` | You have the repo checked out |
| Standalone bundle | `dist/lhc.js` | Distributing to users — single file, no `npm install`, requires only Node.js |

Build the standalone bundle with `just bundle-lhc` or download the `lhc-standalone-vX.Y.Z` artifact from the latest GitHub release.

| Flag | Short | Description |
|------|-------|-------------|
| `--input <file>` | `-i` | Input `.scscm` file (or pass as positional arg) |
| `--output <file>` | `-o` | Write generated sclang to file (default: stdout) |
| `--verbose` | | Print token/AST counts during compilation |
| `--help` | `-h` | Show help and exit |
| `--version` | `-v` | Print version and exit |

### Examples

```bash
# Print generated sclang to stdout
node cli/lhc.js piece.scscm

# Write to a .sc file
node cli/lhc.js piece.scscm -o piece.sc

# Compile and render in one pipeline
node cli/lhc.js piece.scscm | node cli/hc.js --output piece.wav

# Standalone bundle (after `just bundle-lhc` or release download)
node dist/lhc.js piece.scscm -o piece.sc
```

---

## `test_hypercollider_parity.js` — hyper-collider comparison suite

Three-tier regression suite that validates the WASM CLI against instruments ported from [hyper-collider](https://github.com/rjungemann/hyper-collider). Instruments covered: `kick1`, `snare1`, `hihat1`, `bass1`, `pluck1`.

```
node src/platform/wasm/cli/test_hypercollider_parity.js
```

**Tier 1 — SCSCM code-text checks** (always runs, no build required)  
Compiles each `.scscm` fixture and asserts expected UGen names appear in the generated sclang output.

**Tier 2 — WASM smoke tests** (requires WASM build)  
Renders each `.scd` fixture via the WASM pipeline and verifies the output WAV is non-silent and approximately the right duration.

**Tier 3 — WASM vs native audio parity** (requires `NATIVE_HCSYNTH`)  
Feeds the same OSC score to both WASM and native scsynth, then compares signal metrics (correlation, SNR, RMS). Uses relaxed thresholds compared to `test_audio_regression.js` to tolerate floating-point divergence from noise and IIR filter UGens.

### Environment variables

| Variable | Description |
|----------|-------------|
| `NATIVE_HCSYNTH=<path>` | Path to native `scsynth` binary (auto-detected at `/opt/homebrew/bin/scsynth`) |
| `SKIP_NATIVE=1` | Skip Tier 3; run Tiers 1 + 2 only |
| `SKIP_WASM=1` | Skip Tiers 2 + 3; run Tier 1 only |
| `AUDIO_DIFF_SOX=1` | Generate SoX spectrogram artifacts on failure |
| `AUDIO_DIFF_KEEP_ARTIFACTS=1` | Keep temp WAV/PNG files after the run |

---

## npm scripts

Run from `src/platform/wasm/cli/` after `npm install`.

### Rendering

| Script | Description |
|--------|-------------|
| `npm run render:smoke` | Render `examples/sine_wave.scd` to `out/smoke.wav` as a quick build check |

### REPLs

| Script | Description |
|--------|-------------|
| `npm run repl` | Interactive sclang REPL with real-time audio |
| `npm run repl:scscm` | Interactive scscm REPL with real-time audio |

### Tests

| Script | Requires | Description |
|--------|----------|-------------|
| `npm test` | WASM build | Core CLI integration tests |
| `npm run test:parity` | WASM build + native | WASM ↔ native output parity |
| `npm run test:audio-regression` | WASM build + native | Signal-metric regression suite |
| `npm run test:scscm` | — | SCSCM lexer / parser / codegen unit tests (156 tests) |
| `npm run test:formats` | WASM build | Output format tests (WAV, AIFF, raw, bit depths) |
| `npm run test:net` | WASM build | UDP/TCP OSC network tests |
| `npm run test:unix` | WASM build | Unix socket bridge tests |
| `npm run test:hypercollider` | WASM build + native | Full 3-tier hyper-collider parity suite |
| `npm run test:hypercollider:smoke` | WASM build | Tiers 1 + 2 (no native scsynth needed) |
| `npm run test:hypercollider:codegen` | — | Tier 1 only — SCSCM codegen checks, no WASM build needed |
| `npm run test:sc-format` | — | SC formatter unit tests |

### Formatters

| Script | Description |
|--------|-------------|
| `npm run format:scscm` | Format all `.scscm` files under `examples/` in-place |
| `npm run format:scscm:check` | Check `.scscm` formatting without modifying files |
| `npm run format:sc` | Format `.sc` files in `SCClassLibrary/` and `HelpSource/` |
| `npm run format:sc:check` | Check `.sc` formatting without modifying files |

---

## Output formats

| Extension | Format | Notes |
|-----------|--------|-------|
| `.wav` | WAV (RIFF) | Default; compatible with all players |
| `.aiff` | AIFF | macOS-native |
| `.raw` | Raw PCM | Interleaved, no header |

Bit depth `32` always writes 32-bit IEEE 754 float samples. Depths `16` and `24` write integer PCM.

---

## Troubleshooting

**`Error: Cannot find module 'build/wasm/lang/sclang/hclang.js'`**  
Run `just build` (or `cmake --build build/wasm --target scsynth hclang`) to produce the WASM artifacts first.

**Silent output / `peak=0.000000`**  
The SynthDef may not have started. Add `--verbosity 1` to see sclang post output and check for errors.

**`node-speaker` build failure**  
Real-time audio (`hclang_repl`, `hcsynth --realtime-audio`) requires native build tools. On macOS: `xcode-select --install`. On Linux: `apt install libasound2-dev`. Offline rendering works without `node-speaker`.

**Script completes before audio renders**  
Increase `--duration` to match how long the SynthDefs run. Synths with `doneAction: 2` free themselves automatically.
