cmake_minimum_required(VERSION 3.12)

include(SCVersion.txt)
# CMake versions can only consist of digits and periods, so don't use _TWEAK
project(SuperCollider VERSION ${SC_VERSION_MAJOR}.${SC_VERSION_MINOR}.${SC_VERSION_PATCH})

message(STATUS "SuperCollider Version: ${SC_VERSION}")
message(STATUS "Building from ${GIT_REF_TYPE} ${GIT_BRANCH_OR_TAG}, commit hash is ${GIT_COMMIT_HASH}")

# Stops CTest from generating a bunch of targets we don't care about.
set_property(GLOBAL PROPERTY CTEST_TARGETS_ADDED 1)
include(CTest)
enable_testing()
list(APPEND CMAKE_CTEST_ARGUMENTS "--output-on-failure")

if(CMAKE_GENERATOR MATCHES "Visual Studio" OR CMAKE_GENERATOR MATCHES "Xcode")
	message(STATUS "Please specify the build configuration in the next step")
else()
	if (NOT CMAKE_BUILD_TYPE)
		message(STATUS "Build type defaulting to \"RelWithDebInfo\"")
		set(CMAKE_BUILD_TYPE "RelWithDebInfo")
	endif()
endif()

if (${CMAKE_SOURCE_DIR} STREQUAL ${CMAKE_BINARY_DIR})
	message(WARNING "WARNING: IN-PLACE BUILDS ARE NOT RECOMMENDED - PLEASE USE A BUILD DIRECTORY")
endif()

set(CMAKE_MODULE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/cmake_modules
                      ${CMAKE_MODULE_PATH})

# CPM source cache: prevents re-downloading on every clean build. The
# env var `CPM_SOURCE_CACHE` overrides this; CI sets it to a persistent
# directory.
if(NOT DEFINED CPM_SOURCE_CACHE AND NOT DEFINED ENV{CPM_SOURCE_CACHE})
    set(CPM_SOURCE_CACHE "${CMAKE_SOURCE_DIR}/.cpm_cache" CACHE PATH
        "CPM source cache directory")
endif()

include(CPM)

CONFIGURE_FILE(
  "${CMAKE_CURRENT_SOURCE_DIR}/cmake_modules/cmake_uninstall.cmake.in"
  "${CMAKE_CURRENT_BINARY_DIR}/cmake_uninstall.cmake"
  IMMEDIATE @ONLY)

ADD_CUSTOM_TARGET(uninstall
  "${CMAKE_COMMAND}" -P "${CMAKE_CURRENT_BINARY_DIR}/cmake_uninstall.cmake")
set_property(TARGET uninstall PROPERTY FOLDER Util)

# install settings
add_compile_definitions(SC_DATA_DIR="${CMAKE_INSTALL_PREFIX}/share/SuperCollider")

#############################################
# Options
option(FFT_GREEN "Use internal 'Green' FFT lib rather than FFTW. (Not recommended.)" OFF)

# Plugins like SIMD_Unit-based ugens (mul_add, lf, trigger, etc.) include
# nova-simd headers unconditionally, so gating the include path here also
# gates the build of those .cpp files. Default ON to match upstream SC and
# the pre-CPM-migration behaviour where src/server/sc3/CMakeLists.txt
# declared this option (the rename to plugins_sc3/ dropped it).
option(NOVA_SIMD "Add nova-simd include path and enable SIMD code paths in plugins/libscsynth." ON)

set(AUDIOAPI "wasm" CACHE STRING "Audio API (wasm only)")

option(SC_MEMORY_DEBUGGING "Build sclang&scsynth for memory debugging (disable memory pools).")
option(GC_SANITYCHECK "Enable sanity checks in the sclang garbage collector.")

option(SC_WASM_STK_PRELOAD_RAWWAVES "Preload STK rawwave assets for sample-backed STK instruments in WASM builds" ON)

option(SC_WASM_WASI "Build for WASI (standalone WASM) instead of Emscripten" OFF)
if(SC_WASM_WASI)
    add_compile_definitions(SC_WASM_WASI=1)
endif()

message(STATUS "Building HyperCollider for WebAssembly")
set(NO_LIBSNDFILE ON CACHE BOOL "libsndfile disabled for WASM builds" FORCE)
add_compile_definitions(SC_WASM=1)
add_compile_definitions(SC_WASM_SNDFILE_COMPAT=1)
add_compile_definitions(SC_WASM_SINGLE_THREADED_RUNTIME=1)
if(SC_WASM_STK_PRELOAD_RAWWAVES)
    add_compile_definitions(SC_WASM_STK_RAWWAVES=1)
endif()
add_compile_definitions(STATIC_PLUGINS=1)

# sc3-plugins is now integrated into src/server/plugins_sc3/ as a normal CMake subdirectory.
# See docs/SC3_PLUGINS_INTEGRATION_PLAN.md (Phase 1, 3a).


#############################################
# other compiler flags

set(CMAKE_CXX_STANDARD 20)

# set default symbol visibility
SET(CMAKE_CXX_VISIBILITY_PRESET hidden)
SET(CMAKE_C_VISIBILITY_PRESET hidden)
SET(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
	add_compile_options(
		-fno-math-errno
		-fno-signaling-nans
		-Werror=return-type
		-fsigned-zeros
		-fno-associative-math
	)
endif()

if (SC_MEMORY_DEBUGGING)
	add_compile_definitions(DISABLE_MEMORY_POOLS ENABLE_MEMORY_CHECKS)
endif()

#############################################
# subdirectories
add_subdirectory(src/external)


configure_file(src/common/version.hpp.in common/version.hpp)
include_directories(${CMAKE_CURRENT_BINARY_DIR}/common)

file(GLOB_RECURSE ClassLibrary src/class_library/*sc)

add_subdirectory(engine)
add_subdirectory(src/platform)
add_subdirectory(src/server)
add_subdirectory(src/lang)

set(auxresourcesdir "share/SuperCollider" CACHE STRING "Resources directory")

set(SCCLASSLIB_EXCLUDE_REGEX "IGNOREME")

install(DIRECTORY src/class_library
    DESTINATION ${auxresourcesdir}
    REGEX ${SCCLASSLIB_EXCLUDE_REGEX} EXCLUDE
    PATTERN "*~" EXCLUDE
    PATTERN "*#" EXCLUDE
)

install(FILES README.md CHANGELOG.md COPYING AUTHORS DESTINATION ${auxresourcesdir})


#############################################
#
# build scdoc help files
#
list(APPEND BUILD_CLASSLIBRARIES "${CMAKE_CURRENT_SOURCE_DIR}/src/class_library")

# this folder has an extension to Platform that disables the loadStartupFiles method
list(APPEND BUILD_CLASSLIBRARIES "${CMAKE_CURRENT_SOURCE_DIR}/src/platform/disable_startup_files")

foreach(arg ${BUILD_CLASSLIBRARIES})
	set(BUILD_CLASSLIBRARYPATH "${BUILD_CLASSLIBRARYPATH}  - ${arg}\n")
endforeach()

configure_file(build_sclang.cfg.in ${CMAKE_CURRENT_BINARY_DIR}/build_sclang.cfg)

#############################################
# CLI distribution target (WASM only)
#
# `cmake --build build/wasm --target cli` assembles a self-contained
# CLI bundle under build/wasm/cli/ containing the WASM artifacts
# and the Node.js wrapper scripts from cli/.
set(CLI_BUNDLE_DIR "${CMAKE_BINARY_DIR}/cli")

add_custom_target(cli
    DEPENDS hcsynth hclang
    COMMAND ${CMAKE_COMMAND} -E make_directory "${CLI_BUNDLE_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CMAKE_SOURCE_DIR}/cli"
        "${CLI_BUNDLE_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_BINARY_DIR}/server/hcsynth/hcsynth.js"
        "${CMAKE_BINARY_DIR}/server/hcsynth/hcsynth.wasm"
        "${CLI_BUNDLE_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_BINARY_DIR}/lang/hclang/hclang.js"
        "${CMAKE_BINARY_DIR}/lang/hclang/hclang.wasm"
        "${CLI_BUNDLE_DIR}"
    COMMENT "Assembling CLI bundle → ${CLI_BUNDLE_DIR}"
)

# Copy .data files only if they exist (STK rawwave preloading is optional).
add_custom_command(TARGET cli POST_BUILD
    COMMAND ${CMAKE_COMMAND}
        -DSCSYNTH_DATA="${CMAKE_BINARY_DIR}/server/hcsynth/hcsynth.data"
        -DSCLANG_DATA="${CMAKE_BINARY_DIR}/lang/hclang/hclang.data"
        -DDEST_DIR="${CLI_BUNDLE_DIR}"
        -P "${CMAKE_SOURCE_DIR}/cmake_modules/copy_data_files.cmake"
    COMMENT "Copying optional .data files to CLI bundle"
)

#############################################
# hide advanced variables
mark_as_advanced(DL)
mark_as_advanced(MATH_LIBRARY)
