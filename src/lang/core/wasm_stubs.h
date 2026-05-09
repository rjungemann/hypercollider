/*
 * SC_Wasm_Stubs.h
 * Stubs for functions not available in WASM builds
 */

#ifndef SC_WASM_STUBS_H
#define SC_WASM_STUBS_H

#ifdef SC_WASM

#include <cstdio>  // for FILE*

// Forward declaration
class SC_LanguageClient;

// Stub implementations for WASM
inline SC_LanguageClient* createLanguageClient(const char* /*name*/) {
    return nullptr;
}

inline void destroyLanguageClient(SC_LanguageClient* /*client*/) {
    // No-op
}

// initGUI() – called from PyrInterpreter3.cpp; no GUI in WASM
inline void initGUI() {}

// NOTE: post(), postfl(), error(), setPostFile() are defined as non-inline
// functions in SC_Wasm_RuntimeBridge.cpp so that they can forward output
// through the registered post callback.  They are declared in SCBase.h which
// is included by every translation unit that needs them.

#endif // SC_WASM

#endif // SC_WASM_STUBS_H
