/*
 * HC_Wasm_Eval.h
 * SuperCollider Language Evaluation for WASM - Header
 *
 * Declares the C API for sclang WASM evaluation.
 * Phase 7.2: sclang WASM Implementation
 */

#ifndef HC_WASM_EVAL_H
#define HC_WASM_EVAL_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialize the sclang WASM evaluation module.
 * Must be called before any evaluation functions.
 * @return 0 on success, non-zero on failure
 */
int hc_wasm_eval_init();

/**
 * Boot the sclang interpreter (load class library, etc.)
 * @return 0 on success, non-zero on failure
 */
int hc_wasm_eval_boot();

/**
 * Evaluate a SuperCollider code string.
 * @param code UTF-8 encoded code string
 * @param len Length of code string (-1 for null-terminated)
 * @return Result as UTF-8 string (valid until next call)
 */
const char* hc_wasm_eval_string(const char* code, int len);

/**
 * Execute a SuperCollider code string with output to post callback.
 * @param code UTF-8 encoded code string
 * @param len Length of code string (-1 for null-terminated)
 */
void hc_wasm_eval_execute(const char* code, int len);

/**
 * Set the callback for post output.
 * Called whenever sclang produces output (postln, etc.)
 * @param cb Function pointer: void (*)(const char* text, int len)
 */
void hc_wasm_eval_set_post_callback(void (*cb)(const char* text, int len));

/**
 * Set the callback for error output.
 * Called whenever sclang produces error output.
 * @param cb Function pointer: void (*)(const char* text, int len)
 */
void hc_wasm_eval_set_error_callback(void (*cb)(const char* text, int len));

/**
 * Set the sclang debug/trace level.
 * Level 0 = off, level 1 = enables method dispatch tracing (gTraceInterpreter).
 * @param level Debug level (0 = off, 1+ = trace)
 */
void hc_wasm_eval_set_debug_level(int level);

/**
 * Run the full boot sequence (init + boot + setup).
 * @return 0 on success, non-zero on failure
 */
int hc_wasm_eval_boot_sequence();

/**
 * Get the current status of the evaluation module.
 * @return Status string (valid until next call)
 */
const char* hc_wasm_eval_status();

/**
 * Return the current sbrk(0) value — the high-water mark of the WASM linear
 * memory after init. Used by the JS heap-snapshot system to determine how
 * many bytes to save; only bytes [0, heapEnd) need to be included.
 */
uint32_t hc_wasm_eval_heap_end();

/**
 * Add a path to the SC class library search list.
 * Must be called after hc_wasm_eval_init() and before hc_wasm_eval_boot_sequence().
 */
void hc_wasm_eval_add_include_path(const char* path);

/**
 * Set quarks availability flag (WAMR host calls this to signal --quarks-dir was provided).
 */
void hc_wasm_quarks_set_available(bool available);

/**
 * Check if quarks are available in the current WASM environment.
 * Browser path: checks for window.__hclang_git_proxy
 * WAMR path: checks if --quarks-dir was registered
 */
int hc_wasm_quarks_available();

#ifdef __cplusplus
}
#endif

#endif // HC_WASM_EVAL_H
