//  alignment utility functions
//  Copyright (C) 2024 SuperCollider Developers
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

#pragma once

#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace nova {

// Check if a pointer is aligned to the given alignment
inline bool is_aligned(const void* p, size_t alignment) {
    return (reinterpret_cast<uintptr_t>(p) % alignment) == 0;
}

// Check if an integer value is a multiple of `alignment`. Used by SIMD
// inner loops that branch on whether the block size aligns to the SIMD
// vector width — e.g. `is_aligned(BUFLENGTH, 16)`. Matches the
// integer-arg form of the previously-used `boost::alignment::is_aligned`.
template <typename Int,
          typename = std::enable_if_t<std::is_integral_v<Int>>>
inline bool is_aligned(Int n, size_t alignment) {
    return (static_cast<size_t>(n) % alignment) == 0;
}

} // namespace nova
