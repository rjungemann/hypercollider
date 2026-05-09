#pragma once

#ifdef SC_WASM_SNDFILE_COMPAT

#include <SC_sndfile_stub.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <memory>
#include <string>

#ifndef SFM_READ
#define SFM_READ 0x10
#endif

#ifndef SFM_WRITE
#define SFM_WRITE 0x20
#endif

#ifndef SF_TRUE
#define SF_TRUE 1
#endif

#ifndef SF_FALSE
#define SF_FALSE 0
#endif

#ifndef SF_FORMAT_TYPEMASK
#define SF_FORMAT_TYPEMASK 0x0FFF0000
#endif

#ifndef SF_FORMAT_SUBMASK
#define SF_FORMAT_SUBMASK 0x0000FFFF
#endif

#ifndef SF_FORMAT_WAV
#define SF_FORMAT_WAV 0x010000
#endif

#ifndef SF_FORMAT_AIFF
#define SF_FORMAT_AIFF 0x020000
#endif

#ifndef SF_FORMAT_RAW
#define SF_FORMAT_RAW 0x040000
#endif

#ifndef SF_FORMAT_PCM_S8
#define SF_FORMAT_PCM_S8 0x0001
#endif

#ifndef SF_FORMAT_PCM_16
#define SF_FORMAT_PCM_16 0x0002
#endif

#ifndef SF_FORMAT_PCM_24
#define SF_FORMAT_PCM_24 0x0003
#endif

#ifndef SF_FORMAT_PCM_32
#define SF_FORMAT_PCM_32 0x0004
#endif

#ifndef SF_FORMAT_PCM_U8
#define SF_FORMAT_PCM_U8 0x0005
#endif

#ifndef SF_FORMAT_FLOAT
#define SF_FORMAT_FLOAT 0x0006
#endif

#ifndef SF_FORMAT_DOUBLE
#define SF_FORMAT_DOUBLE 0x0007
#endif

#ifndef SF_FORMAT_ULAW
#define SF_FORMAT_ULAW 0x0010
#endif

#ifndef SF_FORMAT_ALAW
#define SF_FORMAT_ALAW 0x0011
#endif

#ifndef SF_FORMAT_DPCM_8
#define SF_FORMAT_DPCM_8 0x0020
#endif

#ifndef SF_FORMAT_DPCM_16
#define SF_FORMAT_DPCM_16 0x0021
#endif

#ifndef SF_FORMAT_DWVW_16
#define SF_FORMAT_DWVW_16 0x0030
#endif

#ifndef SF_FORMAT_DWVW_24
#define SF_FORMAT_DWVW_24 0x0031
#endif

#ifndef SF_FORMAT_AU
#define SF_FORMAT_AU 0x030000
#endif

#ifndef SF_FORMAT_IRCAM
#define SF_FORMAT_IRCAM 0x0A0000
#endif

#ifndef SF_FORMAT_W64
#define SF_FORMAT_W64 0x0B0000
#endif

#ifndef SF_FORMAT_FLAC
#define SF_FORMAT_FLAC 0x170000
#endif

#ifndef SF_FORMAT_RF64
#define SF_FORMAT_RF64 0x220000
#endif

#ifndef SFC_GET_LOG_INFO
#define SFC_GET_LOG_INFO 0x1001
#endif

#ifndef SFC_SET_CLIPPING
#define SFC_SET_CLIPPING 0x10C0
#endif

struct SNDFILE_tag {
    std::FILE* file { nullptr };
    SF_INFO info {};
    int mode { 0 };
    int formatType { 0 };
    int sampleSubtype { 0 };
    int bytesPerSample { 0 };
    int blockAlign { 0 };
    int wavEncoding { 0 };
    bool clipOutput { false };
    std::string path;
    std::string logInfo;
    std::uint64_t dataOffset { 0 };
    std::uint64_t dataBytes { 0 };
};

inline SNDFILE* sf_open(const char* path, int mode, SF_INFO* info);
inline int sf_close(SNDFILE* sndfile);

class SndfileHandle {
public:
    SndfileHandle() = default;

    SndfileHandle(const char* path, int mode = SFM_READ, int format = 0, int channels = 0, int samplerate = 0) {
        SF_INFO info {};
        info.format = format;
        info.channels = channels;
        info.samplerate = samplerate;
        handle_.reset(sf_open(path, mode, &info));
    }

    explicit operator bool() const { return static_cast<bool>(handle_); }
    SNDFILE* get() const { return handle_.get(); }
    SF_INFO info() const { return handle_ ? handle_->info : SF_INFO{}; }

private:
    struct Deleter {
        void operator()(SNDFILE* handle) const {
            if (handle)
                sf_close(handle);
        }
    };

    std::unique_ptr<SNDFILE, Deleter> handle_;
};

namespace sc_wasm_sndfile_compat {

inline bool isLittleEndian() {
    constexpr std::uint16_t value = 1;
    return *reinterpret_cast<const std::uint8_t*>(&value) == 1;
}

template <typename T> inline T clampValue(T value, T minimum, T maximum) {
    return std::min(maximum, std::max(minimum, value));
}

inline std::uint16_t readU16LE(std::FILE* file) {
    std::uint8_t bytes[2] = { 0, 0 };
    if (std::fread(bytes, 1, sizeof(bytes), file) != sizeof(bytes))
        return 0;
    return static_cast<std::uint16_t>(bytes[0] | (bytes[1] << 8));
}

inline std::uint32_t readU32LE(std::FILE* file) {
    std::uint8_t bytes[4] = { 0, 0, 0, 0 };
    if (std::fread(bytes, 1, sizeof(bytes), file) != sizeof(bytes))
        return 0;
    return static_cast<std::uint32_t>(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24));
}

inline void writeU16LE(std::FILE* file, std::uint16_t value) {
    const std::uint8_t bytes[2] = { static_cast<std::uint8_t>(value & 0xff),
                                    static_cast<std::uint8_t>((value >> 8) & 0xff) };
    std::fwrite(bytes, 1, sizeof(bytes), file);
}

inline void writeU32LE(std::FILE* file, std::uint32_t value) {
    const std::uint8_t bytes[4] = { static_cast<std::uint8_t>(value & 0xff),
                                    static_cast<std::uint8_t>((value >> 8) & 0xff),
                                    static_cast<std::uint8_t>((value >> 16) & 0xff),
                                    static_cast<std::uint8_t>((value >> 24) & 0xff) };
    std::fwrite(bytes, 1, sizeof(bytes), file);
}

inline int sampleBitsForSubtype(int subtype) {
    switch (subtype) {
    case SF_FORMAT_PCM_S8:
    case SF_FORMAT_PCM_U8:
        return 8;
    case SF_FORMAT_PCM_16:
        return 16;
    case SF_FORMAT_PCM_24:
        return 24;
    case SF_FORMAT_PCM_32:
    case SF_FORMAT_FLOAT:
        return 32;
    case SF_FORMAT_DOUBLE:
        return 64;
    default:
        return 0;
    }
}

inline int bytesPerSampleForSubtype(int subtype) {
    const int bits = sampleBitsForSubtype(subtype);
    return bits > 0 ? bits / 8 : 0;
}

inline int wavEncodingForSubtype(int subtype) {
    switch (subtype) {
    case SF_FORMAT_FLOAT:
    case SF_FORMAT_DOUBLE:
        return 3;
    case SF_FORMAT_PCM_S8:
    case SF_FORMAT_PCM_U8:
    case SF_FORMAT_PCM_16:
    case SF_FORMAT_PCM_24:
    case SF_FORMAT_PCM_32:
        return 1;
    default:
        return 0;
    }
}

inline bool subtypeSupported(int subtype) {
    return bytesPerSampleForSubtype(subtype) > 0 && wavEncodingForSubtype(subtype) > 0;
}

inline bool formatSupported(int formatType) {
    return formatType == SF_FORMAT_WAV || formatType == SF_FORMAT_RAW;
}

inline double readSample(SNDFILE* sndfile, bool* ok = nullptr) {
    if (ok)
        *ok = false;
    if (!sndfile || !sndfile->file)
        return 0.0;

    switch (sndfile->sampleSubtype) {
    case SF_FORMAT_PCM_U8: {
        int value = std::fgetc(sndfile->file);
        if (value == EOF)
            return 0.0;
        if (ok)
            *ok = true;
        return (static_cast<double>(value) - 128.0) / 128.0;
    }
    case SF_FORMAT_PCM_S8: {
        std::int8_t value = 0;
        if (std::fread(&value, 1, sizeof(value), sndfile->file) != sizeof(value))
            return 0.0;
        if (ok)
            *ok = true;
        return static_cast<double>(value) / 128.0;
    }
    case SF_FORMAT_PCM_16: {
        std::int16_t value = 0;
        if (std::fread(&value, 1, sizeof(value), sndfile->file) != sizeof(value))
            return 0.0;
        if (!isLittleEndian())
            value = static_cast<std::int16_t>((static_cast<std::uint16_t>(value) >> 8)
                                              | (static_cast<std::uint16_t>(value) << 8));
        if (ok)
            *ok = true;
        return static_cast<double>(value) / 32768.0;
    }
    case SF_FORMAT_PCM_24: {
        std::uint8_t bytes[3] = { 0, 0, 0 };
        if (std::fread(bytes, 1, sizeof(bytes), sndfile->file) != sizeof(bytes))
            return 0.0;
        std::int32_t value = static_cast<std::int32_t>(bytes[0]) | (static_cast<std::int32_t>(bytes[1]) << 8)
            | (static_cast<std::int32_t>(bytes[2]) << 16);
        if (value & 0x00800000)
            value |= ~0x00FFFFFF;
        if (ok)
            *ok = true;
        return static_cast<double>(value) / 8388608.0;
    }
    case SF_FORMAT_PCM_32: {
        std::int32_t value = 0;
        if (std::fread(&value, 1, sizeof(value), sndfile->file) != sizeof(value))
            return 0.0;
        if (!isLittleEndian()) {
            const std::uint32_t raw = static_cast<std::uint32_t>(value);
            value = static_cast<std::int32_t>((raw >> 24) | ((raw >> 8) & 0x0000ff00)
                                              | ((raw << 8) & 0x00ff0000) | (raw << 24));
        }
        if (ok)
            *ok = true;
        return static_cast<double>(value) / 2147483648.0;
    }
    case SF_FORMAT_FLOAT: {
        float value = 0.0f;
        if (std::fread(&value, 1, sizeof(value), sndfile->file) != sizeof(value))
            return 0.0;
        if (ok)
            *ok = true;
        return static_cast<double>(value);
    }
    case SF_FORMAT_DOUBLE: {
        double value = 0.0;
        if (std::fread(&value, 1, sizeof(value), sndfile->file) != sizeof(value))
            return 0.0;
        if (ok)
            *ok = true;
        return value;
    }
    default:
        return 0.0;
    }
}

inline bool writeSample(SNDFILE* sndfile, double value) {
    if (!sndfile || !sndfile->file)
        return false;

    if (sndfile->clipOutput)
        value = clampValue(value, -1.0, 1.0);

    switch (sndfile->sampleSubtype) {
    case SF_FORMAT_PCM_U8: {
        const auto byte = static_cast<std::uint8_t>(clampValue(std::llround((value * 127.5) + 128.0), 0ll, 255ll));
        return std::fwrite(&byte, 1, sizeof(byte), sndfile->file) == sizeof(byte);
    }
    case SF_FORMAT_PCM_S8: {
        const auto sample = static_cast<std::int8_t>(clampValue(std::llround(value * 127.0), -128ll, 127ll));
        return std::fwrite(&sample, 1, sizeof(sample), sndfile->file) == sizeof(sample);
    }
    case SF_FORMAT_PCM_16: {
        const auto sample = static_cast<std::int16_t>(clampValue(std::llround(value * 32767.0), -32768ll, 32767ll));
        return std::fwrite(&sample, 1, sizeof(sample), sndfile->file) == sizeof(sample);
    }
    case SF_FORMAT_PCM_24: {
        const auto sample = static_cast<std::int32_t>(clampValue(std::llround(value * 8388607.0), -8388608ll, 8388607ll));
        const std::uint8_t bytes[3] = { static_cast<std::uint8_t>(sample & 0xff),
                                        static_cast<std::uint8_t>((sample >> 8) & 0xff),
                                        static_cast<std::uint8_t>((sample >> 16) & 0xff) };
        return std::fwrite(bytes, 1, sizeof(bytes), sndfile->file) == sizeof(bytes);
    }
    case SF_FORMAT_PCM_32: {
        const auto sample = static_cast<std::int32_t>(clampValue(std::llround(value * 2147483647.0),
                                                                 static_cast<long long>(std::numeric_limits<std::int32_t>::min()),
                                                                 static_cast<long long>(std::numeric_limits<std::int32_t>::max())));
        return std::fwrite(&sample, 1, sizeof(sample), sndfile->file) == sizeof(sample);
    }
    case SF_FORMAT_FLOAT: {
        const float sample = static_cast<float>(value);
        return std::fwrite(&sample, 1, sizeof(sample), sndfile->file) == sizeof(sample);
    }
    case SF_FORMAT_DOUBLE:
        return std::fwrite(&value, 1, sizeof(value), sndfile->file) == sizeof(value);
    default:
        return false;
    }
}

inline sf_count_t tellFrames(SNDFILE* sndfile) {
    if (!sndfile || !sndfile->file || sndfile->blockAlign <= 0)
        return 0;
    const long current = std::ftell(sndfile->file);
    if (current < 0)
        return 0;
    return static_cast<sf_count_t>((static_cast<std::uint64_t>(current) - sndfile->dataOffset) / sndfile->blockAlign);
}

inline void updateFrameCount(SNDFILE* sndfile) {
    if (!sndfile)
        return;
    if (sndfile->blockAlign > 0)
        sndfile->info.frames = static_cast<sf_count_t>(sndfile->dataBytes / sndfile->blockAlign);
}

inline bool parseWaveFile(std::FILE* file, SF_INFO* info, std::uint64_t* dataOffset, std::uint64_t* dataBytes,
                          int* subtype, int* wavEncoding, std::string* logInfo) {
    char riff[4] = {};
    char wave[4] = {};
    if (std::fread(riff, 1, sizeof(riff), file) != sizeof(riff))
        return false;
    const std::uint32_t riffSize = readU32LE(file);
    if (std::fread(wave, 1, sizeof(wave), file) != sizeof(wave))
        return false;
    if (std::memcmp(riff, "RIFF", 4) != 0 || std::memcmp(wave, "WAVE", 4) != 0)
        return false;

    bool foundFmt = false;
    bool foundData = false;
    std::uint16_t audioFormat = 0;
    std::uint16_t channels = 0;
    std::uint32_t sampleRate = 0;
    std::uint16_t bitsPerSample = 0;
    std::uint64_t localDataOffset = 0;
    std::uint64_t localDataBytes = 0;

    while (!foundData) {
        char chunkId[4] = {};
        if (std::fread(chunkId, 1, sizeof(chunkId), file) != sizeof(chunkId))
            break;
        const std::uint32_t chunkSize = readU32LE(file);

        if (std::memcmp(chunkId, "fmt ", 4) == 0) {
            audioFormat = readU16LE(file);
            channels = readU16LE(file);
            sampleRate = readU32LE(file);
            (void)readU32LE(file);
            (void)readU16LE(file);
            bitsPerSample = readU16LE(file);
            if (chunkSize > 16)
                std::fseek(file, static_cast<long>(chunkSize - 16), SEEK_CUR);
            foundFmt = true;
        } else if (std::memcmp(chunkId, "data", 4) == 0) {
            localDataOffset = static_cast<std::uint64_t>(std::ftell(file));
            localDataBytes = chunkSize;
            std::fseek(file, static_cast<long>(chunkSize), SEEK_CUR);
            foundData = true;
        } else {
            std::fseek(file, static_cast<long>(chunkSize), SEEK_CUR);
        }

        if (chunkSize & 1)
            std::fseek(file, 1, SEEK_CUR);
    }

    if (!foundFmt || !foundData || channels == 0 || sampleRate == 0)
        return false;

    int localSubtype = 0;
    if (audioFormat == 1) {
        switch (bitsPerSample) {
        case 8:
            localSubtype = SF_FORMAT_PCM_U8;
            break;
        case 16:
            localSubtype = SF_FORMAT_PCM_16;
            break;
        case 24:
            localSubtype = SF_FORMAT_PCM_24;
            break;
        case 32:
            localSubtype = SF_FORMAT_PCM_32;
            break;
        default:
            return false;
        }
    } else if (audioFormat == 3) {
        if (bitsPerSample == 32)
            localSubtype = SF_FORMAT_FLOAT;
        else if (bitsPerSample == 64)
            localSubtype = SF_FORMAT_DOUBLE;
        else
            return false;
    } else {
        return false;
    }

    info->channels = channels;
    info->samplerate = static_cast<int32>(sampleRate);
    info->format = SF_FORMAT_WAV | localSubtype;
    info->seekable = SF_TRUE;
    info->sections = 1;
    const int bytesPerSample = static_cast<int>(bitsPerSample / 8);
    const int blockAlign = static_cast<int>(channels) * bytesPerSample;
    info->frames = blockAlign > 0 ? static_cast<sf_count_t>(localDataBytes / blockAlign) : 0;

    if (dataOffset)
        *dataOffset = localDataOffset;
    if (dataBytes)
        *dataBytes = localDataBytes;
    if (subtype)
        *subtype = localSubtype;
    if (wavEncoding)
        *wavEncoding = audioFormat;
    if (logInfo) {
        *logInfo = "WASM WAV compatibility backend\n";
        *logInfo += "RIFF size: " + std::to_string(riffSize) + "\n";
        *logInfo += "Channels: " + std::to_string(channels) + "\n";
        *logInfo += "Sample rate: " + std::to_string(sampleRate) + "\n";
        *logInfo += "Bits per sample: " + std::to_string(bitsPerSample) + "\n";
    }
    return true;
}

inline bool writeWaveHeader(SNDFILE* sndfile) {
    if (!sndfile || !sndfile->file)
        return false;
    if (sndfile->formatType != SF_FORMAT_WAV)
        return true;

    const std::uint32_t dataSize = static_cast<std::uint32_t>(sndfile->dataBytes);
    const std::uint32_t riffSize = 36u + dataSize;
    const std::uint16_t channels = static_cast<std::uint16_t>(sndfile->info.channels);
    const std::uint32_t sampleRate = static_cast<std::uint32_t>(sndfile->info.samplerate);
    const std::uint16_t bitsPerSample = static_cast<std::uint16_t>(sndfile->bytesPerSample * 8);
    const std::uint16_t blockAlign = static_cast<std::uint16_t>(sndfile->blockAlign);
    const std::uint32_t byteRate = sampleRate * blockAlign;

    std::fseek(sndfile->file, 0, SEEK_SET);
    std::fwrite("RIFF", 1, 4, sndfile->file);
    writeU32LE(sndfile->file, riffSize);
    std::fwrite("WAVE", 1, 4, sndfile->file);
    std::fwrite("fmt ", 1, 4, sndfile->file);
    writeU32LE(sndfile->file, 16);
    writeU16LE(sndfile->file, static_cast<std::uint16_t>(sndfile->wavEncoding));
    writeU16LE(sndfile->file, channels);
    writeU32LE(sndfile->file, sampleRate);
    writeU32LE(sndfile->file, byteRate);
    writeU16LE(sndfile->file, blockAlign);
    writeU16LE(sndfile->file, bitsPerSample);
    std::fwrite("data", 1, 4, sndfile->file);
    writeU32LE(sndfile->file, dataSize);
    std::fflush(sndfile->file);
    std::fseek(sndfile->file, static_cast<long>(sndfile->dataOffset + sndfile->dataBytes), SEEK_SET);
    updateFrameCount(sndfile);
    return true;
}

inline SNDFILE* openForRead(const char* path, SF_INFO* info) {
    std::FILE* file = std::fopen(path, "rb");
    if (!file)
        return nullptr;

    auto sndfile = std::make_unique<SNDFILE>();
    sndfile->file = file;
    sndfile->mode = SFM_READ;
    sndfile->path = path ? path : "";

    if (!parseWaveFile(file, &sndfile->info, &sndfile->dataOffset, &sndfile->dataBytes, &sndfile->sampleSubtype,
                       &sndfile->wavEncoding, &sndfile->logInfo)) {
        std::fclose(file);
        return nullptr;
    }

    sndfile->formatType = SF_FORMAT_WAV;
    sndfile->bytesPerSample = bytesPerSampleForSubtype(sndfile->sampleSubtype);
    sndfile->blockAlign = sndfile->bytesPerSample * sndfile->info.channels;
    if (info)
        *info = sndfile->info;
    std::fseek(file, static_cast<long>(sndfile->dataOffset), SEEK_SET);
    return sndfile.release();
}

inline SNDFILE* openForWrite(const char* path, SF_INFO* info) {
    if (!info)
        return nullptr;

    int formatType = info->format & SF_FORMAT_TYPEMASK;
    if (formatType == SF_FORMAT_AIFF)
        formatType = SF_FORMAT_WAV;
    const int subtype = info->format & SF_FORMAT_SUBMASK;
    if (!formatSupported(formatType) || !subtypeSupported(subtype) || info->channels <= 0 || info->samplerate <= 0)
        return nullptr;

    std::FILE* file = std::fopen(path, "wb+");
    if (!file)
        return nullptr;

    auto sndfile = std::make_unique<SNDFILE>();
    sndfile->file = file;
    sndfile->mode = SFM_WRITE;
    sndfile->path = path ? path : "";
    sndfile->formatType = formatType;
    sndfile->sampleSubtype = subtype;
    sndfile->bytesPerSample = bytesPerSampleForSubtype(subtype);
    sndfile->blockAlign = sndfile->bytesPerSample * info->channels;
    sndfile->wavEncoding = wavEncodingForSubtype(subtype);
    sndfile->info = *info;
    sndfile->info.format = formatType | subtype;
    sndfile->info.frames = 0;
    sndfile->info.seekable = SF_TRUE;
    sndfile->info.sections = 1;
    sndfile->logInfo = "WASM WAV compatibility backend\n";
    sndfile->logInfo += "Path: " + sndfile->path + "\n";

    if (formatType == SF_FORMAT_WAV) {
        sndfile->dataOffset = 44;
        sndfile->dataBytes = 0;
        writeWaveHeader(sndfile.get());
        std::fseek(file, static_cast<long>(sndfile->dataOffset), SEEK_SET);
    } else {
        sndfile->dataOffset = 0;
        sndfile->dataBytes = 0;
    }

    *info = sndfile->info;
    return sndfile.release();
}

} // namespace sc_wasm_sndfile_compat

inline SNDFILE* sf_open(const char* path, int mode, SF_INFO* info) {
    if (!path)
        return nullptr;
    if (mode == SFM_READ)
        return sc_wasm_sndfile_compat::openForRead(path, info);
    if (mode == SFM_WRITE)
        return sc_wasm_sndfile_compat::openForWrite(path, info);
    return nullptr;
}

inline int sf_close(SNDFILE* sndfile) {
    if (!sndfile)
        return 0;
    if (sndfile->mode == SFM_WRITE)
        sc_wasm_sndfile_compat::writeWaveHeader(sndfile);
    const int result = sndfile->file ? std::fclose(sndfile->file) : 0;
    delete sndfile;
    return result;
}

inline sf_count_t sf_seek(SNDFILE* sndfile, sf_count_t frames, int origin) {
    if (!sndfile || !sndfile->file || sndfile->blockAlign <= 0)
        return -1;

    sf_count_t base = 0;
    switch (origin) {
    case SEEK_SET:
        base = 0;
        break;
    case SEEK_CUR:
        base = sc_wasm_sndfile_compat::tellFrames(sndfile);
        break;
    case SEEK_END:
        base = sndfile->info.frames;
        break;
    default:
        return -1;
    }

    const sf_count_t target = std::max<sf_count_t>(0, base + frames);
    const std::uint64_t byteOffset = sndfile->dataOffset + (static_cast<std::uint64_t>(target) * sndfile->blockAlign);
    if (sndfile->mode == SFM_READ && byteOffset > sndfile->dataOffset + sndfile->dataBytes)
        return -1;
    if (std::fseek(sndfile->file, static_cast<long>(byteOffset), SEEK_SET) != 0)
        return -1;
    return target;
}

inline sf_count_t sf_readf_float(SNDFILE* sndfile, float* ptr, sf_count_t frames) {
    if (!sndfile || !ptr || sndfile->info.channels <= 0)
        return 0;
    const sf_count_t samplesToRead = frames * sndfile->info.channels;
    sf_count_t samplesRead = 0;
    for (; samplesRead < samplesToRead; ++samplesRead) {
        bool ok = false;
        const double value = sc_wasm_sndfile_compat::readSample(sndfile, &ok);
        if (!ok)
            break;
        ptr[samplesRead] = static_cast<float>(value);
    }
    return sndfile->info.channels > 0 ? samplesRead / sndfile->info.channels : 0;
}

inline sf_count_t sf_writef_float(SNDFILE* sndfile, const float* ptr, sf_count_t frames) {
    if (!sndfile || !ptr || sndfile->info.channels <= 0)
        return 0;
    const sf_count_t samplesToWrite = frames * sndfile->info.channels;
    sf_count_t samplesWritten = 0;
    for (; samplesWritten < samplesToWrite; ++samplesWritten) {
        if (!sc_wasm_sndfile_compat::writeSample(sndfile, ptr[samplesWritten]))
            break;
    }
    sndfile->dataBytes += static_cast<std::uint64_t>(samplesWritten) * sndfile->bytesPerSample;
    sc_wasm_sndfile_compat::updateFrameCount(sndfile);
    return sndfile->info.channels > 0 ? samplesWritten / sndfile->info.channels : 0;
}

inline sf_count_t sf_read_float(SNDFILE* sndfile, float* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t read = 0;
    for (; read < items; ++read) {
        bool ok = false;
        ptr[read] = static_cast<float>(sc_wasm_sndfile_compat::readSample(sndfile, &ok));
        if (!ok)
            break;
    }
    return read;
}

inline sf_count_t sf_read_double(SNDFILE* sndfile, double* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t read = 0;
    for (; read < items; ++read) {
        bool ok = false;
        ptr[read] = sc_wasm_sndfile_compat::readSample(sndfile, &ok);
        if (!ok)
            break;
    }
    return read;
}

inline sf_count_t sf_read_short(SNDFILE* sndfile, short* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t read = 0;
    for (; read < items; ++read) {
        bool ok = false;
        const double value = sc_wasm_sndfile_compat::readSample(sndfile, &ok);
        if (!ok)
            break;
        ptr[read] = static_cast<short>(sc_wasm_sndfile_compat::clampValue(std::llround(value * 32767.0), -32768ll, 32767ll));
    }
    return read;
}

inline sf_count_t sf_read_int(SNDFILE* sndfile, int* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t read = 0;
    for (; read < items; ++read) {
        bool ok = false;
        const double value = sc_wasm_sndfile_compat::readSample(sndfile, &ok);
        if (!ok)
            break;
        ptr[read] = static_cast<int>(sc_wasm_sndfile_compat::clampValue(std::llround(value * 2147483647.0),
                                                                        static_cast<long long>(std::numeric_limits<int>::min()),
                                                                        static_cast<long long>(std::numeric_limits<int>::max())));
    }
    return read;
}

inline sf_count_t sf_write_float(SNDFILE* sndfile, const float* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t written = 0;
    for (; written < items; ++written) {
        if (!sc_wasm_sndfile_compat::writeSample(sndfile, ptr[written]))
            break;
    }
    sndfile->dataBytes += static_cast<std::uint64_t>(written) * sndfile->bytesPerSample;
    sc_wasm_sndfile_compat::updateFrameCount(sndfile);
    return written;
}

inline sf_count_t sf_write_double(SNDFILE* sndfile, const double* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t written = 0;
    for (; written < items; ++written) {
        if (!sc_wasm_sndfile_compat::writeSample(sndfile, ptr[written]))
            break;
    }
    sndfile->dataBytes += static_cast<std::uint64_t>(written) * sndfile->bytesPerSample;
    sc_wasm_sndfile_compat::updateFrameCount(sndfile);
    return written;
}

inline sf_count_t sf_write_short(SNDFILE* sndfile, const short* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t written = 0;
    for (; written < items; ++written) {
        if (!sc_wasm_sndfile_compat::writeSample(sndfile, static_cast<double>(ptr[written]) / 32768.0))
            break;
    }
    sndfile->dataBytes += static_cast<std::uint64_t>(written) * sndfile->bytesPerSample;
    sc_wasm_sndfile_compat::updateFrameCount(sndfile);
    return written;
}

inline sf_count_t sf_write_int(SNDFILE* sndfile, const int* ptr, sf_count_t items) {
    if (!sndfile || !ptr)
        return 0;
    sf_count_t written = 0;
    for (; written < items; ++written) {
        if (!sc_wasm_sndfile_compat::writeSample(sndfile, static_cast<double>(ptr[written]) / 2147483648.0))
            break;
    }
    sndfile->dataBytes += static_cast<std::uint64_t>(written) * sndfile->bytesPerSample;
    sc_wasm_sndfile_compat::updateFrameCount(sndfile);
    return written;
}

inline const char* sf_strerror(SNDFILE* sndfile) {
    if (!sndfile)
        return "WASM soundfile compatibility backend could not open file";
    return sndfile->logInfo.empty() ? "WASM soundfile compatibility backend error" : sndfile->logInfo.c_str();
}

inline int sf_command(SNDFILE* sndfile, int command, void* data, int datasize) {
    if (!sndfile)
        return SF_FALSE;

    switch (command) {
    case SFC_SET_CLIPPING:
        sndfile->clipOutput = datasize == SF_TRUE;
        return SF_TRUE;
    case SFC_GET_LOG_INFO:
        if (!data || datasize <= 0)
            return SF_FALSE;
        std::snprintf(static_cast<char*>(data), static_cast<std::size_t>(datasize), "%s", sndfile->logInfo.c_str());
        return SF_TRUE;
    default:
        return SF_FALSE;
    }
}

#endif
