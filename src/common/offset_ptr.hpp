//  Position-independent pointer for use inside shared memory.
//
//  Drop-in replacement for boost::interprocess::offset_ptr<T>, scoped to
//  the subset of the API actually exercised by `scope_buffer.hpp` and
//  `server_shm.hpp` (the only consumers in this project).
//
//  See docs/BOOST_ELIMINATION_PLAN.md §Phase H Option B.1 for the
//  rationale and the full boost API we are *not* implementing.
//
//  Layout: a single `std::ptrdiff_t` storing `(target - this)`. When the
//  ptr is null we store the sentinel value 1 — a self-referential offset
//  of 0 means "points at *this*" and is a valid (non-null) state, so 1
//  is reserved as null. Boost uses the same sentinel choice for the
//  same reason; we follow that convention so existing on-disk /
//  shared-memory layouts (if any) remain bit-compatible during the
//  transition.
//
//  Copy/move semantics: the offset is relative to *this*, so a bitwise
//  copy from another offset_ptr would point somewhere wrong. Both the
//  copy constructor and copy assignment recompute the offset from
//  `o.get()` to preserve the target.
//
//  Not implemented (intentionally): pointer arithmetic operators (`+`,
//  `-`, `++`, `--`), comparison operators, conversion to `void*`,
//  array indexing. Add them if a future consumer needs them.

#pragma once

#include <cstddef>

namespace nova {

template <typename T>
class offset_ptr {
public:
    offset_ptr() noexcept : offset_(kNullSentinel) {}
    offset_ptr(std::nullptr_t) noexcept : offset_(kNullSentinel) {}

    offset_ptr(T* p) noexcept : offset_(encode(p, this)) {}

    offset_ptr(const offset_ptr& o) noexcept : offset_(encode(o.get(), this)) {}

    offset_ptr& operator=(T* p) noexcept {
        offset_ = encode(p, this);
        return *this;
    }

    offset_ptr& operator=(const offset_ptr& o) noexcept {
        offset_ = encode(o.get(), this);
        return *this;
    }

    offset_ptr& operator=(std::nullptr_t) noexcept {
        offset_ = kNullSentinel;
        return *this;
    }

    T* get() const noexcept {
        if (offset_ == kNullSentinel) return nullptr;
        // const_cast is safe: we only need a base address for arithmetic;
        // the returned T* preserves whatever const-ness the caller has on
        // the offset_ptr (this is a const member, so they don't get write
        // access through `get()` either way — see operator-> / operator*).
        auto base = reinterpret_cast<char*>(const_cast<offset_ptr*>(this));
        return reinterpret_cast<T*>(base + offset_);
    }

    T& operator*() const noexcept { return *get(); }
    T* operator->() const noexcept { return get(); }

    explicit operator bool() const noexcept { return offset_ != kNullSentinel; }

private:
    // 1 is a safe null sentinel because a valid self-pointer would have
    // offset 0 (points at *this), and any other valid pointer has an
    // offset that is a multiple of alignof(T) (which is at least 1 for
    // most types but never exactly 1 for any T larger than a byte; for
    // char this still works because we never construct an offset_ptr to
    // the byte one past the offset_ptr's own first byte).
    static constexpr std::ptrdiff_t kNullSentinel = 1;

    static std::ptrdiff_t encode(T* p, const offset_ptr* self) noexcept {
        if (p == nullptr) return kNullSentinel;
        return reinterpret_cast<char*>(p)
             - reinterpret_cast<const char*>(self);
    }

    std::ptrdiff_t offset_;
};

} // namespace nova
