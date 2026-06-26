# Changelog

## [0.1.5] — 2026-06-26

### Fixed
- **WAMR-native hclang build**: dropped the invalid 4th argument from the `--extra-class-path` CLI11 `add_option` call in `native/hclang_host/main.cpp`. CLI11's vector overload only accepts up to 3 arguments, so the trailing `true` made the file fail to compile — which had blocked every native bundle job in the release pipeline since v0.1.0, meaning no prior v0.1.x release ever actually produced the WAMR-native `hclang` binary.

## [0.1.4] — 2026-06-25

### Fixed
- **hcsynth (Emscripten)**: explicitly set `SUFFIX=".js"` on the hcsynth target's Emscripten branch. Emscripten 3.1.73 (pinned in the release workflow) doesn't apply `CMAKE_EXECUTABLE_SUFFIX=".js"` automatically, so the build produced an extension-less `hcsynth` binary instead of `hcsynth.js`, breaking the release pipeline's Stage WASM step. Mirrors the explicit suffix already in place for hclang.

## [0.1.3] — 2026-06-25

### Fixed
- **Release pipeline**: disable `HCLANG_BUILD_SNAPSHOT` for the WASM (Linux) job. The POST_BUILD snapshot generator runs the freshly-built `hclang.js` under Node and fails in CI (no quarks dir), prompting CMake to delete `hclang.js` and breaking the downstream Stage / bundle jobs. The snapshot is a Node-WASM optimization not consumed by the WAMR-native release binaries.

## [0.1.2] — 2026-06-25

### Fixed
- **WASM (Emscripten) build**: dropped `_hc_wasm_quarks_available` from `EXPORTED_FUNCTIONS` in `src/lang/CMakeLists.txt`. The symbol is defined via `EM_JS` and cannot be resolved by `wasm-ld --export`; the bad entry blocked the WASM (Linux) job in the v0.1.1 release pipeline, which in turn blocked the native bundles (Linux, macOS).

## [0.1.1] — 2026-06-25

### Fixed
- **WASI build**: resolved merge-conflict residue in `src/common/filesystem_wasm.cpp` that broke the v0.1.0 release pipeline's WASI `.wasm` target. Native builds were unaffected because the file is gated by `#ifdef SC_WASM`.
