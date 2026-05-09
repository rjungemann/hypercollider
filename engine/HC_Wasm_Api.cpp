/*
 * HC_Wasm_Api.cpp - C API implementation for WASM builds
 *
 * Wires the public JS-callable C API to the real SuperCollider audio engine
 * (World_New / World_Run) instead of stub implementations.
 *
 * Phase 6: real World_New + World_Run wiring.
 */

#ifdef SC_WASM

#include "HC_Wasm_Api.h"
#include "HC_Wasm_OscShim.h"

// Server engine headers (resolved via target_include_directories in CMakeLists.txt)
#include "SC_WorldOptions.h"
#include "SC_GraphDef.h"
#include "SC_Prototypes.h"
#include "sc_errors.h"

// Plugin_interface public headers
#include "SC_World.h"

// Common headers
#include "reply_impl.hpp"
#include "SC_Endian.h"

#include "SC_HiddenWorld.h"
#include "SC_UnitDef.h"

#include <unordered_map>
#include <vector>
#include <string>
#include <algorithm>
#include <cstring>
#include <cstdio>

// ============================================================================
// Forward declarations from HC_Wasm_AudioDriver.cpp (linked into same binary)
// ============================================================================

void HC_Wasm_FlushNRT(World* inWorld);
int  PerformOSCMessage(World* inWorld, int inSize, char* inData, ReplyAddress* inReply);

// ============================================================================
// World registry
// ============================================================================

static std::unordered_map<int, World*> gWorlds;
static int gNextWorldId = 1000;

// ============================================================================
// OSC message helper utilities
// ============================================================================

// Write a null-padded OSC string into buf; return number of bytes written.
static int osc_put_string(char* buf, const char* s) {
    size_t len = strlen(s) + 1;          // include NUL terminator
    memcpy(buf, s, len);
    size_t padded = (len + 3) & ~3u;     // round up to 4-byte boundary
    if (padded > len) memset(buf + len, 0, padded - len);
    return (int)padded;
}

// Write a big-endian int32 into buf; return 4.
static int osc_put_int32(char* buf, int32_t v) {
    uint32_t n = sc_htonl((uint32_t)v);
    memcpy(buf, &n, 4);
    return 4;
}

// Write a big-endian float32 into buf; return 4.
static int osc_put_float(char* buf, float v) {
    union { float f; uint32_t u; } c;
    c.f = v;
    uint32_t n = sc_htonl(c.u);
    memcpy(buf, &n, 4);
    return 4;
}

// ============================================================================
// C API Implementation
// ============================================================================

int hc_wasm_world_create(int sample_rate, int block_size) {
    if (sample_rate <= 0 || block_size <= 0)
        return 0;

    WorldOptions opts;
    // Preferred hardware parameters
    opts.mPreferredSampleRate             = (uint32_t)sample_rate;
    opts.mPreferredHardwareBufferFrameSize = (uint32_t)block_size;
    opts.mBufLength                       = (uint32_t)block_size;
    // Audio bus configuration (stereo out, no inputs)
    opts.mNumOutputBusChannels            = 2;
    opts.mNumInputBusChannels             = 0;
    opts.mNumAudioBusChannels             = 128;
    opts.mNumControlBusChannels           = 4096;
    // No disk-based synthdefs, no POSIX shm, no Rendezvous
    opts.mLoadGraphDefs                   = 0;
    opts.mSharedMemoryID                  = 0;
    opts.mRendezvous                      = false;
    opts.mVerbosity                       = 0;
    opts.mRealTime                        = true;

    World* world = World_New(&opts);
    if (!world)
        return 0;

    int id = gNextWorldId++;
    gWorlds[id] = world;
    hc_wasm_osc_register_world(id, world);
    hc_wasm_osc_set_default_world(id);

    // Register a logical client, mirroring standard sclang boot flow.
    {
        char buf[32];
        int pos = 0;
        pos += osc_put_string(buf + pos, "/notify");
        pos += osc_put_string(buf + pos, ",i");
        pos += osc_put_int32(buf + pos, 1);

        ReplyAddress reply;
        memset(&reply, 0, sizeof(reply));
        reply.mReplyFunc = null_reply_func;
        (void)PerformOSCMessage(world, pos, buf, &reply);
    }

    // Mirror classic scsynth client setup used by sclang: create default group 1.
    {
        char buf[64];
        int pos = 0;
        pos += osc_put_string(buf + pos, "/g_new");
        pos += osc_put_string(buf + pos, ",iii");
        pos += osc_put_int32(buf + pos, 1); // new group id
        pos += osc_put_int32(buf + pos, 0); // add to head
        pos += osc_put_int32(buf + pos, 0); // target root group

        ReplyAddress reply;
        memset(&reply, 0, sizeof(reply));
        reply.mReplyFunc = null_reply_func;
        (void)PerformOSCMessage(world, pos, buf, &reply);
        HC_Wasm_FlushNRT(world);
    }

    return id;
}

int hc_wasm_world_destroy(int world_id) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end())
        return -1;
    hc_wasm_osc_unregister_world(world_id);
    World_Cleanup(it->second, true);
    gWorlds.erase(it);
    return 0;
}

int hc_wasm_world_sample_rate(int world_id) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end()) return 0;
    return (int)it->second->mSampleRate;
}

int hc_wasm_world_block_size(int world_id) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end()) return 0;
    return (int)it->second->mBufLength;
}

int hc_wasm_load_synthdef(int world_id, const uint8_t* synthdef_data, size_t data_size,
                          const char* /*synthdef_name - embedded in binary*/) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end() || !synthdef_data || data_size == 0)
        return -1;

    World* world = it->second;

    // Parse and define synchronously (bypass async NRT staging).
    GraphDef* defs = GraphDef_Recv(world, (const char*)synthdef_data, data_size, nullptr);
    if (!defs)
        return -1;

    GraphDef_Define(world, defs);
    HC_Wasm_FlushNRT(world);
    return 0;
}

int hc_wasm_list_synthdefs(int world_id, char* name_buffer, size_t buffer_size) {
    // Stub: listing GraphDef names requires iterating the hash table.
    if (name_buffer && buffer_size > 0) {
        name_buffer[0] = '\0';
        return 1;
    }
    return -1;
}

int hc_wasm_synth_new(int world_id, const char* synthdef_name, int node_id, int add_action,
                      int target_id) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end() || !synthdef_name)
        return -1;

    World* world = it->second;

    // Build a command-id packet for s_new:
    //   <9 BE><",siii" padded><name padded><node_id BE><add_action BE><target_id BE>
    // This mirrors completion messages produced by sclang in split-module wasm mode.
    char buf[512];
    int pos = 0;
    pos += osc_put_int32(buf + pos, (int32_t)9);
    pos += osc_put_string(buf + pos, ",siii");
    pos += osc_put_string(buf + pos, synthdef_name);
    pos += osc_put_int32(buf + pos, (int32_t)node_id);
    pos += osc_put_int32(buf + pos, (int32_t)add_action);
    pos += osc_put_int32(buf + pos, (int32_t)target_id);

    ReplyAddress reply;
    memset(&reply, 0, sizeof(reply));
    reply.mReplyFunc = null_reply_func;

    int err = PerformOSCMessage(world, pos, buf, &reply);
    if (err == kSCErr_None)
        HC_Wasm_FlushNRT(world);
    return (err == kSCErr_None) ? 0 : -1;
}

int hc_wasm_synth_free(int world_id, int node_id) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end())
        return -1;

    World* world = it->second;

    char buf[32];
    int pos = 0;
    pos += osc_put_string(buf + pos, "/n_free");
    pos += osc_put_int32(buf + pos, (int32_t)node_id);

    ReplyAddress reply;
    memset(&reply, 0, sizeof(reply));
    reply.mReplyFunc = null_reply_func;

    int err = PerformOSCMessage(world, pos, buf, &reply);
    return (err == kSCErr_None) ? 0 : -1;
}

int hc_wasm_synth_set(int world_id, int node_id, int control_index, float value) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end())
        return -1;

    World* world = it->second;

    char buf[64];
    int pos = 0;
    pos += osc_put_string(buf + pos, "/n_set");
    pos += osc_put_int32(buf + pos, (int32_t)node_id);
    pos += osc_put_int32(buf + pos, (int32_t)control_index);
    pos += osc_put_float(buf + pos, value);

    ReplyAddress reply;
    memset(&reply, 0, sizeof(reply));
    reply.mReplyFunc = null_reply_func;

    int err = PerformOSCMessage(world, pos, buf, &reply);
    return (err == kSCErr_None) ? 0 : -1;
}

int hc_wasm_synth_set_multi(int world_id, int node_id, int control_count,
                            const int* indices, const float* values) {
    if (!indices || !values || control_count <= 0)
        return -1;
    for (int i = 0; i < control_count; ++i) {
        int r = hc_wasm_synth_set(world_id, node_id, indices[i], values[i]);
        if (r != 0) return r;
    }
    return 0;
}

int hc_wasm_render(int world_id, float* output_buffer, int num_samples, int num_channels) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end() || !output_buffer || num_samples <= 0 || num_channels <= 0)
        return -1;

    World* world = it->second;
    int buf_len      = (int)world->mBufLength;
    int num_outputs  = (int)world->mNumOutputs;
    int copy_chans   = (num_channels < num_outputs) ? num_channels : num_outputs;

    // Drain any pending NRT-stage completions (async command FIFOs).
    HC_Wasm_FlushNRT(world);

    // Render in blocks of buf_len.
    int num_blocks = (num_samples + buf_len - 1) / buf_len;

    for (int b = 0; b < num_blocks; ++b) {
        World_Run(world);

        // Copy non-interleaved output buses to interleaved caller buffer.
        int samples_this_block = buf_len;
        int base_out = b * buf_len * num_channels;

        for (int ch = 0; ch < copy_chans; ++ch) {
            float* bus = world->mAudioBus + ch * buf_len;
            for (int s = 0; s < samples_this_block; ++s)
                output_buffer[base_out + s * num_channels + ch] = bus[s];
        }
        // Zero any extra channels not produced by the engine.
        for (int ch = copy_chans; ch < num_channels; ++ch) {
            for (int s = 0; s < samples_this_block; ++s)
                output_buffer[base_out + s * num_channels + ch] = 0.0f;
        }

        world->mBufCounter++;
    }

    return 0;
}

int hc_wasm_render_mix(int world_id, float* output_buffer, int num_samples, int num_channels,
                       float /*mix_level*/) {
    // Delegate; mix_level handling deferred to a later phase.
    return hc_wasm_render(world_id, output_buffer, num_samples, num_channels);
}

int hc_wasm_get_status(int world_id, char* status_buffer, size_t buffer_size) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end() || !status_buffer || buffer_size == 0)
        return -1;

    World* world = it->second;
    int written = snprintf(status_buffer, buffer_size,
        "{\"status\":\"ok\",\"ugens\":%u,\"synths\":%u,\"groups\":%u}",
        world->mNumUnits, world->mNumGraphs, world->mNumGroups);
    return written + 1;
}

int hc_wasm_reset(int world_id) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end())
        return -1;

    World* world = it->second;

    // Free all nodes via the /g_freeAll command on node 0 (root group).
    char buf[32];
    int pos = 0;
    pos += osc_put_string(buf + pos, "/g_freeAll");
    pos += osc_put_int32(buf + pos, 0);

    ReplyAddress reply;
    memset(&reply, 0, sizeof(reply));
    reply.mReplyFunc = null_reply_func;

    PerformOSCMessage(world, pos, buf, &reply);
    return 0;
}

int hc_wasm_process_controls(int world_id, int /*max_messages*/) {
    // Controls are applied immediately via hc_wasm_synth_set; nothing is queued here.
    (void)world_id;
    return 0;
}

int hc_wasm_enqueue_control(int world_id, int /*message_type*/, int node_id, int control_index,
                            float value) {
    // Apply immediately.
    return hc_wasm_synth_set(world_id, node_id, control_index, value);
}

int hc_wasm_get_metrics(int world_id, float* cpu_percent, int* xruns, int* buffer_used) {
    auto it = gWorlds.find(world_id);
    if (it == gWorlds.end() || !cpu_percent || !xruns || !buffer_used)
        return -1;
    *cpu_percent = 0.0f;
    *xruns       = 0;
    *buffer_used = 0;
    return 0;
}

int hc_wasm_reset_metrics(int world_id) {
    (void)world_id;
    return 0;
}

int hc_wasm_list_ugens(char* buffer, size_t buffer_size) {
    if (!buffer || buffer_size == 0)
        return -1;
    if (!gUnitDefLib) {
        buffer[0] = '\0';
        return 0;
    }
    std::vector<std::string> names;
    names.reserve((size_t)gUnitDefLib->NumItems());
    for (int i = 0; i < gUnitDefLib->TableSize(); ++i) {
        UnitDef* ud = gUnitDefLib->AtIndex(i);
        if (!ud)
            continue;
        const char* name = (const char*)ud->mUnitDefName;
        if (name && name[0] != '\0')
            names.push_back(std::string(name));
    }
    std::sort(names.begin(), names.end());
    size_t pos = 0;
    for (const auto& n : names) {
        size_t len = n.size();
        if (pos + len + 2 > buffer_size) {
            buffer[pos] = '\0';
            return -1;
        }
        memcpy(buffer + pos, n.c_str(), len);
        pos += len;
        buffer[pos++] = '\n';
    }
    if (pos > 0 && buffer[pos - 1] == '\n')
        pos--;
    buffer[pos] = '\0';
    return (int)pos;
}

#endif // SC_WASM
