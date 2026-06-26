# CLI Quickstart

Get SuperCollider audio rendering working in a terminal in under five minutes.

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A WASM build of SuperCollider (see [README.md](../README.md)):
  ```
  cmake --preset wasm_release
  just build
  ```

---

## Install CLI dependencies

```bash
cd src/platform/wasm/cli
npm install
```

---

## Render your first audio file

```bash
node src/platform/wasm/cli/hc.js \
  --script src/platform/wasm/cli/examples/sine_wave.scd \
  --output /tmp/sine.wav
```

Open `/tmp/sine.wav` in any audio player. You should hear a 440 Hz sine tone.

---

## Common patterns

### Render a script to WAV

```bash
node src/platform/wasm/cli/hc.js \
  --script my_piece.scd \
  --output my_piece.wav \
  --duration 10 \
  --sample-rate 48000
```

### Render with reverb and echo

```bash
node src/platform/wasm/cli/hc.js \
  --script src/platform/wasm/cli/examples/reverb_echo.scd \
  --output reverb.wav \
  --duration 6
```

### Render FM synthesis

```bash
node src/platform/wasm/cli/hc.js \
  --script src/platform/wasm/cli/examples/fm_synthesis.scd \
  --output fm.wav
```

### Render layered synths

```bash
node src/platform/wasm/cli/hc.js \
  --script src/platform/wasm/cli/examples/layered_synths.scd \
  --output layered.wav \
  --duration 8
```

### Higher quality output

```bash
node src/platform/wasm/cli/hc.js \
  --script my_piece.scd \
  --output hq.wav \
  --sample-rate 96000 \
  --bit-depth 32 \
  --duration 30
```

### 24-bit AIFF

```bash
node src/platform/wasm/cli/hc.js \
  --script my_piece.scd \
  --output my_piece.aiff \
  --bit-depth 24
```

---

## Interactive REPL

Start a live-coding session with real-time audio output (requires `node-speaker`):

```bash
node src/platform/wasm/cli/hclang_repl.js
```

Type SuperCollider code and press Enter to evaluate. Use `.quit` to exit.

---

## scscm dialect

The CLI also supports the [scscm](../cli/README_SCSCM.md) Scheme-like dialect — see the [scscm Quick Start](scscm/SCSCM_QUICK_START.md):

```bash
node cli/lhc.js \
  --input cli/examples/sine_wave.scscm \
  | node cli/hc.js --output /tmp/scscm.wav
```

For users without the repo, a single-file standalone build is published with each release (`lhc-standalone-vX.Y.Z` artifact). Run it with `node lhc.js`.

---

## Run the built-in examples

```bash
just scscm-example sine_wave
just scscm-example fm_synthesis
```

---

## Using HyperCollider with mise

If you manage tool versions with [mise](https://mise.jdx.dev) (or asdf),
the [`asdf-hypercollider`](https://github.com/rjungemann/asdf-hypercollider)
plugin installs prebuilt release tarballs — no Emscripten, no source
build:

```bash
mise plugin install hypercollider https://github.com/rjungemann/asdf-hypercollider.git
mise install hypercollider@latest
mise exec -- hclang --help
```

`hclang` and `hcsynth` resolve to the **WAMR-native** binaries —
self-contained, no Node runtime required. `hclang-wasm` / `hcsynth-wasm`
are kept as explicit aliases for users who want the Node-hosted variant
(and need Node on PATH).

```toml
# .mise.toml — native binaries need no extra runtime
[tools]
hypercollider = "latest"
# node = "20"  # only if you'll use the -wasm shims
```

The plugin and the Homebrew formula are independent — pick whichever
matches your toolchain. See [MISE_PLUGIN_PLAN.md](MISE_PLUGIN_PLAN.md)
for the asset contract.

## Next steps

- Full flag reference: [CLI_REFERENCE.md](CLI_REFERENCE.md)
- scscm dialect guide: [src/platform/wasm/cli/README_SCSCM.md](../src/platform/wasm/cli/README_SCSCM.md)
- CLI source: [src/platform/wasm/cli/](../src/platform/wasm/cli/)
