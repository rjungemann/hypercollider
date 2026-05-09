HyperCollider
=============

**HyperCollider** is a WebAssembly-first fork of SuperCollider for audio synthesis and algorithmic composition. Both `hclang` and `hcsynth` compile to WASM and run in the browser or via Node.js.

- **hcsynth** — real-time audio server with hundreds of UGens, running as a browser AudioWorklet
- **hclang** — interpreted programming language that controls hcsynth, running in a WASM module
- **Browser IDE** — a self-contained HTML5 editor at `src/platform/wasm/test/sc_ide.html`

Native desktop targets (scide, supernova, Bela, Raspberry Pi) have been removed.

Quickstart
----------

### Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (`emsdk`)
- CMake ≥ 3.18
- Python 3 (for Emscripten toolchain scripts)

### Build

**Quick setup (recommended):**
```bash
source ./hypercollider.rc        # Sets up PATH, Emscripten SDK, and aliases
just build                        # Build WASM modules (hclang + hcsynth)
```

**Manual setup:**
```bash
# Activate Emscripten
source /path/to/emsdk/emsdk_env.sh

# Configure
emcmake cmake -B build -DSC_WASM=ON -DAUDIOAPI=wasm -DCMAKE_BUILD_TYPE=Release .

# Build hcsynth and hclang WASM modules
cmake --build build --target hcsynth hclang -j$(nproc)
```

### Run the browser IDE

Open `src/platform/wasm/test/sc_ide.html` in a browser (serve it from a local HTTP server — e.g. `npx serve .`), or use the CLI tools in `cli/`.

### CLI sound generation

```bash
node cli/hclang.js           # interactive hclang REPL
node cli/hcsynth.js          # headless hcsynth
node cli/hclang_repl.js      # combined REPL
```

See `docs/CLI_REFERENCE.md` for full CLI documentation.

Standalone native binaries (WAMR)
---------------------------------

`hclang_native` and `hcsynth_native` are statically-linked single-file
binaries that embed the WASM engine via [WAMR](https://github.com/bytecodealliance/wasm-micro-runtime).
They run anywhere the OS does, with no Node.js, no `.js`/`.data`
sidecars, and no class-library install on the host — the SC class
library is baked into the binary.

Use them when you want:

- Deployment to embedded Linux, Raspberry Pi, CI runners, sandboxed
  environments, or anywhere a Node.js install is unwelcome.
- A faster cold-start path than `node cli/hclang.js`.
- A reproducible audio rendering pipeline without an SC install.

See `docs/HCLANG_NATIVE_REFERENCE.md` for the full design doc; open work is tracked in `docs/HCLANG_NATIVE_PLAN.md`.

### Prerequisites

| Tool | Required for | Install (macOS) | Install (Debian/Ubuntu) |
|---|---|---|---|
| `cmake` ≥ 3.18 | All builds | `brew install cmake` | `apt install cmake` |
| Emscripten SDK | WASI build (`build-wasi`) | [emsdk](https://emscripten.org/docs/getting_started/downloads.html) | `emsdk` upstream |
| `node` ≥ 18 | Bench helper, `cli/*.js` | `brew install node` | `apt install nodejs` |
| `just` | Recipe runner | `brew install just` | `cargo install just` |
| `sclang` / `scsynth` | Native bench rows only | `brew install supercollider` | `apt install supercollider` |
| `gtime` (GNU `time`) | RSS in bench output | `brew install gnu-time` | `apt install time` (already GNU) |
| `wamrc` + `llvm@17` | AOT-compiled bench (optional) | See **wamrc setup** below | See **wamrc setup** below |

Run `just _check-tools` to print presence/path or MISSING for each.

### wamrc setup (for AOT-compiled binaries)

To build ahead-of-time (AOT) compiled WAMR binaries, you need wamrc (the WAMR compiler).

**Automated setup (recommended):**
```bash
just setup-wamrc    # Installs LLVM 17, builds wamrc, sets up PATH automatically
```

That's it! The script handles:
- Installing LLVM 17 (via Homebrew on macOS, apt on Linux)
- Cloning WAMR and building wamrc
- Setting up symlinks and PATH
- Verifying the installation

After running `just setup-wamrc`, you can build AOT binaries:
```bash
just build-wamr-aot
```

**Note:** wamrc is built into the `build/` directory. If you run `just clean`, you'll need to run `just setup-wamrc` again. The error message will remind you.

**Manual setup (if needed):**
If you prefer to set up wamrc yourself, see `scripts/setup-wamrc.sh` for the steps, or check `docs/HCLANG_NATIVE_PLAN.md` for detailed information.

Once installed, `just build-aot` will compile WASM modules to native code using `wamrc` (currently at `--opt-level=0` due to upstream wamrc optimizer issues; see [HCLANG_NATIVE_PLAN.md Phase 12.3](docs/HCLANG_NATIVE_PLAN.md#phase-123--wamr-aot-perf-follow-ups--todo)).

### Quick start

```bash
# Build the JS pipeline + WASI .wasm + standalone hosts in one shot.
# This creates the build/ directories and produces hclang_native + hcsynth_native.
just build-all

# Smoke test the standalone binary (uses the embedded class library).
echo "10.do { |i| i.postln }" > /tmp/hello.sc
./build/native/hclang_host/hclang_native --script /tmp/hello.sc

# Two-process pipeline: hclang_native sends OSC to hcsynth_native.
./build/native/hcsynth_host/hcsynth_native \
    --udp-port 57110 --output /tmp/out.wav --duration 5 &
./build/native/hclang_host/hclang_native \
    --script bench/patches/wamr_full/sine.scd \
    --scsynth-host 127.0.0.1 --scsynth-port 57110

# Interactive REPL (multi-line input, history at ~/.hclang_history).
./build/native/hclang_host/hclang_native --repl
```

### CLI flags (most-used)

| Flag | Description |
|---|---|
| `--script <file>` | Evaluate a `.sc` / `.scd` file and exit |
| `--repl` | Interactive REPL (linenoise; multi-line, history) |
| `--classlib-dir <path>` | Override the embedded class library |
| `--scsynth-host <h>` | Forward outbound OSC to this host (paired with `--scsynth-port`) |
| `--scsynth-port <p>` | UDP port on `--scsynth-host` |
| `--udp-port <p>` | (`hcsynth_native`) Listen for OSC on this port |
| `--output <file>` | (`hcsynth_native`) Render audio to a WAV |
| `--duration <s>` | (`hcsynth_native`) Render length in seconds |
| `--wait-for-osc-ms <n>` | (`hcsynth_native`) Delay first block until OSC arrives |
| `-v 1` | Verbose: log classlib choice, module load path, etc. |

### Bench quickstart

```bash
# Full suite (native + wasm + wamr + wamr-full + wamr-aot if available).
just bench

# Just the wamr-full pipeline (hclang_native → hcsynth_native), 5+1 runs.
just bench-wamr-full

# AOT-compiled variant (requires wamrc on PATH).
just bench-wamr-aot

# Quick sanity (sine + poly cold/warm only, ~3 min).
just bench-quick

# Regression check against bench/baselines/wamr-full.json.
just bench-check

# What does this machine have?
bash bench/run_bench.sh --list-toolchains
```

### Limits and known gaps

- **AOT lang side**: `hclang.aot` loads but the SC parser hits a crash
  when compiling the class library with `--opt-level > 0` (SIGSEGV at 1,
  OOM at 2+). Synth side AOT works fine at all opt levels.
  Currently locked at `--opt-level=0` as a workaround. WAMR upgraded to 2.4.4
  to test for upstream fixes; see `docs/HCLANG_NATIVE_PLAN.md` §Phase 12.3
  for testing and bug-filing plan.
- **sc3-plugins on native**: `plugin_heavy` is auto-skipped on the `native`
  toolchain unless `SC3plugins/` is installed under your SuperCollider
  Extensions dir. The wasm/wamr/wamr-full/wamr-aot toolchains have
  sc3-plugins linked into `hcsynth.wasm` directly, so they always run.
- **Frequency offset**: rendered sine measures ~468 Hz instead of the
  requested 440 Hz; the pipeline is otherwise correct. Pending investigation.
- **macOS arm64 only in CI**: Linux x86_64 also builds in CI, but
  Linux arm64 needs a self-hosted runner.

### Troubleshooting

- **`emcc: command not found`** during `build-wasi` — activate the
  Emscripten SDK: `source /path/to/emsdk/emsdk_env.sh`.
- **Bench row says `output_bytes=0`** — the patch sent no OSC. Either
  the synthdef failed to load (check stderr from `hcsynth_native -v 1`),
  or the patch execution failed. Validation warnings in the benchmark output
  will indicate if a patch did not produce expected output markers.
- **`wamrc not found`** under `build-wamr-aot` — install LLVM 17 and
  build wamrc from source. See the "wamrc setup" section above for platform-specific
  instructions. Brew's default LLVM (22) is too new for wamrc 2.4.4.
- **`HC_REQUIRE_EMBEDDED_WASM=ON ... .wasm not found`** — run
  `just build-wasi` first, or use `just build-all` which orders
  the dependencies correctly.
- **Bench feels stuck on a cell** — each cell prints
  `runs (ms): 743w 540 ...` after completion. If a cell sits silent
  for >60 s, that's a real hang; capture stderr from the underlying
  binary (`-v 1`) and file an issue.
- **`row Y` shows `MISSING` in `bench-check`** — no matching results
  for that baseline cell; the bench probably skipped it (toolchain
  not detected). Re-run with `--toolchains <name>` and check
  `bench/run_bench.sh --list-toolchains`.

Documentation
-------------

- `docs/BUILD_SYSTEM.md` — **Start here if confused about JS/WASI/WAMR/AOT** — explains why there are 4 build targets, what wamrc is, and tradeoffs
- `docs/WASM_FEATURE_MATRIX.md` — supported features and known limitations
- `docs/WASM_POST_LAUNCH_ENHANCEMENTS.md` — planned improvements
- `docs/CLI_QUICKSTART.md` — getting started with the CLI tools
- `docs/HCLANG_NATIVE_REFERENCE.md` — WAMR-hosted standalone binaries (architecture & embedding API)
- `docs/HCLANG_NATIVE_PLAN.md` — WAMR native host: open work
- `docs/WAMR_PERF_PARITY_PLAN.md` — plan to close the cold-start gap vs the Node.js + V8 path
- `docs/WAMR_PERF_INVESTIGATION.md` — measured stage breakdown of the gap (read before working the parity plan)

Learn SuperCollider
-------------------

- [A Gentle Introduction to SuperCollider](https://ccrma.stanford.edu/~ruviaro/texts/A_Gentle_Introduction_To_SuperCollider.pdf)
- [Eli Fieldsteel's video tutorials](https://www.youtube.com/playlist?list=PLPYzvS8A_rTaNDweXe6PX4CXSGq4iEWYC)
- [SCCode.org](http://sccode.org/)

Community
---------

- Forum: [scsynth.org](https://scsynth.org/)
- Slack: [join](https://join.slack.com/t/scsynth/shared_invite/zt-ezoyz15j-SVM7JVul94pxtDiUDRnd0w)

License
-------

SuperCollider is free software available under Version 3 of the GNU General Public License. See [COPYING](COPYING) for details.
