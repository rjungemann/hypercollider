#ifndef HC_WASM_HOST_H
#define HC_WASM_HOST_H

#include "wasm_export.h"
#include <cstdint>
#include <string>
#include <vector>

// Load raw bytes from a file on disk
bool wasm_host_load_file(const char* path, std::vector<uint8_t>& out_bytes);

class WasmHost {
public:
    WasmHost();
    ~WasmHost();

    // Initialize WAMR runtime (call once at startup)
    bool init();

    // Load a WASM module from a byte blob
    bool load(const uint8_t* wasm_bytes, uint32_t wasm_size,
              const char* module_name = "module");

    // Load a WASM module from a file path (development fallback)
    bool load_file(const char* path, const char* module_name = "module");

    // Instantiate the loaded module
    bool instantiate(uint32_t stack_size = 65536,
                     uint32_t heap_size  = 32u * 1024u * 1024u);

    // Lookup an exported function
    wasm_function_inst_t lookup_function(const char* name);

    // Call a WASM function using WAMR's typed variadic API.
    // num_results: expected return value count (0 or 1 for HC API).
    // results:     output array of wasm_val_t (may be nullptr when num_results==0).
    // args...:     native C values matching the WASM param types
    //              (int32_t for i32, float for f32, etc.).
    template<typename... Args>
    bool call(const char* func_name,
              uint32_t num_results, wasm_val_t* results,
              Args... args)
    {
        wasm_function_inst_t fn = lookup_function(func_name);
        if (!fn) {
            m_error = std::string("Function not found: ") + func_name;
            return false;
        }
        if (!wasm_runtime_call_wasm_v(m_exec_env, fn,
                                      num_results, results,
                                      static_cast<uint32_t>(sizeof...(args)),
                                      args...)) {
            const char* exc = wasm_runtime_get_exception(m_instance);
            m_error = exc ? exc : "unknown exception";
            return false;
        }
        return true;
    }

    // Convenience wrappers
    bool call_v(const char* func_name) {
        return call(func_name, 0u, nullptr);
    }
    bool call_i(const char* func_name, int32_t* out) {
        wasm_val_t r[1]{};
        if (!call(func_name, 1u, r)) return false;
        if (out) *out = r[0].of.i32;
        return true;
    }

    // Allocate inside WASM linear memory; returns WASM address.
    // *native_ptr is set to the host-side pointer for the same memory.
    uint32_t wasm_malloc(uint32_t size, void** native_ptr = nullptr);

    // Free a WASM linear memory address
    void wasm_free(uint32_t wasm_ptr);

    // Translate a WASM linear-memory address to a native pointer
    void* addr_to_native(uint32_t wasm_ptr);

    // Destroy exec_env, instance, and unload module (runtime stays alive)
    void cleanup();

    // Last error from a failed operation
    const std::string& get_error() const { return m_error; }

    // Raw WAMR handles (needed for wasm_runtime_register_natives, etc.)
    wasm_module_inst_t get_instance()  const { return m_instance; }
    wasm_exec_env_t    get_exec_env()  const { return m_exec_env;  }

private:
    wasm_module_t        m_module      = nullptr;
    wasm_module_inst_t   m_instance    = nullptr;
    wasm_exec_env_t      m_exec_env    = nullptr;
    std::string          m_error;
    bool                 m_initialized = false;
    // Buffer keeping the WASM binary alive — WAMR stores raw pointers
    // into the original binary data, so this must outlive m_module.
    std::vector<uint8_t> m_wasm_bytes;
};

#endif // HC_WASM_HOST_H
