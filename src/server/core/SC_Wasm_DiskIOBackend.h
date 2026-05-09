/*
    SuperCollider real time audio synthesis system
    Copyright (c) 2026
*/

#pragma once

#ifdef SC_WASM

// Phase 4.4 scaffolding: centralizes DiskIO backend capability checks for
// WASM runtime so future IDBFS/OPFS support can be integrated behind a stable API.
extern "C" {
bool sc_wasm_diskio_backend_available();
const char* sc_wasm_diskio_backend_name();
const char* sc_wasm_diskio_backend_status_message();
void sc_wasm_diskio_backend_configure_nativefs(const char* mount_root);
void sc_wasm_diskio_backend_configure_idbfs(const char* mount_root);
}

#endif
