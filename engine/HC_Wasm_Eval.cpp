/*
 * HC_Wasm_Eval.cpp
 * SuperCollider Language Evaluation for WASM
 *
 * Implements code evaluation for browser-based sclang WASM.
 * Phase 9: Full PyrInterpreter integration – compiles the class library and
 *          evaluates SC code via interpretPrintCmdLine.
 */

#include "HC_Wasm_Eval.h"
#include "wasm_platform.h"

// SC Language headers
#include "interpreter.h"
#include "kernel.h"
#include "lexer.h"
#include "object_proto.h"
#include "object.h"
#include "slot.h"
#include "init_alloc.h"
#include "gc.h"
#include "sc_base.h"
#include "vm_globals.h"

// For s_interpretPrintCmdLine, s_interpretCmdLine
#include "object.h"

#include "language_config.hpp"

#include <emscripten.h>
#include <string>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <unordered_map>
#include <vector>
#include <sys/stat.h>

// Forward-declare sbrk directly instead of including <unistd.h>.
// <unistd.h> redeclares fork/execve as C functions, conflicting with the
// C++ inline stubs in SC_Wasm_Platform.h that shadow them for WASM builds.
extern "C" void* sbrk(intptr_t);

// ============================================================================
// EXTERNS – provided by SC_Wasm_RuntimeBridge.cpp
// ============================================================================

extern "C" {
    void sc_wasm_post_set_callback(void (*fn)(const char*, int));
    void sc_wasm_error_set_callback(void (*fn)(const char*, int));
    void sc_wasm_capture_start();
    const char* sc_wasm_capture_end();
    void sc_wasm_get_boot_timing(double* shutdown, double* passone,
                                  double* deptree, double* succeeded,
                                  double* initruntime, double* startup);
}

// runLibrary and compiledOK are defined in PyrLexer.cpp
extern bool compiledOK;
SCLANG_DLLEXPORT_C void runLibrary(PyrSymbol* selector);
SCLANG_DLLEXPORT_C bool compileLibrary(bool standalone);

// s_interpretPrintCmdLine is in PyrObject.cpp
extern PyrSymbol* s_interpretPrintCmdLine;

// newPyrStringN is in PyrObject.cpp
extern PyrString* newPyrStringN(PyrGC* gc, int length, int flags, bool collect);

// ============================================================================
// CLASS LIBRARY CONTENT CACHE  (Task 8)
// ============================================================================
//
// On first init, hclang_classlib.pack (a single-file binary pack built by
// tools/pack_sc_classlib.js) is read from MEMFS.  Each entry is copied into
// g_classlib_cache keyed by its MEMFS path.  PyrLexer.cpp's
// passOne_ProcessOneFile checks this cache and, when it gets a hit, sets
// fileSym->u.source before calling startLexer, bypassing the per-file
// fopen/fstat/fread overhead (~200+ individual calls during compileLibrary).

static constexpr char CLASSLIB_PACK_PATH[] = "/hclang_classlib.pack";
static constexpr uint8_t CLASSLIB_PACK_MAGIC[8] = {
    'S','C','C','L','P','K','\x01','\n'
};

// path → heap-allocated content (null-terminated).  Lives for the process
// lifetime; the compile pool does not own these pointers.
static std::unordered_map<std::string, char*> g_classlib_cache;

// Parse the pack format (magic + count + repeated <pathLen, contentLen,
// path, content>) from an in-memory buffer. Returns the number of entries
// loaded, or -1 on parse error.  Idempotent if called twice with the same
// data, but each call re-allocates so don't call repeatedly.
static int wasm_classlib_preload_buffer(const uint8_t* buf, size_t len) {
    if (!buf || len < 12) return -1; // magic + count

    auto readU32LE = [](const uint8_t* p) -> uint32_t {
        return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
               ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
    };

    if (memcmp(buf, CLASSLIB_PACK_MAGIC, 8) != 0) return -1;
    size_t pos = 8;
    uint32_t count = readU32LE(buf + pos);
    pos += 4;

    g_classlib_cache.reserve(g_classlib_cache.size() + count);

    int loaded = 0;
    for (uint32_t i = 0; i < count; ++i) {
        if (pos + 8 > len) return -1;
        uint32_t pathLen = readU32LE(buf + pos);    pos += 4;
        uint32_t contentLen = readU32LE(buf + pos); pos += 4;
        if (pos + pathLen + contentLen > len) return -1;

        std::string path((const char*)(buf + pos), pathLen); pos += pathLen;

        // Allocate content + null terminator in regular heap memory. The
        // compile pool is NOT used so these pointers survive
        // shutdownLibrary / pyr_pool_compile->FreeAll between recompiles.
        char* content = static_cast<char*>(malloc(contentLen + 1));
        if (!content) return loaded;
        memcpy(content, buf + pos, contentLen);
        content[contentLen] = '\0';
        pos += contentLen;

        g_classlib_cache.emplace(std::move(path), content);
        ++loaded;
    }
    return loaded;
}

// Read the pack from MEMFS, populate g_classlib_cache. Called from
// hc_wasm_eval_init in the JS/Emscripten build where the pack is preloaded
// into MEMFS via --preload-file.  WASI builds use the explicit
// hc_wasm_classlib_preload_bytes export instead.
static void wasm_classlib_preload() {
    FILE* f = fopen(CLASSLIB_PACK_PATH, "rb");
    if (!f) return; // pack not present — fall back to per-file reads

    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return; }
    long sz = ftell(f);
    if (sz <= 0) { fclose(f); return; }
    rewind(f);

    uint8_t* buf = static_cast<uint8_t*>(malloc((size_t)sz));
    if (!buf) { fclose(f); return; }
    if (fread(buf, 1, (size_t)sz, f) != (size_t)sz) {
        free(buf); fclose(f); return;
    }
    fclose(f);

    wasm_classlib_preload_buffer(buf, (size_t)sz);
    free(buf);
}

// Host-callable export. Hands a pack buffer (already in WASM linear memory)
// to the loader. The WASI host loads `hclang_classlib.pack` from disk,
// allocates a WASM buffer, copies the bytes in, then calls this. Returns
// the number of entries loaded, or -1 on parse failure.
extern "C" int hc_wasm_classlib_preload_bytes(const uint8_t* buf, int len) {
    if (!buf || len <= 0) return -1;
    return wasm_classlib_preload_buffer(buf, (size_t)len);
}

// Called from PyrLexer.cpp (passOne_ProcessOneFile) under #ifdef SC_WASM.
// Returns a null-terminated content pointer if the file is in the cache,
// or nullptr to fall through to the normal fopen path.
extern "C" const char* wasm_classlib_cache_lookup(const char* memfs_path) {
    if (g_classlib_cache.empty()) return nullptr;
    auto it = g_classlib_cache.find(memfs_path);
    return (it != g_classlib_cache.end()) ? it->second : nullptr;
}

// ============================================================================
// GLOBALS
// ============================================================================

static void (*g_post_callback)(const char* text, int len) = nullptr;
static void (*g_error_callback)(const char* text, int len) = nullptr;
static bool g_initialized = false;

// ============================================================================
// POST/ERROR CALLBACK REGISTRATION
// ============================================================================

extern "C" void hc_wasm_eval_set_post_callback(void (*cb)(const char*, int)) {
    g_post_callback = cb;
    // Also wire into HC_Wasm_RuntimeBridge so compileLibrary/runLibrary output
    // reaches the callback.
    sc_wasm_post_set_callback(cb);
}

extern "C" void hc_wasm_eval_set_error_callback(void (*cb)(const char*, int)) {
    g_error_callback = cb;
    sc_wasm_error_set_callback(cb);
}

extern bool gTraceInterpreter;

extern "C" void hc_wasm_eval_set_debug_level(int level) {
    gTraceInterpreter = (level > 0);
}

// ============================================================================
// SIMPLE OUTPUT HELPER (for our own messages)
// ============================================================================

// postText is defined in wasm_runtime_bridge.cpp; it has its own WASI fallback
// that routes to hc_host_post when no JS callback is registered.
extern void postText(const char* str, std::int64_t len);

static void post_to_callback(const char* text) {
    int len = (int)std::strlen(text);
    if (g_post_callback)
        g_post_callback(text, len);
    else
        postText(text, (std::int64_t)len);
}

// ============================================================================
// VM INITIALIZATION + CLASS LIBRARY COMPILATION (C5 / P1-P5)
// ============================================================================

extern "C" int hc_wasm_eval_init() {
    if (g_initialized) {
        return 0;
    }

    // Use the same memory sizes as SC_LanguageClient defaults:
    //   mMemSpace = 2 * 1024 * 1024 (2 MB), mMemGrow = 256 * 1024
    // compileLibrary() → shutdownLibrary() → pyr_pool_runtime->FreeAll()
    // requires the pool to exist first.
    if (!pyr_init_mem_pools(2 * 1024 * 1024, 256 * 1024)) {
        post_to_callback("sclang WASM: pyr_init_mem_pools failed\n");
        return -1;
    }

    // Pre-load all class library file content from the single binary pack so
    // passOne can serve file reads from cache instead of 200+ MEMFS opens.
    wasm_classlib_preload();

    // Compile the full class library.
    // compileLibrary() internally calls:
    //   shutdownLibrary() → FreeAll, compiledOK=false
    //   passOne()         → initPassOne (symbol table, classes, primitives)
    //                     → recursive_directory_iterator over preloaded SCClassLibrary
    //   compileSucceeded() → initRuntime(gMainVMGlobals), schedRun (stubbed)
    post_to_callback("sclang WASM: compiling class library...\n");

    bool ok = compileLibrary(false);

    // Emit sub-phase timing to stderr (parsed by bench/run_bench.sh and
    // hclang_native's `-v 1` output). Goes through the registered error
    // callback when one is set (Emscripten path); otherwise direct
    // fprintf so the WASI path picks it up too.
    {
        double shutdown_ms = 0, passone_ms = 0, deptree_ms = 0, succeeded_ms = 0;
        double initruntime_ms = 0, startup_ms = 0;
        sc_wasm_get_boot_timing(&shutdown_ms, &passone_ms, &deptree_ms, &succeeded_ms,
                                &initruntime_ms, &startup_ms);
        char buf[512];
        std::snprintf(buf, sizeof(buf),
            "hclang_shutdown_ms: %.0f\nhclang_passone_ms: %.0f\nhclang_deptree_ms: %.0f\n"
            "hclang_succeeded_ms: %.0f\nhclang_initruntime_ms: %.0f\nhclang_startup_ms: %.0f\n",
            shutdown_ms, passone_ms, deptree_ms, succeeded_ms, initruntime_ms, startup_ms);
        if (g_error_callback) {
            g_error_callback(buf, (int)std::strlen(buf));
        } else {
            std::fputs(buf, stderr);
            std::fflush(stderr);
        }
    }

    if (!ok) {
        post_to_callback("sclang WASM: class library compilation FAILED\n");
        return -1;
    }

    g_initialized = true;
    post_to_callback("sclang WASM: class library compiled OK\n");
    return 0;
}

// ============================================================================
// BOOT (C10: Server.default – runs SC startup method)
// ============================================================================

extern "C" int hc_wasm_eval_boot() {
    if (!g_initialized) {
        if (hc_wasm_eval_init() != 0) {
            return -1;
        }
    }
    // startup is already called inside compileSucceeded() when compileLibrary
    // completes.  Nothing extra needed here for a headless WASM boot.
    return 0;
}

// ============================================================================
// CODE EVALUATION (P1: replace stub with PyrInterpreter call)
// ============================================================================

extern "C" const char* hc_wasm_eval_string(const char* code, int len) {
    if (!g_initialized) {
        if (hc_wasm_eval_init() != 0) {
            return "[error: initialization failed]";
        }
    }

    if (!code) {
        return "";
    }
    if (len < 0) {
        len = (int)std::strlen(code);
    }
    if (len == 0) {
        return "";
    }

    if (!compiledOK) {
        return "[error: class library not compiled]";
    }

    VMGlobals* g = gMainVMGlobals;
    if (!g || !g->process) {
        return "[error: VM not initialized]";
    }

    // -----------------------------------------------------------------------
    // Step 1: Set the interpreter's cmdLine slot to the provided source text.
    // (Mirrors SC_LanguageClient::setCmdLine without the mutex since WASM is
    // single-threaded.)
    // -----------------------------------------------------------------------
    PyrString* strobj = newPyrStringN(g->gc, len, 0, true);
    if (!strobj) {
        return "[error: string allocation failed]";
    }
    memcpy(strobj->s, code, len);

    PyrInterpreter* interp = slotRawInterpreter(&g->process->interpreter);
    SetObject(&interp->cmdLine, strobj);
    g->gc->GCWriteNew(slotRawObject(&g->process->interpreter), strobj);

    // -----------------------------------------------------------------------
    // Step 2: Evaluate via interpretPrintCmdLine, capturing posted output.
    // -----------------------------------------------------------------------
    sc_wasm_capture_start();
    runLibrary(s_interpretPrintCmdLine);
    const char* captured = sc_wasm_capture_end();

    // If the interpreter produced no output (e.g. a side-effect-only
    // expression), return an empty string rather than a stub placeholder.
    return captured;
}

// ============================================================================
// EXECUTE (fire-and-forget, result goes to post callback)
// ============================================================================

extern "C" void hc_wasm_eval_execute(const char* code, int len) {
    if (!g_initialized) {
        hc_wasm_eval_init();
    }

    if (!code) return;
    if (len < 0) len = (int)std::strlen(code);

    const char* result = hc_wasm_eval_string(code, len);

    if (result && *result) {
        int rlen = (int)std::strlen(result);
        if (g_post_callback)
            g_post_callback(result, rlen);
        else
            postText(result, (std::int64_t)rlen);
    }
}

// ============================================================================
// BOOT SEQUENCE
// ============================================================================

extern "C" int hc_wasm_eval_boot_sequence() {
    if (!g_initialized) {
        if (hc_wasm_eval_init() != 0) {
            return -1;
        }
    }
    return hc_wasm_eval_boot();
}

// ============================================================================
// HEAP SNAPSHOT SUPPORT
// ============================================================================

// Returns the current sbrk(0) value: the end of the live heap after init.
// The JS snapshot system saves only bytes [0, heapEnd) to disk.
extern "C" uint32_t hc_wasm_eval_heap_end() {
    return (uint32_t)(uintptr_t)sbrk(0);
}

// ============================================================================
// VFS HELPER (called from native _emscripten_fs_load_embedded_files)
// ============================================================================
//
// Creates parent directories and writes the file into Emscripten's MEMFS.
// Called by the native host's _emscripten_fs_load_embedded_files stub, which
// iterates the embedded-file table and calls us for each entry so that the
// class library files embedded via --embed-file are visible in MEMFS before
// compileLibrary() runs.

extern "C" void hc_wasm_vfs_create_file(const char* path, const void* data, uint32_t len) {
    // Recursively create parent directories (ignore EEXIST errors)
    char tmp[4096];
    std::snprintf(tmp, sizeof(tmp), "%s", path);
    for (char* p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            ::mkdir(tmp, 0755);
            *p = '/';
        }
    }
    FILE* f = ::fopen(path, "wb");
    if (f) {
        ::fwrite(data, 1, len, f);
        ::fclose(f);
    }
}

// ============================================================================
// STATUS
// ============================================================================

extern "C" const char* hc_wasm_eval_status() {
    static char status[256];
    std::snprintf(status, sizeof(status),
                  "sclang WASM: %s, compiledOK=%s, post_cb=%s",
                  g_initialized ? "initialized" : "not init",
                  compiledOK   ? "true"        : "false",
                  g_post_callback ? "set" : "not set");
    return status;
}

// ============================================================================
// CLASS LIBRARY INCLUDE PATH
// ============================================================================

extern "C" void hc_wasm_eval_add_include_path(const char* path) {
    if (!path || !gLanguageConfig) {
        return;
    }
    // Convert C string to std::filesystem::path
    gLanguageConfig->addIncludedDirectory(std::filesystem::path(path));
}

// ============================================================================
// QUARKS AVAILABILITY CHECK
// ============================================================================

// Static flag set by the WAMR host when --quarks-dir is provided.
// Browser path checks window.__hclang_git_proxy via JS.
static bool g_quarks_dir_registered = false;

extern "C" void hc_wasm_quarks_set_available(bool available) {
    g_quarks_dir_registered = available;
}

// Check if quarks are available in the current environment.
// Returns 1 if available, 0 otherwise.
#if defined(SC_WASM_WASI)
extern "C" int hc_wasm_quarks_available() {
    // WAMR path: check if --quarks-dir was registered
    return g_quarks_dir_registered ? 1 : 0;
}
#elif defined(SC_WASM)
// Emscripten path: check for JS proxy via emscripten
EM_JS(int, hc_wasm_quarks_available, (), {
    if (typeof window !== 'undefined' && window.__hclang_git_proxy) {
        return 1;
    }
    return 0;
});
#endif
