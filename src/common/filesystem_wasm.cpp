/*
 * SC_Filesystem_wasm.cpp
 *
 * SC_Filesystem platform implementation for WebAssembly builds.
 *
 * For WASM, the browser sandbox has no meaningful filesystem hierarchy, so all
 * "default directory" helpers return empty paths or fixed virtual paths under
 * "/sc/".  Glob support returns no results (no directory scanning at runtime —
 * SynthDefs are loaded via the JS API instead).
 */

#ifdef SC_WASM

#include "filesystem.hpp"

using Path = SC_Filesystem::Path;

// ============================================================================
// Path aliases / alias resolution
// ============================================================================

Path SC_Filesystem::resolveIfAlias(const Path& p, bool& isAlias) {
    isAlias = false;
    return p;
}

// ============================================================================
// Default directory helpers
// ============================================================================

Path SC_Filesystem::defaultSystemAppSupportDirectory() { return Path("/sc/system"); }
Path SC_Filesystem::defaultUserHomeDirectory()          { return Path("/sc/home"); }
Path SC_Filesystem::defaultUserAppSupportDirectory()    { return Path("/sc/user"); }
Path SC_Filesystem::defaultUserConfigDirectory()        { return Path("/sc/config"); }
// Match the --preload-file destination in lang/CMakeLists.txt:
//   --preload-file SCClassLibrary@/usr/share/SuperCollider/SCClassLibrary
// SC_LanguageConfig appends "SCClassLibrary" to the resource dir, so we
// return the parent directory of the preloaded class library.
Path SC_Filesystem::defaultResourceDirectory()          { return Path("/usr/share/SuperCollider"); }

// ============================================================================
// Platform directory name filter
// ============================================================================

bool SC_Filesystem::isNonHostPlatformDirectoryName(const std::string& s) {
    // The WASM platform is none of the known desktop platform names.
    return s == "windows" || s == "osx" || s == "linux";
}

// ============================================================================
// Glob utilities — no filesystem scanning in browser sandbox
// ============================================================================

struct SC_Filesystem::Glob {
    // Empty: no results.
};

SC_Filesystem::Glob* SC_Filesystem::makeGlob(const char* /*pattern*/) {
    return new Glob();
}

Path SC_Filesystem::globNext(Glob* /*g*/) {
    return Path(); // empty path signals end-of-glob
}

void SC_Filesystem::freeGlob(Glob* g) {
    delete g;
}

#endif // SC_WASM
