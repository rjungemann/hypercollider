# Homebrew formula for HyperCollider.
#
# Install via the GitHub tap:
#   brew tap rjungemann/hypercollider https://github.com/rjungemann/hypercollider
#   brew install rjungemann/hypercollider/hypercollider
#
# Or directly (no tap):
#   brew install https://raw.githubusercontent.com/rjungemann/hypercollider/main/Formula/hypercollider.rb
#
# To install the development (HEAD) build:
#   brew install --HEAD rjungemann/hypercollider/hypercollider
#
# After installation the following commands are available:
#   hclang-wasm         — WASM hclang via Node.js
#   hcsynth-wasm        — WASM hcsynth via Node.js
#   hclang-wamr-full    — WASI hclang via native WAMR host
#   hcsynth-wamr-full   — WASI hcsynth via native WAMR host
#   hclang-wamr-aot     — AOT-compiled hclang (requires prior `just build-wamr-aot`)
#   hcsynth-wamr-aot    — AOT-compiled hcsynth (requires prior `just build-wamr-aot`)

class Hypercollider < Formula
  desc "WebAssembly-first SuperCollider fork: hclang language + hcsynth audio engine"
  homepage "https://github.com/rjungemann/hypercollider"
  license "GPL-2.0-or-later"

  # Replace the url + sha256 pair below with a tagged release archive once
  # one exists.  Use `brew fetch --build-from-source` against the tag to
  # obtain the sha256.
  head "https://github.com/rjungemann/hypercollider.git", branch: "main"

  # ── Build-time dependencies ───────────────────────────────────────────────
  depends_on "cmake"       => :build
  depends_on "emscripten"  => :build  # provides emcc / em++ for WASM + WASI builds
  depends_on "ninja"       => :build  # used by the native WAMR host preset
  depends_on "python@3"    => :build  # required by Emscripten toolchain scripts

  # ── Runtime dependencies ──────────────────────────────────────────────────
  depends_on "node"                   # runs hclang-wasm / hcsynth-wasm CLI scripts

  def install
    jobs = ENV.make_jobs

    # Homebrew isolates the build from EMSDK env vars; tell the toolchain
    # files to find emcc via PATH instead (they already handle this case
    # when EMSDK is unset — see cmake_modules/EmscriptenToolchain.cmake).
    ENV.delete("EMSDK")

    # ── 1. Build JS-target WASM artifacts (hclang.js / hcsynth.js) ──────────
    wasm_dir = buildpath/"build/wasm"
    wasm_dir.mkpath
    system "cmake", "-G", "Unix Makefiles",
           "-DCMAKE_TOOLCHAIN_FILE=#{buildpath}/cmake_modules/EmscriptenToolchain.cmake",
           "-DSC_WASM=ON",
           "-DCMAKE_BUILD_TYPE=Release",
           "-S", buildpath, "-B", wasm_dir
    system "cmake", "--build", wasm_dir,
           "--target", "hcsynth", "hclang", "-j#{jobs}"

    # ── 2. Build WASI .wasm artifacts (loaded by the WAMR native host) ──────
    wasi_dir = buildpath/"build/wasi"
    wasi_dir.mkpath
    system "cmake", "-G", "Unix Makefiles",
           "-DCMAKE_TOOLCHAIN_FILE=#{buildpath}/cmake_modules/EmscriptenWasiToolchain.cmake",
           "-DSC_WASM=ON",
           "-DSC_WASM_WASI=ON",
           "-DCMAKE_BUILD_TYPE=Release",
           "-S", buildpath, "-B", wasi_dir
    system "cmake", "--build", wasi_dir,
           "--target", "hclang", "hcsynth", "-j#{jobs}"

    # ── 3. Build native WAMR host binaries (hclang_native / hcsynth_native) ─
    # HC_EMBED_WASM=ON links the WASI .wasm blobs directly into the binaries
    # so they are fully self-contained — no separate .wasm files at runtime.
    # HC_REQUIRE_EMBEDDED_WASM=ON makes a missing .wasm a fatal configure error.
    native_dir = buildpath/"build/native"
    native_dir.mkpath
    system "cmake", "-G", "Ninja",
           "-DCMAKE_BUILD_TYPE=Release",
           "-DHC_EMBED_WASM=ON",
           "-DHC_REQUIRE_EMBEDDED_WASM=ON",
           "-DWASI_BUILD_DIR=#{wasi_dir}",
           "-S", buildpath/"native", "-B", native_dir
    system "cmake", "--build", native_dir,
           "--target", "hclang_native", "hcsynth_native", "-j#{jobs}"

    # ── 4. Install npm deps for the CLI scripts ──────────────────────────────
    # --omit=optional skips audio-speaker and midi (native addons that need
    # node-gyp + system audio libs; not required for offline rendering).
    # --ignore-scripts prevents lifecycle scripts from running during install.
    cd "cli" do
      system "npm", "ci", "--omit=optional", "--ignore-scripts"
    end

    # ── 5. Stage everything under libexec ────────────────────────────────────
    # CLI scripts (JS) + node_modules
    libexec.install "cli"
    # WASM build artifacts
    (libexec/"build/wasm/lang").install wasm_dir/"lang"
    (libexec/"build/wasm/server").install wasm_dir/"server"
    # WASI build artifacts (for wamr-full / wamr-aot)
    (libexec/"build/wasi/lang").install wasi_dir/"lang"
    (libexec/"build/wasi/server").install wasi_dir/"server"
    # SC class library (hclang_native loads .sc files at runtime)
    (libexec/"src").install buildpath/"src/class_library"

    # ── 6. Install native WAMR host binaries ─────────────────────────────────
    bin.install native_dir/"hclang_host/hclang_native"
    bin.install native_dir/"hcsynth_host/hcsynth_native"

    # ── 7. Write convenience wrapper scripts ─────────────────────────────────
    # Paths burned in at install time so shims work without any PATH magic.
    cli_dir      = libexec/"cli"
    wasi_lang    = libexec/"build/wasi/lang/hclang"
    wasi_synth   = libexec/"build/wasi/server/hcsynth"
    classlib_dir = libexec/"src/class_library"
    lang_bin     = bin/"hclang_native"
    synth_bin    = bin/"hcsynth_native"

    # ── hclang-wasm ─────────────────────────────────────────────────────────
    (bin/"hclang-wasm").write <<~SH
      #!/usr/bin/env bash
      exec node "#{cli_dir}/hclang.js" "$@"
    SH

    # ── hcsynth-wasm ─────────────────────────────────────────────────────────
    (bin/"hcsynth-wasm").write <<~SH
      #!/usr/bin/env bash
      exec node "#{cli_dir}/hcsynth.js" "$@"
    SH

    # ── hclang-wamr-full ─────────────────────────────────────────────────────
    (bin/"hclang-wamr-full").write <<~SH
      #!/usr/bin/env bash
      exec "#{lang_bin}" \
        --classlib-dir "#{classlib_dir}" \
        "$@"
    SH

    # ── hcsynth-wamr-full ────────────────────────────────────────────────────
    (bin/"hcsynth-wamr-full").write <<~SH
      #!/usr/bin/env bash
      exec "#{synth_bin}" "$@"
    SH

    # ── hclang-wamr-aot ──────────────────────────────────────────────────────
    # The AOT artifacts (.wasm.aot files) are not built by this formula —
    # they require wamrc (LLVM-based AOT compiler).  Build them with:
    #   brew install rjungemann/hypercollider/wamrc   (when available), or
    #   just build-wamr-aot   (from a source checkout with wamrc on PATH)
    # then copy / symlink the resulting files into:
    #   #{wasi_lang}/hclang.wasm.aot
    #   #{wasi_synth}/hcsynth.wasm.aot
    (bin/"hclang-wamr-aot").write <<~SH
      #!/usr/bin/env bash
      # Validate that the AOT artifact is present before attempting to use it.
      aot_file="#{wasi_lang}/hclang.wasm.aot"
      if [[ ! -f "$aot_file" ]]; then
        echo "hclang-wamr-aot: AOT artifact not found: $aot_file" >&2
        echo "  Build it with: just build-wamr-aot  (requires wamrc on PATH)" >&2
        echo "  See: https://github.com/rjungemann/hypercollider/blob/main/docs/HCLANG_NATIVE_PLAN.md" >&2
        exit 1
      fi
      ln -sf "$aot_file" "#{wasi_lang}/hclang.aot"
      trap 'rm -f "#{wasi_lang}/hclang.aot"' EXIT
      HC_WASM_FROM_DISK=1 exec "#{lang_bin}" \
        --classlib-dir "#{classlib_dir}" \
        "$@"
    SH

    # ── hcsynth-wamr-aot ─────────────────────────────────────────────────────
    (bin/"hcsynth-wamr-aot").write <<~SH
      #!/usr/bin/env bash
      aot_file="#{wasi_synth}/hcsynth.wasm.aot"
      if [[ ! -f "$aot_file" ]]; then
        echo "hcsynth-wamr-aot: AOT artifact not found: $aot_file" >&2
        echo "  Build it with: just build-wamr-aot  (requires wamrc on PATH)" >&2
        echo "  See: https://github.com/rjungemann/hypercollider/blob/main/docs/HCLANG_NATIVE_PLAN.md" >&2
        exit 1
      fi
      ln -sf "$aot_file" "#{wasi_synth}/hcsynth.aot"
      trap 'rm -f "#{wasi_synth}/hcsynth.aot"' EXIT
      HC_WASM_FROM_DISK=1 exec "#{synth_bin}" "$@"
    SH

    # Ensure all shim scripts are executable.
    %w[hclang-wasm hcsynth-wasm hclang-wamr-full hcsynth-wamr-full
       hclang-wamr-aot hcsynth-wamr-aot].each do |s|
      chmod 0755, bin/s
    end
  end

  def caveats
    wasi_lang  = opt_libexec/"build/wasi/lang/hclang"
    wasi_synth = opt_libexec/"build/wasi/server/hcsynth"
    <<~EOS
      Six commands are now available:
        hclang-wasm / hcsynth-wasm         — WASM via Node.js
        hclang-wamr-full / hcsynth-wamr-full — native WAMR host (interpreted)
        hclang-wamr-aot / hcsynth-wamr-aot  — native WAMR host (AOT-compiled)

      The wamr-aot commands require AOT-compiled artifacts built separately:
        1. Install wamrc (see docs/HCLANG_NATIVE_PLAN.md §Phase 8), or run:
             just setup-wamrc
        2. Build the artifacts from a source checkout:
             just build-wamr-aot
        3. Copy the resulting files into:
             #{wasi_lang}/hclang.wasm.aot
             #{wasi_synth}/hcsynth.wasm.aot

      Realtime audio output (hcsynth-wasm --realtime-audio) and MIDI support
      require optional Node.js native addons.  Install them with:
        npm install --prefix "#{opt_libexec}/cli" audio-speaker midi
    EOS
  end

  test do
    # Smoke-test: hclang-wasm should print a version line and exit cleanly.
    assert_match "hclang", shell_output("#{bin}/hclang-wasm --version")
    # Smoke-test: hcsynth-wasm should print a version line and exit cleanly.
    assert_match "hcsynth", shell_output("#{bin}/hcsynth-wasm --version")
    # Smoke-test: native binaries should exist and be executable.
    assert_predicate bin/"hclang_native", :executable?
    assert_predicate bin/"hcsynth_native", :executable?
  end
end
