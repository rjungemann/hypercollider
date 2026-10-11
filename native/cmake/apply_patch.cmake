# apply_patch.cmake -- apply a patch to a fetched dependency's sources, once.
#
# Run as a FetchContent/CPM PATCH_COMMAND, in the dependency's source tree:
#
#   PATCH_COMMAND ${CMAKE_COMMAND} -DGIT=${GIT_EXECUTABLE}
#                 -DPATCH=<file.patch> -DWORK_DIR=<scratch dir> -P <this file>
#
# WORK_DIR holds the LF copy of the patch; it defaults to the working
# directory, which is the dependency's source tree, so pass a build dir.
#
# CPM's own PATCHES option runs `patch` on every configure (FetchContent's git
# update step always runs, and the patch step follows it), which fails on the
# second configure with "Reversed (or previously applied) patch detected".
# Here an already-applied patch is a no-op: `git apply --reverse --check`
# succeeding means it is in. When an earlier version of the patch is in, the
# files it touches are checked out as fetched and this version applied.
#
# Line endings: a Windows checkout with core.autocrlf gives CRLF in both the
# fetched sources and this repository's .patch file. The files the patch
# touches, and a copy of the patch, are normalised to LF first, so it applies
# whatever either checkout did.

if(NOT GIT OR NOT PATCH)
    message(FATAL_ERROR "apply_patch.cmake needs -DGIT=<git> -DPATCH=<file>")
endif()
if(NOT WORK_DIR)
    set(WORK_DIR "${CMAKE_CURRENT_BINARY_DIR}")
endif()

# file(READ) drops the CR of each CRLF, so what it returns is already LF.
file(READ "${PATCH}" patch_text)
get_filename_component(patch_name "${PATCH}" NAME)
set(lf_patch "${WORK_DIR}/${patch_name}.lf")
file(WRITE "${lf_patch}" "${patch_text}")

# The files the patch changes: its "+++ b/<path>" lines.
string(REGEX MATCHALL "\n\\+\\+\\+ b/[^\n\t]+" targets "\n${patch_text}")
set(paths)
foreach(target IN LISTS targets)
    string(REGEX REPLACE "^\n\\+\\+\\+ b/" "" path "${target}")
    list(APPEND paths "${path}")
endforeach()

macro(normalise_paths)
    foreach(path IN LISTS paths)
        if(EXISTS "${path}")
            file(READ "${path}" text)
            file(SIZE "${path}" size)
            string(LENGTH "${text}" length)
            if(NOT size EQUAL length) # CRs were dropped: write it back as LF
                file(WRITE "${path}" "${text}")
            endif()
        endif()
    endforeach()
endmacro()
normalise_paths()

execute_process(
    COMMAND "${GIT}" apply --reverse --check "${lf_patch}"
    RESULT_VARIABLE already_applied
    OUTPUT_QUIET ERROR_QUIET)
if(already_applied EQUAL 0)
    message(STATUS "Patch already applied: ${patch_name}")
    return()
endif()

# Neither in nor applicable: an earlier version of the patch is in. Put the
# files back as fetched and apply this one.
execute_process(
    COMMAND "${GIT}" apply --check "${lf_patch}"
    RESULT_VARIABLE applicable
    OUTPUT_QUIET ERROR_QUIET)
if(NOT applicable EQUAL 0)
    message(STATUS "Patch changed since it was applied; restoring ${paths}")
    execute_process(COMMAND "${GIT}" checkout -- ${paths})
    normalise_paths()
endif()

execute_process(
    COMMAND "${GIT}" apply "${lf_patch}"
    RESULT_VARIABLE rc)
if(NOT rc EQUAL 0)
    message(FATAL_ERROR "Could not apply ${PATCH}")
endif()
message(STATUS "Applied patch: ${patch_name}")
