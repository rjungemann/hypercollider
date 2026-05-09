# Emscripten WASI Toolchain for SuperCollider standalone WASM builds
# Usage: cmake -DCMAKE_TOOLCHAIN_FILE=cmake_modules/EmscriptenWasiToolchain.cmake -DSC_WASM=ON -DSC_WASM_WASI=ON <build-dir>
#
# This produces WASI-compliant .wasm modules compatible with WAMR, Wasmtime, etc.
# Requirements:
#  - Emscripten SDK installed and EMSDK environment set up
#  - Emscripten 3.1.0 or later (for WASI support)

# Set compiler and flags for Emscripten
set(CMAKE_SYSTEM_NAME Emscripten)
set(CMAKE_SYSTEM_VERSION 1)

# Find emscripten toolchain (same as EmscriptenToolchain.cmake)
if(DEFINED ENV{EMSDK})
  set(EMSCRIPTEN_TOOLCHAIN_PATH "$ENV{EMSDK}/upstream/emscripten")
  set(EMSCRIPTEN_SYSROOT "$ENV{EMSDK}/upstream/emscripten/cache/sysroot")
else()
  find_program(EMCC_PROGRAM emcc REQUIRED)
  get_filename_component(EMSCRIPTEN_TOOLCHAIN_PATH "${EMCC_PROGRAM}" DIRECTORY)
  if(EXISTS "${EMSCRIPTEN_TOOLCHAIN_PATH}/cache/sysroot")
    set(EMSCRIPTEN_SYSROOT "${EMSCRIPTEN_TOOLCHAIN_PATH}/cache/sysroot")
  elseif(EXISTS "/opt/homebrew/Cellar/emscripten/5.0.5/libexec/cache/sysroot")
    set(EMSCRIPTEN_SYSROOT "/opt/homebrew/Cellar/emscripten/5.0.5/libexec/cache/sysroot")
  else()
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

# ccache support (same as EmscriptenToolchain.cmake)
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

# Enable WASM tail-call so scscm's recursive idioms compile to
# `return_call` / `return_call_indirect` rather than ordinary calls
# that consume stack. Paired with WAMR_BUILD_TAIL_CALL=1 in
# native/CMakeLists.txt so the embedded runtime accepts the new
# instructions. See docs/HCLANG_NATIVE_PLAN.md §12.3d.
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -mtail-call")

# WASI-specific flags: STANDALONE_WASM produces WASI-compliant modules.
# Note: EXIT_RUNTIME must NOT be set explicitly with STANDALONE_WASM —
# Emscripten manages it automatically (always true for programs with main()).
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -sSTANDALONE_WASM")

# Disable modularization and ES6 export (not needed for WASI)
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -sMODULARIZE=0")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -sEXPORT_ES6=0")

# Explicitly export the C API symbols for hcsynth and hclang
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -sEXPORTED_FUNCTIONS='[\"_hc_wasm_init\",\"_hc_wasm_world_create\",\"_hc_wasm_world_destroy\",\"_hc_wasm_load_synthdef\",\"_hc_wasm_synth_new\",\"_hc_wasm_synth_free\",\"_hc_wasm_synth_set\",\"_hc_wasm_render\",\"_hc_wasm_get_metrics\",\"_hc_wasm_get_status\",\"_hc_wasm_list_synthdefs\",\"_hc_wasm_list_ugens\",\"_hc_wasm_enqueue_control\",\"_hc_wasm_osc_dispatch\",\"_hc_wasm_osc_dispatch_reply\",\"_hc_wasm_osc_register_handler\",\"_hc_wasm_osc_register_world\",\"_hc_wasm_osc_send_to_sclang\",\"_malloc\",\"_free\",\"_hc_wasm_eval_init\",\"_hc_wasm_eval_boot\",\"_hc_wasm_eval_boot_sequence\",\"_hc_wasm_eval_string\",\"_hc_wasm_eval_execute\",\"_hc_wasm_eval_set_post_callback\",\"_hc_wasm_eval_set_error_callback\",\"_hc_wasm_eval_heap_end\",\"_hc_wasm_eval_status\"]'")

# Disable exception catching (C++ exceptions not fully supported in WASI)
# Note: This may need adjustment if SC code requires exceptions
# set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -fno-exceptions")

# Disable stack protector (not supported in WASI)
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -fno-stack-protector")

# Disable some problematic features for WASM
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${EMSCRIPTEN_FLAGS} -Wno-warn-absolute-paths")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${EMSCRIPTEN_FLAGS} -Wno-warn-absolute-paths -std=c++20")

# Linker flags - no embind (JS-only)
# Explicitly export the C API symbols
# Note: In Emscripten, -s flags are link-time flags that must be passed to the linker
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -sSTANDALONE_WASM -sMODULARIZE=0 -sEXPORT_ES6=0 -sWASM=1")

# Also add to compile flags for modules
set(CMAKE_MODULE_LINKER_FLAGS "${CMAKE_MODULE_LINKER_FLAGS} -sSTANDALONE_WASM -sMODULARIZE=0 -sEXPORT_ES6=0 -sWASM=1")

# And to shared library linker flags
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -sSTANDALONE_WASM -sMODULARIZE=0 -sEXPORT_ES6=0 -sWASM=1")

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

# SC_WASM_FAST_BUILD: swap -O3 -> -O2 to cut Binaryen/wasm-opt link time 2-3x.
if(SC_WASM_FAST_BUILD)
  string(REPLACE "-O3" "-O2" CMAKE_C_FLAGS   "${CMAKE_C_FLAGS}")
  string(REPLACE "-O3" "-O2" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")
  message(STATUS "SC_WASM_FAST_BUILD: -O3 -> -O2 (faster link; for dev iteration only)")
endif()

# Set shared library suffix
set(CMAKE_SHARED_LIBRARY_SUFFIX ".js")
set(CMAKE_STATIC_LIBRARY_SUFFIX ".a")

# Disable shared libraries by default (WASM prefers static linking)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libraries" FORCE)

message(STATUS "Emscripten WASI toolchain configured")
message(STATUS "C compiler: ${CMAKE_C_COMPILER}")
message(STATUS "C++ compiler: ${CMAKE_CXX_COMPILER}")
