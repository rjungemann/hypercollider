/*
 * HC_Wasm_Sclang.cpp
 * SuperCollider Language - WASM Emscripten Bindings
 *
 * Exposes sclang evaluation API to JavaScript via Emscripten bindings.
 * Allows browser IDE to evaluate SuperCollider code.
 *
 * Phase 7.2: sclang WASM Implementation
 */

#ifdef SC_WASM

#include <emscripten.h>
#include <emscripten/bind.h>
#include <string>
#include <cstring>

// Include our evaluation header
#include "HC_Wasm_Eval.h"

// Forward declarations - these would be from the main interpreter
// TODO: Link against actual sclang interpreter when available
extern "C" {
    // Main interpreter context (would come from PyrInterpreter3.cpp)
    struct VMGlobals;
    extern VMGlobals *g_vmglobals;
}

/*
 * ============================================================================
 * JAVASCRIPT BINDINGS FOR SCLANG EVALUATION
 * ============================================================================
 * These provide the JavaScript API for evaluating SuperCollider code
 * from the browser IDE.
 */

class SclangEvaluator {
public:
    SclangEvaluator() : initialized_(false) {}
    
    /**
     * Initialize the sclang interpreter
     * Called once at startup
     */
    std::string init() {
        if (initialized_) {
            return "sclang already initialized";
        }
        
        // Call the C API init function
        int result = hc_wasm_eval_init();
        if (result != 0) {
            return "ERROR: Failed to initialize sclang WASM";
        }
        
        initialized_ = true;
        return "sclang initialized";
    }
    
    /**
     * Boot the sclang interpreter (load class library, etc.)
     * Called after init to fully prepare the interpreter
     */
    std::string boot() {
        if (!initialized_) {
            return "ERROR: sclang not initialized. Call init() first.";
        }
        
        // Call the C API boot function
        int result = hc_wasm_eval_boot();
        if (result != 0) {
            return "ERROR: Failed to boot sclang WASM";
        }
        
        return "sclang booted";
    }
    
    /**
     * Evaluate a SuperCollider expression
     * Returns the result as a string (for now)
     * 
     * @param code The SuperCollider code to evaluate
     * @return Result string (would be extended to include type info)
     */
    std::string eval(const std::string& code) {
        if (!initialized_) {
            return "ERROR: sclang not initialized. Call init() first.";
        }
        
        if (code.empty()) {
            return "";
        }
        
        // Call the C API eval function
        const char* result_cstr = hc_wasm_eval_string(code.c_str(), code.size());
        if (result_cstr) {
            return std::string(result_cstr);
        }
        return "";
    }
    
    /**
     * Evaluate code and post output to console
     * Returns nothing; output goes to post window
     */
    void execute(const std::string& code) {
        if (!initialized_) {
            EM_ASM({
                console.warn("sclang not initialized");
            });
            return;
        }
        
        // Call the C API execute function
        hc_wasm_eval_execute(code.c_str(), code.size());
    }
    
    /**
     * Get interpreter status (for debugging)
     */
    std::string status() const {
        // Call the C API status function
        const char* status_cstr = hc_wasm_eval_status();
        if (status_cstr) {
            return std::string(status_cstr);
        }
        return "sclang status: unknown";
    }
    
private:
    bool initialized_;
};

// Global sclang evaluator instance
static SclangEvaluator g_sclang_evaluator;

/*
 * ============================================================================
 * RAW C API FOR SCLANG EVALUATION
 * ============================================================================
 * These can be called directly from C/C++ or via Emscripten bindings
 * Note: Most functions are now in HC_Wasm_Eval.cpp. These are kept for
 * backwards compatibility and may be removed in the future.
 */

extern "C" {

/**
 * Initialize sclang WASM module
 * Must be called before any eval operations
 * Returns 0 on success, -1 on failure
 */
int hc_sclang_wasm_init() {
    // Call the new eval init
    return hc_wasm_eval_init();
}

/**
 * Boot the sclang interpreter (load class library, etc.)
 * @return 0 on success, non-zero on failure
 */
int hc_sclang_wasm_boot() {
    return hc_wasm_eval_boot();
}

/**
 * Run the full boot sequence (init + boot)
 * @return 0 on success, non-zero on failure
 */
int hc_sclang_wasm_boot_sequence() {
    return hc_wasm_eval_boot_sequence();
}

/**
 * Evaluate a SuperCollider code string
 * @param code UTF-8 encoded code string
 * @param len Length of code string (-1 for null-terminated)
 * @return Result as UTF-8 string (caller must not free)
 */
const char* sc_sclang_eval(const char* code, int len) {
    // Call the new eval function
    return hc_wasm_eval_string(code, len);
}

/**
 * Execute code (with output capture)
 * @param code UTF-8 encoded code string
 * @param len Length of code string (-1 for null-terminated)
 */
void sc_sclang_execute(const char* code, int len) {
    // Call the new eval execute function
    hc_wasm_eval_execute(code, len);
}

/**
 * Get sclang status string
 * @return Status as UTF-8 string
 */
const char* sc_sclang_status() {
    // Call the new eval status function
    return hc_wasm_eval_status();
}

}  // extern "C"

/*
 * ============================================================================
 * EMSCRIPTEN JAVASCRIPT BINDINGS
 * ============================================================================
 * These make the C++ class available to JavaScript via Emscripten's binding API.
 */

EMSCRIPTEN_BINDINGS(sclang_module) {
    emscripten::class_<SclangEvaluator>("SclangEvaluator")
        .constructor()
        .function("init", &SclangEvaluator::init)
        .function("boot", &SclangEvaluator::boot)
        .function("eval", &SclangEvaluator::eval)
        .function("execute", &SclangEvaluator::execute)
        .function("status", &SclangEvaluator::status)
        ;
    
    // Note: All C API functions can be called via Module.ccall() from JavaScript.
    // Embind has limitations with function pointers and raw const char* return values,
    // so we use the C API directly via ccall.
}

#endif  // SC_WASM
