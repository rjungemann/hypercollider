/*
 * HC_Wasm_Filesystem.hpp - WASM filesystem abstraction
 *
 * Provides abstractions for file I/O in WASM context:
 * - Virtual in-memory filesystem for SynthDefs and assets
 * - JS-side asset loading via typed arrays
 * - No direct filesystem access (browser sandbox)
 */

#ifndef HC_WASM_FILESYSTEM_H
#define HC_WASM_FILESYSTEM_H

#ifdef SC_WASM

#include <string>
#include <unordered_map>
#include <vector>
#include <cstring>
#include <cstdint>
#include <memory>

namespace sc_wasm {

/**
 * \class AssetStore
 * \brief In-memory asset storage for WASM builds
 *
 * Holds SynthDefs, samples, and other binary assets loaded from JavaScript.
 * Thread-safe (no-op locks for WASM Phase 1).
 */
class AssetStore {
public:
    struct Asset {
        std::vector<uint8_t> data;
        std::string mime_type;
    };

    static AssetStore& instance();

    /**
     * Register an asset (typically called from JS via Emscripten binding)
     */
    void register_asset(const std::string& path, const uint8_t* data, size_t size,
                        const std::string& mime_type = "application/octet-stream");

    /**
     * Retrieve asset by path
     */
    const Asset* get_asset(const std::string& path) const;

    /**
     * Check if asset exists
     */
    bool has_asset(const std::string& path) const;

    /**
     * Clear all assets
     */
    void clear();

private:
    AssetStore() = default;
    std::unordered_map<std::string, Asset> assets_;
};

/**
 * \class WasmFileStream
 * \brief Virtual file stream reading from in-memory assets
 *
 * Provides FILE-like interface for reading assets without actual file I/O.
 */
class WasmFileStream {
public:
    WasmFileStream(const std::string& path);
    ~WasmFileStream();

    bool is_open() const { return data_ != nullptr && position_ <= size_; }

    // Read up to n bytes
    size_t read(void* buf, size_t size);

    // Seek to position
    int seek(long offset, int whence);

    // Get current position
    long tell() const { return position_; }

    // Get remaining bytes
    size_t remaining() const {
        return position_ < size_ ? size_ - position_ : 0;
    }

    // Get full data pointer and size
    const uint8_t* data() const { return data_; }
    size_t size() const { return size_; }

private:
    const uint8_t* data_;
    size_t size_;
    size_t position_;
};

/**
 * Helper to open an asset as a stream
 */
inline std::unique_ptr<WasmFileStream> open_asset(const std::string& path) {
    return std::make_unique<WasmFileStream>(path);
}

} // namespace sc_wasm

#endif // SC_WASM

#endif // HC_WASM_FILESYSTEM_H
