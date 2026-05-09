# SuperCollider WASM CLI

Headless Node.js wrappers for offline rendering and live network audio using `hclang` and `hcsynth` WASM artifacts.

## Prerequisites

- Build artifacts:
  - `build/wasm/lang/sclang/hclang.js`
  - `build/wasm/server/scsynth/scsynth.js`
- Node.js 18+
- For real-time audio (`hclang_repl, hcl_repl, hcsynth --realtime-audio`): the `speaker` npm package (`npm install` in this directory). On macOS you need Xcode command-line tools; on Linux, ALSA development headers (`libasound2-dev`).

---

## Offline Rendering

### hc — unified offline renderer

Compile an `.scd` script and render audio in one step:

```bash
node hc.js --script examples/sine_wave.scd --output out/sine.wav --duration 2
```

#### All options

| Option | Default | Purpose |
|--------|---------|---------|
| `--script <file>` | *(required)* | Input .scd file |
| `--output <file>` | *(required)* | Output audio file |
| `--duration <seconds>` | 2.0 | Render duration |
| `--sample-rate <hz>` | 48000 | Sample rate |
| `--block-size <samples>` | 512 | Render block size |
| `--channels <n>` | 2 | Output channels |
| `--bit-depth <n>` | 16 | Bit depth: 16, 24, or 32 (float) |
| `--output-format <fmt>` | *(from extension)* | `wav`, `aiff`, or `raw` |
| `--call-stop` | false | Evaluate `Main.stop` after script |
| `--verbosity <level>` | 0 | -2 (silent) to 2 (debug) |
| `--sclang-js <path>` | build/wasm/… | Path to hclang.js |
| `--scsynth-js <path>` | build/wasm/… | Path to scsynth.js |
| `--verbose` | false | Print sclang post output |
| `-h, --help` | | Show help |
| `-v, --version` | | Show version |

#### Output format examples

```bash
# AIFF 24-bit (format inferred from .aiff extension)
node hc.js --script sine.scd --output out/sine.aiff --bit-depth 24

# WAV 32-bit float
node hc.js --script fm.scd --output out/fm.wav --bit-depth 32

# Raw PCM (headerless, 16-bit little-endian)
node hc.js --script sweep.scd --output out/sweep.raw --output-format raw
```

---

## Network Routing (Live Mode)

Route OSC directly from sclang to a running scsynth instance over UDP, instead of offline rendering:

```bash
# Start scsynth server first (WASM or native)
node hcsynth.js --server --udp-port 57110

# In another terminal, route a script to it
node hc.js --script examples/sine_wave.scd --scsynth-host 127.0.0.1 --scsynth-port 57110
```

#### Routing options (hc / hclang)

| Option | Purpose |
|--------|---------|
| `--scsynth-host <addr>` | External scsynth host |
| `--scsynth-port <port>` | External scsynth UDP port |
| `--lang-udp-port <port>` | Local port for scsynth → sclang replies |

---

## hcsynth — server mode

Run the WASM scsynth as a persistent OSC server:

```bash
# UDP only
node hcsynth.js --server --udp-port 57110

# UDP + TCP simultaneously
node hcsynth.js --server -u 57110 -t 57120 -B 0.0.0.0

# TCP with login limit and password
node hcsynth.js --server --tcp-port 57120 --max-logins 8 --tcp-password secret

# Server with real-time speaker output
node hcsynth.js --server --udp-port 57110 --realtime-audio
```

#### Server mode options

| Option | Short | Default | Purpose |
|--------|-------|---------|---------|
| `--server` | | false | Enable server mode |
| `--udp-port <port>` | `-u` | 57110 | UDP listen port |
| `--tcp-port <port>` | `-t` | (off) | TCP listen port |
| `--bind-address <addr>` | `-B` | 127.0.0.1 | Bind address |
| `--max-logins <n>` | `-l` | 64 | Max TCP connections |
| `--tcp-password <pass>` | `-p` | (none) | TCP session password |
| `--realtime-audio` | | false | Stream audio to speakers |

---

## Interactive REPLs

### hclang_repl — HyperCollider interactive REPL

```bash
# In-process mode (sclang + scsynth in this process, real-time audio)
node hclang_repl.js

# Live network mode (sclang here, scsynth elsewhere)
node hclang_repl.js --scsynth-host 127.0.0.1 --scsynth-port 57110
node hclang_repl.js --scsynth-host 127.0.0.1 --scsynth-port 57120 --protocol tcp
```

#### REPL commands

| Command | Purpose |
|---------|---------|
| `.quit` / `.exit` | Exit |
| `.help` | Show help |
| `.version` | Print version |
| `.info` | Show runtime info (mode, sample rate, etc.) |
| `.load <file.scd>` | Load and evaluate a .scd file |
| `.bench [n]` | Re-run last expression n times (default 100), report timing |
| `.record [seconds]` | Capture audio to `/tmp/hc_record_<ts>.wav` |
| `.stop-record` | Stop capture and save WAV |

### lhc_repl — HyperCollider Lisp REPL

Same options and commands as `hclang_repl`, plus:

| Command | Purpose |
|---------|---------|
| `.load <file.scscm>` | Load scscm file |
| `.load-sc <file.scd>` | Load raw SC file |

---

## Split Pipeline (advanced)

For debugging or caching, run sclang and scsynth as separate steps:

```bash
# Step 1: compile script → OSC packet JSON
node hclang.js --script examples/sine_wave.scd --output out/cmds.json

# Step 2: render OSC packets → audio
node hcsynth.js --commands out/cmds.json --output out/sine.wav --duration 2
```

hclang additional options:

| Option | Purpose |
|--------|---------|
| `--call-stop` | Evaluate `Main.stop` after script |
| `--scsynth-host`, `--scsynth-port` | Live routing instead of writing JSON |
| `--lang-udp-port` | Local UDP port for scsynth replies |

---

## WASM Hardcoded Limits

These values are baked into the WASM build and cannot be changed at runtime (unlike native scsynth where `-n`, `-d`, etc. can be passed):

| Parameter | WASM Default | Native flag |
|-----------|-------------|-------------|
| Max nodes | 1024 | `-n` |
| Max SynthDefs | 1024 | `-d` |
| Sample buffers | 1024 | `-b` |
| Audio bus channels | 128 | `-a` |
| Control bus channels | 16384 | `-c` |
| Wire buffers | 64 | `-w` |
| Random seeds | 64 | `-r` |
| RT memory pool | 8 MB | `-m` |

If your synthesis hits a node limit, you'll see scsynth error messages in the verbose output. Increasing these requires rebuilding with modified CMake parameters.

---

## Tests

```bash
# Offline render + parity tests
node test_cli.js
node test_cli_parity.js  # Optional: requires native scsynth in PATH

# A/B audio regression suite
npm run test:audio-regression
NATIVE_HCSYNTH=/path/to/scsynth npm run test:audio-regression

# Networking integration tests (requires WASM build)
npm run test:net

# scscm compiler tests
npm run test:scscm
```

Useful env vars for the regression suite:
- `NATIVE_HCSYNTH=/path/to/scsynth` — override native scsynth path
- `SKIP_NATIVE=1` — run WASM-only checks
- `AUDIO_DIFF_KEEP_ARTIFACTS=1` — keep temp artifacts
- `AUDIO_DIFF_SOX=1` — generate SoX spectrograms

---

## Features & Limitations

### Supported

- Full SuperCollider class library (sclang)
- SynthDef definition and parameterized instantiation
- Offline rendering: WAV (16/24/32-bit), AIFF (16/24/32-bit), raw PCM
- Server mode: UDP and TCP OSC with native framing protocol
- Live routing: sclang → external scsynth over UDP/TCP
- Real-time audio output via `node-speaker` (hclang_repl, hcl_repl, hcsynth --server)
- sc3-plugins Tier 1 (15 plugins)

### Known Limitations

- **No File I/O**: `DiskOut` and file-based operations are not available in WASM
- **Single-threaded**: sclang and scsynth run on one JS thread
- **No FLAC**: No native FLAC encoder; only WAV/AIFF/raw are supported
- **No GUI**: Terminal-only
- **WASM limits**: Node/SynthDef/buffer counts are fixed at build time (see table above)

---

## Architecture

```
Offline rendering:
  .scd script
    → hclang (OSC packet capture)
    → hcsynth (offline render)
    → .wav / .aiff / .raw

Live network routing:
  .scd script
    → hclang (OSC packet capture)
    → node:dgram UDP / node:net TCP
    → external scsynth (WASM server or native)

Server mode:
  External OSC client (DAW, native sclang, TouchOSC, …)
    → node:dgram / node:net (JS socket layer)
    → hcsynth (_hc_wasm_osc_dispatch)
    → hcsynth (_hc_wasm_render)
    → node-speaker (real-time) or offline WAV
```
