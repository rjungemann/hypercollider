/*
 * HC_Wasm_Embind.cpp - Emscripten JavaScript bindings
 *
 * Exposes the C API to JavaScript via Emscripten's embind.
 * Enables idiomatic JavaScript usage like:
 *   const world = Module.hc_wasm_world_create(48000, 512);
 */

#ifdef SC_WASM

#include "HC_Wasm_Api.h"
#include <emscripten/bind.h>

using namespace emscripten;

// ============================================================================
// JavaScript Wrapper Class
// ============================================================================

class ScWasmWorld {
public:
    ScWasmWorld(int sample_rate, int block_size)
        : world_id_(hc_wasm_world_create(sample_rate, block_size)) {}

    ~ScWasmWorld() {
        if (world_id_ > 0) {
            hc_wasm_world_destroy(world_id_);
        }
    }

    int get_world_id() const { return world_id_; }
    int get_sample_rate() const { return hc_wasm_world_sample_rate(world_id_); }
    int get_block_size() const { return hc_wasm_world_block_size(world_id_); }

    int load_synthdef(const std::string& data, const std::string& name) {
        return hc_wasm_load_synthdef(world_id_, (const uint8_t*)data.data(), data.size(),
                                     name.c_str());
    }

    std::string list_synthdefs() {
        char buffer[4096];
        int result = hc_wasm_list_synthdefs(world_id_, buffer, sizeof(buffer));
        return result > 0 ? std::string(buffer) : "";
    }

    int synth_new(const std::string& synthdef_name, int node_id, int add_action, int target_id) {
        return hc_wasm_synth_new(world_id_, synthdef_name.c_str(), node_id, add_action, target_id);
    }

    int synth_free(int node_id) { return hc_wasm_synth_free(world_id_, node_id); }

    int synth_set(int node_id, int control_index, float value) {
        return hc_wasm_synth_set(world_id_, node_id, control_index, value);
    }

    // Accepts a WASM heap byte-offset (obtained via Module._malloc on the JS side).
    // JS usage:
    //   const ptr = Module._malloc(numSamples * numChannels * 4);
    //   world.render(ptr, numSamples, numChannels);
    //   const out = new Float32Array(Module.HEAPF32.buffer, ptr, numSamples * numChannels);
    int render(unsigned int heap_byte_offset, int num_samples, int num_channels) {
        float* output_buffer = reinterpret_cast<float*>(heap_byte_offset);
        return hc_wasm_render(world_id_, output_buffer, num_samples, num_channels);
    }

    int render_mix(unsigned int heap_byte_offset, int num_samples, int num_channels, float mix_level) {
        float* output_buffer = reinterpret_cast<float*>(heap_byte_offset);
        return hc_wasm_render_mix(world_id_, output_buffer, num_samples, num_channels, mix_level);
    }

    std::string get_status() {
        char buffer[8192];
        int result = hc_wasm_get_status(world_id_, buffer, sizeof(buffer));
        return result > 0 ? std::string(buffer) : "";
    }

    int reset() { return hc_wasm_reset(world_id_); }

private:
    int world_id_;
};

// ============================================================================
// Emscripten Bindings
// ============================================================================

EMSCRIPTEN_BINDINGS(supercollider_wasm) {
    class_<ScWasmWorld>("ScWasmWorld")
        .constructor<int, int>()
        .function("get_world_id", &ScWasmWorld::get_world_id)
        .function("get_sample_rate", &ScWasmWorld::get_sample_rate)
        .function("get_block_size", &ScWasmWorld::get_block_size)
        .function("load_synthdef", &ScWasmWorld::load_synthdef)
        .function("list_synthdefs", &ScWasmWorld::list_synthdefs)
        .function("synth_new", &ScWasmWorld::synth_new)
        .function("synth_free", &ScWasmWorld::synth_free)
        .function("synth_set", &ScWasmWorld::synth_set)
        .function("render", &ScWasmWorld::render)
        .function("render_mix", &ScWasmWorld::render_mix)
        .function("get_status", &ScWasmWorld::get_status)
        .function("reset", &ScWasmWorld::reset);
}

#endif // SC_WASM
