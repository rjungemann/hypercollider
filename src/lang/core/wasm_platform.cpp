/*
 * SC_Wasm_Platform.cpp
 * SuperCollider Language - WASM Platform Abstraction Layer Implementation
 *
 * Provides time functions and scheduling stubs for WASM builds.
 *
 * Phase 7.2: sclang WASM Implementation
 */

#ifdef SC_WASM

#include "wasm_platform.h"
// Include Emscripten headers only for non-WASI builds
#if !defined(SC_WASM_WASI)
#include <emscripten.h>
#endif
#include <chrono>
#include <map>

/*
 * ============================================================================
 * TIME IMPLEMENTATION
 * ============================================================================
 * Uses JavaScript's performance.now() via Emscripten for standard WASM builds.
 * Uses clock_gettime(CLOCK_MONOTONIC) for WASI builds.
 */

// Cache the start time to provide consistent relative timing
static double g_wasm_start_time = 0.0;

double sc_wasm_get_now() {
    if (g_wasm_start_time == 0.0) {
#if defined(SC_WASM_WASI)
        // WASI: use clock_gettime for monotonic time
        struct timespec now;
        clock_gettime(CLOCK_MONOTONIC, &now);
        g_wasm_start_time = now.tv_sec + now.tv_nsec / 1000000000.0;
#else
        // Emscripten: use emscripten_get_now (returns ms, convert to seconds)
        g_wasm_start_time = emscripten_get_now() / 1000.0;
#endif
    }
#if defined(SC_WASM_WASI)
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (now.tv_sec + now.tv_nsec / 1000000000.0) - g_wasm_start_time;
#else
    return (emscripten_get_now() / 1000.0) - g_wasm_start_time;
#endif
}

void sc_wasm_sleep_ms(int milliseconds) {
    // TODO: Implement via emscripten_sleep or JavaScript setTimeout
    // For now, this is a no-op to maintain single-threaded execution
    (void)milliseconds;
}

/*
 * ============================================================================
 * SCHEDULING IMPLEMENTATION
 * ============================================================================
 * Deferred to Phase 8 with full JavaScript event loop integration.
 * For now, callbacks are stored but not executed automatically.
 */

struct ScheduledCallback {
    void (*callback)(void*);
    void* ctx;
    double scheduled_time;
    int callback_id;
};

static constexpr int kMaxCallbacks = 64;
static ScheduledCallback g_callbacks[kMaxCallbacks];
static int g_cb_head = 0;
static int g_cb_tail = 0;
static int g_next_callback_id = 1;

void sc_wasm_schedule_callback(void (*callback)(void*), void* ctx, double delay_seconds) {
    int next_tail = (g_cb_tail + 1) % kMaxCallbacks;
    if (next_tail == g_cb_head)
        return; // ring buffer full; drop oldest or silently discard
    g_callbacks[g_cb_tail] = { callback, ctx, sc_wasm_get_now() + delay_seconds, g_next_callback_id++ };
    g_cb_tail = next_tail;
    // TODO: In Phase 8, wire this to JavaScript setTimeout
}

// File I/O is handled by the Emscripten virtual filesystem (MEMFS/IDBFS).
// PyrFilePrim.cpp is included in the WASM build and uses standard POSIX calls
// which Emscripten routes through its FS layer.  The early-bring-up no-op stubs
// that used to override open()/read()/write()/stat()/access() have been removed
// as part of Phase 8.2 so that real file I/O works in both CLI (native FS) and
// browser (IDBFS-backed) WASM environments.

/*
 * ============================================================================
 * WASM-SPECIFIC INITIALIZATION
 * ============================================================================
 * Called during engine startup to initialize WASM platform state.
 */

extern "C" {

void sc_wasm_platform_init() {
    // Initialize time base
    g_wasm_start_time = 0.0;
    (void)sc_wasm_get_now();  // Prime the cache
}

}  // extern "C"

#endif  // SC_WASM
