/*
 * HC_Wasm_Api.h - C API boundary for WASM builds
 *
 * This header exposes the SuperCollider audio engine to JavaScript via
 * a stable C interface that Emscripten can wrap with JavaScript bindings.
 *
 * Usage from JavaScript:
 *   const Module = await SC.init();
 *   const worldId = Module._hc_wasm_world_create(48000, 512);
 *   Module._hc_wasm_load_synthdef(worldId, synthdefBuffer.buffer);
 *   const bufPtr = Module._malloc(512 * 4);  // 512 samples * 4 bytes float
 *   Module._hc_wasm_render(worldId, bufPtr, 512);
 *   const output = new Float32Array(Module.HEAPF32.buffer, bufPtr, 512);
 */

#ifndef HC_WASM_API_H
#define HC_WASM_API_H

#ifdef SC_WASM

#include <cstdint>
#include <cstddef>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * \defgroup WasmAPI SuperCollider WASM C API
 * @{
 */

// ============================================================================
// World (Engine) Management
// ============================================================================

/**
 * Create a new audio engine instance
 *
 * @param sample_rate Sample rate in Hz (typically 48000)
 * @param block_size Block size in samples (typically 512 or 128)
 * @return Opaque world handle, or 0 on error
 */
int hc_wasm_world_create(int sample_rate, int block_size);

/**
 * Destroy an audio engine instance and free resources
 *
 * @param world_id World handle from hc_wasm_world_create
 * @return 0 on success, -1 on error
 */
int hc_wasm_world_destroy(int world_id);

/**
 * Get the sample rate of a world
 *
 * @param world_id World handle
 * @return Sample rate in Hz, or 0 if world not found
 */
int hc_wasm_world_sample_rate(int world_id);

/**
 * Get the block size of a world
 *
 * @param world_id World handle
 * @return Block size in samples, or 0 if world not found
 */
int hc_wasm_world_block_size(int world_id);

// ============================================================================
// SynthDef Management
// ============================================================================

/**
 * Load a compiled SynthDef from binary data
 *
 * SynthDefs must be pre-compiled (externally or via sclang).
 * Format: SuperCollider SynthDef bytecode
 *
 * @param world_id World handle
 * @param synthdef_data Pointer to SynthDef bytecode
 * @param data_size Size of synthdef_data in bytes
 * @param synthdef_name Optional name to register under; if NULL, use embedded name
 * @return 0 on success, -1 on error
 */
int hc_wasm_load_synthdef(int world_id, const uint8_t* synthdef_data, size_t data_size,
                          const char* synthdef_name);

/**
 * Get list of loaded SynthDef names
 *
 * @param world_id World handle
 * @param name_buffer Buffer to store null-terminated names (comma-separated)
 * @param buffer_size Size of name_buffer
 * @return Number of bytes written, or -1 on error
 */
int hc_wasm_list_synthdefs(int world_id, char* name_buffer, size_t buffer_size);

/**
 * Unload a compiled SynthDef from memory
 *
 * Removes the SynthDef definition but does not affect running synth instances
 * that were created from this definition (they continue with cached state).
 *
 * @param world_id World handle
 * @param synthdef_name Name of the SynthDef to unload
 * @return 0 on success, -1 if SynthDef not found or other error
 */
int hc_wasm_unload_synthdef(int world_id, const char* synthdef_name);

/**
 * Unload all compiled SynthDefs from memory
 *
 * Clears the entire SynthDef table. Running synth instances are not affected.
 *
 * @param world_id World handle
 * @return 0 on success, -1 on error
 */
int hc_wasm_unload_all_synthdefs(int world_id);

// ============================================================================
// Node (Synth Instance) Management
// ============================================================================

/**
 * Create a new synth node and add it to the tree
 *
 * @param world_id World handle
 * @param synthdef_name Name of the SynthDef to instantiate
 * @param node_id Unique node ID (you assign)
 * @param add_action Where to add: 0=replace, 1=head of group, 2=tail of group
 * @param target_id Target node ID (typically 1 for root group)
 * @return 0 on success, -1 on error
 */
int hc_wasm_synth_new(int world_id, const char* synthdef_name, int node_id, int add_action,
                      int target_id);

/**
 * Free (remove and stop) a synth node
 *
 * @param world_id World handle
 * @param node_id Node ID to free
 * @return 0 on success, -1 on error
 */
int hc_wasm_synth_free(int world_id, int node_id);

/**
 * Set a control parameter on a synth
 *
 * @param world_id World handle
 * @param node_id Node ID
 * @param control_index Control index (0-based)
 * @param value New control value
 * @return 0 on success, -1 on error
 */
int hc_wasm_synth_set(int world_id, int node_id, int control_index, float value);

/**
 * Set multiple control parameters at once
 *
 * @param world_id World handle
 * @param node_id Node ID
 * @param control_count Number of control pairs
 * @param indices Array of control indices
 * @param values Array of control values
 * @return 0 on success, -1 on error
 */
int hc_wasm_synth_set_multi(int world_id, int node_id, int control_count,
                            const int* indices, const float* values);

// ============================================================================
// Audio Rendering
// ============================================================================

/**
 * Render one block of audio
 *
 * Advances the synth graph one block and writes audio to output buffer.
 * Must be called repeatedly (e.g., from AudioWorklet callback).
 *
 * @param world_id World handle
 * @param output_buffer Pointer to output buffer (must hold block_size * num_channels floats)
 * @param num_samples Number of samples to render (typically block_size)
 * @param num_channels Number of output channels (typically 2 for stereo)
 * @return 0 on success, -1 on error
 */
int hc_wasm_render(int world_id, float* output_buffer, int num_samples, int num_channels);

/**
 * Render and mix with existing buffer (for offline rendering chains)
 *
 * @param world_id World handle
 * @param output_buffer Pointer to output buffer
 * @param num_samples Number of samples to render
 * @param num_channels Number of output channels
 * @param mix_level Gain to apply to rendered audio (1.0 = unity)
 * @return 0 on success, -1 on error
 */
int hc_wasm_render_mix(int world_id, float* output_buffer, int num_samples, int num_channels,
                       float mix_level);

// ============================================================================
// Diagnostic & Status
// ============================================================================

/**
 * Get engine statistics
 *
 * Returns CPU usage, glitch count, and other diagnostic info as JSON.
 *
 * @param world_id World handle
 * @param status_buffer Buffer to store JSON status string
 * @param buffer_size Size of status_buffer
 * @return Number of bytes written, or -1 on error
 */
int hc_wasm_get_status(int world_id, char* status_buffer, size_t buffer_size);

/**
 * Clear all nodes and reset engine state (for restarting)
 *
 * @param world_id World handle
 * @return 0 on success, -1 on error
 */
int hc_wasm_reset(int world_id);

// ============================================================================
// Real-Time Audio (Phase 2+)
// ============================================================================

/**
 * Process control messages before rendering
 *
 * Drains the command queue and applies control updates.
 * Call this before rendering to handle pending commands.
 *
 * @param world_id World handle
 * @param max_messages Maximum messages to process per call
 * @return Number of messages processed, or -1 on error
 */
int hc_wasm_process_controls(int world_id, int max_messages);

/**
 * Enqueue a control message (thread-safe)
 *
 * Can be called from the main thread to queue commands for the audio thread.
 * Uses a lock-free or bounded-locking queue for safety.
 *
 * @param world_id World handle
 * @param message_type Type code (0=synth_set, 1=synth_free, etc.)
 * @param node_id Target node ID
 * @param control_index Control index or sub-command
 * @param value Control value
 * @return 0 on success, -1 if queue full
 */
int hc_wasm_enqueue_control(int world_id, int message_type, int node_id, int control_index,
                            float value);

/**
 * Get performance metrics
 *
 * @param world_id World handle
 * @param cpu_percent Output: CPU usage percentage (0-100+)
 * @param xruns_output: Number of render deadline misses
 * @param buffer_used Output: Peak buffer usage in samples
 * @return 0 on success, -1 on error
 */
int hc_wasm_get_metrics(int world_id, float* cpu_percent, int* xruns, int* buffer_used);

/**
 * Reset performance counters
 *
 * @param world_id World handle
 * @return 0 on success, -1 on error
 */
int hc_wasm_reset_metrics(int world_id);

// ============================================================================
// UGen Discovery
// ============================================================================

/**
 * Get sorted list of all registered UGen names
 *
 * Populates buffer with newline-separated UGen names, null-terminated.
 * Must be called after at least one world has been created (i.e. after
 * hc_wasm_world_create) so that the UGen library has been initialised.
 *
 * @param buffer  Caller-allocated buffer for the newline-separated name list
 * @param buffer_size  Size of buffer in bytes
 * @return Number of bytes written (excluding the terminating NUL), or -1 if
 *         buffer is too small
 */
int hc_wasm_list_ugens(char* buffer, size_t buffer_size);

/**
 * @}
 */

#ifdef __cplusplus
}
#endif

#endif // SC_WASM

#endif // HC_WASM_API_H
