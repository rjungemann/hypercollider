# HyperCollider – common development tasks
# Usage: just <recipe>
# Requires: just (https://github.com/casey/just), cmake, node, python3, npx

BUILD_DIR      := "build/wasm"
TESTSUITE_DIR  := "tests"
PLATFORM_DIR   := "src/platform/test"
DEPLOY_DIR     := "build/deploy"
SERVER         := "build/wasm/server/hcsynth"
SCLANG_DIR     := "build/wasm/lang/hclang"
# SCSYNDEF: optional precompiled SynthDef used by some smoke tests. Not
# present in current source tree; copy made conditional in stage-test.
SCSYNDEF       := "src/platform/test/help_out.scsyndef"
DEPLOY_PROJECT := "hc-wasm-ide"
SERVE_PORT     := "8000"
CLI_DIR        := "cli"

# ── Build ─────────────────────────────────────────────────────────────────────

# Configure the WASM build (run once, or after CMakeLists changes)
configure:
    cmake --preset wasm_release

# Configure with STK rawwave preloading enabled
configure-stk:
    cmake --preset wasm_release -DSC_WASM_STK_PRELOAD_RAWWAVES=ON

JOBS := `sysctl -n hw.logicalcpu 2>/dev/null || nproc`

# Emscripten sub-process parallelism (Binaryen, wasm-opt thread pool)
export EMCC_CORES := `sysctl -n hw.logicalcpu 2>/dev/null || nproc`

# Build hcsynth (audio engine)
build-hcsynth:
    @if [ ! -f {{BUILD_DIR}}/CMakeCache.txt ] || [ ! -f {{BUILD_DIR}}/Makefile ] || \
       ! grep -q '^hcsynth:' {{BUILD_DIR}}/Makefile 2>/dev/null; then cmake --preset wasm_release; fi
    cmake --build {{BUILD_DIR}} --target hcsynth -j{{JOBS}}

# Build hclang (language interpreter)
build-hclang:
    cmake --build {{BUILD_DIR}} --target hclang -j{{JOBS}}

# Build hcsynth and hclang in parallel (~2× throughput on 8+ cores).
# Configure first (serial) so both cmake invocations enter an already-configured tree.
build:
    @if [ ! -f {{BUILD_DIR}}/CMakeCache.txt ] || [ ! -f {{BUILD_DIR}}/Makefile ] || \
       ! grep -q '^hcsynth:' {{BUILD_DIR}}/Makefile 2>/dev/null; then cmake --preset wasm_release; fi
    cmake --build {{BUILD_DIR}} --target hcsynth -j{{JOBS}} & \
    cmake --build {{BUILD_DIR}} --target hclang  -j{{JOBS}} & \
    wait

# Bundle CLI scripts + WASM artifacts into build/wasm/cli/
build-cli:
    cmake --build {{BUILD_DIR}} --target cli -j{{JOBS}}

# ── WASI / WAMR-hosted standalone binaries ────────────────────────────────────
# Builds the WASI-target .wasm files plus hclang_native / hcsynth_native — the
# self-contained WAMR-hosted binaries documented in the README's "Standalone
# native binaries (WAMR)" section. Full design + status:
#   docs/HCLANG_NATIVE_PLAN.md

# Automated wamrc setup. Installs LLVM 17, builds wamrc from WAMR source,
# and sets up PATH. Run this once before using build-wamr-aot.
setup-wamrc:
    bash scripts/setup-wamrc.sh

WASI_BUILD_DIR := "build/wasi"
NATIVE_BUILD_DIR := "build/native"

# Print the locations of build prerequisites (or MISSING). Use this when a
# subsequent build fails with a confusing mid-flight error to confirm the
# environment is set up. Doesn't fail the recipe — informational only.
_check-tools:
    @printf "  cmake : "; command -v cmake  || echo MISSING
    @printf "  ninja : "; command -v ninja  || echo "MISSING (optional, used by some build-* recipes)"
    @printf "  node  : "; command -v node   || echo MISSING
    @printf "  emcc  : "; command -v emcc   || echo "MISSING — install emsdk and 'source ./emsdk_env.sh'"
    @printf "  just  : "; command -v just   || echo MISSING
    @printf "  wamrc : "; command -v wamrc  || echo "MISSING (only needed for build-wamr-aot; run 'just setup-wamrc')"
    @printf "  sclang: "; command -v sclang || echo "MISSING (only needed for native bench rows)"
    @printf "  gtime : "; command -v gtime  || echo "MISSING (only needed for RSS in bench output; brew install gnu-time)"

# Build the WASI variant of hclang.wasm + hcsynth.wasm (loadable by WAMR).
# Re-uses the existing CMake build dir on incremental runs; configures from
# scratch only when CMakeCache.txt is missing. Run `just _check-tools` first
# if a build fails mid-flight with a "command not found" or similar.
build-wasi:
    @if [ ! -f {{WASI_BUILD_DIR}}/CMakeCache.txt ]; then cmake --preset wasi_release; fi
    cmake --build {{WASI_BUILD_DIR}} --target hclang hcsynth -j{{JOBS}}

# Build hclang_native + hcsynth_native (WAMR-hosted standalone binaries).
# Depends on build-wasi so the .wasm + classlib pack are available to embed.
# HC_REQUIRE_EMBEDDED_WASM=ON makes a missing .wasm a fatal error rather
# than silently shipping a non-self-contained binary.
build-wamr-host: build-wasi
    @if [ ! -f {{NATIVE_BUILD_DIR}}/CMakeCache.txt ]; then \
        cmake -B {{NATIVE_BUILD_DIR}} -S native \
            -DCMAKE_BUILD_TYPE=Release \
            -DHC_EMBED_WASM=ON \
            -DHC_REQUIRE_EMBEDDED_WASM=ON; \
    fi
    cmake --build {{NATIVE_BUILD_DIR}} --target hclang_native hcsynth_native -j{{JOBS}}

# Build the AOT-compiled .aot files for hclang + hcsynth. Requires wamrc on
# PATH (see README.md wamrc setup section for install instructions).
build-wamr-aot: build-wasi
    @WAMRC=$(command -v wamrc || echo ""); \
    if [ -z "$WAMRC" ]; then \
        if [ -L "$$HOME/.local/bin/wamrc" ] && [ ! -f "$$HOME/.local/bin/wamrc" ]; then \
            echo "ERROR: wamrc symlink is broken (build/ directory was cleaned)." >&2; \
            echo "" >&2; \
            echo "To rebuild wamrc:" >&2; \
            echo "  just setup-wamrc" >&2; \
            echo "" >&2; \
        else \
            echo "ERROR: wamrc not found in PATH." >&2; \
            echo "" >&2; \
            echo "To set up wamrc:" >&2; \
            echo "  just setup-wamrc" >&2; \
            echo "" >&2; \
            echo "This script will install LLVM 17, build wamrc, and set up your PATH." >&2; \
        fi; \
        exit 1; \
    fi; \
    if [ ! -f {{NATIVE_BUILD_DIR}}/CMakeCache.txt ] || \
       ! grep -q '^HC_WASM_AOT:BOOL=ON' {{NATIVE_BUILD_DIR}}/CMakeCache.txt; then \
        cmake -B {{NATIVE_BUILD_DIR}} -S native \
            -DCMAKE_BUILD_TYPE=Release \
            -DHC_EMBED_WASM=ON \
            -DHC_REQUIRE_EMBEDDED_WASM=ON \
            -DHC_WASM_AOT=ON \
            -DWAMRC_EXECUTABLE=$WAMRC; \
    fi
    cmake --build {{NATIVE_BUILD_DIR}} --target hclang_aot hcsynth_aot -j{{JOBS}}

# Umbrella recipe: builds the JS pipeline + the WAMR-hosted standalone
# binaries. `just build` itself stays JS-only for backwards compatibility
# with existing scripts; reach for `build-all` when you want everything
# the bench suite can measure.
build-all: build build-wamr-host

# Debug build
configure-debug:
    cmake --preset wasm_debug

build-debug:
    cmake --build build/wasm_debug --target hcsynth -j{{JOBS}}

# Ninja builds (faster incremental rebuilds — run configure-ninja first)
configure-ninja:
    cmake --preset wasm_release_ninja

build-ninja-hcsynth:
    @if [ ! -f build/wasm_ninja/build.ninja ]; then cmake --preset wasm_release_ninja; fi
    cmake --build build/wasm_ninja --target hcsynth -j{{JOBS}}

build-ninja-hclang:
    cmake --build build/wasm_ninja --target hclang -j{{JOBS}}

build-ninja:
    @if [ ! -f build/wasm_ninja/build.ninja ]; then cmake --preset wasm_release_ninja; fi
    cmake --build build/wasm_ninja --target hcsynth -j{{JOBS}} & \
    cmake --build build/wasm_ninja --target hclang  -j{{JOBS}} & \
    wait

# Dev builds (Ninja + -O2 instead of -O3 for 2-3× faster link during iteration)
configure-dev:
    cmake --preset wasm_dev

build-dev-hcsynth:
    @if [ ! -f build/wasm_dev/build.ninja ]; then cmake --preset wasm_dev; fi
    cmake --build build/wasm_dev --target hcsynth -j{{JOBS}}

build-dev-hclang:
    cmake --build build/wasm_dev --target hclang -j{{JOBS}}

build-dev:
    @if [ ! -f build/wasm_dev/build.ninja ]; then cmake --preset wasm_dev; fi
    cmake --build build/wasm_dev --target hcsynth -j{{JOBS}} & \
    cmake --build build/wasm_dev --target hclang  -j{{JOBS}} & \
    wait

# ── Artifact staging ──────────────────────────────────────────────────────────

# Copy build artifacts into the test harness directory
stage-test:
    cp {{SERVER}}/hcsynth.js   {{TESTSUITE_DIR}}/hcsynth-engine.js
    cp {{SERVER}}/hcsynth.wasm {{TESTSUITE_DIR}}/
    @if [ -f {{SERVER}}/hcsynth.data ]; then cp {{SERVER}}/hcsynth.data {{TESTSUITE_DIR}}/; fi
    @if [ -f {{SCSYNDEF}} ]; then cp {{SCSYNDEF}} {{TESTSUITE_DIR}}/; fi

# Copy build artifacts into the deploy directory
stage-deploy:
    mkdir -p {{DEPLOY_DIR}}
    mkdir -p {{DEPLOY_DIR}}/debug
    mkdir -p {{DEPLOY_DIR}}/tools
    cd {{PLATFORM_DIR}} && npm run vendor:codemirror
    cp {{SERVER}}/hcsynth.js   {{DEPLOY_DIR}}/hcsynth-engine.js
    cp {{SERVER}}/hcsynth.wasm {{DEPLOY_DIR}}/
    @if [ -f {{SERVER}}/hcsynth.data ]; then cp {{SERVER}}/hcsynth.data {{DEPLOY_DIR}}/; fi
    cp {{SCLANG_DIR}}/hclang.js   {{DEPLOY_DIR}}/
    cp {{SCLANG_DIR}}/hclang.wasm {{DEPLOY_DIR}}/
    @if [ -f {{SCLANG_DIR}}/hclang.data ]; then cp {{SCLANG_DIR}}/hclang.data {{DEPLOY_DIR}}/; fi
    cp {{TESTSUITE_DIR}}/index.html              {{DEPLOY_DIR}}/debug/index.html
    cp {{TESTSUITE_DIR}}/realtime-demo.html      {{DEPLOY_DIR}}/
    cp {{TESTSUITE_DIR}}/hcsynth.js              {{DEPLOY_DIR}}/
    cp {{TESTSUITE_DIR}}/hcsynth-realtime.js     {{DEPLOY_DIR}}/
    cp {{TESTSUITE_DIR}}/HCSynthAudioWorklet.js  {{DEPLOY_DIR}}/
    cp {{PLATFORM_DIR}}/sc_ide.html              {{DEPLOY_DIR}}/
    cp {{PLATFORM_DIR}}/sc_ide.html              {{DEPLOY_DIR}}/index.html
    cp {{PLATFORM_DIR}}/codemirror-vendor.mjs    {{DEPLOY_DIR}}/
    cp {{PLATFORM_DIR}}/tools/MemoryMonitor.js   {{DEPLOY_DIR}}/tools/
    @echo "Staged artifacts → {{DEPLOY_DIR}}/"

# Write the Cloudflare Pages _headers file (required for SharedArrayBuffer / AudioWorklet)
write-headers:
    @printf '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n' > {{DEPLOY_DIR}}/_headers
    @echo "Wrote {{DEPLOY_DIR}}/_headers"

# Write Cloudflare Pages redirects
write-redirects:
    @printf '/platform/wasm/test/sc_ide.html /\n/platform/wasm/test/index.html /debug/\n/platform/wasm/test/realtime-demo.html /realtime-demo.html\n/platform/wasm/test/debug /debug/\n/platform/wasm/test/debug/* /debug/:splat\n/platform/wasm/test/tools/* /tools/:splat\n/platform/wasm/test/* /:splat\n' > {{DEPLOY_DIR}}/_redirects
    @echo "Wrote {{DEPLOY_DIR}}/_redirects"

# ── Node.js tests ─────────────────────────────────────────────────────────────

# Run the Node.js offline smoke test (no synthdef – just world init)
test-node:
    node {{PLATFORM_DIR}}/sc_wasm_test.js {{SERVER}}/hcsynth.js

# Run the Node.js smoke test with a synthdef
test-node-synthdef:
    node {{PLATFORM_DIR}}/sc_wasm_test.js {{SERVER}}/hcsynth.js {{SCSYNDEF}}

# Run the legacy testsuite smoke test
test-smoke:
    node {{TESTSUITE_DIR}}/smoke_test.js

# Install npm dependencies for IDE smoke tests
test-ide-setup:
    cd {{PLATFORM_DIR}} && npm install
    cd {{PLATFORM_DIR}} && npx puppeteer browsers install chrome

# Run browser IDE smoke tests with Puppeteer (all phases)
test-ide: test-ide-setup
    cd {{PLATFORM_DIR}} && node run_smoke_tests.js

# Run browser IDE smoke tests for a specific phase (1-7)
test-ide-phase phase: test-ide-setup
    cd {{PLATFORM_DIR}} && node run_smoke_tests.js {{phase}}

# Run browser IDE smoke tests for Phase 6 (Help, SC Tweets, Material Icons)
test-ide-phase6: test-ide-setup
    cd {{PLATFORM_DIR}} && node run_smoke_tests.js 6

# ── Browser dev server ────────────────────────────────────────────────────────

# Serve the test harness locally (requires staged artifacts)
serve: stage-test
    @echo "Serving on http://localhost:{{SERVE_PORT}}"
    @echo "  index:    http://localhost:{{SERVE_PORT}}/index.html"
    @echo "  demo:     http://localhost:{{SERVE_PORT}}/realtime-demo.html"
    @echo "  ide:      http://localhost:{{SERVE_PORT}}/sc_ide.html (from deploy preview)"
    cd {{TESTSUITE_DIR}} && python3 -m http.server {{SERVE_PORT}}

# Serve the deploy directory locally (preview before deploying)
serve-deploy: stage-deploy write-headers
    @echo "Serving deploy preview on http://localhost:{{SERVE_PORT}}"
    @echo "  index:    http://localhost:{{SERVE_PORT}}/index.html"
    @echo "  demo:     http://localhost:{{SERVE_PORT}}/realtime-demo.html"
    @echo "  ide:      http://localhost:{{SERVE_PORT}}/sc_ide.html"
    cd {{DEPLOY_DIR}} && python3 -m http.server {{SERVE_PORT}}

# Serve the IDE locally (no staging required)
serve-ide:
    @echo "Serving browser IDE on http://localhost:{{SERVE_PORT}}"
    @echo "  Open: http://localhost:{{SERVE_PORT}} (or /sc_ide.html)"
    # Create symlinks for WASM files if they don't exist
    @if [ ! -e {{PLATFORM_DIR}}/hcsynth-engine.js ]; then ln -sf ../../../../build/wasm/server/hcsynth/hcsynth.js {{PLATFORM_DIR}}/hcsynth-engine.js; fi
    @if [ ! -e {{PLATFORM_DIR}}/hcsynth.js ]; then ln -sf ../../../../tests/hcsynth.js {{PLATFORM_DIR}}/hcsynth.js; fi
    @if [ ! -e {{PLATFORM_DIR}}/hcsynth-realtime.js ]; then ln -sf ../../../../tests/hcsynth-realtime.js {{PLATFORM_DIR}}/hcsynth-realtime.js; fi
    @if [ ! -e {{PLATFORM_DIR}}/HCSynthAudioWorklet.js ]; then ln -sf ../../../../tests/HCSynthAudioWorklet.js {{PLATFORM_DIR}}/HCSynthAudioWorklet.js; fi
    @if [ ! -e {{PLATFORM_DIR}}/hcsynth.wasm ]; then ln -sf ../../../../build/wasm/server/hcsynth/hcsynth.wasm {{PLATFORM_DIR}}/hcsynth.wasm; fi
    @if [ ! -e {{PLATFORM_DIR}}/hcsynth.data ] && [ -e build/wasm/server/hcsynth/hcsynth.data ]; then ln -sf ../../../../build/wasm/server/hcsynth/hcsynth.data {{PLATFORM_DIR}}/hcsynth.data; fi
    @if [ ! -e {{PLATFORM_DIR}}/hclang.js ]; then ln -sf ../../../../build/wasm/lang/hclang/hclang.js {{PLATFORM_DIR}}/hclang.js; fi
    @if [ ! -e {{PLATFORM_DIR}}/hclang.wasm ]; then ln -sf ../../../../build/wasm/lang/hclang/hclang.wasm {{PLATFORM_DIR}}/hclang.wasm; fi
    @if [ ! -e {{PLATFORM_DIR}}/hclang.data ] && [ -e build/wasm/lang/hclang/hclang.data ]; then ln -sf ../../../../build/wasm/lang/hclang/hclang.data {{PLATFORM_DIR}}/hclang.data; fi
    cd {{PLATFORM_DIR}} && python3 -m http.server {{SERVE_PORT}}

# ── scscm (Scheme-like SuperCollider) ─────────────────────────────────────────

# Install scscm dependencies (npm in cli/)
scscm-setup:
    cd {{CLI_DIR}} && npm install

# Run scscm tests
scscm-test: scscm-setup
    node {{CLI_DIR}}/tests/test_lhc.js

# Format all .scscm source files
scscm-format: scscm-setup
    node {{CLI_DIR}}/lhc_format.js {{CLI_DIR}}/examples/
    @echo "✓ scscm files formatted"

# Check .scscm formatting (exits non-zero if any file would change)
scscm-format-check: scscm-setup
    node {{CLI_DIR}}/lhc_format.js --check {{CLI_DIR}}/examples/

# Run sclang formatter unit + round-trip tests
sc-format-test:
    node {{CLI_DIR}}/tests/test_sc_format.js

# ── sclang formatter ──────────────────────────────────────────────────────────

# Format all sclang source files (.sc / .scd / .schelp)
sc-format:
    node {{CLI_DIR}}/sc_format.js src/SCClassLibrary/ src/HelpSource/ src/examples/
    @echo "✓ sclang files formatted"

# Check sclang formatting (exits non-zero if any file would change)
sc-format-check:
    node {{CLI_DIR}}/sc_format.js --check src/SCClassLibrary/ src/HelpSource/

# Format a single sclang file (usage: just sc-format-file path/to/file.sc)
sc-format-file file:
    node {{CLI_DIR}}/sc_format.js {{file}}

# ─────────────────────────────────────────────────────────────────────────────

# Compile a .scscm file to .sc (usage: just scscm-compile path/to/file.scscm)
scscm-compile file: scscm-setup
    node {{CLI_DIR}}/lhc.js --input {{file}} --output {{file}}.sc
    @echo "✓ Compiled {{file}} → {{file}}.sc"

# Compile and view generated sclang code (usage: just scscm-view path/to/file.scscm)
scscm-view file: scscm-setup
    node {{CLI_DIR}}/lhc.js --input {{file}} --verbose

# Compile a scscm file and generate audio (usage: just scscm-render path/to/file.scscm output.wav)
scscm-render input output: scscm-setup build
    node {{CLI_DIR}}/lhc.js --input {{input}} | node {{CLI_DIR}}/hc.js --output {{output}}
    @echo "✓ Rendered {{input}} → {{output}}"

# Compile an example scscm file and generate audio (usage: just scscm-example sine_wave)
scscm-example name: scscm-setup build
    node {{CLI_DIR}}/lhc.js --input {{CLI_DIR}}/examples/{{name}}.scscm --verbose | node {{CLI_DIR}}/hc.js --output /tmp/{{name}}.wav

# Install Vim syntax files for .scscm into ~/.vim
install-vim:
    @mkdir -p ~/.vim/syntax ~/.vim/ftdetect ~/.vim/ftplugin
    cp vim/syntax/scscm.vim   ~/.vim/syntax/scscm.vim
    cp vim/ftdetect/scscm.vim ~/.vim/ftdetect/scscm.vim
    cp vim/ftplugin/scscm.vim ~/.vim/ftplugin/scscm.vim
    @echo "✓ Vim syntax files installed to ~/.vim"

# List available scscm examples
scscm-examples:
    @echo "Available scscm examples:"
    @ls -1 {{CLI_DIR}}/examples/*.scscm | sed 's|cli/examples/||g' | sed 's|\.scscm||g' | sed 's|^|  • |'

# ── CLI (offline rendering & REPL) ────────────────────────────────────────────

# Install CLI dependencies (npm in cli/)
cli-setup:
    cd {{CLI_DIR}} && npm install

# Run all CLI tests (offline render, parity, scscm)
cli-test: cli-setup build
    node {{CLI_DIR}}/tests/test_hc.js
    node {{CLI_DIR}}/tests/test_hc_parity.js
    node {{CLI_DIR}}/tests/test_lhc.js

# Render sines via the native WAMR binaries and FFT-check that the rendered
# spectrum is centred on the requested frequency. Catches block-rate corruption
# in hc_wasm_render (see engine/HC_Wasm_Api.cpp).
test-audio-frequency: build-wamr-host
    node {{CLI_DIR}}/tests/test_audio_frequency.js

# Run WASM CLI networking integration tests (UDP server, TCP server, UDP routing, realtime audio)
test-wasm-net: cli-setup build
    node {{CLI_DIR}}/tests/test_hcsynth_udp.js
    node {{CLI_DIR}}/tests/test_hcsynth_tcp.js
    node {{CLI_DIR}}/tests/test_hc_udp_route.js
    node {{CLI_DIR}}/tests/test_hcsynth_realtime_audio.js

# Run NRT parity tests against native hcsynth (documents known WASM vs native gaps)
cli-test-parity: cli-setup build
    node {{CLI_DIR}}/tests/test_hc_parity.js

# Run output format and bit-depth combination tests (WAV/AIFF/raw × 16/24/32)
cli-test-formats: cli-setup build
    node {{CLI_DIR}}/tests/test_hc_formats.js

# Print version info for all CLI tools
cli-version: cli-setup
    @echo "hc:          $(node {{CLI_DIR}}/hc.js --version 2>&1)"
    @echo "hclang:      $(node {{CLI_DIR}}/hclang.js --version 2>&1)"
    @echo "hcsynth:     $(node {{CLI_DIR}}/hcsynth.js --version 2>&1)"
    @echo "lhc:         $(node {{CLI_DIR}}/lhc_repl.js --version 2>&1)"

# Run A/B audio regression tests (usage: just cli-test-audio-regression [native_hcsynth_path])
cli-test-audio-regression native_hcsynth='': cli-setup build
    cd {{CLI_DIR}} && if [ -n "{{native_hcsynth}}" ]; then NATIVE_HCSYNTH="{{native_hcsynth}}" npm run test:audio-regression; else npm run test:audio-regression; fi

# Offline render a .scd file to WAV (usage: just sc-cli script.scd output.wav)
sc-cli input output: cli-setup build
    node {{CLI_DIR}}/hc.js --script {{input}} --output {{output}} --duration 5
    @echo "✓ Rendered {{input}} → {{output}}"

# Start interactive SuperCollider REPL with real-time audio output
sc-repl: cli-setup build
    @echo "Starting HyperCollider REPL (Press Ctrl+C to exit)"
    node {{CLI_DIR}}/hclang_repl.js

# Start interactive scscm REPL with real-time audio output
scscm-repl: cli-setup build
    @echo "Starting scscm REPL (Press Ctrl+C to exit)"
    node {{CLI_DIR}}/lhc_repl.js

# Start interactive scscm REPL in WASM-only mode
scscm-repl-wasm: cli-setup build
    @echo "Starting scscm REPL (WASM mode, Press Ctrl+C to exit)"
    node {{CLI_DIR}}/lhc_repl.js --wasm-sclang

# Start interactive scscm REPL in native sclang mode
scscm-repl-native: cli-setup
    @echo "Starting scscm REPL (native sclang mode, Press Ctrl+C to exit)"
    node {{CLI_DIR}}/lhc_repl.js --native-sclang

# Start interactive scscm REPL with --show-compiled to see generated SC code
scscm-repl-debug: cli-setup build
    @echo "Starting scscm REPL with compiled SC output (Press Ctrl+C to exit)"
    node {{CLI_DIR}}/lhc_repl.js --show-compiled

# ── Deployment ────────────────────────────────────────────────────────────────

# Build, stage, and deploy to Cloudflare Pages
deploy: build stage-deploy write-headers write-redirects
    npx wrangler pages deploy {{DEPLOY_DIR}} --project-name {{DEPLOY_PROJECT}}

# Deploy without rebuilding (uses existing artifacts)
deploy-only: stage-deploy write-headers write-redirects
    npx wrangler pages deploy {{DEPLOY_DIR}} --project-name {{DEPLOY_PROJECT}}

# ── Single-file distribution (Option C: base64 self-extracting JS) ───────────
# Each output is a standalone .js script with WASM + data assets embedded as
# base64.  Requires only Node.js at runtime — no adjacent files needed.

DIST_DIR := "dist"

# Bundle both hclang and hcsynth standalone scripts
bundle: cli-setup
    node {{CLI_DIR}}/hc_bundle.js --out-dir {{DIST_DIR}}
    @echo "Standalone scripts written to {{DIST_DIR}}/"

# Bundle hclang standalone script only
bundle-hclang: cli-setup
    node {{CLI_DIR}}/hc_bundle.js --hclang --out-dir {{DIST_DIR}}

# Bundle hcsynth standalone script only
bundle-hcsynth: cli-setup
    node {{CLI_DIR}}/hc_bundle.js --hcsynth --out-dir {{DIST_DIR}}

# Bundle the scscm compiler (lhc.js) as a single self-contained Node.js
# script. Output: dist/lhc.js — runs with `node lhc.js [args...]` and has
# no external dependencies beyond Node.js itself.
bundle-lhc:
    node {{CLI_DIR}}/lhc_bundle.js --out-dir {{DIST_DIR}}
    @echo "Standalone scscm compiler written to {{DIST_DIR}}/lhc.js"

# Smoke-test the bundled lhc: --version + compile a sample
bundle-test-lhc: bundle-lhc
    node {{DIST_DIR}}/lhc.js --version
    node {{DIST_DIR}}/lhc.js -i {{CLI_DIR}}/examples/quick_start_1.scscm > /tmp/lhc_bundle_smoke.sc
    @echo "✓ lhc bundle smoke test passed (compiled to /tmp/lhc_bundle_smoke.sc)"

# Smoke-test the bundled hclang: evaluate a trivial expression
bundle-test-hclang: bundle-hclang
    node {{DIST_DIR}}/hclang_standalone.js --version
    @echo "✓ hclang_standalone smoke test passed"

# Smoke-test the bundled hcsynth: run a short offline render
bundle-test-hcsynth: bundle-hcsynth
    node {{DIST_DIR}}/hcsynth_standalone.js --commands "src/testsuite/server/supernova/help_out.osc" \
        --scsyndef-dir src/testsuite/server/supernova/ \
        --output /tmp/bundle_smoke.wav --duration 1
    @echo "✓ hcsynth_standalone smoke test → /tmp/bundle_smoke.wav"

# Smoke-test both standalone bundles
bundle-test: bundle-test-hclang bundle-test-hcsynth

# Remove generated standalone bundles
clean-bundle:
    rm -rf {{DIST_DIR}}

# ── Benchmarks ───────────────────────────────────────────────────────────────
# Quickstart and per-recipe descriptions are in the README's "Bench
# quickstart" subsection. Baseline regression checks live alongside in
# bench/baselines/wamr-full.json (see bench-check / bench-update-baselines).

# Run the full perf benchmark suite (all phases × all patches × all toolchains).
# Depends on build-all so a fresh clone exercises the WAMR rows too — `just
# build` alone produces only the JS toolchain, leaving the wamr/wamr-full/
# wamr-aot rows silently skipped.
# Defaults: 5 runs + 1 warmup; ~26 cells; expect ~10 min with WASM
bench: build-all
    mkdir -p bench/results
    bash bench/run_bench.sh

# Quick benchmark: cold + warm, sine/poly only, 3 runs — expect ~3 min with WASM
bench-quick: build
    mkdir -p bench/results
    bash bench/run_bench.sh --phases cold,warm --patches sine,poly --runs 3 --warmups 1

# WAMR full-pipeline benchmark: hclang_native + hcsynth_native (WAMR-hosted lang
# forwarding OSC to WAMR-hosted synth). Measures wall_compile_ms = lang side,
# wall_synth_ms = synth side, summed into wall_total_ms.
# (A synth-only `wamr` toolchain was removed in Phase 12.2c — it rendered
# silence by design. The synth-side wall time lives inside `wall_synth_ms`
# of each `wamr-full` row.)
bench-wamr-full: build-wamr-host
    mkdir -p bench/results
    bash bench/run_bench.sh --toolchains wamr-full

# WAMR AOT-compiled benchmark: same shape as wamr-full but loads the
# wamrc-produced .aot module instead of interpreting the .wasm. Requires
# the build to have been configured with -DHC_WASM_AOT=ON and wamrc
# available in PATH. Both hclang.wasm.aot and hcsynth.wasm.aot must exist
# alongside the .wasm files; the bench symlinks them as <name>.aot in the
# host CWD so the binaries' module-load probe picks them up.
bench-wamr-aot: build-wamr-aot
    mkdir -p bench/results
    bash bench/run_bench.sh --toolchains wamr-aot

# Run the wamr-full bench on sine + fm (cold + warm, 5 runs + 1 warmup)
# and check each metric against bench/baselines/wamr-full.json. Exits
# non-zero if any cell regresses past its threshold_pct. Use this in CI
# or before merging perf-sensitive changes.
bench-check: build-wamr-host
    mkdir -p bench/results
    bash bench/run_bench.sh --toolchains wamr-full --patches sine,fm --phases cold,warm
    node bench/check_baselines.js

# Refresh bench/baselines/wamr-full.json with the medians from the most
# recent bench results. Run after a deliberate perf-affecting change
# (e.g. a WAMR upgrade or a hot-path optimisation). Review the diff in
# the PR — large jumps usually mean something else changed too.
bench-update-baselines: build-wamr-host
    mkdir -p bench/results
    bash bench/run_bench.sh --toolchains wamr-full --patches sine,fm --phases cold,warm
    node bench/check_baselines.js --update

# ── Housekeeping ──────────────────────────────────────────────────────────────

# Guard against adding new no-op WASM stubs without updating allowlist
lint-wasm-stubs:
    bash tools/guard/check_wasm_stub_allowlist.sh

# Remove build output
clean:
    rm -rf {{BUILD_DIR}}

# Remove staged deploy directory
clean-deploy:
    rm -rf {{DEPLOY_DIR}}

# Remove artifacts copied into the test harness directory
clean-test:
    rm -f {{TESTSUITE_DIR}}/hcsynth-engine.js \
          {{TESTSUITE_DIR}}/hcsynth.wasm \
          {{TESTSUITE_DIR}}/hcsynth.data \
          {{TESTSUITE_DIR}}/help_out.scsyndef

# List available recipes
default:
    @just --list
