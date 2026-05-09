# SuperCollider WASM Platform

This directory contains WebAssembly-specific code and abstractions for porting SuperCollider to the browser/Emscripten target.

## Directory Structure

- **SC_Wasm_Shims.h** — POSIX API stubs for threading, sockets, dynamic loading, etc.
- **SC_Wasm_Filesystem.hpp/cpp** — In-memory virtual filesystem for asset management
- **SC_Wasm_PluginRegistry.hpp** — Static UGen registration (replaces dlopen at runtime)

## Building for WASM

### Prerequisites

1. Install Emscripten SDK (3.1.0 or later)
   ```bash
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh
   ```

2. Set up build directory
   ```bash
   mkdir -p build/wasm && cd build/wasm
   ```

### Build Command

```bash
cmake .. \
  -DCMAKE_TOOLCHAIN_FILE=../cmake_modules/EmscriptenToolchain.cmake \
  -DSC_WASM=ON \
  -DCMAKE_BUILD_TYPE=Release
make
```

### CMakePresets (Recommended)

Alternatively, use the preset configuration:
```bash
cmake --preset wasm_release
cd build/wasm
make
```

## WASM-Specific Build Flags

- `SC_WASM=ON` — Enable WASM target build
- `AUDIOAPI=wasm` — Set audio API to WASM (automatic with SC_WASM)
- `SC_QT=OFF` — Disable Qt (automatic with SC_WASM)
- `-msimd128` — Enable WebAssembly SIMD (enabled by default in toolchain)

## Architecture Decisions (Phase 1)

### Threading Model
- **Phase 1:** Single-threaded only. No pthreads.
- **Phase 2+:** Evaluate SharedArrayBuffer + pthreads with explicit opt-in

### Dynamic Loading
- **Before (native):** `dlopen("plugin.so")` at runtime
- **After (WASM):** Static registration via `SC_WASM_REGISTER_UGENS()` macro

### Filesystem
- **Before (native):** Direct file I/O to disk
- **After (WASM):** Virtual in-memory filesystem (AssetStore)
  - SynthDefs and samples loaded from JS via typed arrays
  - No access to browser's filesystem APIs (intentional sandbox protection)

### Networking
- **Before (native):** Raw UDP/TCP sockets for OSC
- **After (WASM):** Message bridge through JavaScript
  - JS handles WebSocket/HTTP, C++ receives parsed messages
  - No raw socket access in browser context

## Testing

### Offline Rendering Test
```cpp
#include "SC_World.h"

// In test code:
World* world = World::create(/* params */);
SynthDef* def = world->load_synthdef(/* SynthDef bytes */);
float output[512];
world->render_block(output, 512);
delete world;
```

### Browser Integration
See `testsuite/wasm/` for JavaScript harness and AudioWorklet integration.

## Known Limitations (Phase 1)

1. **Single-threaded** — No concurrent rendering
2. **No file I/O** — Assets must be pre-loaded from JS
3. **No OSC networking** — Message protocol via JS bridge only
4. **Limited plugin set** — Tier-1 plugins (43 total available; ~18 in Phase 1)
5. **No SynthDef compilation** — Only supports pre-compiled SynthDef bytecode

## Future Work (Phase 2+)

- Real-time AudioWorklet integration
- WebWorker threading with SharedArrayBuffer
- Plugin dependency management (FFTW, etc.)
- SynthDef on-the-fly compilation from miniature sclang subset
- Performance optimization and profiling

## References

- [Emscripten CMake Toolchain](https://emscripten.org/docs/getting_started/cmake_build_system.html)
- [WebAssembly SIMD](https://webassembly.org/roadmap/)
- [Web Audio API AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
