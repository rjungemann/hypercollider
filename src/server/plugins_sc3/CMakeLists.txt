#---------
# includes
#---------

include_directories(${CMAKE_SOURCE_DIR}/include/)
include_directories(${CMAKE_SOURCE_DIR}/common)
include_directories(${CMAKE_SOURCE_DIR}/plugin_interface)
include_directories(${CMAKE_SOURCE_DIR}/include/plugin_interface)
include_directories(${CMAKE_SOURCE_DIR}/include/common)
include_directories(${CMAKE_SOURCE_DIR}/server/plugins) # for FFT_UGens.h
include_directories(${CMAKE_SOURCE_DIR}/src/platform)

# Force include path via compiler flags for out-of-tree builds
add_compile_options(-I${CMAKE_SOURCE_DIR}/include)

# FFT backend: Green FFT (no FFTW3/vDSP available in WASM)
add_compile_definitions(SC_FFT_GREEN=1)

message(STATUS "Configuring sc3-plugins for WASM target")


#-------
# macros
#-------

macro(GET_GCC_VERSION VAR)
    if (CMAKE_COMPILER_IS_GNUCC)
        execute_process(
            COMMAND ${CMAKE_CXX_COMPILER} --version OUTPUT_VARIABLE OUTPUT)
        string(REGEX REPLACE
            ".* ([0-9]\\.[0-9]\\.[0-9]) .*" "\\1" ${VAR} ${OUTPUT})
    endif()
endmacro(GET_GCC_VERSION)


macro(FIND_AND_BUILD_PLUGINS DIR)
    file(GLOB PLUGIN_SRC RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}" "${DIR}/*.cpp")
    foreach(plugin ${PLUGIN_SRC})
        get_filename_component(basename ${plugin} NAME_WE)
        BUILD_PLUGIN(${basename} ${plugin} "" "${DIR}")
    endforeach(plugin)
endmacro()


# Track wasm plugin sources for combined library
set(SC_WASM_PLUGIN_SOURCES "" CACHE INTERNAL "Combined plugin sources for WASM")

macro(BUILD_PLUGIN PLUGIN_NAME PLUGIN_SOURCES PLUGIN_LIBS PLUGIN_DIR)
    # Each plugin is compiled separately for proper registration,
    # then collected into the combined SC_Wasm_Plugins static library.
    add_library(${PLUGIN_NAME} STATIC ${PLUGIN_SOURCES})
    list(APPEND plugins ${PLUGIN_NAME})
    list(APPEND wasm_plugins ${PLUGIN_NAME})
    target_link_libraries(${PLUGIN_NAME} ${PLUGIN_LIBS})
    set_property(TARGET ${PLUGIN_NAME} PROPERTY POSITION_INDEPENDENT_CODE ON)

    target_include_directories(${PLUGIN_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/include)
    target_include_directories(${PLUGIN_NAME} PRIVATE ${SC_PATH}/src/platform)

    # Collect sources for combined library
    list(APPEND SC_WASM_PLUGIN_SOURCES ${PLUGIN_SOURCES})

    message(STATUS "Building ${PLUGIN_NAME} as static library")
endmacro()

#-----------------------
# plugins without extras
#-----------------------

set(PLUGIN_DIRS
    AntiAliasingOscillators
    ATK
    BatUGens
    BBCut2UGens
    BerlachUGens
    BhobUGens
    BlackrainUGens
    ConcatUGens
    DistortionUGens
    DWGUGens
    GlitchUGens
    JoshUGens
    LoopBufUGens
    MCLDUGens
    MdaUGens
    Neuromodules
    NHUGens
    QuantityUGens
    RFWUGens
    RMEQSuiteUGens
    SCMIRUGens
    SkUGens
    SLUGens
    SummerUGens
    TagSystemUGens
    VBAPUGens
    VOSIMUGens
)

# plugins with extra lib
set(PLUGIN_DIRS_EXTRA
    AuditoryModeling
    BetablockerUGens
    ChaosUGens
    DEINDUGens
    MembraneUGens
    NCAnalysisUGens
    OteyPianoUGens
    PitchDetection
    StkUGens
    TJUGens
)

# Plugin tier filtering
# Define Tier-1 plugins (pure C++, no external deps, high priority)
# Note: GendynUGens and GrainUGens are built-in server plugins, not sc3-plugins
set(WASM_TIER1_PLUGINS
        AntiAliasingOscillators
        BlackrainUGens
        BerlachUGens
        ChaosUGens
        ConcatUGens
        DistortionUGens
        DWGUGens
        LoopBufUGens
        Neuromodules
        SkUGens
        SLUGens
        SummerUGens
        VOSIMUGens
    )
    # Define Tier-2 plugins (pure C++ or SC-FFT dependent, feasible for WASM)
    # Note: AYUGens/TJUGens/MembraneUGens/DEINDUGens/AuditoryModeling/BetablockerUGens/
    #       PitchDetection handled separately below (multiple sources or extra include paths).
    set(WASM_TIER2_PLUGINS
        GlitchUGens
        NHUGens
        QuantityUGens
        RFWUGens
        RMEQSuiteUGens
        TagSystemUGens
        MdaUGens
        VBAPUGens
        BhobUGens
        NCAnalysisUGens
    )

    # Define Tier-3 plugins (viable for future implementation, power-of-2 FFT compatible)
    set(WASM_TIER3_PLUGINS
        ATK
        BatUGens
        BBCut2UGens
        JoshUGens
        MCLDUGens
        StkUGens
        SCMIRUGens
    )

    # Filter plugins based on tier selection
    if(SC_WASM_PLUGIN_TIER EQUAL 1)
        # Tier 1 only
        set(FILTERED_PLUGIN_DIRS "${WASM_TIER1_PLUGINS}")
        set(FILTERED_PLUGIN_DIRS_EXTRA "")
        message(STATUS "WASM: Building Tier-1 plugins only")
    elseif(SC_WASM_PLUGIN_TIER EQUAL 2)
        # Tier 1 + Tier 2 (FILTERED_PLUGIN_DIRS_EXTRA handled separately below)
        set(FILTERED_PLUGIN_DIRS "${WASM_TIER1_PLUGINS};${WASM_TIER2_PLUGINS}")
        set(FILTERED_PLUGIN_DIRS_EXTRA "")
        message(STATUS "WASM: Building Tier-1 and Tier-2 plugins")
    elseif(SC_WASM_PLUGIN_TIER EQUAL 3)
        # Tier 1 + Tier 2 + Tier 3
        set(FILTERED_PLUGIN_DIRS "${WASM_TIER1_PLUGINS};${WASM_TIER2_PLUGINS};${WASM_TIER3_PLUGINS}")
        set(FILTERED_PLUGIN_DIRS_EXTRA "")
        message(STATUS "WASM: Building Tier-1, Tier-2, and Tier-3 plugins")
    else()
        # All plugins (all tiers + extras)
        message(STATUS "WASM: Building all available plugins")
    endif()

    message(STATUS "WASM Plugin Tier: ${SC_WASM_PLUGIN_TIER}")

if (${CMAKE_CXX_COMPILER_ID} MATCHES "Clang" AND ${CMAKE_CXX_COMPILER_VERSION} MATCHES "^6.0.")
  set(BHOBFILT_CPP "${CMAKE_CURRENT_SOURCE_DIR}/BhobUGens/BhobFilt.cpp")
  message(STATUS "Skipping vectorization on BhobFilt.cpp because of Clang bug. (${BHOBFILT_CPP})")
  SET_SOURCE_FILES_PROPERTIES(${BHOBFILT_CPP} PROPERTIES COMPILE_FLAGS "-fno-slp-vectorize")
endif()

set(plugins "")
set(supernova_plugins "")

set(CMAKE_SHARED_MODULE_PREFIX "")
set(PLUGIN_EXTENSION ".so")

if (APPLE OR WIN32)
    set(CMAKE_SHARED_MODULE_SUFFIX ".scx")
    set(PLUGIN_EXTENSION ".scx")
endif()


GET_GCC_VERSION(gcc_version)


if(UNIX AND NOT APPLE)
    set(LIB_SUFFIX "" CACHE STRING "Install plugins to suffixed lib directory: eg. `64` for `lib64`")
endif()

if (CMAKE_SYSTEM_NAME MATCHES "Linux|.*BSD|DragonFly")
    set(INSTALL_DESTINATION "lib${LIB_SUFFIX}/SuperCollider/plugins")
    if (QUARKS)
        set(INSTALL_DESTINATION_DISTRO "share/SuperCollider/SC3plugins")
    else()
        set(INSTALL_DESTINATION_DISTRO "share/SuperCollider/Extensions/SC3plugins")
    endif(QUARKS)
else()
    set(INSTALL_DESTINATION "SC3plugins")
    set(INSTALL_DESTINATION_DISTRO "SC3plugins")
endif()

foreach(DIR ${FILTERED_PLUGIN_DIRS})
    FIND_AND_BUILD_PLUGINS(${DIR})
endforeach(DIR)
foreach(DIR ${FILTERED_PLUGIN_DIRS_EXTRA})
    FIND_AND_BUILD_PLUGINS(${DIR})
endforeach(DIR)

    # Tier 2: Special plugins that need extra source files or custom include paths
    if(SC_WASM_PLUGIN_TIER GREATER_EQUAL 2)
        # AYUGens - requires AY_libayemu (bundled, local headers + .c source)
        include_directories(AYUGens/AY_libayemu/include)
        BUILD_PLUGIN(AY_UGen "AYUGens/AY_UGen.cpp;AYUGens/AY_libayemu/src/ay8912.c" "" "AYUGens")

        # TJUGens - multiple source files (Dfm1.cpp, TJUGens.cpp, etc.)
        file(GLOB TJUGensSources TJUGens/*.cpp)
        BUILD_PLUGIN(TJUGens "${TJUGensSources}" "" "TJUGens")

        # MembraneUGens - mixed C and C++ sources
        BUILD_PLUGIN(MembraneUGens "MembraneUGens/Membrane_shape.c;MembraneUGens/Membrane.cpp" "" "MembraneUGens")

        # AuditoryModeling - multiple cpp files compiled together (one PluginLoad in AuditoryModelingUGens.cpp)
        file(GLOB AuditoryModelingSources AuditoryModeling/*.cpp)
        BUILD_PLUGIN(AuditoryModeling "${AuditoryModelingSources}" "" "AuditoryModeling")

        # BetablockerUGens - main UGen + betablocker VM engine (subdirectory sources)
        BUILD_PLUGIN(BetablockerUGens
            "BetablockerUGens/BetablockerUGens.cpp;BetablockerUGens/betablocker/machine.cpp;BetablockerUGens/betablocker/thread.cpp"
            "" "BetablockerUGens")

        # DEINDUGens - pre-generated Faust C++; JPverb/Greyhole need DEINDUGens/include/ for Faust headers
        include_directories(DEINDUGens/include)
        BUILD_PLUGIN(RMS "DEINDUGens/RMS.cpp" "" "DEINDUGens")
        BUILD_PLUGIN(DiodeRingMod "DEINDUGens/DiodeRingMod.cpp" "" "DEINDUGens")
        BUILD_PLUGIN(complexRes "DEINDUGens/complexRes.cpp" "" "DEINDUGens")
        BUILD_PLUGIN(JPverb "DEINDUGens/JPverbRaw.cpp" "" "DEINDUGens")
        set_property(TARGET JPverb APPEND PROPERTY COMPILE_DEFINITIONS SC_FAUST_PREFIX="\"\"")
        set_property(TARGET JPverb APPEND PROPERTY COMPILE_DEFINITIONS mydsp=JPVERB)
        set_property(TARGET JPverb APPEND PROPERTY COMPILE_DEFINITIONS NDEBUG)
        BUILD_PLUGIN(Greyhole "DEINDUGens/GreyholeRaw.cpp" "" "DEINDUGens")
        set_property(TARGET Greyhole APPEND PROPERTY COMPILE_DEFINITIONS SC_FAUST_PREFIX="\"\"")
        set_property(TARGET Greyhole APPEND PROPERTY COMPILE_DEFINITIONS mydsp=GREYHOLE)
        set_property(TARGET Greyhole APPEND PROPERTY COMPILE_DEFINITIONS NDEBUG)

        # PitchDetection - Qitch (WASM-safe) + Tartini (excluded via #ifndef SC_WASM guard in Tartini.cpp)
        file(GLOB PitchDetectionSources PitchDetection/*.cpp)
        BUILD_PLUGIN(PitchDetection "${PitchDetectionSources}" "" "PitchDetection")
    endif()

    # Tier 3: plugins with extra sources not covered by FIND_AND_BUILD_PLUGINS
    if(SC_WASM_PLUGIN_TIER GREATER_EQUAL 3)
        # STK is now fetched via CPM (src/external/CMakeLists.txt Phase 2c).
        # Build only the synthesis cores; exclude networking/threading/realtime components.
        file(GLOB STKSources "${HC_STK_SOURCE_DIR}/src/*.cpp")
        set(UnneededSTKSources
            "${HC_STK_SOURCE_DIR}/src/Rt*.cpp"
            "${HC_STK_SOURCE_DIR}/src/Inet*.cpp"
            "${HC_STK_SOURCE_DIR}/src/Socket.cpp"
            "${HC_STK_SOURCE_DIR}/src/Tcp*.cpp"
            "${HC_STK_SOURCE_DIR}/src/UdpSocket.cpp"
            "${HC_STK_SOURCE_DIR}/src/Thread.cpp"
            "${HC_STK_SOURCE_DIR}/src/Mutex.cpp"
            "${HC_STK_SOURCE_DIR}/src/Messager.cpp"
        )
        file(GLOB UnneededExpanded ${UnneededSTKSources})
        list(REMOVE_ITEM STKSources ${UnneededExpanded})

        # Compile the shared STK implementation once into the combined WASM plugin library.
        list(APPEND SC_WASM_PLUGIN_SOURCES ${STKSources})

        # Wrapper translation unit for the extra StkInst plugin entry point.
        # StkUGens/StkAll.cpp is already picked up by the generic Tier-3 directory pass.
        BUILD_PLUGIN(StkUnit "StkInst/StkInst.cpp" "" "StkInst")

        BUILD_PLUGIN(OteyPianoUGens "OteyPianoUGens/OteyPiano.cpp;OteyPianoUGens/dwgs.cpp;OteyPianoUGens/filter.cpp;OteyPianoUGens/hammer.cpp;OteyPianoUGens/reverb.cpp" "" "OteyPianoUGens")
    endif()

# Create combined static library for all plugins.
# This library contains all plugin UGen definitions for linking into the WASM binary.
if(SC_WASM_PLUGIN_SOURCES)
    # Create combined library from all plugin sources
    add_library(SC_Wasm_Plugins STATIC ${SC_WASM_PLUGIN_SOURCES})
    set_property(GLOBAL PROPERTY wasm_plugins_lib SC_Wasm_Plugins)
    
    # Link all individual plugin libraries into the combined one
    if(wasm_plugins)
        target_link_libraries(SC_Wasm_Plugins PRIVATE ${wasm_plugins})
    endif()
    
    # Add include directories
    target_include_directories(SC_Wasm_Plugins PRIVATE ${CMAKE_SOURCE_DIR}/include)
    target_include_directories(SC_Wasm_Plugins PRIVATE ${CMAKE_SOURCE_DIR})
    target_include_directories(SC_Wasm_Plugins PRIVATE ${CMAKE_SOURCE_DIR}/include)
    # nova-simd headers for SIMD-enabled plugins (CPM-fetched; see src/external/CMakeLists.txt Phase 3)
    target_include_directories(SC_Wasm_Plugins PRIVATE ${HC_NOVA_SIMD_DIR})
    # STK headers for synthesis core plugins (CPM-fetched; see src/external/CMakeLists.txt Phase 2c)
    target_include_directories(SC_Wasm_Plugins PRIVATE ${HC_STK_SOURCE_DIR})
    target_include_directories(SC_Wasm_Plugins PRIVATE ${HC_STK_SOURCE_DIR}/include)
    target_include_directories(SC_Wasm_Plugins PRIVATE ${HC_STK_SOURCE_DIR}/src/include)

    set_property(TARGET SC_Wasm_Plugins PROPERTY POSITION_INDEPENDENT_CODE ON)

    # Unity build: batch multiple TUs together to cut Emscripten invocations.
    # STK alone contributes ~90 TUs; batching into groups of
    # 20 reduces that to ~10 compiler calls for each, saving 30-50% build time.
    set_target_properties(SC_Wasm_Plugins PROPERTIES
        UNITY_BUILD ON
        UNITY_BUILD_BATCH_SIZE 20
    )

    message(STATUS "WASM: Created combined plugins library SC_Wasm_Plugins with ${SC_WASM_PLUGIN_SOURCES}")
endif()
