# Emscripten CMake Toolchain for SuperCollider WASM builds
# Usage: cmake -DCMAKE_TOOLCHAIN_FILE=cmake_modules/EmscriptenToolchain.cmake -DSC_WASM=ON <build-dir>
#
# Requirements:
#  - Emscripten SDK installed and EMSDK environment set up
#  - Typically: source /path/to/emsdk/emsdk_env.sh
#  - Emscripten 3.1.0 or later (for SIMD support)

# Set compiler and flags for Emscripten
set(CMAKE_SYSTEM_NAME Emscripten)
set(CMAKE_SYSTEM_VERSION 1)

# Find emscripten toolchain
if(DEFINED ENV{EMSDK})
  set(EMSCRIPTEN_TOOLCHAIN_PATH "$ENV{EMSDK}/upstream/emscripten")
  set(EMSCRIPTEN_SYSROOT "$ENV{EMSDK}/upstream/emscripten/cache/sysroot")
else()
  # Try to find emcc in PATH
  find_program(EMCC_PROGRAM emcc REQUIRED)
  get_filename_component(EMSCRIPTEN_TOOLCHAIN_PATH "${EMCC_PROGRAM}" DIRECTORY)
  # Look for sysroot in common locations
  if(EXISTS "${EMSCRIPTEN_TOOLCHAIN_PATH}/cache/sysroot")
    set(EMSCRIPTEN_SYSROOT "${EMSCRIPTEN_TOOLCHAIN_PATH}/cache/sysroot")
  elseif(EXISTS "/opt/homebrew/Cellar/emscripten/5.0.5/libexec/cache/sysroot")
    set(EMSCRIPTEN_SYSROOT "/opt/homebrew/Cellar/emscripten/5.0.5/libexec/cache/sysroot")
  else()
    # Fallback: use emcc to find the sysroot
    execute_process(COMMAND ${EMCC_PROGRAM} -print-libgcc-file-name OUTPUT_VARIABLE SYSROOT_TEST OUTPUT_STRIP_TRAILING_WHITESPACE)
    get_filename_component(EMSCRIPTEN_SYSROOT "${SYSROOT_TEST}" DIRECTORY)
    get_filename_component(EMSCRIPTEN_SYSROOT "${EMSCRIPTEN_SYSROOT}/../.." ABSOLUTE)
  endif()
endif()

message(STATUS "Using Emscripten at: ${EMSCRIPTEN_TOOLCHAIN_PATH}")
message(STATUS "Using Emscripten sysroot at: ${EMSCRIPTEN_SYSROOT}")

# Add Emscripten sysroot include paths
if(EXISTS "${EMSCRIPTEN_SYSROOT}/include")
  list(APPEND CMAKE_C_IMPLICIT_INCLUDE_DIRECTORIES "${EMSCRIPTEN_SYSROOT}/include")
  list(APPEND CMAKE_CXX_IMPLICIT_INCLUDE_DIRECTORIES "${EMSCRIPTEN_SYSROOT}/include")
  include_directories("${EMSCRIPTEN_SYSROOT}/include")
  message(STATUS "Added Emscripten sysroot include path: ${EMSCRIPTEN_SYSROOT}/include")
endif()

# ccache: wrap emcc/em++ for caching across clean builds and branch switches.
# Install: brew install ccache
# Stats:   ccache --show-stats
# Reset:   ccache --clear
# Config:  ccache --max-size=20G  (default is 5G)
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
  message(STATUS "ccache found: ${CCACHE_PROGRAM} — compiler output will be cached")
  set(CMAKE_C_COMPILER_LAUNCHER   "${CCACHE_PROGRAM}")
  set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
else()
  message(STATUS "ccache not found (optional) — install with: brew install ccache")
endif()

# Set C/C++ compilers
set(CMAKE_C_COMPILER "${EMSCRIPTEN_TOOLCHAIN_PATH}/emcc")
set(CMAKE_CXX_COMPILER "${EMSCRIPTEN_TOOLCHAIN_PATH}/em++")
set(CMAKE_AR "${EMSCRIPTEN_TOOLCHAIN_PATH}/emar")
set(CMAKE_RANLIB "${EMSCRIPTEN_TOOLCHAIN_PATH}/emranlib")

# Emscripten-specific flags
set(EMSCRIPTEN_FLAGS "-fPIC")

# Enable SIMD by default (wasm_simd128)
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -msimd128")

# Disable some problematic features for WASM
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${EMSCRIPTEN_FLAGS} -Wno-warn-absolute-paths")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${EMSCRIPTEN_FLAGS} -Wno-warn-absolute-paths -std=c++20")

# Linker flags
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -lembind")

# Disable executable checks that don't work cross-compiling
set(CMAKE_C_ABI_COMPILED 1)
set(CMAKE_CXX_ABI_COMPILED 1)

# Set build type
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# Add optimization flags
if(CMAKE_BUILD_TYPE STREQUAL "Release")
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O3")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3")
elseif(CMAKE_BUILD_TYPE STREQUAL "Debug")
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -g -O0")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -g -O0")
endif()

# SC_WASM_FAST_BUILD: swap -O3 → -O2 to cut Binaryen/wasm-opt link time 2-3×.
# Enable via the wasm_dev preset or -DSC_WASM_FAST_BUILD=ON.
if(SC_WASM_FAST_BUILD)
  string(REPLACE "-O3" "-O2" CMAKE_C_FLAGS   "${CMAKE_C_FLAGS}")
  string(REPLACE "-O3" "-O2" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")
  message(STATUS "SC_WASM_FAST_BUILD: -O3 → -O2 (faster link; for dev iteration only)")
endif()

# Set shared library suffix
set(CMAKE_SHARED_LIBRARY_SUFFIX ".js")
set(CMAKE_STATIC_LIBRARY_SUFFIX ".a")

# Disable shared libraries by default (WASM prefers static linking)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libraries" FORCE)

message(STATUS "Emscripten toolchain configured")
message(STATUS "C compiler: ${CMAKE_C_COMPILER}")
message(STATUS "C++ compiler: ${CMAKE_CXX_COMPILER}")
