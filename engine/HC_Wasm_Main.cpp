/*
 * HC_Wasm_Main.cpp - WASM module entry point
 *
 * This is the main entry point for the Emscripten build.
 * It initializes the audio engine and plugin registry.
 */

#ifdef SC_WASM

#include "HC_Wasm_PluginRegistry.hpp"
#include "HC_Wasm_Api.h"

// ============================================================================
// Initialization
// ============================================================================

extern "C" {

/**
 * Initialize the WASM module
 * Called once at startup by JavaScript
 */
void hc_wasm_init() {
    printf("SuperCollider WASM Module Initializing\n");
    printf("  Emscripten build\n");
    printf("  Phase 1: Core DSP engine + Tier-1 plugins\n");

    // Plugin registry is initialized via initialize_library() -> PluginRegistry::initialize_all(&gInterfaceTable)
    // during World_New(); nothing to do here.

    printf("Plugin initialization complete\n");
    printf("Ready for audio synthesis\n");
}

/**
 * Get version information
 */
const char* hc_wasm_version() {
    return "SuperCollider WASM 0.1.0-preview1";
}

/**
 * Get build information
 */
const char* hc_wasm_build_info() {
    return "Emscripten "
#ifdef __EMSCRIPTEN__
           "build"
#else
           "non-Emscripten"
#endif
           ;
}

} // extern "C"

#ifdef SC_WASM_WASI
// Standalone WASM (WAMR/Wasmtime) requires either a `main` for command-mode
// modules or a reactor build (`-mexec-model=reactor`). hcsynth.wasm is used
// purely through exported entry points by the native host, so we provide a
// stub main that does nothing — `__wasm_call_ctors` runs static
// initialisers at instantiate time and the host calls into the exported
// API afterwards. The stub is never invoked because the host never calls
// `_start`.
extern "C" int main(int /*argc*/, char** /*argv*/) {
    return 0;
}
#endif

#endif // SC_WASM
