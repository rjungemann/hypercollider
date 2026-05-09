#include "wasm_host.h"
#include <cstring>
#include <cstdio>

// ---------------------------------------------------------------------------
// File helper
// ---------------------------------------------------------------------------
bool wasm_host_load_file(const char* path, std::vector<uint8_t>& out_bytes) {
    FILE* f = fopen(path, "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size <= 0) { fclose(f); return false; }
    out_bytes.resize(static_cast<size_t>(size));
    size_t n = fread(out_bytes.data(), 1, static_cast<size_t>(size), f);
    fclose(f);
    return n == static_cast<size_t>(size);
}

// ---------------------------------------------------------------------------
// WasmHost
// ---------------------------------------------------------------------------
WasmHost::WasmHost() = default;

WasmHost::~WasmHost() {
    cleanup();
    if (m_initialized) {
        wasm_runtime_destroy();
        m_initialized = false;
    }
}

bool WasmHost::init() {
    if (m_initialized) return true;
    wasm_runtime_init();
    m_initialized = true;
    return true;
}

bool WasmHost::load(const uint8_t* wasm_bytes, uint32_t wasm_size,
                    const char* module_name) {
    if (!m_initialized) {
        m_error = "WAMR runtime not initialized";
        return false;
    }
    cleanup();

    // Copy into m_wasm_bytes so the buffer outlives m_module.
    // WAMR stores raw pointers into this buffer for export name strings.
    m_wasm_bytes.assign(wasm_bytes, wasm_bytes + wasm_size);

    char err[1024] = {};
    m_module = wasm_runtime_load(
        m_wasm_bytes.data(), static_cast<uint32_t>(m_wasm_bytes.size()),
        err, sizeof(err) - 1);
    if (!m_module) {
        m_error = err;
        m_wasm_bytes.clear();
        return false;
    }
    return true;
}

bool WasmHost::load_file(const char* path, const char* module_name) {
    std::vector<uint8_t> bytes;
    if (!wasm_host_load_file(path, bytes)) {
        m_error = std::string("Failed to read file: ") + path;
        return false;
    }
    return load(bytes.data(), static_cast<uint32_t>(bytes.size()), module_name);
}

bool WasmHost::instantiate(uint32_t stack_size, uint32_t heap_size) {
    if (!m_module) {
        m_error = "No module loaded";
        return false;
    }
    char err[1024] = {};
    m_instance = wasm_runtime_instantiate(
        m_module, stack_size, heap_size,
        err, sizeof(err) - 1);
    if (!m_instance) {
        m_error = err;
        return false;
    }
    m_exec_env = wasm_runtime_create_exec_env(m_instance, stack_size);
    if (!m_exec_env) {
        m_error = "Failed to create execution environment";
        wasm_runtime_deinstantiate(m_instance);
        m_instance = nullptr;
        return false;
    }
    return true;
}

wasm_function_inst_t WasmHost::lookup_function(const char* name) {
    if (!m_instance) {
        m_error = "No module instantiated";
        return nullptr;
    }
    return wasm_runtime_lookup_function(m_instance, name);
}

uint32_t WasmHost::wasm_malloc(uint32_t size, void** native_ptr) {
    if (!m_instance) {
        m_error = "No module instantiated";
        return 0;
    }
    void* p = nullptr;
    uint32_t wptr = wasm_runtime_module_malloc(m_instance, size, &p);
    if (native_ptr) *native_ptr = p;
    return wptr;
}

void WasmHost::wasm_free(uint32_t wasm_ptr) {
    if (m_instance) wasm_runtime_module_free(m_instance, wasm_ptr);
}

void* WasmHost::addr_to_native(uint32_t wasm_ptr) {
    if (!m_instance) return nullptr;
    return wasm_runtime_addr_app_to_native(m_instance, wasm_ptr);
}

void WasmHost::cleanup() {
    if (m_exec_env) {
        wasm_runtime_destroy_exec_env(m_exec_env);
        m_exec_env = nullptr;
    }
    if (m_instance) {
        wasm_runtime_deinstantiate(m_instance);
        m_instance = nullptr;
    }
    if (m_module) {
        wasm_runtime_unload(m_module);
        m_module = nullptr;
        m_wasm_bytes.clear();
    }
}
