# hcsynth native host
# All CPM packages and vmlib are set up in the parent CMakeLists.txt

add_executable(hcsynth_native
    main.cpp
    wasm_host.cpp
    osc_server.cpp
    audio_out.cpp
    impl.cpp
    ${TINYOSC_SOURCE_DIR}/tinyosc.c
)

target_include_directories(hcsynth_native PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${MINIAUDIO_SOURCE_DIR}
    ${DR_LIBS_SOURCE_DIR}
    ${TINYOSC_SOURCE_DIR}
)

target_link_libraries(hcsynth_native PRIVATE
    vmlib
    CLI11::CLI11
)

if(HC_EMBED_WASM AND EXISTS "${HCSYNTH_WASM}")
    embed_wasm(hcsynth_native "${HCSYNTH_WASM}" hcsynth_wasm_blob)
    target_compile_definitions(hcsynth_native PRIVATE HC_EMBEDDED_WASM=1)
else()
    target_compile_definitions(hcsynth_native PRIVATE HC_LOAD_WASM_FROM_FILE=1)
endif()

if(APPLE)
    target_link_libraries(hcsynth_native PRIVATE
        "-framework CoreAudio"
        "-framework AudioToolbox"
        "-framework CoreFoundation"
    )
elseif(UNIX)
    target_link_libraries(hcsynth_native PRIVATE -lpthread -ldl -lm)
endif()

install(TARGETS hcsynth_native DESTINATION bin)
