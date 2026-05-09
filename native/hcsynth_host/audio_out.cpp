#include "audio_out.h"
#include <cstring>

bool audio_init(ma_device* pDevice, int sample_rate, int channels, ma_device_data_proc callback) {
    ma_result result;
    
    ma_device_config config = ma_device_config_init(ma_device_type_playback);
    config.playback.format = ma_format_f32;
    config.playback.channels = channels;
    config.sampleRate = sample_rate;
    config.dataCallback = callback;
    config.pUserData = nullptr;
    
    result = ma_device_init(nullptr, &config, pDevice);
    if (result != MA_SUCCESS) {
        return false;
    }
    
    return true;
}

void audio_cleanup(ma_device* pDevice) {
    ma_device_uninit(pDevice);
}
