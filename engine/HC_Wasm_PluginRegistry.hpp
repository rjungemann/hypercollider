/*
 * HC_Wasm_PluginRegistry.hpp - Static UGen registration for WASM
 *
 * In WASM builds, plugins are registered at compile time instead of using
 * dlopen() at runtime. This header provides the registry mechanism.
 *
 * Usage in plugin source:
 *   HC_WASM_REGISTER_PLUGIN(PluginName, init_func);
 *   or
 *   HC_WASM_REGISTER_UGENS(PluginName, "UGen1", "UGen2", ...);
 *
 * The registration system hooks into SuperCollider's InterfaceTable system.
 */

#ifndef HC_WASM_PLUGIN_REGISTRY_H
#define HC_WASM_PLUGIN_REGISTRY_H

#ifdef SC_WASM

#include <string>
#include <vector>
#include <unordered_map>
#include <functional>

// Forward declaration of SuperCollider's InterfaceTable
struct InterfaceTable;

namespace sc_wasm {

/**
 * \class PluginRegistry
 * \brief Global registry for statically-compiled UGens
 *
 * Each plugin registers its UGens at startup. This allows the server
 * to enumerate and instantiate UGens without runtime plugin loading.
 * 
 * The registry integrates with SuperCollider's InterfaceTable system.
 */
class PluginRegistry {
public:
    // PluginInitFunc can be std::function, function pointer, or any callable
    using PluginInitFunc = std::function<void(InterfaceTable*)>;

    static PluginRegistry& instance();

    /**
     * Register a plugin's initialization function
     * The init_func will be called with the InterfaceTable pointer at startup
     */
    template<typename Func>
    void register_plugin(const std::string& plugin_name, Func&& init_func) {
        register_plugin_impl(plugin_name, std::forward<Func>(init_func));
    }

    /**
     * Get list of registered plugin names
     */
    std::vector<std::string> get_plugin_names() const;

    /**
     * Check if a plugin is registered
     */
    bool has_plugin(const std::string& name) const;

    /**
     * Initialize all registered plugins with the given InterfaceTable
     * Called once at engine startup after InterfaceTable is created
     */
    void initialize_all(InterfaceTable* inTable);

    /**
     * Get the InterfaceTable pointer (set at initialization)
     */
    InterfaceTable* get_interface_table() const { return m_interface_table; }

private:
    void register_plugin_impl(const std::string& plugin_name, PluginInitFunc init_func);
    PluginRegistry() = default;
    std::unordered_map<std::string, PluginInitFunc> plugins_;
    InterfaceTable* m_interface_table = nullptr;
    bool initialized_ = false;
};

/**
 * \class AutoPluginRegister
 * \brief Helper class for automatic plugin registration at static init time
 *
 * Create a static instance of this class in each plugin to auto-register.
 * Registration happens during static initialization, before main().
 */
class AutoPluginRegister {
public:
    AutoPluginRegister(const std::string& plugin_name, PluginRegistry::PluginInitFunc init_func) {
        PluginRegistry::instance().register_plugin(plugin_name, init_func);
    }
};

} // namespace sc_wasm

/**
 * Macro to register a plugin with a custom init function
 * 
 * Example usage:
 *   void MyPlugin_Load(InterfaceTable* inTable);
 *   HC_WASM_REGISTER_PLUGIN(MyPlugin, MyPlugin_Load);
 */
#define HC_WASM_REGISTER_PLUGIN(PluginName, InitFunc) \
    namespace { \
        sc_wasm::AutoPluginRegister g_##PluginName##_wasm_registrar( \
            #PluginName, \
            [](InterfaceTable* inTable) { InitFunc(inTable); } \
        ); \
    }

/**
 * Macro to declare and register a plugin with inline UGen definitions
 * 
 * This is for plugins that define their UGens in a single compilation unit.
 * The UGen classes must have static Init methods that can be called.
 *
 * Example usage in ChaosUGens.cpp:
 *   HC_WASM_REGISTER_UGENS(ChaosUGens, 
 *       "Logistic", 
 *       "Henon", 
 *       "Gendyn" 
 *   );
 *
 * Note: This requires the plugin to define the UGen classes with proper
 * static initialization. The macro just ensures the plugin is registered.
 */
#define HC_WASM_REGISTER_UGENS(PluginName, ...) \
    HC_WASM_REGISTER_PLUGIN(PluginName, PluginName##_Load)

/**
 * Macro to register a plugin with no special initialization
 * (for plugins that only provide UGen definitions via static linking)
 */
#define HC_WASM_REGISTER_PLUGIN_SIMPLE(PluginName) \
    HC_WASM_REGISTER_PLUGIN(PluginName, [](InterfaceTable* inTable) {})

#endif // SC_WASM

#endif // HC_WASM_PLUGIN_REGISTRY_H
