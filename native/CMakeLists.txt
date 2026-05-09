# Native WASM Host CMake Project
#
# This builds standalone hclang and hcsynth native binaries that embed
# the WASM engine via WAMR (or other WASM VM).
#
# Usage (from repo root):
#   cmake --preset native_host_release
#   cmake --build build/native

cmake_minimum_required(VERSION 3.14)
project(hc_native_host LANGUAGES C CXX)

message(STATUS "Configuring HyperCollider Native WASM Host")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(cmake/CPM.cmake)
include(cmake/EmbedWasm.cmake)

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
set(HC_WASM_VM "WAMR" CACHE STRING "WASM VM backend: WAMR or wasm3")
set_property(CACHE HC_WASM_VM PROPERTY STRINGS WAMR wasm3)
option(HC_EMBED_WASM "Embed WASM engine blobs in the binary" ON)
option(HC_WASM_AOT   "Use AOT-compiled WASM (requires wamrc)"    OFF)
# When ON, missing .wasm artefacts are a fatal configure error rather than
# a warning that silently disables embedding. The build-wamr-host Justfile
# recipe sets this so a stale state can't ship a non-self-contained binary.
option(HC_REQUIRE_EMBEDDED_WASM "Fail configure if WASM artefacts are missing" OFF)

# ---------------------------------------------------------------------------
# WASM file paths (produced by the wasi_release build)
# ---------------------------------------------------------------------------
set(WASI_BUILD_DIR "${CMAKE_SOURCE_DIR}/../build/wasi"
    CACHE PATH "Path to WASI build directory")
set(HCSYNTH_WASM "${WASI_BUILD_DIR}/server/hcsynth/hcsynth.wasm"
    CACHE FILEPATH "Path to hcsynth.wasm")
set(HCLANG_WASM "${WASI_BUILD_DIR}/lang/hclang/hclang.wasm"
    CACHE FILEPATH "Path to hclang.wasm")

if(HC_EMBED_WASM AND NOT EXISTS "${HCSYNTH_WASM}")
    if(HC_REQUIRE_EMBEDDED_WASM)
        message(FATAL_ERROR
            "hcsynth.wasm not found at ${HCSYNTH_WASM}.\n"
            "  Run `just build-wasi` first, or pass -DHC_REQUIRE_EMBEDDED_WASM=OFF\n"
            "  if you intentionally want a non-self-contained binary that loads\n"
            "  the .wasm from disk at runtime.")
    endif()
    message(WARNING "hcsynth.wasm not found at ${HCSYNTH_WASM}; embedding disabled.")
    set(HC_EMBED_WASM OFF)
endif()
if(HC_EMBED_WASM AND NOT EXISTS "${HCLANG_WASM}")
    if(HC_REQUIRE_EMBEDDED_WASM)
        message(FATAL_ERROR
            "hclang.wasm not found at ${HCLANG_WASM}.\n"
            "  Run `just build-wasi` first, or pass -DHC_REQUIRE_EMBEDDED_WASM=OFF\n"
            "  if you intentionally want a non-self-contained binary that loads\n"
            "  the .wasm from disk at runtime.")
    endif()
    message(WARNING "hclang.wasm not found at ${HCLANG_WASM}; embedding disabled.")
    set(HC_EMBED_WASM OFF)
endif()

# ---------------------------------------------------------------------------
# WAMR — fetch, configure, and build vmlib here (once, shared by both targets)
# ---------------------------------------------------------------------------
CPMAddPackage(
    NAME wamr
    GITHUB_REPOSITORY bytecodealliance/wasm-micro-runtime
    GIT_TAG WAMR-2.4.4
    DOWNLOAD_ONLY YES
)

# Platform
if(APPLE)
    set(WAMR_BUILD_PLATFORM "darwin")
elseif(WIN32)
    set(WAMR_BUILD_PLATFORM "windows")
else()
    set(WAMR_BUILD_PLATFORM "linux")
endif()

# CPU architecture
if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64|ARM64|AARCH64")
    set(WAMR_BUILD_TARGET "AARCH64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "armv7|armhf")
    set(WAMR_BUILD_TARGET "ARM")
else()
    set(WAMR_BUILD_TARGET "X86_64")
endif()

set(WAMR_BUILD_INTERP        1)
set(WAMR_BUILD_FAST_INTERP   1)
# WAMR_BUILD_AOT is on whenever HC_WASM_AOT=ON. Either format can be loaded
# at runtime once enabled — wasm_runtime_load auto-detects via magic bytes.
if(HC_WASM_AOT)
    set(WAMR_BUILD_AOT       1)
else()
    set(WAMR_BUILD_AOT       0)
endif()
set(WAMR_BUILD_LIBC_WASI     1)
set(WAMR_BUILD_LIBC_BUILTIN  1)
set(WAMR_BUILD_SHARED_MEMORY 0)
set(WAMR_BUILD_THREAD_MGR    0)
set(WAMR_BUILD_BULK_MEMORY   1)
set(WAMR_BUILD_SIMD          1)
set(WAMR_BUILD_SIMDE         1)
set(WAMR_BUILD_LIB_SIMDE     1)
# scscm (the Scheme dialect, see docs/SCSCM_GUIDE.md) compiles to sclang
# code that depends on tail-call elimination. This enables WAMR runtime
# support for the WASM tail-call proposal so `return_call` instructions
# in hclang.wasm don't trap. Currently a no-op for hclang.wasm because
# the WASI build doesn't pass `-mtail-call` to clang yet (Phase 12.3d
# step 1) — but the runtime flag is the cheap layer to land first.
set(WAMR_BUILD_TAIL_CALL     1)
set(WAMR_ROOT_DIR "${wamr_SOURCE_DIR}")
include(${wamr_SOURCE_DIR}/build-scripts/runtime_lib.cmake)

# ---------------------------------------------------------------------------
# wamrc — locates the AOT compiler. Must be installed separately (it
# requires LLVM and isn't bundled with the iwasm runtime). Sources for the
# common cases:
#   - Pre-built binary from a WAMR GitHub release
#   - `brew install --build-from-source wasm-micro-runtime` (slow; pulls LLVM)
#   - Build from source: native/_deps/wamr-src/wamr-compiler/build_llvm.sh
#     and then cmake/make in wamr-compiler/build
# ---------------------------------------------------------------------------
if(HC_WASM_AOT)
    find_program(WAMRC_EXECUTABLE
        NAMES wamrc
        HINTS
            $ENV{HOME}/.local/bin
            /opt/homebrew/bin
            /usr/local/bin
        DOC "Path to the wamrc AOT compiler")
    if(NOT WAMRC_EXECUTABLE)
        message(FATAL_ERROR
            "HC_WASM_AOT=ON requested but wamrc not found in PATH. "
            "Install it from a WAMR release, or via `brew install "
            "--build-from-source wasm-micro-runtime`, or build it from "
            "${wamr_SOURCE_DIR}/wamr-compiler. Then either add to PATH or "
            "pass -DWAMRC_EXECUTABLE=/path/to/wamrc.")
    endif()
    message(STATUS "wamrc: ${WAMRC_EXECUTABLE}")

    # Translate the host CPU architecture to a wamrc --target value. wamrc's
    # supported targets are x86_64, i386, aarch64, armv7, riscv32, etc.
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64|ARM64|AARCH64")
        set(WAMRC_TARGET aarch64)
    elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "armv7|armhf")
        set(WAMRC_TARGET armv7)
    else()
        set(WAMRC_TARGET x86_64)
    endif()
endif()

# wamrc --opt-level is split per WASM module. The lang side hits a wamrc
# optimiser bug at >=1 (Phase 12.3c — SIGSEGV at -O1, OOM at -O2/-O3 in
# the AOT'd SC parser) so it stays pinned at 0 until upstream ships a fix.
# The synth side has no such bug and is the bottleneck on poly-heavy
# benches (see docs/WAMR_PERF_PARITY_PLAN.md §P7.2), so default it to 3.
set(HC_WASM_AOT_OPT_LEVEL_LANG  "0" CACHE STRING
    "wamrc --opt-level for hclang.aot. Pinned at 0 due to wamrc bug; lift once upstream is fixed.")
set(HC_WASM_AOT_OPT_LEVEL_SYNTH "3" CACHE STRING
    "wamrc --opt-level for hcsynth.aot. Recovers ~30-50% synth-side perf vs the symmetric =0 build.")

# Helper: attach a `<name>_aot` custom target that produces <wasm>.aot from
# <wasm>. AOT is sample-rate independent; same .aot works for both lang and
# synth modules. Producers are wired into the EmbedWasm.cmake helper too.
function(hc_add_aot_target name wasm_path opt_level)
    if(NOT HC_WASM_AOT)
        return()
    endif()
    set(aot_path "${wasm_path}.aot")
    # Notes on flags:
    #   --bounds-checks=1     forces software bounds checks. Default on 64-bit
    #                         relies on HW bounds traps, which need WAMR's
    #                         signal handlers to be installed correctly. If
    #                         HW traps aren't being caught (e.g. SIGSEGV
    #                         leaking through), software checks are safer.
    # --enable-tail-call: required for scscm; never toggle off as a
    # bisection knob (see docs/HCLANG_NATIVE_PLAN.md §12.3d).
    add_custom_command(
        OUTPUT  "${aot_path}"
        COMMAND "${WAMRC_EXECUTABLE}" --target=${WAMRC_TARGET}
                --enable-simd --enable-tail-call
                --opt-level=${opt_level} --bounds-checks=1
                -o "${aot_path}" "${wasm_path}"
        DEPENDS "${wasm_path}"
        COMMENT "wamrc → ${aot_path} (--opt-level=${opt_level})"
        VERBATIM
    )
    add_custom_target(${name}_aot DEPENDS "${aot_path}")
    set("HC_${name}_AOT" "${aot_path}" CACHE INTERNAL "")
endfunction()

if(HC_WASM_AOT)
    hc_add_aot_target(hclang  "${HCLANG_WASM}"  "${HC_WASM_AOT_OPT_LEVEL_LANG}")
    hc_add_aot_target(hcsynth "${HCSYNTH_WASM}" "${HC_WASM_AOT_OPT_LEVEL_SYNTH}")
endif()

add_library(vmlib STATIC ${WAMR_RUNTIME_LIB_SOURCE})
target_include_directories(vmlib PUBLIC
    ${WAMR_ROOT_DIR}/core/iwasm/include
)

# ---------------------------------------------------------------------------
# CPM dependencies (fetched once, paths propagated via variables)
# ---------------------------------------------------------------------------
CPMAddPackage(
    NAME CLI11
    GITHUB_REPOSITORY CLIUtils/CLI11
    GIT_TAG v2.4.1
)

CPMAddPackage(
    NAME miniaudio
    GITHUB_REPOSITORY mackron/miniaudio
    GIT_TAG 0.11.21
    DOWNLOAD_ONLY YES
)
set(MINIAUDIO_SOURCE_DIR "${miniaudio_SOURCE_DIR}" CACHE INTERNAL "")

CPMAddPackage(
    NAME dr_libs
    GITHUB_REPOSITORY mackron/dr_libs
    GIT_TAG master
    DOWNLOAD_ONLY YES
)
set(DR_LIBS_SOURCE_DIR "${dr_libs_SOURCE_DIR}" CACHE INTERNAL "")

CPMAddPackage(
    NAME tinyosc
    GITHUB_REPOSITORY mhroth/tinyosc
    GIT_TAG master
    DOWNLOAD_ONLY YES
)
set(TINYOSC_SOURCE_DIR "${tinyosc_SOURCE_DIR}" CACHE INTERNAL "")

CPMAddPackage(
    NAME linenoise
    GITHUB_REPOSITORY antirez/linenoise
    GIT_TAG master
    DOWNLOAD_ONLY YES
)
set(LINENOISE_SOURCE_DIR "${linenoise_SOURCE_DIR}" CACHE INTERNAL "")

# ---------------------------------------------------------------------------
# Sub-targets
# ---------------------------------------------------------------------------
add_subdirectory(hcsynth_host)
add_subdirectory(hclang_host)
