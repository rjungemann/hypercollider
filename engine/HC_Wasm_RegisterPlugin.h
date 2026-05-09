/*
 * HC_Wasm_RegisterPlugin.h - Simple plugin registration for WASM
 *
 * Include this in ONE .cpp file per sc3-plugin to register it for WASM builds.
 * Place it AFTER the PluginLoad() call in the file.
 *
 * Usage:
 *   In AntiAliasingOscillators.cpp:
 *   #include "SC_PlugIn.h"
 *   ...
 *   PluginLoad(AntiAliasingOscillators) {
 *       ...
 *   }
 *   #include "HC_Wasm_RegisterPlugin.h"
 *   HC_WASM_REGISTER_FOR_PLUGIN(AntiAliasingOscillators)
 */

#ifndef HC_WASM_REGISTER_PLUGIN_H
#define HC_WASM_REGISTER_PLUGIN_H

#ifdef SC_WASM

#include "HC_Wasm_PluginRegistry.hpp"

// Define a wrapper struct that calls the plugin load function
// This avoids lambda type issues by using a named struct with operator()
// PluginName: the name to register (for display/logging)
// LoadFuncName: the name of the PluginLoad function (without _Load suffix)
#define HC_WASM_REGISTER_FOR_PLUGIN(PluginName, LoadFuncName) \
    namespace { \
        struct PluginName##_WasmLoader { \
            void operator()(InterfaceTable* ft) const { \
                LoadFuncName##_Load(ft); \
            } \
        }; \
        struct PluginName##_WasmRegistrar { \
            PluginName##_WasmRegistrar() { \
                sc_wasm::PluginRegistry::instance().register_plugin( \
                    #PluginName, \
                    PluginName##_WasmLoader() \
                ); \
            } \
        } g_##PluginName##_wasm_registrar; \
    }

#else

// No-op registration for non-WASM builds
#define HC_WASM_REGISTER_FOR_PLUGIN(PluginName, LoadFuncName)

#endif // SC_WASM

#endif // HC_WASM_REGISTER_PLUGIN_H
