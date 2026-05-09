/*
    SuperCollider real time audio synthesis system
    Copyright (c) 2026
*/

#include "SC_Wasm_DiskIOBackend.h"

#include <cstdio>
#include <string>

#ifdef SC_WASM

extern "C" {

enum class DiskIOBackendKind {
    None,
    NativeFsCli,
    IdbfsBrowser,
};

static DiskIOBackendKind g_backend_kind = DiskIOBackendKind::None;
static std::string g_mount_root = "/";
static std::string g_status_message = "WASM: DiskIO backend unavailable (IDBFS/OPFS integration pending).";

bool sc_wasm_diskio_backend_available() {
    return g_backend_kind != DiskIOBackendKind::None;
}

const char* sc_wasm_diskio_backend_name() {
    switch (g_backend_kind) {
    case DiskIOBackendKind::NativeFsCli:
        return "nativefs-cli";
    case DiskIOBackendKind::IdbfsBrowser:
        return "idbfs";
    case DiskIOBackendKind::None:
    default:
        return "none";
    }
}

const char* sc_wasm_diskio_backend_status_message() {
    return g_status_message.c_str();
}

void sc_wasm_diskio_backend_configure_nativefs(const char* mount_root) {
    g_backend_kind = DiskIOBackendKind::NativeFsCli;
    g_mount_root = (mount_root && mount_root[0] != '\0') ? mount_root : "/";

    char buf[256];
    std::snprintf(buf, sizeof(buf),
                  "WASM: DiskIO backend enabled for CLI native FS (mount root: %s).",
                  g_mount_root.c_str());
    g_status_message = buf;
}

void sc_wasm_diskio_backend_configure_idbfs(const char* mount_root) {
    g_backend_kind = DiskIOBackendKind::IdbfsBrowser;
    g_mount_root = (mount_root && mount_root[0] != '\0') ? mount_root : "/sc_persist";

    char buf[256];
    std::snprintf(buf, sizeof(buf),
                  "WASM: DiskIO backend enabled for browser IDBFS (mount root: %s).",
                  g_mount_root.c_str());
    g_status_message = buf;
}

} // extern "C"

#endif
