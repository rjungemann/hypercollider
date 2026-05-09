# hclang native host
# All CPM packages and vmlib are set up in the parent CMakeLists.txt

add_executable(hclang_native
    main.cpp
    wasm_host.cpp
    ${LINENOISE_SOURCE_DIR}/linenoise.c
)

target_include_directories(hclang_native PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${LINENOISE_SOURCE_DIR}
)

target_link_libraries(hclang_native PRIVATE
    vmlib
    CLI11::CLI11
)

if(HC_EMBED_WASM AND EXISTS "${HCLANG_WASM}")
    embed_wasm(hclang_native "${HCLANG_WASM}" hclang_wasm_blob)
    target_compile_definitions(hclang_native PRIVATE HC_EMBEDDED_WASM=1)
else()
    target_compile_definitions(hclang_native PRIVATE HC_LOAD_WASM_FROM_FILE=1)
endif()

# Phase 9: also embed the SC class library pack so the binary is fully
# self-contained — running with no flags works because the host falls back
# to the embedded pack + extracts it to a temp dir for the WASI pre-open.
set(HCLANG_CLASSLIB_PACK
    "${WASI_BUILD_DIR}/lang/hclang/hclang_classlib.pack"
    CACHE FILEPATH "Path to the SC class library pack")
if(HC_EMBED_WASM AND EXISTS "${HCLANG_CLASSLIB_PACK}")
    embed_wasm(hclang_native "${HCLANG_CLASSLIB_PACK}" hclang_classlib_pack_blob)
    target_compile_definitions(hclang_native PRIVATE HC_EMBEDDED_CLASSLIB_PACK=1)
endif()

if(APPLE)
    # No special frameworks needed for hclang (no audio)
elseif(UNIX)
    target_link_libraries(hclang_native PRIVATE -lpthread -ldl)
endif()

install(TARGETS hclang_native DESTINATION bin)
