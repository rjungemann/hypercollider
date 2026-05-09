# HyperCollider WASM Platform Abstraction Layer

message(STATUS "Building WASM platform abstractions")

# WASM Platform Library
set(WASM_PLATFORM_SOURCES
    HC_Wasm_Filesystem.cpp
    HC_Wasm_PluginRegistry.cpp
    HC_Wasm_Api.cpp
    HC_Wasm_OscShim.cpp
    HC_Wasm_Eval.cpp
)

# Add Emscripten bindings if we're actually building with Emscripten
# but NOT in WASI mode (embind is JS-only)
if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten" AND NOT SC_WASM_WASI)
    list(APPEND WASM_PLATFORM_SOURCES HC_Wasm_Embind.cpp)
    
    # Phase 7.2: Add sclang WASM bindings
    if(TARGET libhclang)
        list(APPEND WASM_PLATFORM_SOURCES HC_Wasm_Sclang.cpp)
        message(STATUS "Including sclang WASM bindings")
    endif()
    
    message(STATUS "Including Emscripten bindings")
endif()

add_library(hc_platform STATIC ${WASM_PLATFORM_SOURCES})

target_include_directories(hc_platform PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/..
    ${CMAKE_SOURCE_DIR}/src/include/common
    ${CMAKE_SOURCE_DIR}/src/include/server
    ${CMAKE_SOURCE_DIR}/src/include/lang
    ${CMAKE_SOURCE_DIR}/src/include/plugin_interface
    ${CMAKE_SOURCE_DIR}/src/server/core
    ${CMAKE_SOURCE_DIR}/src/lang/core
    ${CMAKE_SOURCE_DIR}/src/common
)

# tlsf → tlsf.h (SC_HiddenWorld.h → server_shm.hpp → scope_buffer.hpp)
# INTERFACE/STATIC target from src/external/CMakeLists.txt.
target_link_libraries(hc_platform PUBLIC tlsf)

# Add WASM-specific compile definitions
target_compile_definitions(hc_platform PRIVATE SC_WASM=1)

# Enable C++ exception support so that HC_Wasm_Api.cpp can propagate and handle
# exceptions thrown by GraphDef_Recv and friends.
target_compile_options(hc_platform PRIVATE -fexceptions)

# For Emscripten builds, add embind support
if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
    target_compile_options(hc_platform PRIVATE
        -fPIC
        "SHELL:-s WASM_ASYNC_COMPILATION=1"
        "SHELL:-s FORCE_FILESYSTEM=0"
    )

    if(NOT SC_WASM_WASI)
        target_link_options(hc_platform INTERFACE
            "SHELL:-s WASM_ASYNC_COMPILATION=1"
            "SHELL:-lembind"
        )
    endif()
endif()

message(STATUS "WASM platform library: hc_platform")

# Link sc3-plugins if available
if(TARGET SC_Wasm_Plugins)
    target_link_libraries(hc_platform PRIVATE SC_Wasm_Plugins)
    message(STATUS "Linked WASM plugins library")
    
    # Get all individual plugin libraries
    get_property(wasm_plugins_list GLOBAL PROPERTY wasm_plugins_list)
    if(wasm_plugins_list)
        target_link_libraries(hc_platform PRIVATE ${wasm_plugins_list})
        message(STATUS "Linked individual WASM plugins: ${wasm_plugins_list}")
    endif()
endif()
