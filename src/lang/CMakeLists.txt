
include_directories(${CMAKE_SOURCE_DIR}/src/include/common
                    ${CMAKE_SOURCE_DIR}/src/include/lang
                    ${CMAKE_SOURCE_DIR}/src/include/plugin_interface
                    ${CMAKE_SOURCE_DIR}/src/include/server
                    ${CMAKE_SOURCE_DIR}/src/common

                    core
                    primitives

                    core/Bison
)

set(sclang_sources
    primitives/link_clock.cpp
    primitives/audio_device_prim.cpp
    primitives/signal_prim.cpp
    primitives/sched.cpp
    primitives/primitive.cpp
    primitives/math_prim.cpp
    primitives/com_port.cpp
    primitives/osc_data.cpp
    primitives/archiver.cpp
    primitives/array_primitives.cpp
    primitives/bit_prim.cpp
    primitives/char_prim.cpp
    primitives/file_prim.cpp
    primitives/list_prim.cpp
    primitives/platform_prim.cpp
    primitives/string_prim.cpp
    primitives/symbol_prim.cpp
    primitives/unix_prim.cpp
    core/advancing_alloc_pool.cpp
    core/byte_code_array.cpp
    core/language_config.cpp
    core/dump_parse_node.cpp
    core/gc.cpp
    core/init_alloc.cpp
    core/interpreter3.cpp
    core/lexer.cpp
    core/math_ops.cpp
    core/math_support.cpp
    core/message.cpp
    core/object.cpp
    core/parse_node.cpp
    core/signal.cpp
    core/symbol_table.cpp
    core/simple_stack.cpp
    core/vm_globals.cpp
    core/dump_byte_codes.cpp

    ${CMAKE_SOURCE_DIR}/src/common/filesystem_wasm.cpp

    ${CMAKE_SOURCE_DIR}/src/common/fftlib.c
    ${CMAKE_SOURCE_DIR}/src/common/samp.cpp
    ${CMAKE_SOURCE_DIR}/src/common/alloc_pool.cpp
    ${CMAKE_SOURCE_DIR}/src/common/reply.cpp
    ${CMAKE_SOURCE_DIR}/src/common/string_buffer.cpp
    ${CMAKE_SOURCE_DIR}/src/common/string_parser.cpp
    ${CMAKE_SOURCE_DIR}/src/common/text_utils.cpp

    ${CMAKE_SOURCE_DIR}/src/common/sc_popen.cpp
)

set(sclang_parser_source core/Bison/lang11d_tab.cpp)

# WASM-only: no system audio backend needed for sclang
add_definitions("-DSC_AUDIO_API_WASM")
add_definitions("-DNO_LIBSNDFILE")

include(doc/CMakeLists.txt)
list(APPEND sclang_sources ${SCDOC_SRCS})

# ============================================================================
# hclang Target
# ============================================================================

set(hclang_sources ${sclang_sources})

    # Add WASM platform layer
    list(APPEND hclang_sources
        core/wasm_platform.cpp
        core/wasm_platform.h
    )

    # Add WASM evaluation framework
    list(APPEND hclang_sources
        ${CMAKE_SOURCE_DIR}/engine/HC_Wasm_Eval.cpp
    )

    # Add WASM runtime bridge
    list(APPEND hclang_sources
        core/wasm_runtime_bridge.cpp
    )

    # WASI/WAMR-only: filesystem shim that overrides Emscripten's
    # STANDALONE_WASM stubs (which return -EPERM for all file syscalls)
    # and routes openat / stat / getdents64 through real WASI calls.
    if(SC_WASM_WASI)
        list(APPEND hclang_sources
            ${CMAKE_SOURCE_DIR}/src/common/wasi_fs_shim.c
        )
    endif()

    # Phase 6 exclusion registry (path|reason|linked issue|target phase)
    set(SC_WASM_LANG_EXCLUSION_ENTRIES
        "primitives/unix_prim.cpp|Unix process/signal primitives are not available in browser runtime|docs/WASM_FEATURE_MATRIX.md|Phase 8"
        "primitives/sched.cpp|Native scheduler path still assumes non-browser threading/timing model|docs/WASM_STUB_ELIMINATION_PLAN.md#phase-2---remove-sclang-primitive-stub-surface|Phase 8"
    )

    set(hclang_excluded_sources)
    foreach(exclusion_entry IN LISTS SC_WASM_LANG_EXCLUSION_ENTRIES)
        string(REPLACE "|" ";" exclusion_fields "${exclusion_entry}")
        list(LENGTH exclusion_fields exclusion_field_count)
        if(NOT exclusion_field_count EQUAL 4)
            message(FATAL_ERROR
                "Invalid SC_WASM_LANG_EXCLUSION_ENTRIES item '${exclusion_entry}'. Expected 4 fields: path|reason|issue|phase."
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

        list(APPEND hclang_excluded_sources "${exclusion_source}")
        message(STATUS
            "WASM exclusion: ${exclusion_source} | reason='${exclusion_reason}' | issue='${exclusion_issue}' | target='${exclusion_phase}'"
        )
    endforeach()

    list(REMOVE_ITEM hclang_sources ${hclang_excluded_sources})

    add_library(libhclang STATIC ${hclang_sources} ${sclang_parser_source})

    target_include_directories(libhclang PRIVATE
        ${CMAKE_SOURCE_DIR}/engine
        ${CMAKE_SOURCE_DIR}/src/platform
    )

    target_compile_definitions(libhclang PRIVATE
        YYSTACK_USE_ALLOC SC_WASM=1 SC_WASM_USE_OSCDATA=1
        BOOST_NO_CXX11_THREADLOCAL BOOST_THREAD_DISABLED)

    # Precompiled headers: the GC and primitive headers are pulled in by nearly
    # every sclang TU; precompiling them once saves significant parse time.
    target_precompile_headers(libhclang PRIVATE
        <stddef.h>
        <stdint.h>
        <stdlib.h>
        <stdio.h>
        <string.h>
        <math.h>
    )

    if(SCLANG_SERVER)
        target_link_libraries(libhclang libscsynth)
    else()
        target_compile_definitions(libhclang PUBLIC NO_INTERNAL_SERVER)
    endif()

    target_link_libraries(libhclang
        Boost::math
        Asio::asio
        yaml-cpp
        tlsf
    )

    if(GC_SANITYCHECK)
        target_compile_definitions(libhclang PUBLIC GC_SANITYCHECK)
    endif()

    add_executable(hclang core/cmd_line_funcs.cpp)
    target_link_libraries(hclang libhclang)

    if(TARGET hc_platform)
        add_dependencies(hclang hc_platform)
        target_link_libraries(hclang hc_platform)
        message(STATUS "Linked WASM platform library to hclang")
    endif()

    # ── Class library pack (used by both build paths) ────────────────────────
    # Pack all included .sc files into a single binary so passOne can read
    # them from an in-memory cache instead of 200+ individual fopen/fread
    # round-trips. JS path embeds the pack via --preload-file; WASI/WAMR
    # path passes the pack at runtime via --classlib-pack and the host
    # calls hc_wasm_classlib_preload_bytes before hc_wasm_eval_init.
    set(SC_CLASSLIB_PACK "${CMAKE_BINARY_DIR}/lang/hclang/hclang_classlib.pack")
    set(SC_PACK_SCRIPT "${CMAKE_SOURCE_DIR}/tools/pack_sc_classlib.js")
    add_custom_command(
        OUTPUT "${SC_CLASSLIB_PACK}"
        COMMAND node "${SC_PACK_SCRIPT}"
                --src-dir "${CMAKE_SOURCE_DIR}/src/class_library"
                --memfs-prefix "/usr/share/SuperCollider/SCClassLibrary"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/SCDoc"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/HID_API.sc"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/HIDFunc.sc"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/HIDMatchers.sc"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/SerialPort.sc"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/Common/Collections/osx"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/Common/Collections/linux"
                --exclude "${CMAKE_SOURCE_DIR}/src/class_library/Common/Audio/iphone"
                --output "${SC_CLASSLIB_PACK}"
        DEPENDS "${SC_PACK_SCRIPT}"
        COMMENT "Packing SC class library → hclang_classlib.pack"
        VERBATIM
    )
    add_custom_target(sc_classlib_pack DEPENDS "${SC_CLASSLIB_PACK}")
    add_dependencies(hclang sc_classlib_pack)

    if(NOT SC_WASM_WASI)
        # ── Browser / Node.js path ────────────────────────────────────────────
        set_target_properties(hclang PROPERTIES SUFFIX ".js")

        target_link_options(hclang PRIVATE
            "SHELL:-s EXPORTED_FUNCTIONS=['_hc_wasm_eval_init','_hc_wasm_eval_boot','_hc_wasm_eval_string','_hc_wasm_eval_execute','_hc_wasm_eval_status','_hc_wasm_eval_set_post_callback','_hc_wasm_eval_set_error_callback','_hc_wasm_eval_boot_sequence','_hc_wasm_eval_heap_end','_hc_wasm_eval_add_include_path','_hc_wasm_quarks_set_available','_sc_wasm_midi_receive_short','_sc_wasm_midi_receive_sysex','_sc_wasm_unix_command_complete','_sc_wasm_process_system_clock_tasks','_malloc','_free']"
            "SHELL:-s EXPORTED_RUNTIME_METHODS=['UTF8ToString','stringToUTF8','lengthBytesUTF8','writeArrayToMemory','ccall','cwrap','HEAPU8','HEAP32','HEAPF32','HEAPF64','allocateUTF8','addFunction','removeFunction','FS','NODEFS']"
            "SHELL:-s ALLOW_MEMORY_GROWTH=1"
            "SHELL:-s ALLOW_TABLE_GROWTH=1"
            "SHELL:-s INITIAL_MEMORY=134217728"
            "SHELL:-s MAXIMUM_MEMORY=1073741824"
            "SHELL:-s STACK_SIZE=8388608"
            "SHELL:-s NO_EXIT_RUNTIME=1"
            "SHELL:-s ENVIRONMENT=node,web,worker,shell"
            "SHELL:-s MODULARIZE=1"
            "SHELL:-s EXPORT_NAME=SClangModule"
            "SHELL:-s ASSERTIONS=1"
            "SHELL:-s NO_DISABLE_EXCEPTION_CATCHING=1"
            "SHELL:-lembind"
            "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/src/class_library@/usr/share/SuperCollider/SCClassLibrary"
            # Task 8: single-file content cache
            "SHELL:--preload-file ${SC_CLASSLIB_PACK}@/hclang_classlib.pack"
            # Task 9: Exclude WASM-irrelevant class library files to reduce boot time.
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/SCDoc"
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/HID_API.sc"
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/HIDFunc.sc"
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/HIDMatchers.sc"
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/Common/Control/SerialPort.sc"
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/Common/Collections/osx"
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/Common/Collections/linux"
            "SHELL:--exclude-file ${CMAKE_SOURCE_DIR}/src/class_library/Common/Audio/iphone"
        )

        set_target_properties(hclang PROPERTIES
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lang/hclang"
            OUTPUT_NAME "hclang"
        )

        install(TARGETS hclang
            RUNTIME DESTINATION "bin"
            PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE)

        # Task 10b: Generate build-time WASM snapshot
        option(HCLANG_BUILD_SNAPSHOT "Generate WASM boot snapshot during build (adds ~0.5s to link step)" ON)
        if(HCLANG_BUILD_SNAPSHOT)
            set(SC_SNAP_BIN "${CMAKE_BINARY_DIR}/lang/hclang/hclang_snap.bin")
            set(SC_HCLANG_JS "${CMAKE_BINARY_DIR}/lang/hclang/hclang.js")
            add_custom_command(TARGET hclang POST_BUILD
                COMMAND node "${CMAKE_SOURCE_DIR}/cli/hclang.js"
                        --print-ready
                        --no-snapshot
                        --snapshot-out "${SC_SNAP_BIN}"
                        --sclang-js "${SC_HCLANG_JS}"
                COMMENT "Generating WASM boot snapshot → hclang_snap.bin"
                VERBATIM
            )
            message(STATUS "  - Build-time snapshot enabled (disable with -DHCLANG_BUILD_SNAPSHOT=OFF)")
        else()
            message(STATUS "  - Build-time snapshot disabled")
        endif()

        message(STATUS "hclang target configured")
        message(STATUS "  - Class library will be preloaded from: ${CMAKE_SOURCE_DIR}/src/class_library")
    else()
        # ── WASI / WAMR path ─────────────────────────────────────────────────
        # No classlib pack, no MEMFS preload, no snapshot, no JS output.
        # The class library is accessed via WASI pre-opened directory at runtime.
        set_target_properties(hclang PROPERTIES SUFFIX ".wasm")

        target_link_options(hclang PRIVATE
            # ___wasm_call_ctors: WAMR skips auto-calling this for WASI modules
            # (it expects _start to call it), but we don't call _start to avoid
            # proc_exit destroying C++ statics. Export it so the host can call it
            # explicitly right after instantiation to run all static constructors.
            #
            # _hc_wasm_classlib_preload_bytes: optional Phase 3.3 fast path. If
            # the host has hclang_classlib.pack available, it copies the bytes
            # into WASM memory and calls this before hc_wasm_eval_init so that
            # passOne reads class library files from an in-memory cache instead
            # of through ~200 individual WASI path_open / fd_read / fd_close
            # round-trips.
            "SHELL:-s EXPORTED_FUNCTIONS=['_hc_wasm_eval_init','_hc_wasm_eval_boot','_hc_wasm_eval_boot_sequence','_hc_wasm_eval_string','_hc_wasm_eval_execute','_hc_wasm_eval_status','_hc_wasm_eval_heap_end','_hc_wasm_eval_add_include_path','_hc_wasm_quarks_set_available','_sc_wasm_process_system_clock_tasks','_hc_wasm_classlib_preload_bytes','_malloc','_free','___wasm_call_ctors']"
            "SHELL:-s ALLOW_MEMORY_GROWTH=1"
            "SHELL:-s INITIAL_MEMORY=134217728"
            "SHELL:-s MAXIMUM_MEMORY=1073741824"
            "SHELL:-s STACK_SIZE=8388608"
            "SHELL:-s ASSERTIONS=1"
            # Disable JS-based exception catching — WAMR handles all exceptions.
            # Class library is accessed via WASI pre-open at runtime (--classlib-dir).
            "SHELL:-s DISABLE_EXCEPTION_CATCHING=1"
        )

        set_target_properties(hclang PROPERTIES
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lang/hclang"
            OUTPUT_NAME "hclang"
        )

        install(TARGETS hclang
            RUNTIME DESTINATION "bin"
            PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE)

        message(STATUS "hclang target configured (WASI/WAMR mode)")
        message(STATUS "  - Class library provided via WASI pre-open at runtime")
    endif()

set_property(TARGET libhclang PROPERTY FOLDER Libs)
