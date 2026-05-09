/*
 * HC_Wasm_OscShim.h
 * In-process OSC message dispatch for WASM builds
 *
 * Phase 1: C8 - In-process OSC dispatch
 */

#ifndef HC_WASM_OSC_SHIM_H
#define HC_WASM_OSC_SHIM_H

#ifdef SC_WASM

#include <cstddef>
#include <sys/types.h>
#include <sys/socket.h>  // For socklen_t, sockaddr, etc.

// Forward declaration
struct World;
struct ReplyAddress;

// ============================================================================
// C API for in-process OSC dispatch
// ============================================================================

/**
 * Send an OSC message to a scsynth world via in-process dispatch.
 * 
 * @param world_id The ID of the target scsynth world
 * @param msg_data Pointer to the OSC message data
 * @param msg_size Size of the message in bytes
 * @return 0 on success, -1 on error
 */
extern "C" int hc_wasm_osc_dispatch(int world_id, const char* msg_data, size_t msg_size);

/**
 * Register a scsynth world for in-process OSC dispatch.
 * 
 * @param world_id The ID to register for this world
 * @param world Pointer to the World object
 * @return 0 on success, -1 on error
 */
extern "C" int hc_wasm_osc_register_world(int world_id, World* world);

/**
 * Set the default world ID used when dispatch callers pass world_id <= 0.
 *
 * @param world_id The world ID to use as default target
 * @return 0 on success, -1 on error
 */
extern "C" int hc_wasm_osc_set_default_world(int world_id);

/**
 * Unregister a scsynth world.
 * 
 * @param world_id The ID of the world to unregister
 * @return 0 on success
 */
extern "C" int hc_wasm_osc_unregister_world(int world_id);

/**
 * Callback type for OSC messages from scsynth to sclang.
 */
typedef void (*hc_wasm_osc_callback_t)(int world_id, const char* msg_data, size_t msg_size, ReplyAddress* reply);

/**
 * Register a callback to receive OSC messages from scsynth.
 * 
 * @param world_id The ID of the scsynth world
 * @param handler The callback function to receive messages
 * @return 0 on success, -1 on error
 */
extern "C" int hc_wasm_osc_register_handler(int world_id, hc_wasm_osc_callback_t handler);

/**
 * Send a message from scsynth back to sclang.
 * 
 * @param world_id The ID of the source scsynth world
 * @param msg_data Pointer to the OSC message data
 * @param msg_size Size of the message in bytes
 * @return 0 on success, -1 on error
 */
extern "C" int hc_wasm_osc_send_to_sclang(int world_id, const char* msg_data, size_t msg_size);

// ============================================================================
// Socket shims
// ============================================================================

/**
 * Shim for sendto() that redirects to in-process OSC dispatch.
 */
extern "C" ssize_t hc_wasm_sendto_shim(int sockfd, const void* buf, size_t len, int flags,
                                     const struct sockaddr* dest_addr, socklen_t addrlen);

// ============================================================================
// Reply accumulation API
// ============================================================================

/**
 * Like hc_wasm_osc_dispatch, but captures replies produced by scsynth into a
 * per-world queue.  Drain with hc_wasm_reply_peek / hc_wasm_reply_count.
 */
extern "C" int hc_wasm_osc_dispatch_reply(int world_id, const char* msg_data, size_t msg_size);

/**
 * Return the number of pending reply messages queued for this world.
 */
extern "C" int hc_wasm_reply_count(int world_id);

/**
 * Copy the next pending reply into buf (up to buf_size bytes) and dequeue it.
 * Returns bytes copied, or 0 when the queue is empty.
 */
extern "C" int hc_wasm_reply_peek(int world_id, char* buf, int buf_size);

/**
 * Shim for recvfrom() - returns error as in-process uses callbacks.
 */
extern "C" ssize_t hc_wasm_recvfrom_shim(int sockfd, void* buf, size_t len, int flags,
                                      struct sockaddr* src_addr, socklen_t* addrlen);

#endif // SC_WASM

#endif // HC_WASM_OSC_SHIM_H
