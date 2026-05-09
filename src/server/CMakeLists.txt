if(UNIX AND NOT APPLE)
	set(LIB_SUFFIX "" CACHE STRING "Install plugins to suffixed lib directory: eg. `64` for `lib64`")
	set(LINUX_SC_PLUGIN_DIR ${CMAKE_INSTALL_PREFIX}/lib${LIB_SUFFIX}/SuperCollider/plugins)
endif()

# sc3-plugins: create SC_Wasm_Plugins before core, which links it into hcsynth.wasm.
# See docs/SC3_PLUGINS_INTEGRATION_PLAN.md (Phase 1).
add_subdirectory(plugins_sc3)
add_subdirectory(plugins)
add_subdirectory(core)

set(plugins "${plugins}" PARENT_SCOPE)
