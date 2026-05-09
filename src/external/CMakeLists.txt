# Boost was eliminated from this project in 2026-05. The bundled Boost source
# tree previously at src/external/boost (~48 MB) is gone; the only remaining
# Boost dependency is `boost::math`, fetched via CPM as a standalone-mode
# boostorg/math repo (see below).
#
# Old, removed targets:
#   - boost_thread_lib, boost_program_options_lib, boost_unit_test_framework_lib
#   - boost_regex_lib, boost_sync (compiled boost libs)
#   - boost_headers (interface lib for the bundled tree)
#
# Old, removed call sites (now using std/std-libcpp/CPM equivalents):
#   - boost::interprocess  → custom POSIX/Win32 shm + nova::offset_ptr
#   - boost::asio          → standalone Asio via CPM (Asio::asio below)
#   - boost::regex         → std::regex
#   - boost::lockfree      → moodycamel ConcurrentQueue / SPSC
#   - boost::thread/futures → std::thread + std::future
#   - boost::sync          → std::counting_semaphore
#   - boost::math          → CPM-fetched standalone boost.math
#   - boost::predef        → __SSE__ / cpu macros
#   - boost::alignment     → nova::is_aligned
#   - boost::algorithm::iequals → strcasecmp / _stricmp shim

# boost::math — header-only, fetched standalone via CPM
CPMAddPackage(
    NAME boost_math
    GITHUB_REPOSITORY boostorg/math
    GIT_TAG boost-1.86.0
    DOWNLOAD_ONLY YES
)
add_library(boost_math_lib INTERFACE)
target_include_directories(boost_math_lib INTERFACE "${boost_math_SOURCE_DIR}/include")
target_compile_definitions(boost_math_lib INTERFACE
    BOOST_MATH_STANDALONE=1
    BOOST_MATH_DISABLE_FLOAT128=1
)
add_library(Boost::math ALIAS boost_math_lib)

# Standalone Asio. Replaces the old boost::asio dependency. Header-only when
# ASIO_STANDALONE is defined. Used by `src/lang/primitives/com_port.{h,cpp}`
# and `osc_data.cpp`.
CPMAddPackage(
    NAME asio
    GITHUB_REPOSITORY chriskohlhoff/asio
    GIT_TAG asio-1-30-2
    DOWNLOAD_ONLY YES
)
add_library(asio_lib INTERFACE)
target_include_directories(asio_lib INTERFACE "${asio_SOURCE_DIR}/asio/include")
target_compile_definitions(asio_lib INTERFACE ASIO_STANDALONE=1)
# WASI / Emscripten don't have full POSIX (no pthreads_setspecific, no
# sigprocmask). Asio's detail/tss_ptr.hpp + detail/signal_blocker.hpp
# fail to compile without one of these guards. ASIO_DISABLE_THREADS
# turns off the parts of Asio that need them; the lang's com_port
# usage is single-threaded under WASI anyway.
if(SC_WASM)
    target_compile_definitions(asio_lib INTERFACE
        ASIO_DISABLE_THREADS=1
        ASIO_HAS_PTHREADS=0
    )
endif()
add_library(Asio::asio ALIAS asio_lib)

# nova-simd — header-only SIMD helpers (Tim Blechmann). Fetched via CPM
# rather than vendored. The active build (libscsynth + WASM plugins)
# uses the path exposed via the `nova_simd` interface target and
# HC_NOVA_SIMD_DIR cache variable. The sc3-plugins build also uses
# HC_NOVA_SIMD_DIR (see src/server/plugins_sc3/source/CMakeLists.txt).
CPMAddPackage(
    NAME nova-simd
    GITHUB_REPOSITORY timblechmann/nova-simd
    GIT_TAG master
    DOWNLOAD_ONLY YES
)
add_library(nova_simd INTERFACE)
target_include_directories(nova_simd INTERFACE "${nova-simd_SOURCE_DIR}")
set(HC_NOVA_SIMD_DIR "${nova-simd_SOURCE_DIR}" CACHE INTERNAL
    "CPM-fetched nova-simd source directory; reused by libscsynth and plugins")

# STK (Synthesis ToolKit) — header + implementation, fetched via CPM rather
# than vendored. The WASM build includes only the audio synthesis cores;
# networking, threading, and realtime I/O components are excluded.
# The rawwaves assets are preloaded into the Emscripten VFS at
# /stksc/rawwaves via SC_WASM_STK_PRELOAD_RAWWAVES.
CPMAddPackage(
    NAME stk
    GITHUB_REPOSITORY thestk/stk
    GIT_TAG 4.6.2
    DOWNLOAD_ONLY YES
)
set(HC_STK_SOURCE_DIR "${stk_SOURCE_DIR}" CACHE INTERNAL
    "CPM-fetched STK source directory; reused by sc3-plugins")
set(HC_STK_RAWWAVES_DIR "${stk_SOURCE_DIR}/rawwaves" CACHE INTERNAL
    "STK rawwaves asset directory for Emscripten preload")

# oscpack — removed 2026-05-08. The vendored copy at src/external/oscpack
# (288 KB) was never linked by any active target in this fork; the OSC
# functionality used at runtime comes from the engine's own
# `engine/HC_Wasm_OscShim.cpp` plus tinyosc on the native-host side.

# tlsf — Two-level segregated fit allocator. Used by scope_buffer_pool
# for Stethoscope shared memory buffer allocation (SC_World.cpp).
add_library(tlsf STATIC EXCLUDE_FROM_ALL "tlsf/src/tlsf.c")
target_compile_definitions(tlsf PRIVATE TLSF_STATISTIC=1)
target_include_directories(tlsf INTERFACE tlsf/src)
set_property(TARGET tlsf PROPERTY POSITION_INDEPENDENT_CODE TRUE)
set_property(TARGET tlsf PROPERTY FOLDER 3rdparty)

# yaml-cpp — fetched via CPM. Previously a git submodule at
# src/external/yaml-cpp; the submodule was ~6 MB even after a shallow clone.
# Pinning to a release tag keeps the build reproducible.
if(NOT SYSTEM_YAMLCPP)
    message(STATUS "Fetching yaml-cpp via CPM")
    # yaml-cpp 0.8.0's CMakeLists declares cmake_minimum_required(3.4),
    # which CMake 4.x rejects. The CMP0048-style policy bump lets it
    # configure under a modern CMake without monkey-patching the
    # downloaded sources.
    CPMAddPackage(
        NAME yaml-cpp
        GITHUB_REPOSITORY jbeder/yaml-cpp
        GIT_TAG 0.8.0
        OPTIONS
            "YAML_CPP_BUILD_TOOLS OFF"
            "YAML_CPP_BUILD_TESTS OFF"
            "YAML_CPP_BUILD_CONTRIB OFF"
            "YAML_BUILD_SHARED_LIBS OFF"
            "CMAKE_POLICY_VERSION_MINIMUM 3.5"
    )
    set_property(TARGET yaml-cpp PROPERTY FOLDER 3rdparty)
endif()
