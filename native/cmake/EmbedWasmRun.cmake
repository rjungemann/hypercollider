# Generator script invoked via `cmake -P` from EmbedWasm.cmake.
# Reads HC_EMBED_INPUT, writes a C file at HC_EMBED_OUTPUT defining the
# byte array HC_EMBED_SYMBOL and its _len companion.
#
# Implementation: read the file as a hex string with `file(READ ... HEX)`,
# then a single bulk `string(REGEX REPLACE ...)` to insert "0x" before
# every byte and ",\n" after — this is O(n) instead of the per-byte
# loop's O(n²). The replacement pattern uses doubled backslashes so
# CMake's string parser doesn't eat them as escape sequences.

if(NOT HC_EMBED_INPUT OR NOT HC_EMBED_OUTPUT OR NOT HC_EMBED_SYMBOL)
    message(FATAL_ERROR
        "EmbedWasmRun.cmake requires HC_EMBED_INPUT, HC_EMBED_OUTPUT, HC_EMBED_SYMBOL")
endif()

file(READ "${HC_EMBED_INPUT}" hex_content HEX)

# CMake quirk: in a `string(REGEX REPLACE)` replacement string, `\\1` in
# the source becomes `\1` after the parser, and `\1` is treated as a
# regex backreference. We want a literal `0x` prefix plus the matched
# byte plus `, ` separator, with a newline every 16 bytes for readability.
#
# First pass: turn each byte (two hex chars) into "0xXX, ".
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1, " hex_content "${hex_content}")
# Second pass: insert a newline after every 16 bytes (= every 16 "0xXX, "
# groups of 6 chars each = 96 chars). Using a regex anchored on the
# group boundary keeps this O(n).
string(REGEX REPLACE "((0x[0-9a-f][0-9a-f], ){16})" "\\1\n    " hex_content "${hex_content}")

set(out "/* Auto-generated from ${HC_EMBED_INPUT}. Do not edit. */\n")
string(APPEND out "#include <stddef.h>\n")
string(APPEND out "const unsigned char ${HC_EMBED_SYMBOL}[] = {\n    ${hex_content}\n};\n")
string(APPEND out "const size_t ${HC_EMBED_SYMBOL}_len = sizeof(${HC_EMBED_SYMBOL});\n")

file(WRITE "${HC_EMBED_OUTPUT}" "${out}")
