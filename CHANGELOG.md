# Changelog

## [0.1.1] — 2026-06-25

### Fixed
- **WASI build**: resolved merge-conflict residue in `src/common/filesystem_wasm.cpp` that broke the v0.1.0 release pipeline's WASI `.wasm` target. Native builds were unaffected because the file is gated by `#ifdef SC_WASM`.
