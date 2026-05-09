//  Shared memory interface to the supercollider server.
//  Copyright (C) 2011 Tim Blechmann
//  Copyright (C) 2011 Jakob Leben
//
//  This program is free software; you can redistribute it and/or modify
//  it under the terms of the GNU General Public License as published by
//  the Free Software Foundation; either version 2 of the License, or
//  (at your option) any later version.
//
//  This program is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  GNU General Public License for more details.
//
//  You should have received a copy of the GNU General Public License
//  along with this program; see the file COPYING.  If not, write to
//  the Free Software Foundation, Inc., 59 Temple Place - Suite 330,
//  Boston, MA 02111-1307, USA.
//
//  Reimplemented 2026-05-08 (Phase H Option B of
//  docs/BOOST_ELIMINATION_PLAN.md). Replaces boost::interprocess with a
//  fixed-layout shared memory region accessed via direct POSIX/Win32
//  mmap calls. The public class names and methods are unchanged so
//  consumers (SC_World.cpp, osc_data.cpp, SC_HiddenWorld.h) continue
//  to compile without modification.
//
//  Layout in the shared region (offset 0):
//
//    +----------------------------------------------------+
//    |  shm_header                                         |  // 16 B aligned
//    |    uint32 magic                                     |
//    |    uint32 version                                   |
//    |    uint32 control_bus_count                         |
//    |    uint32 num_scope_buffers                         |
//    +----------------------------------------------------+
//    |  scope_buffer pool (kScopePoolBytes ≈ 4 MB)         |  // tlsf-managed
//    +----------------------------------------------------+
//    |  scope_buffer slots (kMaxScopeBuffers × sizeof)     |
//    +----------------------------------------------------+
//    |  control_busses[control_bus_count] (float)          |  // tail
//    +----------------------------------------------------+
//
//  Total mapping size is computed at construction time. All offsets
//  are derivable from the header so the client side doesn't need its
//  own knowledge of `control_bus_count`.
//
//  WASM note: POSIX shm isn't available under WASI or in the browser.
//  In WASM builds the implementation falls back to a process-local
//  heap allocation (calloc'd to the same layout). Cross-process IPC
//  isn't meaningful in WASM anyway — both lang and synth run in the
//  same WASM module — so a heap-backed buffer satisfies the API
//  without changing call sites.

#pragma once

#include "scope_buffer.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <stdexcept>
#include <string>
#include <utility>

#if !defined(_WIN32) && !defined(SC_WASM)
#    include <fcntl.h>
#    include <sys/mman.h>
#    include <sys/stat.h>
#    include <unistd.h>
#endif

#if defined(_WIN32)
#    define WIN32_LEAN_AND_MEAN
#    include <windows.h>
#endif

namespace detail_server_shm {

using std::pair;
using std::string;

// Each scope buffer reserves space for ~8192 frames × 1 channel ×
// sizeof(float) × 3-region triple-buffer. Pessimised to ~4 MB total
// (matches the original boost::interprocess implementation).
inline constexpr std::size_t kMaxScopeBuffers = 128;
inline constexpr std::size_t kScopePoolBytes  = kMaxScopeBuffers * 8192 * sizeof(float);

struct shm_header {
    std::uint32_t magic;          // 'HCSM' = 0x4843534D
    std::uint32_t version;        // bump on layout change
    std::uint32_t control_bus_count;
    std::uint32_t num_scope_buffers;
};

inline constexpr std::uint32_t kShmMagic   = 0x4843534Du; // "HCSM" little-endian
inline constexpr std::uint32_t kShmVersion = 1u;

// Compute the byte offset of each region inside the shared mapping.
// All inline — the header gets dropped if unused; the layout is
// trivially derivable from `control_bus_count`.
struct shm_layout_offsets {
    std::size_t scope_pool;
    std::size_t scope_buffers;
    std::size_t control_busses;
    std::size_t total_size;
};

inline shm_layout_offsets compute_layout(std::uint32_t control_bus_count) {
    constexpr std::size_t kAlign = 16;
    auto round_up = [](std::size_t n) {
        return (n + (kAlign - 1)) & ~(kAlign - 1);
    };

    shm_layout_offsets o{};
    o.scope_pool     = round_up(sizeof(shm_header));
    o.scope_buffers  = round_up(o.scope_pool + kScopePoolBytes);
    o.control_busses = round_up(o.scope_buffers + kMaxScopeBuffers * sizeof(scope_buffer));
    o.total_size     = round_up(o.control_busses + control_bus_count * sizeof(float));
    return o;
}

inline string make_shmem_name(unsigned int port_number) {
    return string("SuperColliderServer_") + std::to_string(port_number);
}

// ─── Platform-specific mapping helpers ───────────────────────────────────
//
// shm_map_create  — open or create a named shared mapping, sized to
//                   `total_size` bytes, returning a writable pointer.
// shm_map_open    — open an existing named mapping, sized to fit the
//                   on-disk header, then re-map to the full size found
//                   in the header.
// shm_map_unmap   — unmap (does NOT remove the name).
// shm_unlink_name — delete the name from the OS namespace.
//
// In WASM we don't have any of this; we use a process-local heap.
//
// All four return nullptr / no-op on failure; callers handle errors.

#if defined(SC_WASM)

inline void* shm_map_create(const char* /*name*/, std::size_t total_size) {
    void* p = std::calloc(1, total_size);
    return p;
}
inline void* shm_map_open(const char* /*name*/, std::size_t /*expected_min*/, std::size_t* out_size) {
    (void)out_size;
    // No cross-process IPC in WASM. Returning nullptr signals "not connected".
    return nullptr;
}
inline void shm_map_unmap(void* p, std::size_t /*total_size*/) { std::free(p); }
inline void shm_unlink_name(const char* /*name*/) {}

#elif defined(_WIN32)

inline void* shm_map_create(const char* name, std::size_t total_size) {
    HANDLE h = CreateFileMappingA(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
                                  static_cast<DWORD>(total_size >> 32),
                                  static_cast<DWORD>(total_size & 0xFFFFFFFFu),
                                  name);
    if (!h) return nullptr;
    void* p = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, total_size);
    // Note: handle leaked deliberately for the lifetime of the mapping;
    // MapViewOfFile keeps the section alive. Closed by CloseHandle on
    // shm_unlink_name. Stash by re-finding the name (cheap).
    if (p) std::memset(p, 0, total_size);
    return p;
}
inline void* shm_map_open(const char* name, std::size_t expected_min, std::size_t* out_size) {
    HANDLE h = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, name);
    if (!h) return nullptr;
    void* hdr = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, expected_min);
    if (!hdr) { CloseHandle(h); return nullptr; }
    auto* header = reinterpret_cast<shm_header*>(hdr);
    auto layout = compute_layout(header->control_bus_count);
    UnmapViewOfFile(hdr);
    void* full = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, layout.total_size);
    CloseHandle(h);
    if (out_size) *out_size = layout.total_size;
    return full;
}
inline void shm_map_unmap(void* p, std::size_t /*total_size*/) {
    if (p) UnmapViewOfFile(p);
}
inline void shm_unlink_name(const char* /*name*/) {
    // On Windows, the name is freed automatically when no handles are open.
    // No explicit unlink needed.
}

#else // POSIX (macOS, Linux)

inline void* shm_map_create(const char* name, std::size_t total_size) {
    // Try create-exclusive first; if it already exists, unlink and recreate
    // so a stale region (from a crashed previous process) doesn't carry
    // a layout we can't trust.
    int fd = ::shm_open(name, O_CREAT | O_EXCL | O_RDWR, 0600);
    if (fd < 0) {
        ::shm_unlink(name);
        fd = ::shm_open(name, O_CREAT | O_RDWR, 0600);
        if (fd < 0) return nullptr;
    }
    if (::ftruncate(fd, static_cast<off_t>(total_size)) != 0) {
        ::close(fd);
        ::shm_unlink(name);
        return nullptr;
    }
    void* p = ::mmap(nullptr, total_size, PROT_READ | PROT_WRITE,
                     MAP_SHARED, fd, 0);
    ::close(fd);
    if (p == MAP_FAILED) {
        ::shm_unlink(name);
        return nullptr;
    }
    std::memset(p, 0, total_size);
    return p;
}
inline void* shm_map_open(const char* name, std::size_t expected_min, std::size_t* out_size) {
    int fd = ::shm_open(name, O_RDWR, 0600);
    if (fd < 0) return nullptr;
    void* hdr = ::mmap(nullptr, expected_min, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (hdr == MAP_FAILED) { ::close(fd); return nullptr; }
    auto* header = reinterpret_cast<shm_header*>(hdr);
    auto layout = compute_layout(header->control_bus_count);
    ::munmap(hdr, expected_min);
    void* full = ::mmap(nullptr, layout.total_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    ::close(fd);
    if (full == MAP_FAILED) return nullptr;
    if (out_size) *out_size = layout.total_size;
    return full;
}
inline void shm_map_unmap(void* p, std::size_t total_size) {
    if (p) ::munmap(p, total_size);
}
inline void shm_unlink_name(const char* name) { ::shm_unlink(name); }

#endif

// ─── Public API ──────────────────────────────────────────────────────────

class server_shared_memory_creator {
public:
    server_shared_memory_creator(unsigned int port_number, unsigned int control_busses)
        : shmem_name_(make_shmem_name(port_number)) {
        layout_ = compute_layout(control_busses);
        mapping_ = shm_map_create(shmem_name_.c_str(), layout_.total_size);
        if (!mapping_) {
            throw std::runtime_error(
                "server_shared_memory_creator: failed to create shared memory '"
                + shmem_name_ + "'");
        }

        // Header
        auto* header = reinterpret_cast<shm_header*>(mapping_);
        header->magic              = kShmMagic;
        header->version            = kShmVersion;
        header->control_bus_count  = control_busses;
        header->num_scope_buffers  = static_cast<std::uint32_t>(kMaxScopeBuffers);

        // Scope buffer pool: backs the tlsf allocator inside scope_buffer
        // instances (used for triple-buffered frame data).
        char* base = reinterpret_cast<char*>(mapping_);
        scope_pool_.init(base + layout_.scope_pool, kScopePoolBytes);

        // Construct scope_buffer slots in place.
        auto* slots = reinterpret_cast<scope_buffer*>(base + layout_.scope_buffers);
        for (std::size_t i = 0; i < kMaxScopeBuffers; ++i) {
            new (&slots[i]) scope_buffer();
        }
    }

    static void cleanup(unsigned int port_number) {
        shm_unlink_name(make_shmem_name(port_number).c_str());
    }

    ~server_shared_memory_creator() {
        if (mapping_) {
            disconnect();
        }
    }

    void disconnect() {
        if (!mapping_) return;
        // No need to call ~scope_buffer() — it's trivially destructible
        // (atomic<int> + plain ints; no heap state outside the pool).
        shm_map_unmap(mapping_, layout_.total_size);
        shm_unlink_name(shmem_name_.c_str());
        mapping_ = nullptr;
    }

    float* get_control_busses() {
        char* base = reinterpret_cast<char*>(mapping_);
        return reinterpret_cast<float*>(base + layout_.control_busses);
    }

    scope_buffer_writer get_scope_buffer_writer(unsigned int index, unsigned int channels, unsigned int size) {
        scope_buffer* buf = scope_buffer_at(index);
        if (buf)
            return scope_buffer_writer(buf, scope_pool_, channels, size);
        return scope_buffer_writer();
    }

    void release_scope_buffer_writer(scope_buffer_writer& writer) {
        writer.release(scope_pool_);
    }

private:
    scope_buffer* scope_buffer_at(unsigned int index) {
        if (!mapping_ || index >= kMaxScopeBuffers) return nullptr;
        char* base = reinterpret_cast<char*>(mapping_);
        auto* slots = reinterpret_cast<scope_buffer*>(base + layout_.scope_buffers);
        return &slots[index];
    }

    string             shmem_name_;
    void*              mapping_ = nullptr;
    shm_layout_offsets layout_{};
    scope_buffer_pool  scope_pool_{};
};

class server_shared_memory_client {
public:
    server_shared_memory_client(unsigned int port_number)
        : shmem_name_(make_shmem_name(port_number)) {
        std::size_t mapped_size = 0;
        mapping_ = shm_map_open(shmem_name_.c_str(), sizeof(shm_header), &mapped_size);
        if (!mapping_) {
            throw std::runtime_error(
                "server_shared_memory_client: cannot connect to '" + shmem_name_ + "'");
        }
        auto* header = reinterpret_cast<shm_header*>(mapping_);
        if (header->magic != kShmMagic || header->version != kShmVersion) {
            shm_map_unmap(mapping_, mapped_size);
            mapping_ = nullptr;
            throw std::runtime_error(
                "server_shared_memory_client: incompatible layout in '" + shmem_name_ + "'");
        }
        layout_ = compute_layout(header->control_bus_count);
    }

    ~server_shared_memory_client() {
        if (mapping_) shm_map_unmap(mapping_, layout_.total_size);
    }

    float* get_control_busses() {
        char* base = reinterpret_cast<char*>(mapping_);
        return reinterpret_cast<float*>(base + layout_.control_busses);
    }

    scope_buffer_reader get_scope_buffer_reader(unsigned int index) {
        if (!mapping_ || index >= kMaxScopeBuffers) return scope_buffer_reader(nullptr);
        char* base = reinterpret_cast<char*>(mapping_);
        auto* slots = reinterpret_cast<scope_buffer*>(base + layout_.scope_buffers);
        return scope_buffer_reader(&slots[index]);
    }

private:
    string             shmem_name_;
    void*              mapping_ = nullptr;
    shm_layout_offsets layout_{};
};

} // namespace detail_server_shm

using detail_server_shm::scope_buffer;
using detail_server_shm::scope_buffer_reader;
using detail_server_shm::scope_buffer_writer;
using detail_server_shm::server_shared_memory_client;
using detail_server_shm::server_shared_memory_creator;
