# WASM uses the Green FFT library (no vDSP/FFTW available in the browser runtime).
message(STATUS "FFT library (scsynth): Green (WASM)")
set(FFT_GREEN 1)
add_definitions("-DSC_FFT_GREEN")

message(STATUS "Audio API (scsynth): wasm (browser AudioWorklet)")
set(AUDIOAPI_WASM ON)

set(scsynth_sources
	SC_BufGen.cpp

	SC_Graph.cpp
	SC_GraphDef.cpp
	SC_Group.cpp
	SC_HiddenWorld.h
	SC_Lib_Cintf.cpp
	SC_Lib.cpp
	SC_MiscCmds.cpp
	SC_Node.cpp
	SC_Rate.cpp
	SC_SequencedCommand.cpp
	SC_Str4.cpp
	SC_Unit.cpp
	SC_UnitDef.cpp
	SC_World.cpp

	${CMAKE_SOURCE_DIR}/src/common/sc_fftlib.cpp
	${CMAKE_SOURCE_DIR}/src/common/alloc_pool.cpp
	${CMAKE_SOURCE_DIR}/src/common/sc_errors.cpp
	${CMAKE_SOURCE_DIR}/src/common/reply.cpp
	${CMAKE_SOURCE_DIR}/src/common/string_buffer.cpp
	${CMAKE_SOURCE_DIR}/src/common/string_parser.cpp
	${CMAKE_SOURCE_DIR}/src/common/samp.cpp
	${CMAKE_SOURCE_DIR}/src/common/sc_popen.cpp
	${CMAKE_SOURCE_DIR}/src/common/server_boot_delay_warning.cpp
)

if (FFT_GREEN)
	list(APPEND scsynth_sources ${CMAKE_SOURCE_DIR}/src/common/fftlib.c)
endif()

include_directories(${CMAKE_SOURCE_DIR}/src/include/common
                    ${CMAKE_SOURCE_DIR}/src/common
                    ${CMAKE_SOURCE_DIR}/src/include/server
                    ${CMAKE_SOURCE_DIR}/src/include/plugin_interface
                    ${CMAKE_SOURCE_DIR}/src/lang/core
                    .
)

add_definitions("-DSC_AUDIO_API=SC_AUDIO_API_WASM")
set(SC_WASM_SCSYNTH_EXCLUSION_ENTRIES
    "SC_ComPort.cpp|Native OSC socket transport is replaced by browser bridge transport|docs/WASM_STUB_ELIMINATION_PLAN.md#phase-3---rebuild-oscnetaddr-on-browser-transport|Phase 3.3"
    "server/plugins/ui_ugens.cpp|Desktop UI input/windowing semantics are unsupported in browser scsynth runtime|docs/WASM_STUB_ELIMINATION_PLAN.md#phase-4---remove-scsynth-ugen-stubs|Phase 8"
)
foreach(exclusion_entry IN LISTS SC_WASM_SCSYNTH_EXCLUSION_ENTRIES)
    string(REPLACE "|" ";" exclusion_fields "${exclusion_entry}")
    list(LENGTH exclusion_fields exclusion_field_count)
    if(NOT exclusion_field_count EQUAL 4)
        message(FATAL_ERROR
            "Invalid SC_WASM_SCSYNTH_EXCLUSION_ENTRIES item '${exclusion_entry}'. Expected 4 fields: path|reason|issue|phase."
        )
    endif()

    list(GET exclusion_fields 0 exclusion_source)
    list(GET exclusion_fields 1 exclusion_reason)
    list(GET exclusion_fields 2 exclusion_issue)
    list(GET exclusion_fields 3 exclusion_phase)

    if(exclusion_issue STREQUAL "UNTRACKED")
        message(FATAL_ERROR
            "WASM exclusion '${exclusion_source}' must include a linked issue/document reference."
        )
    endif()

    if(exclusion_phase STREQUAL "UNSCHEDULED")
        message(FATAL_ERROR
            "WASM exclusion '${exclusion_source}' must include a target phase."
        )
    endif()

    message(STATUS
        "WASM exclusion: ${exclusion_source} | reason='${exclusion_reason}' | issue='${exclusion_issue}' | target='${exclusion_phase}'"
    )
endforeach()
# Provide the wasm audio driver (replaces SC_CoreAudio.cpp for wasm builds).
list(APPEND scsynth_sources SC_Wasm_AudioDriver.cpp)
# Scaffolding for future DiskIO backend integration.
list(APPEND scsynth_sources SC_Wasm_DiskIOBackend.cpp)
# Provide the wasm filesystem stubs (replaces SC_Filesystem_*.cpp for wasm builds).
list(APPEND scsynth_sources ${CMAKE_SOURCE_DIR}/src/common/filesystem_wasm.cpp)
# Include all core built-in UGens that are WASM-safe (no libsndfile, no UI, no Bela/Link).
# These provide the *_Load symbols that STATIC_PLUGINS calls in SC_Lib_Cintf.cpp.
set(WASM_PLUGIN_DIR ${CMAKE_SOURCE_DIR}/src/server/plugins)
list(APPEND scsynth_sources
    ${WASM_PLUGIN_DIR}/io_ugens.cpp
    ${WASM_PLUGIN_DIR}/osc_ugens.cpp
    ${WASM_PLUGIN_DIR}/delay_ugens.cpp
    ${WASM_PLUGIN_DIR}/binary_op_ugens.cpp
    ${WASM_PLUGIN_DIR}/filter_ugens.cpp
    ${WASM_PLUGIN_DIR}/gendyn_ugens.cpp
    ${WASM_PLUGIN_DIR}/lf_ugens.cpp
    ${WASM_PLUGIN_DIR}/noise_ugens.cpp
    ${WASM_PLUGIN_DIR}/mul_add_ugens.cpp
    ${WASM_PLUGIN_DIR}/grain_ugens.cpp
    ${WASM_PLUGIN_DIR}/pan_ugens.cpp
    ${WASM_PLUGIN_DIR}/reverb_ugens.cpp
    ${WASM_PLUGIN_DIR}/trigger_ugens.cpp
    ${WASM_PLUGIN_DIR}/unary_op_ugens.cpp
    ${WASM_PLUGIN_DIR}/physical_modeling_ugens.cpp
    ${WASM_PLUGIN_DIR}/disk_io_ugens.cpp
    ${WASM_PLUGIN_DIR}/test_ugens.cpp
    ${WASM_PLUGIN_DIR}/demand_ugens.cpp
    ${WASM_PLUGIN_DIR}/dyn_noise_ugens.cpp
    ${WASM_PLUGIN_DIR}/chaos_ugens.cpp
    # FFT UGens (use built-in fftlib, no Accelerate on non-Apple)
    ${WASM_PLUGIN_DIR}/fft_ugens.cpp
    ${WASM_PLUGIN_DIR}/fft_interface_table.cpp
    ${WASM_PLUGIN_DIR}/pv_ugens.cpp
    ${WASM_PLUGIN_DIR}/unpack_fft_ugens.cpp
    ${WASM_PLUGIN_DIR}/partitioned_convolution.cpp
)
include_directories(${WASM_PLUGIN_DIR})
if(NOVA_SIMD)
    # nova-simd is fetched via CPM in src/external/CMakeLists.txt and
    # exposed as the `nova_simd` INTERFACE target.
    include_directories(${HC_NOVA_SIMD_DIR})
    add_compile_definitions(NOVA_SIMD)
endif()

set (FINAL_BUILD 0) # disable final build for scsynth

if (LIBSCSYNTH)
	set (LIBSCSYNTH_TYPE SHARED)
else()
	set (LIBSCSYNTH_TYPE STATIC)
endif()

file(GLOB_RECURSE all_headers ./*.h*)

if (FINAL_BUILD)
	CREATE_FINAL_FILE(libscsynth_final.cpp ${scsynth_sources} ${all_headers})
	add_library(libscsynth ${LIBSCSYNTH_TYPE} libscsynth_final.cpp)
else()
	add_library(libscsynth ${LIBSCSYNTH_TYPE} ${scsynth_sources} ${all_headers})
endif()


if(LIBSCSYNTH)
        target_compile_definitions(libscsynth PRIVATE   BUILDING_SCSYNTH)
        target_compile_definitions(libscsynth INTERFACE BUILDING_SCSYNTH)
endif()

target_compile_definitions(libscsynth PUBLIC  SC_MEMORY_ALIGNMENT=32)

# Precompiled headers: amortize heavy-include parsing across all TUs.
# These headers appear in almost every server source file.
target_precompile_headers(libscsynth PRIVATE
    <stddef.h>
    <stdint.h>
    <stdlib.h>
    <stdio.h>
    <string.h>
    <math.h>
    <SC_Types.h>
    <SC_World.h>
)

# Link TLSF allocator (used by scope_buffer_pool for Stethoscope)
target_link_libraries(libscsynth PRIVATE tlsf)

# Link plugins if available
if(TARGET SC_Wasm_Plugins)
    target_link_libraries(libscsynth PRIVATE SC_Wasm_Plugins)
    message(STATUS "Linked SC_Wasm_Plugins to libscsynth")
endif()

# Link platform library if available
if(TARGET sc_wasm_platform)
    target_link_libraries(libscsynth PRIVATE sc_wasm_platform)
    message(STATUS "Linked sc_wasm_platform to libscsynth")
endif()

find_library(DL NAMES dl)
if(DL)
    target_link_libraries(libscsynth PRIVATE ${DL})
endif()

# WASM: no libsndfile, no Avahi, no native audio backend libraries
add_definitions("-DNO_LIBSNDFILE")

message(STATUS "WASM: No audio backend libraries to link")

add_executable(hcsynth
    ${CMAKE_SOURCE_DIR}/engine/HC_Wasm_Main.cpp
    ${CMAKE_SOURCE_DIR}/src/common/server_boot_delay_warning.cpp
)
target_link_libraries(hcsynth libscsynth)

# Link the WASM platform abstraction layer (HC_Wasm_Api.cpp, etc.)
target_link_libraries(hcsynth hc_platform)

# Export all public C API symbols so JS can call them via Module._hc_wasm_*
set(WASM_EXPORTED_FUNCTIONS
        "_hc_wasm_world_create"
        "_hc_wasm_world_destroy"
        "_hc_wasm_world_sample_rate"
        "_hc_wasm_world_block_size"
        "_hc_wasm_load_synthdef"
        "_hc_wasm_list_synthdefs"
        "_hc_wasm_synth_new"
        "_hc_wasm_synth_free"
        "_hc_wasm_synth_set"
        "_hc_wasm_synth_set_multi"
        "_hc_wasm_render"
        "_hc_wasm_render_mix"
        "_hc_wasm_get_status"
        "_hc_wasm_reset"
        "_hc_wasm_process_controls"
        "_hc_wasm_enqueue_control"
        "_hc_wasm_get_metrics"
        "_hc_wasm_reset_metrics"
        # OSC shim functions for in-process communication
        "_hc_wasm_osc_dispatch"
        "_hc_wasm_osc_register_world"
        "_hc_wasm_osc_unregister_world"
        "_hc_wasm_osc_register_handler"
        "_hc_wasm_osc_send_to_sclang"
        "_hc_wasm_sendto_shim"
        "_hc_wasm_recvfrom_shim"
            # Reply accumulation API (server mode: JS polls for hcsynth replies)
            "_hc_wasm_osc_dispatch_reply"
            "_hc_wasm_reply_count"
            "_hc_wasm_reply_peek"
            "_sc_wasm_diskio_backend_configure_nativefs"
            "_sc_wasm_diskio_backend_configure_idbfs"
        "_hc_wasm_list_ugens"
        "_malloc"
        "_free"
    )
    # ___wasm_call_ctors: same rationale as hclang — WAMR skips auto-calling
    # this for WASI modules, so the host calls it explicitly post-instantiate.
    list(APPEND WASM_EXPORTED_FUNCTIONS "___wasm_call_ctors")
    # Join list into a JSON-style array string for -s EXPORTED_FUNCTIONS
    string(JOIN "," WASM_EF_CSV ${WASM_EXPORTED_FUNCTIONS})
    if(SC_WASM_WASI)
        # ── WASI / WAMR path ───────────────────────────────────────────────
        # Standalone WASM for WAMR consumption. No Emscripten JS glue, no
        # MEMFS — the host owns audio I/O and OSC dispatch.
        set_target_properties(hcsynth PROPERTIES SUFFIX ".wasm")
        target_link_options(hcsynth PRIVATE
            "SHELL:-s EXPORTED_FUNCTIONS=[${WASM_EF_CSV}]"
            "SHELL:-s ALLOW_MEMORY_GROWTH=1"
            "SHELL:-s INITIAL_MEMORY=67108864"   # 64 MiB
            "SHELL:-s ASSERTIONS=1"
            # No JS-based exception catching — disable so WAMR can load.
            "SHELL:-s DISABLE_EXCEPTION_CATCHING=1"
        )
    else()
        # ── Browser / Node.js path ─────────────────────────────────────────
        target_link_options(hcsynth PRIVATE
            "SHELL:-s EXPORTED_FUNCTIONS=[${WASM_EF_CSV}]"
            "SHELL:-s EXPORTED_RUNTIME_METHODS=[ccall,cwrap,HEAPU8,HEAPF32,FS,IDBFS]"
            "SHELL:-s ALLOW_MEMORY_GROWTH=1"
            "SHELL:-s INITIAL_MEMORY=67108864"   # 64 MiB
            "SHELL:-s NO_EXIT_RUNTIME=1"
            "SHELL:-s ENVIRONMENT=node,web,worker,shell"
            "SHELL:-s MODULARIZE=1"
            "SHELL:-s EXPORT_NAME=HCsynthModule"
            "SHELL:-s ASSERTIONS=1"
            "SHELL:-s NO_DISABLE_EXCEPTION_CATCHING=1"
            "SHELL:-lidbfs.js"
            "SHELL:-lembind"
        )
    endif()
if(SC_WASM_STK_PRELOAD_RAWWAVES)
    # STK rawwaves now sourced from CPM-fetched STK (see src/external/CMakeLists.txt Phase 2c)
    target_link_options(hcsynth PRIVATE
        "SHELL:--preload-file ${HC_STK_RAWWAVES_DIR}@/stksc/rawwaves"
    )
endif()
# Enable C++ exception support for all WASM libscsynth TUs so that
# GraphDef_Recv's try/catch blocks actually catch parsing errors.
# WASI/WAMR builds run with DISABLE_EXCEPTION_CATCHING=1, so leave
# -fexceptions off there — keeping it on would import a wad of
# `__cxa_*` symbols that WAMR has no way to satisfy.
if(NOT SC_WASM_WASI)
    target_compile_options(libscsynth PRIVATE -fexceptions)
endif()

set_target_properties(hcsynth PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/server/hcsynth"
    OUTPUT_NAME "hcsynth"
)

if (LIBSCSYNTH)
	set(INSTALL_TARGETS hcsynth libscsynth)
else()
	set(INSTALL_TARGETS hcsynth)
endif()

install(TARGETS ${INSTALL_TARGETS}
        RUNTIME DESTINATION "bin"
        LIBRARY DESTINATION "lib"
        PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE)

set_property(TARGET libscsynth PROPERTY FOLDER Libs)
