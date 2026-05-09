/*
 * HC_Wasm_OscShim.cpp
 * In-process OSC message dispatch for WASM builds
 *
 * Replaces UDP socket communication between sclang and scsynth with direct
 * function calls when both run in the same WASM module.
 *
 * Phase 1: C8 - In-process OSC dispatch
 */

#ifdef SC_WASM

#include "HC_Wasm_OscShim.h"
#include "HC_Wasm_Api.h"
#include "reply_impl.hpp"
#include "sc_errors.h"  // For kSCErr_None, SCErr
#include "SC_Endian.h"

#include <vector>
#include <cstring>
#include <unordered_map>
#include <cstdio>

// Forward declarations for socket types (avoid including platform-specific headers)
// Note: Emscripten defines socklen_t as unsigned, so we use the same type
struct sockaddr;
#ifndef socklen_t_DEFINED
typedef unsigned socklen_t;
#define socklen_t_DEFINED
#endif

// Forward declaration - PerformOSCMessage is defined in HC_Wasm_AudioDriver.cpp
// which is part of libscsynth
struct World;
int PerformOSCMessage(World* inWorld, int inSize, char* inData, ReplyAddress* inReply);
void HC_Wasm_FlushNRT(World* inWorld);

static inline bool IsBundle(const char* ptr) { return ptr && strcmp(ptr, "#bundle") == 0; }
static inline bool IsMessage(const char* ptr) { return ptr && ptr[0] == '/'; }

// Convert internal command-ID format (cmdInt=9 for /s_new) to standard OSC
static std::vector<char> convertInternalCommandToOsc(const char* data, size_t size) {
    if (size < 8 || data[0] == '/' || data[0] == '#') {
        return std::vector<char>(data, data + size);
    }

    // Check for command ID 9 (/s_new)
    uint32_t cmdInt = sc_ntohl(*reinterpret_cast<const uint32_t*>(data));
    if (cmdInt != 9) {
        return std::vector<char>(data, data + size);
    }

    std::vector<char> out;
    const char* s_new_cmd = "/s_new";
    out.insert(out.end(), s_new_cmd, s_new_cmd + 7);
    while (out.size() % 4 != 0) out.push_back(0);

    const char* p = data + 4;
    const char* end = data + size;

    // Read and copy remaining data as-is (type tags and arguments)
    // This handles any tag format: ,siii, ,siiisisf, etc.
    while (p < end) {
        out.push_back(*p++);
    }

    return out;
}

static int dispatch_osc_data(World* world, const char* data, size_t size, ReplyAddress* reply) {
    static int s_dispatchTraceCount = 0;
    const bool trace = s_dispatchTraceCount < 32;

    if (!world || !data || size == 0) {
        return -1;
    }

    std::vector<char> converted = convertInternalCommandToOsc(data, size);
    const char* msg = converted.data();
    const size_t msg_size = converted.size();

    if (IsMessage(msg)) {
        if (trace) {
            printf("SC_WASM OSC dispatch msg='%s' len=%d\n", msg, (int)msg_size);
            s_dispatchTraceCount++;
        }
        return PerformOSCMessage(world, static_cast<int>(msg_size), const_cast<char*>(msg), reply);
    }

    if (!IsBundle(msg) || msg_size < 16) {
        return -1;
    }

    if (trace) {
        printf("SC_WASM OSC dispatch bundle len=%d\n", (int)msg_size);
        s_dispatchTraceCount++;
    }

    // Skip "#bundle" + timetag and walk element chunks.
    const char* p = msg + 16;
    const char* end = msg + msg_size;
    while (p < end) {
        if ((end - p) < 4) {
            return -1;
        }

        const int32_t elemSize = static_cast<int32_t>(sc_ntohl(*reinterpret_cast<const uint32_t*>(p)));
        p += 4;
        if (elemSize <= 0 || p + elemSize > end) {
            return -1;
        }

        const int r = dispatch_osc_data(world, p, static_cast<size_t>(elemSize), reply);
        if (r != kSCErr_None) {
            return r;
        }
        p += elemSize;
    }

    return kSCErr_None;
}

// ============================================================================
// OSC Message Buffer
// ============================================================================

struct OscMessage {
    std::vector<uint8_t> data;
    ReplyAddress reply;
};

// ============================================================================
// World Registry for in-process dispatch
// ============================================================================

static std::unordered_map<int, World*> gWasmWorlds;
static int gDefaultWorldId = 0;

// ============================================================================
// OSC Message Handler
// ============================================================================

// Callback type for OSC messages
using OscMessageCallback = void (*)(int world_id, const char* msg_data, size_t msg_size, ReplyAddress* reply);

// Registered handlers per world
static std::unordered_map<int, OscMessageCallback> gOscHandlers;

// ============================================================================
// In-Process OSC Dispatch
// ============================================================================

/**
 * Send an OSC message to a scsynth world running in the same WASM module.
 * Instead of sending via UDP socket, we call directly into the World's message handler.
 */
extern "C" int hc_wasm_osc_dispatch(int world_id, const char* msg_data, size_t msg_size) {
    static int s_worldTraceCount = 0;
    const bool trace = s_worldTraceCount < 16;
    const int requestedWorldId = world_id;

    if (world_id <= 0) {
        world_id = gDefaultWorldId;
    }

    auto it = gWasmWorlds.find(world_id);
    if (it == gWasmWorlds.end()) {
        if (trace) {
                 printf("SC_WASM OSC dispatch world missing req=%d resolved=%d default=%d\n",
                     requestedWorldId, world_id, gDefaultWorldId);
            s_worldTraceCount++;
        }
        return -1; // World not found
    }

    if (trace) {
         printf("SC_WASM OSC dispatch world ok req=%d resolved=%d size=%d\n",
             requestedWorldId, world_id, (int)msg_size);
        s_worldTraceCount++;
    }
    
    World* world = it->second;
    
    // Create a temporary reply address (messages are fire-and-forget for now)
    ReplyAddress reply;
    memset(&reply, 0, sizeof(reply));
    reply.mReplyFunc = null_reply_func;
    
    const int err = dispatch_osc_data(world, msg_data, msg_size, &reply);
    if (err == kSCErr_None) {
        // Some sequenced commands (notably /d_recv completion paths) depend on
        // NRT queue draining, which may stall in headless/no-audio callback runs.
        HC_Wasm_FlushNRT(world);
    }
    return (err == kSCErr_None) ? 0 : -1;
}

/**
 * Register a scsynth world for in-process OSC dispatch.
 * Called when a new World is created.
 */
extern "C" int hc_wasm_osc_register_world(int world_id, World* world) {
    if (world_id <= 0 || !world) return -1;
    gWasmWorlds[world_id] = world;
    if (gDefaultWorldId <= 0) {
        gDefaultWorldId = world_id;
    }
    return 0;
}

extern "C" int hc_wasm_osc_set_default_world(int world_id) {
    if (world_id <= 0) return -1;
    if (gWasmWorlds.find(world_id) == gWasmWorlds.end()) return -1;
    gDefaultWorldId = world_id;
    return 0;
}

/**
 * Unregister a scsynth world.
 * Called when a World is destroyed.
 */
extern "C" int hc_wasm_osc_unregister_world(int world_id) {
    gWasmWorlds.erase(world_id);
    if (gDefaultWorldId == world_id) {
        if (!gWasmWorlds.empty()) {
            gDefaultWorldId = gWasmWorlds.begin()->first;
        } else {
            gDefaultWorldId = 0;
        }
    }
    return 0;
}

/**
 * Register an OSC message handler for a world.
 * This allows scsynth to send messages back to sclang.
 */
extern "C" int hc_wasm_osc_register_handler(int world_id, OscMessageCallback handler) {
    gOscHandlers[world_id] = handler;
    return 0;
}

/**
 * Send a message from scsynth back to sclang.
 * This is used for notifications like /n_end, /n_go, etc.
 */
extern "C" int hc_wasm_osc_send_to_sclang(int world_id, const char* msg_data, size_t msg_size) {
    auto it = gOscHandlers.find(world_id);
    if (it == gOscHandlers.end()) {
        return -1;
    }
    
    ReplyAddress reply;
    memset(&reply, 0, sizeof(reply));
    reply.mReplyFunc = null_reply_func;
    
    it->second(world_id, msg_data, msg_size, &reply);
    return 0;
}

// ============================================================================
// Socket Shim - Replace socket calls with in-process dispatch
// ============================================================================

// These shims intercept socket operations and redirect to in-process dispatch

/**
 * Shim for sendto() - redirects to in-process OSC dispatch
 * Note: This is a simplified version. Full implementation needs to:
 * 1. Parse the OSC message
 * 2. Determine the target world
 * 3. Dispatch via hc_wasm_osc_dispatch
 */
extern "C" ssize_t hc_wasm_sendto_shim(int sockfd, const void* buf, size_t len, int flags,
                                     const struct sockaddr* dest_addr, socklen_t addrlen) {
    // For WASM, we assume the message is for scsynth and dispatch in-process
    // In a real implementation, we'd parse the OSC message to get the target
    // and route accordingly.
    
    // Route through the configured default target world.
    return hc_wasm_osc_dispatch(0, (const char*)buf, len);
}

/**
 * Shim for recvfrom() - not needed for in-process (messages come via callbacks)
 */
extern "C" ssize_t hc_wasm_recvfrom_shim(int sockfd, void* buf, size_t len, int flags,
                                      struct sockaddr* src_addr, socklen_t* addrlen) {
    // In-process: messages arrive via callback, not via recv
    return -1; // Would block - not suitable for WASM
}

// ============================================================================
// Reply accumulation API
// Allows the JS side to dispatch an OSC message and synchronously drain any
// replies that scsynth produces (e.g. /status.reply, /done, /fail).
// ============================================================================

struct WasmReplyMsg {
    std::vector<char> data;
};

static std::unordered_map<int, std::vector<WasmReplyMsg>> gReplyQueues;
static int gActiveReplyWorldId = 0;

// Reply function used by hc_wasm_osc_dispatch_reply: collects messages into
// the per-world queue instead of discarding them.
static void collect_reply_func(struct ReplyAddress* /*addr*/, char* msg, int size) {
    if (msg && size > 0 && gActiveReplyWorldId > 0) {
        gReplyQueues[gActiveReplyWorldId].push_back({ std::vector<char>(msg, msg + size) });
    }
}

/**
 * Like hc_wasm_osc_dispatch, but captures any replies produced by scsynth
 * into a per-world queue.  Drain with hc_wasm_reply_peek / hc_wasm_reply_count.
 */
extern "C" int hc_wasm_osc_dispatch_reply(int world_id, const char* msg_data, size_t msg_size) {
    if (world_id <= 0) world_id = gDefaultWorldId;

    auto it = gWasmWorlds.find(world_id);
    if (it == gWasmWorlds.end()) return -1;

    World* world = it->second;

    ReplyAddress reply;
    memset(&reply, 0, sizeof(reply));
    reply.mReplyFunc = collect_reply_func;

    gActiveReplyWorldId = world_id;
    const int err = dispatch_osc_data(world, msg_data, msg_size, &reply);
    if (err == kSCErr_None) HC_Wasm_FlushNRT(world);
    gActiveReplyWorldId = 0;

    return (err == kSCErr_None) ? 0 : -1;
}

/**
 * Return the number of pending reply messages for the given world.
 */
extern "C" int hc_wasm_reply_count(int world_id) {
    auto it = gReplyQueues.find(world_id);
    if (it == gReplyQueues.end()) return 0;
    return (int)it->second.size();
}

/**
 * Copy the next pending reply into buf (up to buf_size bytes) and remove it
 * from the queue.  Returns the number of bytes copied, or 0 if the queue is
 * empty.  The caller must call this in a loop until 0 is returned to drain all
 * replies from a single dispatch.
 */
extern "C" int hc_wasm_reply_peek(int world_id, char* buf, int buf_size) {
    auto it = gReplyQueues.find(world_id);
    if (it == gReplyQueues.end() || it->second.empty()) return 0;
    WasmReplyMsg& msg = it->second.front();
    int copy = (buf_size < (int)msg.data.size()) ? buf_size : (int)msg.data.size();
    if (buf && copy > 0) memcpy(buf, msg.data.data(), (size_t)copy);
    it->second.erase(it->second.begin());
    return copy;
}

#endif // SC_WASM
