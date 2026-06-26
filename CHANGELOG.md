# Changelog

## [0.1.2] — 2026-06-25

### Fixed
- **WASM (Emscripten) build**: dropped `_hc_wasm_quarks_available` from `EXPORTED_FUNCTIONS` in `src/lang/CMakeLists.txt`. The symbol is defined via `EM_JS` and cannot be resolved by `wasm-ld --export`; the bad entry blocked the WASM (Linux) job in the v0.1.1 release pipeline, which in turn blocked the native bundles (Linux, macOS).

## [0.1.1] — 2026-06-25

### Fixed
- **WASI build**: resolved merge-conflict residue in `src/common/filesystem_wasm.cpp` that broke the v0.1.0 release pipeline's WASI `.wasm` target. Native builds were unaffected because the file is gated by `#ifdef SC_WASM`.
