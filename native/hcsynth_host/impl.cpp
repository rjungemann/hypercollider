// impl.cpp — single translation unit that compiles single-header library
// implementations.  Must appear in exactly ONE .cpp file per target.
//
// miniaudio: real-time audio playback
// dr_wav:    WAV file read/write

#define MA_IMPLEMENTATION
#include <miniaudio.h>

#define DR_WAV_IMPLEMENTATION
#include <dr_wav.h>
