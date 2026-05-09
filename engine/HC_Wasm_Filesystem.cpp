/*
 * HC_Wasm_Filesystem.cpp - WASM filesystem abstraction implementation
 */

#ifdef SC_WASM

#include "HC_Wasm_Filesystem.hpp"
#include <cstring>

namespace sc_wasm {

// ============================================================================
// AssetStore Implementation
// ============================================================================

AssetStore& AssetStore::instance() {
    static AssetStore store;
    return store;
}

void AssetStore::register_asset(const std::string& path, const uint8_t* data, size_t size,
                                const std::string& mime_type) {
    if (!data || size == 0) {
        return;
    }

    Asset asset;
    asset.data.assign(data, data + size);
    asset.mime_type = mime_type;
    assets_[path] = asset;
}

const AssetStore::Asset* AssetStore::get_asset(const std::string& path) const {
    auto it = assets_.find(path);
    if (it != assets_.end()) {
        return &it->second;
    }
    return nullptr;
}

bool AssetStore::has_asset(const std::string& path) const {
    return assets_.find(path) != assets_.end();
}

void AssetStore::clear() {
    assets_.clear();
}

// ============================================================================
// WasmFileStream Implementation
// ============================================================================

WasmFileStream::WasmFileStream(const std::string& path)
    : data_(nullptr), size_(0), position_(0) {
    const AssetStore::Asset* asset = AssetStore::instance().get_asset(path);
    if (asset) {
        data_ = asset->data.data();
        size_ = asset->data.size();
    }
}

WasmFileStream::~WasmFileStream() {
    // No cleanup needed; data_ points to AssetStore's memory
}

size_t WasmFileStream::read(void* buf, size_t size) {
    if (!is_open()) {
        return 0;
    }

    size_t to_read = std::min(size, remaining());
    if (to_read > 0) {
        std::memcpy(buf, data_ + position_, to_read);
        position_ += to_read;
    }
    return to_read;
}

int WasmFileStream::seek(long offset, int whence) {
    if (!data_) {
        return -1;
    }

    long new_pos = position_;
    switch (whence) {
        case 0: // SEEK_SET
            new_pos = offset;
            break;
        case 1: // SEEK_CUR
            new_pos += offset;
            break;
        case 2: // SEEK_END
            new_pos = (long)size_ + offset;
            break;
        default:
            return -1;
    }

    if (new_pos < 0 || new_pos > (long)size_) {
        return -1;
    }

    position_ = new_pos;
    return 0;
}

} // namespace sc_wasm

#endif // SC_WASM
