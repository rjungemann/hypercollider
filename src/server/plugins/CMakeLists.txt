include_directories(
	${CMAKE_SOURCE_DIR}/src/include/common
	${CMAKE_SOURCE_DIR}/src/common
	${CMAKE_SOURCE_DIR}/src/include/plugin_interface
)

set(plugin_sources
	binary_op_ugens.cpp
	chaos_ugens.cpp
	delay_ugens.cpp
	demand_ugens.cpp
	demo_ugens.cpp
	dyn_noise_ugens.cpp
	filter_ugens.cpp
	gendyn_ugens.cpp
	grain_ugens.cpp
	io_ugens.cpp
	lf_ugens.cpp
	mul_add_ugens.cpp
	noise_ugens.cpp
	osc_ugens.cpp
	pan_ugens.cpp
	physical_modeling_ugens.cpp
	reverb_ugens.cpp
	test_ugens.cpp
	trigger_ugens.cpp
	unary_op_ugens.cpp
	unpack_fft_ugens.cpp
)

set(plugins "")
set(supernova_plugins "")

set(CMAKE_SHARED_MODULE_PREFIX "")
set(CMAKE_SHARED_MODULE_SUFFIX ".scx")

foreach(plugin ${plugin_sources})
	string(REPLACE .cpp "" plugin_name ${plugin} )
	add_library(${plugin_name} MODULE ${plugin})
	list(APPEND plugins ${plugin_name})
endforeach(plugin)

add_library(FFT_UGens MODULE
	fft_interface_table.cpp
	fft_ugens.cpp
	pv_ugens.cpp
	partitioned_convolution.cpp
	${scplugin_common_sources}
)

add_library(PV_ThirdParty MODULE
	convolution.cpp
	fft2_interface_table.cpp
	feature_detection.cpp
	pv_third_party.cpp
	${scplugin_common_sources}
)

add_library(ML_UGens MODULE
	ml.cpp
	loudness.cpp
	beat_track.cpp
	onsets.cpp
	onsetsds.c
	key_track.cpp
	mfcc.cpp
	beat_track2.cpp
	ml_spec_stats.cpp
	beat_track.h
	beat_track2.h
	ml.h
	onsets.h
	onsetsds.h
	${scplugin_common_sources}
)

if(NOT NO_LIBSNDFILE)
	set(diskio_sources disk_io_ugens.cpp)
	add_library(DiskIO_UGens MODULE ${diskio_sources})

	if(SNDFILE_FOUND)
		if(SNDFILE_HAS_VORBIS)
			target_compile_definitions(DiskIO_UGens PUBLIC SNDFILE_HAS_VORBIS)
		endif()
		if(SNDFILE_HAS_OPUS)
			target_compile_definitions(DiskIO_UGens PUBLIC SNDFILE_HAS_OPUS)
		endif()
		if(SNDFILE_HAS_MPEG)
			target_compile_definitions(DiskIO_UGens PUBLIC SNDFILE_HAS_MPEG)
		endif()
		target_include_directories(DiskIO_UGens PUBLIC ${SNDFILE_INCLUDE_DIR})
		target_link_libraries(DiskIO_UGens PRIVATE ${PTHREADS_LIBRARY} ${SNDFILE_LIBRARIES})
		list(APPEND plugins DiskIO_UGens)
	else()
		message(SEND_ERROR "Cannot find libsndfile")
	endif(SNDFILE_FOUND)
endif()

set(fft_ugens FFT_UGens PV_ThirdParty ML_UGens)
list(APPEND plugins FFT_UGens PV_ThirdParty ML_UGens)

if (FFTW3F_FOUND)
	include_directories (${FFTW3F_INCLUDE_DIR})
endif()

foreach(ugen ${fft_ugens})
	target_link_libraries(${ugen} PRIVATE ${PTHREADS_LIBRARY} ${MATH_LIBRARY})

	if(APPLE)
		target_link_libraries(${ugen} PRIVATE "-framework Accelerate")
	endif()
endforeach()

if(NOVA_SIMD)
	# Plugins use the CPM-fetched nova-simd from src/external/CMakeLists.txt.
	# The previous path src/external/nova-simd was an empty placeholder.
	foreach(plugin ${plugins} ${supernova_plugins})
		target_include_directories(${plugin} PUBLIC ${HC_NOVA_SIMD_DIR})
		target_compile_definitions(${plugin} PUBLIC NOVA_SIMD)
	endforeach()
endif()

if (APPLE)
	if(NOT NO_LIBSNDFILE)
		target_link_libraries(DiskIO_UGens PRIVATE "-framework CoreServices")
	endif()
endif()

install(TARGETS ${plugins}
		DESTINATION "lib${LIB_SUFFIX}/SuperCollider/plugins"
		PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE)

set_property(TARGET ${plugins} PROPERTY FOLDER UnitGenerators)

set(plugins "${plugins}" PARENT_SCOPE)
