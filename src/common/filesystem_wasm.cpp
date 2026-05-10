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
=======
/*
 * SC_Filesystem_wasm.cpp
 *
 * SC_Filesystem platform implementation for WebAssembly builds.
 *
 * For WASM, the browser sandbox has no meaningful filesystem hierarchy, so all
 * "default directory" helpers return empty paths or fixed virtual paths.
 * Glob support returns no results (no directory scanning at runtime).
 *
 * For both Emscripten (Node.js) and WASI (WAMR) builds, paths must match what
 * the CLI/host mounts into the virtual filesystem:
 * - UserAppSupport: /home/user/.local/share/SuperCollider
 *   (so that Quarks.folder = userAppSupportDir ++ "downloaded-quarks" resolves correctly)
 * - UserHome: /home/user
 * - UserConfig: /home/user/.config/SuperCollider
 * - Resource: /usr/share/SuperCollider
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

// Use POSIX-style paths for both Emscripten and WASI builds to match what
// the CLI/host mounts into the virtual filesystem.
// This ensures Platform.userAppSupportDir resolves to the same path where
// Quarks.folder (= userAppSupportDir ++ "downloaded-quarks") is mounted.
Path SC_Filesystem::defaultSystemAppSupportDirectory() { return Path("/usr/share/SuperCollider"); }
Path SC_Filesystem::defaultUserHomeDirectory()          { return Path("/home/user"); }
Path SC_Filesystem::defaultUserAppSupportDirectory()    { return Path("/home/user/.local/share/SuperCollider"); }
Path SC_Filesystem::defaultUserConfigDirectory()        { return Path("/home/user/.config/SuperCollider"); }============================================================================
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
