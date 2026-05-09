# copy_data_files.cmake
# Called at build time (cmake -P) by the cli POST_BUILD step.
# Copies optional .data files to the CLI bundle only if they exist.
# Variables passed in via -D:
#   SCSYNTH_DATA  – path to scsynth.data (may not exist)
#   SCLANG_DATA   – path to sclang_wasm.data (may not exist)
#   DEST_DIR      – destination directory

foreach(src IN ITEMS "${SCSYNTH_DATA}" "${SCLANG_DATA}")
    if(EXISTS "${src}")
        get_filename_component(fname "${src}" NAME)
        file(COPY "${src}" DESTINATION "${DEST_DIR}")
        message(STATUS "CLI bundle: copied ${fname}")
    endif()
endforeach()
