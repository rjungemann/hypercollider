#ifndef HC_AUDIO_OUT_H
#define HC_AUDIO_OUT_H

#include <miniaudio.h>

// Initialize audio device
bool audio_init(ma_device* pDevice, int sample_rate, int channels, ma_device_data_proc callback);

// Cleanup audio device
void audio_cleanup(ma_device* pDevice);

#endif // HC_AUDIO_OUT_H
