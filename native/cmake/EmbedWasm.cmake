# EmbedWasm.cmake - CMake helper to embed a binary blob as a C byte array
#
# Usage:
#   embed_wasm(target wasm_file symbol_name)
#
# Generates a .c file with `const unsigned char <symbol>[] = { ... };` and
# `const size_t <symbol>_len = ...;` and adds it to <target>'s sources.
#
# Implementation: defer to a small helper script invoked via `cmake -P` that
# reads the input file as bytes and emits the C array. We avoid CMake's
# `string(REGEX REPLACE ...)` on the hex content because the result needs
# literal `0x` prefixes plus `\1` backreferences would need double-escaping
# (CMake's `\1` in the replacement string is interpreted as control-char
# 0x01, breaking downstream CMake parsing). The generator-script approach
# also keeps regenerate-on-input-change semantics via DEPENDS.

# Capture the directory of THIS file at include-time. CMAKE_CURRENT_LIST_DIR
# inside the function would resolve to the calling CMakeLists.txt's dir.
set(HC_EMBED_WASM_DIR "${CMAKE_CURRENT_LIST_DIR}" CACHE INTERNAL "")

function(embed_wasm target wasm_file symbol_name)
    set(generated_file "${CMAKE_CURRENT_BINARY_DIR}/${symbol_name}.c")

    add_custom_command(
        OUTPUT  "${generated_file}"
        COMMAND ${CMAKE_COMMAND}
                -DHC_EMBED_INPUT=${wasm_file}
                -DHC_EMBED_OUTPUT=${generated_file}
                -DHC_EMBED_SYMBOL=${symbol_name}
                -P "${HC_EMBED_WASM_DIR}/EmbedWasmRun.cmake"
        DEPENDS "${wasm_file}"
                "${HC_EMBED_WASM_DIR}/EmbedWasmRun.cmake"
        COMMENT "Embedding ${wasm_file} as ${symbol_name}"
        VERBATIM
    )
    target_sources(${target} PRIVATE "${generated_file}")
endfunction()
