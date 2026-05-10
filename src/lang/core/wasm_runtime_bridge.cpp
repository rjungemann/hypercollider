/*
 * SC_Wasm_RuntimeBridge.cpp
 * WASM runtime bridge for constrained browser implementations.
 *
 * Linkage notes:
 *   - Functions declared SCLANG_DLLEXPORT_C in SCBase.h have C linkage and
 *     must be defined with extern "C" here.
 *   - post(), postfl(), error(), postText() etc. are plain C++ declarations
 *     in SCBase.h (no C_LINKAGE) and are defined without extern "C".
 */

#ifdef SC_WASM

#include "vm_globals.h"
#include "slot.h"
#include "object.h"
#include "kernel.h"
#include "gc.h"
#include "object_proto.h"
#include "symbol_table.h"
#include "interpreter.h"
#include "wasm_platform.h"
#include "primitive.h"
#include "symbol.h"
#include "filesystem.hpp"
#include "sc_base.h"
#include "HC_Wasm_Eval.h"
#ifndef SC_WASM_WASI
#include <emscripten/val.h>
#endif
#include <cstdarg>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace fs = std::filesystem;

// Single-threaded WASM runtime uses a no-op mutex stub in place of the native
// language mutex declared for threaded desktop builds.
struct SC_Lock_Dummy {
    void lock() { (void)this; }
    bool try_lock() { return true; }
    void unlock() { (void)this; }
    template <class D>
    bool try_lock_for(D) { return true; }
};
SC_Lock_Dummy gLangMutex;

// ============================================================================
// POST CALLBACK INFRASTRUCTURE
// ============================================================================

// Global post/error function pointers – set by SC_Wasm_Eval.cpp via
// sc_wasm_post_set_callback() / sc_wasm_error_set_callback().
static void (*g_wasm_post_fn)(const char*, int) = nullptr;
static void (*g_wasm_error_fn)(const char*, int) = nullptr;

#ifdef SC_WASM_WASI
// In WASI mode these are imported from the native WAMR host (registered via
// wasm_runtime_register_natives in "env").  The import_module/import_name
// attributes tell wasm-ld to treat them as intentional WASM imports rather
// than linker errors.
extern "C" {
__attribute__((import_module("env"), import_name("hc_host_post")))
void hc_host_post(const char* text, int len);
__attribute__((import_module("env"), import_name("hc_host_error")))
void hc_host_error(const char* text, int len);
// Phase 11: Ctrl-C support. The bytecode interpreter polls this every
// ~4096 dispatches; the host returns 1 once after each SIGINT and 0
// otherwise.
__attribute__((import_module("env"), import_name("hc_host_poll_interrupt")))
int32_t hc_host_poll_interrupt(void);
// Quarks CLI: Host execution functions for command execution from WASM.
// hc_host_exec: run a shell command, return exit code.
__attribute__((import_module("env"), import_name("hc_host_exec")))
int32_t hc_host_exec(const char* cmd, int32_t len);
// hc_host_exec_capture: run a shell command, capture stdout.
// Returns exit code. Output is written to the buffer at out_ptr (max out_len bytes).
// Actual bytes written is stored at bytes_written_ptr.
__attribute__((import_module("env"), import_name("hc_host_exec_capture")))
int32_t hc_host_exec_capture(const char* cmd, int32_t len, char* out_ptr, int32_t out_len, int32_t* bytes_written_ptr);
}
#endif

// Capture mode: when enabled, postText output is collected into a static
// buffer instead of forwarded to g_wasm_post_fn.  Used during evaluation to
// capture the printed result of interpretPrintCmdLine.
static bool  g_capture_mode = false;
static char  g_capture_buf[16384];
static int   g_capture_len = 0;

extern "C" {

void sc_wasm_post_set_callback(void (*fn)(const char*, int)) {
    g_wasm_post_fn = fn;
}

void sc_wasm_error_set_callback(void (*fn)(const char*, int)) {
    g_wasm_error_fn = fn;
}

void sc_wasm_error_emit(const char* text, int len) {
    if (g_wasm_error_fn)
        g_wasm_error_fn(text, len);
#ifdef SC_WASM_WASI
    else
        hc_host_error(text, len);
#endif
}

void sc_wasm_capture_start() {
    g_capture_mode = true;
    g_capture_len  = 0;
    g_capture_buf[0] = '\0';
}

const char* sc_wasm_capture_end() {
    g_capture_mode = false;
    g_capture_buf[g_capture_len] = '\0';
    return g_capture_buf;
}

} // extern "C"

// ============================================================================
// POST / ERROR IMPLEMENTATIONS (C++ linkage – matches SCBase.h declarations)
// ============================================================================

void postText(const char* str, std::int64_t len) {
    if (len <= 0) return;
    if (g_capture_mode) {
        int available = (int)(sizeof(g_capture_buf) - g_capture_len - 1);
        int copy = ((int)len < available) ? (int)len : available;
        if (copy > 0) {
            memcpy(g_capture_buf + g_capture_len, str, copy);
            g_capture_len += copy;
        }
    } else if (g_wasm_post_fn) {
        g_wasm_post_fn(str, (int)len);
#ifdef SC_WASM_WASI
    } else {
        hc_host_post(str, (int)len);
#endif
    }
}

void postChar(char c) { postText(&c, 1); }

void flushPostBuf() {
    // Browser/WASM has no buffered terminal transport to flush.
    (void)0;
}

void post(const char* fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n > 0) postText(buf, n);
}

void postfl(const char* fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n > 0) postText(buf, n);
}

void error(const char* fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n > 0) {
        // Errors bypass capture mode and always go to error / post callback.
        if (g_wasm_error_fn)
            g_wasm_error_fn(buf, n);
        else if (g_wasm_post_fn)
            g_wasm_post_fn(buf, n);
#ifdef SC_WASM_WASI
        else
            hc_host_error(buf, n);
#endif
    }
}

static FILE* g_post_file = nullptr;

void setPostFile(FILE* file) {
    // File-backed post redirection is unsupported in browser builds;
    // keep the symbol wired while making this an explicit constrained path.
    g_post_file = file;
}

static bool g_sched_initialized = false;
static bool g_sched_running = false;
static bool g_warned_unix_prims = false;
static bool g_warned_gui_prims = false;
static bool g_warned_serial_prims = false;
static bool g_warned_sched_heap = false;
static bool g_warned_osc_lifecycle = false;
static bool g_warned_custom_ports = false;
static bool g_warned_close_gui = false;
static bool g_warned_midi_prims = false;
static bool g_warned_unix_bridge_missing = false;

// ============================================================================
// PIPE BUFFER MANAGEMENT
// ============================================================================
// Shared pipe buffer table for both Emscripten and WASI paths.
// Used by Pipe.callSync and UnixCmdGetStdOut to buffer command output
// for line-by-line reading. 1-based slot indexing.

struct WasmPipeBuffer {
    std::string output;
    size_t pos;
    bool open;
};

static WasmPipeBuffer g_pipe_buffers[8] = {};

static int allocPipeBuffer() {
    for (int i = 0; i < 8; ++i) {
        if (!g_pipe_buffers[i].open) {
            g_pipe_buffers[i].output.clear();
            g_pipe_buffers[i].pos = 0;
            g_pipe_buffers[i].open = true;
            return i + 1; // 1-based
        }
    }
    return 0; // no free slot
}

static void freePipeBuffer(int slot) {
    if (slot >= 1 && slot <= 8) {
        g_pipe_buffers[slot - 1].output.clear();
        g_pipe_buffers[slot - 1].pos = 0;
        g_pipe_buffers[slot - 1].open = false;
    }
}

static WasmPipeBuffer* getPipeBuffer(int slot) {
    if (slot >= 1 && slot <= 8 && g_pipe_buffers[slot - 1].open) {
        return &g_pipe_buffers[slot - 1];
    }
    return nullptr;
}

static int g_wasm_unix_errno = 0;

static PyrSymbol* s_unixCmdAction = nullptr;

static PyrSymbol* s_midiNoteOnAction = nullptr;
static PyrSymbol* s_midiNoteOffAction = nullptr;
static PyrSymbol* s_midiTouchAction = nullptr;
static PyrSymbol* s_midiControlAction = nullptr;
static PyrSymbol* s_midiPolyTouchAction = nullptr;
static PyrSymbol* s_midiProgramAction = nullptr;
static PyrSymbol* s_midiBendAction = nullptr;
static PyrSymbol* s_midiSysexAction = nullptr;
static PyrSymbol* s_midiin = nullptr;

extern bool compiledOK;

#if !defined(SC_WASM_USE_OSCDATA)
static bool g_osc_initialized = false;
static int g_osc_port = 57120;
#endif

static void wasmWarnOnce(bool& gate, const char* message) {
    if (gate)
        return;
    gate = true;
    post("%s\n", message);
}

#ifndef SC_WASM_WASI
static emscripten::val getMidiBridge() {
    auto bridge = emscripten::val::module_property("__sc_wasm_midi_bridge");
    if (bridge.isUndefined() || bridge.isNull()) {
        return emscripten::val::undefined();
    }
    return bridge;
}

static int callMidiBridgeInt(const char* method) {
    try {
        auto bridge = getMidiBridge();
        if (bridge.isUndefined()) {
            return -1;
        }
        return bridge.call<int>(method);
    } catch (...) {
        return -1;
    }
}

template <typename... Args>
static int callMidiBridgeInt(const char* method, Args... args) {
    try {
        auto bridge = getMidiBridge();
        if (bridge.isUndefined()) {
            return -1;
        }
        return bridge.call<int>(method, args...);
    } catch (...) {
        return -1;
    }
}

static emscripten::val getUnixBridge() {
    auto bridge = emscripten::val::module_property("__sc_wasm_unix_bridge");
    if (bridge.isUndefined() || bridge.isNull()) {
        return emscripten::val::undefined();
    }
    return bridge;
}

static int mapUnixBridgeErrno(emscripten::val bridge) {
    if (bridge.isUndefined() || bridge.isNull()) {
        return ENOSYS;
    }
    try {
        int hostErr = bridge.call<int>("errno");
        return (hostErr >= 0) ? hostErr : EIO;
    } catch (...) {
        return EIO;
    }
}
#endif // !SC_WASM_WASI

static int failUnixBridgeUnavailable() {
    wasmWarnOnce(g_warned_unix_bridge_missing,
                 "WASM: Unix/process primitives require the CLI unix bridge; browser runtime remains unsupported.");
    g_wasm_unix_errno = ENOSYS;
    return errFailed;
}

// ============================================================================
// SCHEDULING STUBS (SCBase.h declares these with SCLANG_DLLEXPORT_C = extern "C")
// ============================================================================

extern "C" {
    void schedRun()     { g_sched_running = true; }
    void schedStop()    { g_sched_running = false; }
    void schedInit()    { g_sched_initialized = true; }
    void schedCleanup() { g_sched_initialized = false; g_sched_running = false; }
    void schedClear()   { g_sched_running = false; }
}

// addheap/getheap are C++ (declared in PyrSched.h without extern "C")
int64 ElapsedTimeToOSC(double elapsed) {
    constexpr double kSecondsToOSC = 4294967296.0;
    return static_cast<int64>(elapsed * kSecondsToOSC);
}

double OSCToElapsedTime(int64 oscTime) {
    constexpr double kOSCtoSecs = 2.328306436538696e-10;
    return static_cast<double>(oscTime) * kOSCtoSecs;
}

bool addheap(VMGlobals* g, PyrObject* heapArg, double schedtime, PyrSlot* task) {
    (void)g; (void)heapArg; (void)schedtime; (void)task;
    wasmWarnOnce(g_warned_sched_heap,
                 "WASM: scheduler heap enqueue is constrained and currently unavailable.");
    return false;
}

extern "C" int vpost(const char* fmt, va_list vargs) {
    char buf[1024];
    const int n = vsnprintf(buf, sizeof(buf), fmt, vargs);
    if (n > 0) {
        postText(buf, n);
    }
    return n;
}
bool getheap(VMGlobals* g, PyrObject* heapArg, double* outTime, PyrSlot* task) {
    (void)g; (void)heapArg; (void)outTime; (void)task;
    wasmWarnOnce(g_warned_sched_heap,
                 "WASM: scheduler heap dequeue is constrained and currently unavailable.");
    return false;
}

// ============================================================================
// OSC NETWORK STUBS (SCBase.h declares these with SCLANG_DLLEXPORT_C = extern "C")
// ============================================================================

#if !defined(SC_WASM_USE_OSCDATA)
extern "C" {
    void init_OSC(int port) {
        g_osc_initialized = true;
        g_osc_port = (port > 0) ? port : 57120;
        wasmWarnOnce(g_warned_osc_lifecycle,
                     "WASM: OSC lifecycle is constrained and routed through browser transport.");
    }

    void cleanup_OSC() {
        g_osc_initialized = false;
    }
}

// closeAllCustomPorts is declared locally in PyrLexer.cpp (C++ linkage)
void closeAllCustomPorts() {
    wasmWarnOnce(g_warned_custom_ports,
                 "WASM: closeAllCustomPorts is constrained in browser runtime.");
}
#endif

// PyrListPrim.cpp is included in the WASM build; no list/dictionary stubs here.

// ============================================================================
// PRIMITIVE INITIALIZATION STUBS
// ============================================================================

// Forward declarations for time primitive functions (defined below)
int prElapsedTime(struct VMGlobals* g, int numArgsPushed);
int prmonotonicClockTime(struct VMGlobals* g, int numArgsPushed);

static int prFileExists(struct VMGlobals* g, int numArgsPushed) {
    PyrSlot *a = g->sp - 1, *b = g->sp;
    char filename[PATH_MAX];

    int error = slotStrVal(b, filename, PATH_MAX);
    if (error != errNone)
        return error;

    const fs::path& p = SC_Codecvt::utf8_str_to_path(filename);
    std::error_code _ec;
    SetBool(a, fs::exists(p, _ec) && !_ec);
    return errNone;
}

static int prFileMkDir(struct VMGlobals* g, int numArgsPushed) {
    PyrSlot *a = g->sp - 1, *b = g->sp;
    char filename[PATH_MAX];

    int error = slotStrVal(b, filename, PATH_MAX);
    if (error != errNone)
        return error;

    const fs::path& p = SC_Codecvt::utf8_str_to_path(filename);
    std::error_code _ec;
    bool result = fs::create_directories(p, _ec);
    SetBool(a, result && !_ec);
    return errNone;
}

static int prSchedNoop(struct VMGlobals* g, int numArgsPushed) {
    (void)g;
    (void)numArgsPushed;
    return errNone;
}

static int prSchedReturnZero(struct VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    SetFloat(g->sp, 0.0);
    return errNone;
}

static int prSchedReturnOne(struct VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    SetFloat(g->sp, 1.0);
    return errNone;
}

static int prSchedConvertArg(struct VMGlobals* g, int numArgsPushed) {
    if (numArgsPushed < 2) {
        return errFailed;
    }
    double v;
    if (slotDoubleVal(g->sp, &v) != errNone) {
        return errWrongType;
    }
    SetFloat(g->sp - 1, v);
    return errNone;
}

static int prFileGetcwd(struct VMGlobals* g, int numArgsPushed) {
    PyrSlot* string = g->sp;

    if (!isKindOfSlot(string, class_string))
        return errWrongType;

    std::error_code _ec;
    std::string cwd = fs::current_path(_ec).generic_string();
    if (_ec) cwd = "/";
    strcpy(slotRawString(string)->s, cwd.c_str());
    slotRawString(string)->size = cwd.size();
    return errNone;
}

static int setSlotString(VMGlobals* g, PyrSlot* slot, const std::string& str) {
    PyrString* strobj = newPyrStringN(g->gc, static_cast<int>(str.size()), 0, true);
    if (!strobj) {
        return errFailed;
    }
    if (!str.empty()) {
        memcpy(strobj->s, str.data(), str.size());
    }
    SetObject(slot, strobj);
    return errNone;
}

static int pyrArrayToStringVector(PyrSlot* arraySlot, std::vector<std::string>& out) {
    if (NotObj(arraySlot))
        return errWrongType;

    PyrObject* argsColl = slotRawObject(arraySlot);
    if (!(slotRawInt(&argsColl->classptr->classFlags) & classHasIndexableInstances))
        return errNotAnIndexableObject;

    if (argsColl->size < 1)
        return errFailed;

    out.reserve(argsColl->size);
    for (int i = 0; i < argsColl->size; ++i) {
        auto [error, value] = slotStrStdStrVal(argsColl->slots + i);
        if (error != errNone) {
            return error;
        }
        out.push_back(std::move(value));
    }

    return errNone;
}

static int prString_System_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* a = g->sp;

    auto [error, command] = slotStrStdStrVal(a);
    if (error != errNone) {
        return error;
    }

#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        return failUnixBridgeUnavailable();
    }

    try {
        int exitCode = bridge.call<int>("system", command);
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        SetInt(a, exitCode);
        return errNone;
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        return errFailed;
    }
#else
    return failUnixBridgeUnavailable();
#endif
}

static int prString_Basename_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* a = g->sp;

    auto [error, pathValue] = slotStrStdStrVal(a);
    if (error != errNone) {
        return error;
    }

    const fs::path p = SC_Codecvt::utf8_str_to_path(pathValue);
    const auto base = p.filename().generic_string();
    return setSlotString(g, a, base);
}

static int prString_Dirname_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* a = g->sp;

    auto [error, pathValue] = slotStrStdStrVal(a);
    if (error != errNone) {
        return error;
    }

    const fs::path p = SC_Codecvt::utf8_str_to_path(pathValue);
    const auto dir = p.parent_path().generic_string();
    return setSlotString(g, a, dir.empty() ? std::string(".") : dir);
}

static int prString_POpen_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* callerSlot = g->sp - 1;
    PyrSlot* postOutputSlot = g->sp;

    auto [error, command] = slotStrStdStrVal(callerSlot);
    if (error != errNone) {
        return error;
    }

#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        return failUnixBridgeUnavailable();
    }

    try {
        int pid = bridge.call<int>("startCommand", command, IsTrue(postOutputSlot));
        if (pid <= 0) {
            g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
            return errFailed;
        }
        g_wasm_unix_errno = 0;
        SetInt(callerSlot, pid);
        return errNone;
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        return errFailed;
    }
#else
    (void)postOutputSlot;
    return failUnixBridgeUnavailable();
#endif
}

static int prArray_POpen_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* callerSlot = g->sp - 1;
    PyrSlot* postOutputSlot = g->sp;

    std::vector<std::string> args;
    int error = pyrArrayToStringVector(callerSlot, args);
    if (error != errNone) {
        return error;
    }

#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        return failUnixBridgeUnavailable();
    }

    try {
        emscripten::val jsArgs = emscripten::val::array();
        for (const auto& arg : args) {
            jsArgs.call<void>("push", emscripten::val(arg));
        }

        int pid = bridge.call<int>("startArgvCommand", jsArgs, IsTrue(postOutputSlot));
        if (pid <= 0) {
            g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
            return errFailed;
        }
        g_wasm_unix_errno = 0;
        SetInt(callerSlot, pid);
        return errNone;
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        return errFailed;
    }
#else
    (void)postOutputSlot;
    return failUnixBridgeUnavailable();
#endif
}

static int prString_UnixCmdGetStdOut_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* callerSlot = g->sp - 1;

    auto [error, command] = slotStrStdStrVal(callerSlot);
    if (error != errNone) {
        return error;
    }

#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        return failUnixBridgeUnavailable();
    }

    try {
        emscripten::val result = bridge.call<emscripten::val>("runCommandCapture", command);
        if (result.isUndefined() || result.isNull()) {
            g_wasm_unix_errno = EIO;
            return errFailed;
        }

        bool ok = false;
        if (!result["ok"].isUndefined() && !result["ok"].isNull()) {
            ok = result["ok"].as<bool>();
        }

        int reportedErrno = 0;
        if (!result["errno"].isUndefined() && !result["errno"].isNull()) {
            reportedErrno = result["errno"].as<int>();
        }

        if (!ok) {
            g_wasm_unix_errno = (reportedErrno > 0) ? reportedErrno : mapUnixBridgeErrno(bridge);
            return errFailed;
        }

        std::string stdoutText;
        if (!result["stdout"].isUndefined() && !result["stdout"].isNull()) {
            stdoutText = result["stdout"].as<std::string>();
        }

        g_wasm_unix_errno = 0;
        return setSlotString(g, callerSlot, stdoutText);
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        return errFailed;
    }
#else
    return failUnixBridgeUnavailable();
#endif
}

static int prArray_UnixCmdGetStdOut_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* callerSlot = g->sp - 1;

    std::vector<std::string> args;
    int error = pyrArrayToStringVector(callerSlot, args);
    if (error != errNone) {
        return error;
    }

#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        return failUnixBridgeUnavailable();
    }

    try {
        emscripten::val jsArgs = emscripten::val::array();
        for (const auto& arg : args) {
            jsArgs.call<void>("push", emscripten::val(arg));
        }

        emscripten::val result = bridge.call<emscripten::val>("runArgvCommandCapture", jsArgs);
        if (result.isUndefined() || result.isNull()) {
            g_wasm_unix_errno = EIO;
            return errFailed;
        }

        bool ok = false;
        if (!result["ok"].isUndefined() && !result["ok"].isNull()) {
            ok = result["ok"].as<bool>();
        }

        int reportedErrno = 0;
        if (!result["errno"].isUndefined() && !result["errno"].isNull()) {
            reportedErrno = result["errno"].as<int>();
        }

        if (!ok) {
            g_wasm_unix_errno = (reportedErrno > 0) ? reportedErrno : mapUnixBridgeErrno(bridge);
            return errFailed;
        }

        std::string stdoutText;
        if (!result["stdout"].isUndefined() && !result["stdout"].isNull()) {
            stdoutText = result["stdout"].as<std::string>();
        }

        g_wasm_unix_errno = 0;
        return setSlotString(g, callerSlot, stdoutText);
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        return errFailed;
    }
#else
    return failUnixBridgeUnavailable();
#endif
}

// ============================================================================
// PIPE PRIMITIVES (for Pipe.callSync compatibility)
// ============================================================================

static int prPipeOpen_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* callerSlot = g->sp - 1;
    PyrSlot* postOutputSlot = g->sp;

    auto [error, command] = slotStrStdStrVal(callerSlot);
    if (error != errNone) {
        return error;
    }

    int slot = allocPipeBuffer();
    if (!slot) {
        g_wasm_unix_errno = ENFILE; // Too many open pipes
        return errFailed;
    }

#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        freePipeBuffer(slot);
        return failUnixBridgeUnavailable();
    }

    try {
        emscripten::val result = bridge.call<emscripten::val>("runCommandCapture", command);
        if (result.isUndefined() || result.isNull()) {
            g_wasm_unix_errno = EIO;
            freePipeBuffer(slot);
            return errFailed;
        }

        bool ok = false;
        if (!result["ok"].isUndefined() && !result["ok"].isNull()) {
            ok = result["ok"].as<bool>();
        }

        int reportedErrno = 0;
        if (!result["errno"].isUndefined() && !result["errno"].isNull()) {
            reportedErrno = result["errno"].as<int>();
        }

        if (!ok) {
            g_wasm_unix_errno = (reportedErrno > 0) ? reportedErrno : mapUnixBridgeErrno(bridge);
            freePipeBuffer(slot);
            return errFailed;
        }

        std::string stdoutText;
        if (!result["stdout"].isUndefined() && !result["stdout"].isNull()) {
            stdoutText = result["stdout"].as<std::string>();
        }

        WasmPipeBuffer* buffer = &g_pipe_buffers[slot - 1];
        buffer->output = stdoutText;
        buffer->pos = 0;

        g_wasm_unix_errno = 0;
        SetInt(callerSlot, slot);
        return errNone;
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        freePipeBuffer(slot);
        return errFailed;
    }
#else
    // WASI path: use hc_host_exec_capture
    // Allocate a temporary buffer for host capture
    constexpr size_t kCaptureBufferSize = 65536;
    static char capture_buffer[kCaptureBufferSize];
    int32_t bytes_written = 0;
    
    int32_t exit_code = hc_host_exec_capture(command.c_str(), (int32_t)command.size(),
                                               capture_buffer, (int32_t)kCaptureBufferSize,
                                               &bytes_written);
    
    if (exit_code != 0) {
        g_wasm_unix_errno = EIO;
        freePipeBuffer(slot);
        return errFailed;
    }

    WasmPipeBuffer* buffer = &g_pipe_buffers[slot - 1];
    buffer->output.assign(capture_buffer, bytes_written);
    buffer->pos = 0;

    g_wasm_unix_errno = 0;
    SetInt(callerSlot, slot);
    return errNone;
#endif
}

static int prFile_GetLine_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* callerSlot = g->sp - 1;
    PyrSlot* resultSlot = g->sp;

    int slot = 0;
    if (slotIntVal(callerSlot, &slot) != errNone) {
        return errWrongType;
    }

    WasmPipeBuffer* buffer = getPipeBuffer(slot);
    if (!buffer) {
        g_wasm_unix_errno = EBADF; // Bad file descriptor
        return errFailed;
    }

    if (buffer->pos >= buffer->output.size()) {
        // EOF - return empty string
        g_wasm_unix_errno = 0;
        return setSlotString(g, resultSlot, "");
    }

    // Find the next newline
    size_t start = buffer->pos;
    size_t end = buffer->output.find('\n', start);
    if (end == std::string::npos) {
        end = buffer->output.size();
    }

    std::string line = buffer->output.substr(start, end - start);
    // Strip trailing \r if present (for \r\n line endings)
    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }
    buffer->pos = end + 1; // Move past the newline

    g_wasm_unix_errno = 0;
    return setSlotString(g, resultSlot, line);
}

static int prPipeClose_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* a = g->sp;

    int slot = 0;
    if (slotIntVal(a, &slot) != errNone) {
        return errWrongType;
    }

    freePipeBuffer(slot);
    g_wasm_unix_errno = 0;
    return errNone;
}

static int prPidRunning_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* a = g->sp;
    int pid = 0;
    if (slotIntVal(a, &pid) != errNone) {
        return errWrongType;
    }

#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        return failUnixBridgeUnavailable();
    }

    try {
        bool alive = bridge.call<bool>("pidRunning", pid);
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        SetBool(a, alive);
        return errNone;
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        return errFailed;
    }
#else
    SetBool(a, false);
    return errNone;
#endif
}

static int prGetPid_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    PyrSlot* a = g->sp;
#ifndef SC_WASM_WASI
    auto bridge = getUnixBridge();
    if (bridge.isUndefined()) {
        return failUnixBridgeUnavailable();
    }

    try {
        int pid = bridge.call<int>("getPid");
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        SetInt(a, pid);
        return errNone;
    } catch (...) {
        g_wasm_unix_errno = mapUnixBridgeErrno(bridge);
        return errFailed;
    }
#else
    SetInt(a, 0);
    return errNone;
#endif
}

static int prUnix_Errno_Wasm(VMGlobals* g, int numArgsPushed) {
    (void)numArgsPushed;
    SetInt(g->sp, g_wasm_unix_errno);
    return errNone;
}

#if !defined(SC_WASM_USE_OSCDATA)
static int prGetHostByName(struct VMGlobals* g, int numArgsPushed) {
    PyrSlot* a = g->sp;
    char hostname[256];

    int err = slotStrVal(a, hostname, 255);
    if (err)
        return err;

    // Explicit WASM network model: loopback-only plus numeric IPv4 parsing.
    if (strcmp(hostname, "localhost") == 0 || strcmp(hostname, "127.0.0.1") == 0) {
        SetInt(a, 2130706433); // 127.0.0.1 in host-order integer form
        return errNone;
    }

    int p1, p2, p3, p4;
    if (sscanf(hostname, "%d.%d.%d.%d", &p1, &p2, &p3, &p4) == 4
        && (p1 >= 0 && p1 <= 255)
        && (p2 >= 0 && p2 <= 255)
        && (p3 >= 0 && p3 <= 255)
        && (p4 >= 0 && p4 <= 255)) {
        SetInt(a, (p1 << 24) | (p2 << 16) | (p3 << 8) | p4);
        return errNone;
    }

    return errFailed;
}

static int prGetLangPort(VMGlobals* g, int numArgsPushed) {
    SetInt(g->sp, g_osc_port);
    return errNone;
}

static int prLocalIPs(VMGlobals* g, int numArgsPushed) {
    PyrSlot* a = g->sp;
    int addressFamily = AF_UNSPEC;
    if (IsSym(a)) {
        PyrSymbol* sym = slotRawSymbol(a);
        if (strcmp(sym->name, "ipv4") == 0) {
            addressFamily = AF_INET;
        } else if (strcmp(sym->name, "ipv6") == 0) {
            addressFamily = AF_INET6;
        } else if (strcmp(sym->name, "all") != 0) {
            error("ignoring unknown option %s\n", sym->name);
        }
    } else if (NotNil(a)) {
        return errWrongType;
    }

    int count = (addressFamily == AF_INET6) ? 0 : 1;
    PyrObject* array = newPyrArray(g->gc, count, 0, true);
    if (count == 1) {
        PyrString* ip = newPyrString(g->gc, "127.0.0.1", 0, true);
        SetObject(array->slots, (PyrObjectHdr*)ip);
    }
    array->size = count;
    SetObject(g->sp - 1, (PyrObjectHdr*)array);
    return errNone;
}

static int prLocalIP(VMGlobals* g, int numArgsPushed) {
    PyrSlot* a = g->sp;
    if (NotNil(a)) {
        char addr[64];
        if (slotStrVal(a, addr, 64) != errNone)
            return errWrongType;
        if (strcmp(addr, "127.0.0.1") != 0 && strcmp(addr, "localhost") != 0)
            return errFailed;
    }

    PyrString* ip = newPyrString(g->gc, "127.0.0.1", 0, true);
    SetObject(g->sp - 1, (PyrObjectHdr*)ip);
    return errNone;
}
#endif

void initFilePrimitives() {
    int base, index = 0;
    base = nextPrimitiveIndex();

    // Minimal file primitives needed by class startup paths in WASM.
    definePrimitive(base, index++, "_FileExists", prFileExists, 2, 0);
    definePrimitive(base, index++, "_FileMkDir", prFileMkDir, 2, 0);
    definePrimitive(base, index++, "_File_getcwd", prFileGetcwd, 2, 0);
}
// Primitive implementation for _HcWasmQuarksAvailable (Shared follow-up)
// Dispatches to hc_wasm_quarks_available() which checks platform-specific support.
static int prHcWasmQuarksAvailable(VMGlobals* g, int numArgsPushed) {
    (void)g; (void)numArgsPushed;
    int available = hc_wasm_quarks_available();
    SetInt(g->sp, available);
    return errNone;
}

void initUnixPrimitives()     {
    wasmWarnOnce(g_warned_unix_prims,
                 "WASM: Unix primitives are CLI-bridge backed; browser runtime remains explicitly unsupported.");

    s_unixCmdAction = getsym("doUnixCmdAction");

    int base = nextPrimitiveIndex();
    int index = 0;
    definePrimitive(base, index++, "_HcWasmQuarksAvailable", prHcWasmQuarksAvailable, 1, 0);
    definePrimitive(base, index++, "_String_System", prString_System_Wasm, 1, 0);
    definePrimitive(base, index++, "_String_Basename", prString_Basename_Wasm, 1, 0);
    definePrimitive(base, index++, "_String_Dirname", prString_Dirname_Wasm, 1, 0);
    definePrimitive(base, index++, "_String_POpen", prString_POpen_Wasm, 2, 0);
    definePrimitive(base, index++, "_Unix_Errno", prUnix_Errno_Wasm, 1, 0);
    definePrimitive(base, index++, "_ArrayPOpen", prArray_POpen_Wasm, 2, 0);
    definePrimitive(base, index++, "_String_UnixCmdGetStdOutWasm", prString_UnixCmdGetStdOut_Wasm, 2, 0);
    definePrimitive(base, index++, "_Array_UnixCmdGetStdOutWasm", prArray_UnixCmdGetStdOut_Wasm, 2, 0);
    definePrimitive(base, index++, "_PidRunning", prPidRunning_Wasm, 1, 0);
    definePrimitive(base, index++, "_GetPid", prGetPid_Wasm, 1, 0);
    // Pipe primitives for Pipe.callSync compatibility
    definePrimitive(base, index++, "_PipeOpen", prPipeOpen_Wasm, 2, 0);
    definePrimitive(base, index++, "_FileReadLine", prFile_GetLine_Wasm, 2, 0);
    definePrimitive(base, index++, "_PipeClose", prPipeClose_Wasm, 1, 0);
}
#if !defined(SC_WASM_USE_OSCDATA)
void init_OSC_primitives()    {
    int base, index = 0;
    base = nextPrimitiveIndex();

    definePrimitive(base, index++, "_GetHostByName", prGetHostByName, 1, 0);
    definePrimitive(base, index++, "_GetLangPort", prGetLangPort, 1, 0);
    definePrimitive(base, index++, "_LocalIPs", prLocalIPs, 2, 0);
    definePrimitive(base, index++, "_LocalIP", prLocalIP, 2, 0);
}
#endif
void initGUIPrimitives()      {
    wasmWarnOnce(g_warned_gui_prims,
                 "WASM: GUI primitives are unavailable; browser IDE handles UI externally.");
}
void initSchedPrimitives() {
    // WASM: Register clock primitive names with non-threaded stubs.
    int base, index = 0;
    base = nextPrimitiveIndex();
    definePrimitive(base, index++, "_TempoClock_New", prSchedNoop, 4, 0);
    definePrimitive(base, index++, "_TempoClock_Free", prSchedNoop, 1, 0);
    definePrimitive(base, index++, "_TempoClock_Clear", prSchedNoop, 1, 0);
    definePrimitive(base, index++, "_TempoClock_Dump", prSchedNoop, 1, 0);
    definePrimitive(base, index++, "_TempoClock_Sched", prSchedNoop, 3, 0);
    definePrimitive(base, index++, "_TempoClock_SchedAbs", prSchedNoop, 3, 0);
    definePrimitive(base, index++, "_TempoClock_Tempo", prSchedReturnOne, 1, 0);
    definePrimitive(base, index++, "_TempoClock_BeatDur", prSchedReturnOne, 1, 0);
    definePrimitive(base, index++, "_TempoClock_ElapsedBeats", prSchedReturnZero, 1, 0);
    definePrimitive(base, index++, "_TempoClock_Beats", prSchedReturnZero, 1, 0);
    definePrimitive(base, index++, "_TempoClock_SetBeats", prSchedNoop, 2, 0);
    definePrimitive(base, index++, "_TempoClock_SetTempoAtBeat", prSchedNoop, 3, 0);
    definePrimitive(base, index++, "_TempoClock_SetTempoAtTime", prSchedNoop, 3, 0);
    definePrimitive(base, index++, "_TempoClock_SetAll", prSchedNoop, 4, 0);
    definePrimitive(base, index++, "_TempoClock_BeatsToSecs", prSchedConvertArg, 2, 0);
    definePrimitive(base, index++, "_TempoClock_SecsToBeats", prSchedConvertArg, 2, 0);
    definePrimitive(base, index++, "_SystemClock_Clear", prSchedNoop, 1, 0);
    definePrimitive(base, index++, "_SystemClock_Sched", prSchedNoop, 3, 0);
    definePrimitive(base, index++, "_SystemClock_SchedAbs", prSchedNoop, 3, 0);
    definePrimitive(base, index++, "_ElapsedTime", prElapsedTime, 1, 0);
    definePrimitive(base, index++, "_monotonicClockTime", prmonotonicClockTime, 1, 0);
}
void initSerialPrimitives()   {
    wasmWarnOnce(g_warned_serial_prims,
                 "WASM: Serial/HID primitives are unavailable in browser builds.");

    int base = nextPrimitiveIndex();
    int index = 0;

    s_midiin = getsym("MIDIIn");
    s_midiNoteOnAction = getsym("doNoteOnAction");
    s_midiNoteOffAction = getsym("doNoteOffAction");
    s_midiTouchAction = getsym("doTouchAction");
    s_midiControlAction = getsym("doControlAction");
    s_midiPolyTouchAction = getsym("doPolyTouchAction");
    s_midiProgramAction = getsym("doProgramAction");
    s_midiBendAction = getsym("doBendAction");
    s_midiSysexAction = getsym("doSysexAction");

#ifndef SC_WASM_WASI
    auto prListMIDIEndpoints = [](VMGlobals* g, int numArgsPushed) -> int {
        (void)numArgsPushed;

        auto bridge = getMidiBridge();
        if (bridge.isUndefined()) {
            wasmWarnOnce(g_warned_midi_prims,
                         "WASM: MIDI bridge unavailable (install CLI MIDI provider, e.g. npm package 'midi').");
        }

        int numSrc = 0;
        int numDst = 0;
        emscripten::val sources = emscripten::val::array();
        emscripten::val destinations = emscripten::val::array();

        if (!bridge.isUndefined()) {
            try {
                emscripten::val listed = bridge.call<emscripten::val>("listEndpoints");
                if (!listed.isUndefined() && !listed.isNull()) {
                    sources = listed["sources"];
                    destinations = listed["destinations"];
                    if (!sources.isUndefined() && !sources.isNull()) {
                        numSrc = sources["length"].as<int>();
                    }
                    if (!destinations.isUndefined() && !destinations.isNull()) {
                        numDst = destinations["length"].as<int>();
                    }
                }
            } catch (...) {
                numSrc = 0;
                numDst = 0;
                sources = emscripten::val::array();
                destinations = emscripten::val::array();
            }
        }

        PyrSlot* a = g->sp;
        PyrObject* idarray = newPyrArray(g->gc, 6 * sizeof(PyrObject), 0, true);
        SetObject(a, idarray);

        PyrObject* idarraySo = newPyrArray(g->gc, numSrc * sizeof(int32_t), 0, true);
        SetObject(idarray->slots + idarray->size++, idarraySo);
        g->gc->GCWriteNew(idarray, idarraySo);

        PyrObject* devarraySo = newPyrArray(g->gc, numSrc * sizeof(PyrObject), 0, true);
        SetObject(idarray->slots + idarray->size++, devarraySo);
        g->gc->GCWriteNew(idarray, devarraySo);

        PyrObject* namearraySo = newPyrArray(g->gc, numSrc * sizeof(PyrObject), 0, true);
        SetObject(idarray->slots + idarray->size++, namearraySo);
        g->gc->GCWriteNew(idarray, namearraySo);

        PyrObject* idarrayDe = newPyrArray(g->gc, numDst * sizeof(int32_t), 0, true);
        SetObject(idarray->slots + idarray->size++, idarrayDe);
        g->gc->GCWriteNew(idarray, idarrayDe);

        PyrObject* namearrayDe = newPyrArray(g->gc, numDst * sizeof(PyrObject), 0, true);
        SetObject(idarray->slots + idarray->size++, namearrayDe);
        g->gc->GCWriteNew(idarray, namearrayDe);

        PyrObject* devarrayDe = newPyrArray(g->gc, numDst * sizeof(PyrObject), 0, true);
        SetObject(idarray->slots + idarray->size++, devarrayDe);
        g->gc->GCWriteNew(idarray, devarrayDe);

        for (int i = 0; i < numSrc; ++i) {
            int uid = i;
            std::string name = "input-" + std::to_string(i);
            std::string device = name;
            try {
                emscripten::val ep = sources[i];
                if (!ep.isUndefined() && !ep.isNull()) {
                    if (!ep["id"].isUndefined() && !ep["id"].isNull()) {
                        uid = ep["id"].as<int>();
                    }
                    if (!ep["name"].isUndefined() && !ep["name"].isNull()) {
                        name = ep["name"].as<std::string>();
                    }
                    if (!ep["device"].isUndefined() && !ep["device"].isNull()) {
                        device = ep["device"].as<std::string>();
                    }
                }
            } catch (...) {
                // Keep defaults if bridge payload is malformed.
            }

            PyrString* nameStr = newPyrString(g->gc, name.c_str(), 0, true);
            SetObject(namearraySo->slots + namearraySo->size++, nameStr);
            g->gc->GCWriteNew(namearraySo, (PyrObject*)nameStr);

            PyrString* devStr = newPyrString(g->gc, device.c_str(), 0, true);
            SetObject(devarraySo->slots + devarraySo->size++, devStr);
            g->gc->GCWriteNew(devarraySo, (PyrObject*)devStr);

            SetInt(idarraySo->slots + idarraySo->size++, uid);
        }

        for (int i = 0; i < numDst; ++i) {
            int uid = i;
            std::string name = "output-" + std::to_string(i);
            std::string device = name;
            try {
                emscripten::val ep = destinations[i];
                if (!ep.isUndefined() && !ep.isNull()) {
                    if (!ep["id"].isUndefined() && !ep["id"].isNull()) {
                        uid = ep["id"].as<int>();
                    }
                    if (!ep["name"].isUndefined() && !ep["name"].isNull()) {
                        name = ep["name"].as<std::string>();
                    }
                    if (!ep["device"].isUndefined() && !ep["device"].isNull()) {
                        device = ep["device"].as<std::string>();
                    }
                }
            } catch (...) {
                // Keep defaults if bridge payload is malformed.
            }

            PyrString* nameStr = newPyrString(g->gc, name.c_str(), 0, true);
            SetObject(namearrayDe->slots + namearrayDe->size++, nameStr);
            g->gc->GCWriteNew(namearrayDe, (PyrObject*)nameStr);

            PyrString* devStr = newPyrString(g->gc, device.c_str(), 0, true);
            SetObject(devarrayDe->slots + devarrayDe->size++, devStr);
            g->gc->GCWriteNew(devarrayDe, (PyrObject*)devStr);

            SetInt(idarrayDe->slots + idarrayDe->size++, uid);
        }

        return errNone;
    };

    auto prInitMIDI = [](VMGlobals* g, int numArgsPushed) -> int {
        int numIn = 0;
        int numOut = 0;
        if (slotIntVal(g->sp - 1, &numIn) != errNone) return errWrongType;
        if (slotIntVal(g->sp, &numOut) != errNone) return errWrongType;
        return callMidiBridgeInt("init", numIn, numOut) == 0 ? errNone : errFailed;
    };

    auto prInitMIDIClient = [](VMGlobals* g, int numArgsPushed) -> int {
        (void)g; (void)numArgsPushed;
        return callMidiBridgeInt("initClient") == 0 ? errNone : errFailed;
    };

    auto prConnectMIDIIn = [](VMGlobals* g, int numArgsPushed) -> int {
        int inport = 0;
        int uid = 0;
        if (slotIntVal(g->sp - 1, &inport) != errNone) return errWrongType;
        if (slotIntVal(g->sp, &uid) != errNone) return errWrongType;
        return callMidiBridgeInt("connectInput", inport, uid) == 0 ? errNone : errFailed;
    };

    auto prDisconnectMIDIIn = [](VMGlobals* g, int numArgsPushed) -> int {
        int inport = 0;
        int uid = 0;
        if (slotIntVal(g->sp - 1, &inport) != errNone) return errWrongType;
        if (slotIntVal(g->sp, &uid) != errNone) return errWrongType;
        return callMidiBridgeInt("disconnectInput", inport, uid) == 0 ? errNone : errFailed;
    };

    auto prDisposeMIDIClient = [](VMGlobals* g, int numArgsPushed) -> int {
        (void)g; (void)numArgsPushed;
        callMidiBridgeInt("disposeClient");
        return errNone;
    };

    auto prRestartMIDI = [](VMGlobals* g, int numArgsPushed) -> int {
        (void)g; (void)numArgsPushed;
        return callMidiBridgeInt("restart") == 0 ? errNone : errFailed;
    };

    auto prSendMIDIOut = [](VMGlobals* g, int numArgsPushed) -> int {
        int outport = 0;
        int uid = 0;
        int length = 0;
        int hiStatus = 0;
        int loStatus = 0;
        int aval = 0;
        int bval = 0;
        float late = 0.0f;

        if (slotIntVal(g->sp - 7, &outport) != errNone) return errWrongType;
        if (slotIntVal(g->sp - 6, &uid) != errNone) return errWrongType;
        if (slotIntVal(g->sp - 5, &length) != errNone) return errWrongType;
        if (slotIntVal(g->sp - 4, &hiStatus) != errNone) return errWrongType;
        if (slotIntVal(g->sp - 3, &loStatus) != errNone) return errWrongType;
        if (slotIntVal(g->sp - 2, &aval) != errNone) return errWrongType;
        if (slotIntVal(g->sp - 1, &bval) != errNone) return errWrongType;
        if (slotFloatVal(g->sp, &late) != errNone) return errWrongType;

        (void)outport;
        return callMidiBridgeInt("sendShort", uid, length, hiStatus, loStatus, aval, bval, late) == 0
            ? errNone
            : errFailed;
    };

    auto prSendSysex = [](VMGlobals* g, int numArgsPushed) -> int {
        PyrSlot* args = g->sp - 2;
        int uid = 0;
        if (slotIntVal(&args[1], &uid) != errNone) return errWrongType;
        if (!isKindOfSlot(&args[2], s_int8array->u.classobj)) return errWrongType;

        PyrInt8Array* packet = slotRawInt8Array(&args[2]);
        const int ptr = (int)(uintptr_t)packet->b;
        const int len = (int)packet->size;
        return callMidiBridgeInt("sendSysexFromHeap", uid, ptr, len) == 0 ? errNone : errFailed;
    };

    definePrimitive(base, index++, "_ListMIDIEndpoints", prListMIDIEndpoints, 1, 0);
    definePrimitive(base, index++, "_InitMIDI", prInitMIDI, 3, 0);
    definePrimitive(base, index++, "_InitMIDIClient", prInitMIDIClient, 1, 0);
    definePrimitive(base, index++, "_ConnectMIDIIn", prConnectMIDIIn, 3, 0);
    definePrimitive(base, index++, "_DisconnectMIDIIn", prDisconnectMIDIIn, 3, 0);
    definePrimitive(base, index++, "_DisposeMIDIClient", prDisposeMIDIClient, 1, 0);
    definePrimitive(base, index++, "_RestartMIDI", prRestartMIDI, 1, 0);
    definePrimitive(base, index++, "_SendMIDIOut", prSendMIDIOut, 9, 0);
    definePrimitive(base, index++, "_SendSysex", prSendSysex, 3, 0);
#else
    // WASI mode: MIDI bridge is unavailable; register no-op stubs so the
    // class library compiles and the primitives exist but are non-functional.
    auto prMidiNoop = [](VMGlobals* g, int n) -> int { (void)g; (void)n; return errNone; };
    auto prMidiFail = [](VMGlobals* g, int n) -> int { (void)g; (void)n; return errFailed; };

    definePrimitive(base, index++, "_ListMIDIEndpoints", prMidiFail, 1, 0);
    definePrimitive(base, index++, "_InitMIDI", prMidiNoop, 3, 0);
    definePrimitive(base, index++, "_InitMIDIClient", prMidiNoop, 1, 0);
    definePrimitive(base, index++, "_ConnectMIDIIn", prMidiNoop, 3, 0);
    definePrimitive(base, index++, "_DisconnectMIDIIn", prMidiNoop, 3, 0);
    definePrimitive(base, index++, "_DisposeMIDIClient", prMidiNoop, 1, 0);
    definePrimitive(base, index++, "_RestartMIDI", prMidiNoop, 1, 0);
    definePrimitive(base, index++, "_SendMIDIOut", prMidiNoop, 9, 0);
    definePrimitive(base, index++, "_SendSysex", prMidiNoop, 3, 0);
#endif // !SC_WASM_WASI
}

extern "C" int sc_wasm_midi_receive_short(int src, int status, int data1, int data2) {
    if (!compiledOK || !gMainVMGlobals || !s_midiin) {
        return -1;
    }

    VMGlobals* g = gMainVMGlobals;
    gLangMutex.lock();
    if (!compiledOK) {
        gLangMutex.unlock();
        return -1;
    }

    ++g->sp;
    SetObject(g->sp, s_midiin->u.classobj);
    ++g->sp;
    SetInt(g->sp, src);

    const int chan = status & 0x0F;
    const int kind = status & 0xF0;

    switch (kind) {
    case 0x80:
        ++g->sp; SetInt(g->sp, chan);
        ++g->sp; SetInt(g->sp, data1 & 0x7F);
        ++g->sp; SetInt(g->sp, data2 & 0x7F);
        runInterpreter(g, s_midiNoteOffAction, 5);
        break;
    case 0x90:
        ++g->sp; SetInt(g->sp, chan);
        ++g->sp; SetInt(g->sp, data1 & 0x7F);
        ++g->sp; SetInt(g->sp, data2 & 0x7F);
        runInterpreter(g, s_midiNoteOnAction, 5);
        break;
    case 0xA0:
        ++g->sp; SetInt(g->sp, chan);
        ++g->sp; SetInt(g->sp, data1 & 0x7F);
        ++g->sp; SetInt(g->sp, data2 & 0x7F);
        runInterpreter(g, s_midiPolyTouchAction, 5);
        break;
    case 0xB0:
        ++g->sp; SetInt(g->sp, chan);
        ++g->sp; SetInt(g->sp, data1 & 0x7F);
        ++g->sp; SetInt(g->sp, data2 & 0x7F);
        runInterpreter(g, s_midiControlAction, 5);
        break;
    case 0xC0:
        ++g->sp; SetInt(g->sp, chan);
        ++g->sp; SetInt(g->sp, data1 & 0x7F);
        runInterpreter(g, s_midiProgramAction, 4);
        break;
    case 0xD0:
        ++g->sp; SetInt(g->sp, chan);
        ++g->sp; SetInt(g->sp, data1 & 0x7F);
        runInterpreter(g, s_midiTouchAction, 4);
        break;
    case 0xE0:
        ++g->sp; SetInt(g->sp, chan);
        ++g->sp; SetInt(g->sp, ((data2 & 0x7F) << 7) | (data1 & 0x7F));
        runInterpreter(g, s_midiBendAction, 4);
        break;
    default:
        g->sp -= 2;
        break;
    }

    gLangMutex.unlock();
    return 0;
}

extern "C" int sc_wasm_midi_receive_sysex(int src, int dataPtr, int dataLen) {
    if (!compiledOK || !gMainVMGlobals || !s_midiin || !s_midiSysexAction || dataPtr <= 0 || dataLen <= 0) {
        return -1;
    }

    VMGlobals* g = gMainVMGlobals;
    uint8_t* bytes = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(dataPtr));

    gLangMutex.lock();
    if (!compiledOK) {
        gLangMutex.unlock();
        return -1;
    }

    ++g->sp;
    SetObject(g->sp, s_midiin->u.classobj);
    ++g->sp;
    SetInt(g->sp, src);
    ++g->sp;
    PyrInt8Array* sysexArray = newPyrInt8Array(g->gc, dataLen, 0, true);
    sysexArray->size = dataLen;
    memcpy(sysexArray->b, bytes, dataLen);
    SetObject(g->sp, (PyrObject*)sysexArray);
    runInterpreter(g, s_midiSysexAction, 3);

    gLangMutex.unlock();
    return 0;
}

extern "C" int sc_wasm_unix_command_complete(int pid, int exitCode, int postOutput, int outputPtr, int outputLen) {
    if (postOutput != 0 && outputPtr > 0 && outputLen > 0) {
        const char* output = reinterpret_cast<const char*>(static_cast<uintptr_t>(outputPtr));
        postText(output, outputLen);
    }

    if (!compiledOK || !gMainVMGlobals || !s_unixCmdAction) {
        return -1;
    }

    VMGlobals* g = gMainVMGlobals;
    gLangMutex.lock();
    if (compiledOK) {
        ++g->sp;
        SetObject(g->sp, class_string);
        ++g->sp;
        SetInt(g->sp, exitCode);
        ++g->sp;
        SetInt(g->sp, pid);
        runInterpreter(g, s_unixCmdAction, 3);
    }
    gLangMutex.unlock();

    return 0;
}

// ============================================================================
// GUI / RENDERING STUBS
// ============================================================================

void closeAllGUIScreens() {
    wasmWarnOnce(g_warned_close_gui,
                 "WASM: closeAllGUIScreens is delegated to browser UI lifecycle.");
}

// ============================================================================
// CLOCK STUBS
// ============================================================================

void TempoClock_stopAll() {
    g_sched_running = false;
}

// ============================================================================
// TIME
// ============================================================================

double elapsedTime() { return sc_wasm_get_now(); }
double monotonicClockTime() { return sc_wasm_get_now(); }

// ============================================================================
// TIME PRIMITIVES (for Main:startup which calls elapsedTime)
// ============================================================================

int prElapsedTime(struct VMGlobals* g, int numArgsPushed) {
    SetFloat(g->sp, elapsedTime());
    return errNone;
}

int prmonotonicClockTime(struct VMGlobals* g, int numArgsPushed) {
    SetFloat(g->sp, monotonicClockTime());
    return errNone;
}

// initPatterns() and arrayAtIdentityHashInPairs() come from PyrListPrim.cpp.

// SystemClock processing hook — called from JS event loop.
// PyrSched.cpp is excluded from WASM builds so this is a no-op stub.
extern "C" void sc_wasm_process_system_clock_tasks(void) {}

#endif // SC_WASM
