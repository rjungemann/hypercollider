/*
 * HC_Wasm_PluginRegistry.cpp - Static UGen registration for WASM
 */

#ifdef SC_WASM

#include "HC_Wasm_PluginRegistry.hpp"
#include "SC_InterfaceTable.h"
#include <iostream>

namespace sc_wasm {

PluginRegistry& PluginRegistry::instance() {
    static PluginRegistry registry;
    return registry;
}

void PluginRegistry::register_plugin_impl(const std::string& plugin_name, PluginInitFunc init_func) {
    if (init_func) {
        plugins_[plugin_name] = init_func;
    }
}

std::vector<std::string> PluginRegistry::get_plugin_names() const {
    std::vector<std::string> names;
    for (const auto& pair : plugins_) {
        names.push_back(pair.first);
    }
    return names;
}

bool PluginRegistry::has_plugin(const std::string& name) const {
    return plugins_.find(name) != plugins_.end();
}

void PluginRegistry::initialize_all(InterfaceTable* inTable) {
    if (initialized_) {
        return;
    }

    m_interface_table = inTable;

    for (const auto& pair : plugins_) {
        try {
            pair.second(inTable);
        } catch (const std::exception& e) {
            std::cerr << "Error initializing plugin '" << pair.first << "': " << e.what() << std::endl;
        } catch (...) {
            std::cerr << "Unknown error initializing plugin '" << pair.first << "'" << std::endl;
        }
    }

    initialized_ = true;
}

} // namespace sc_wasm

#endif // SC_WASM
