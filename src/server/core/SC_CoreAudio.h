/*
    SuperCollider real time audio synthesis system
    Copyright (c) 2002 James McCartney. All rights reserved.
    http://www.audiosynth.com

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program; if not, write to the Free Software
    Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301  USA
*/

#pragma once

#include "msg_fifo.h"
#include "SC_FifoMsg.h"
#include "OSC_Packet.h"
#include "sync_condition.h"
#include "PriorityQueue.h"
#include <optional>

#include <lock.h>

#define SC_AUDIO_API_COREAUDIO 1
#define SC_AUDIO_API_JACK 2
#define SC_AUDIO_API_PORTAUDIO 3
#define SC_AUDIO_API_AUDIOUNITS 4
#define SC_AUDIO_API_BELA 6

#ifndef SC_WASM

#    ifndef SC_AUDIO_API
#        if defined(_WIN32)
#            define SC_AUDIO_API SC_AUDIO_API_PORTAUDIO
#        elif defined(__APPLE__)
#            define SC_AUDIO_API SC_AUDIO_API_COREAUDIO
#        else
#            error SC_AUDIO_API undefined, cannot determine audio backend
#        endif
#    endif // SC_AUDIO_API

#    if SC_AUDIO_API == SC_AUDIO_API_COREAUDIO || SC_AUDIO_API == SC_AUDIO_API_AUDIOUNITS
#        include <CoreAudio/AudioHardware.h>
#        include <CoreAudio/HostTime.h>
#    endif

#endif // SC_WASM


struct SC_ScheduledEvent {
    /// Callback function responsible for freeing the OSC packet in the correct thread.
    typedef void (*PacketFreeFunc)(World* world, OSC_Packet* packet);

    /// Frees an OSC packet in the realtime thread (to be used as a PacketFreeFunc).
    static void FreeInRT(World* world, OSC_Packet* packet);
    /// Frees an OSC packet in the non-realtime thread (to be used as a PacketFreeFunc).
    static void FreeInNRT(World* world, OSC_Packet* packet);

    SC_ScheduledEvent(): mTime(0), mPacket(0) {}
    SC_ScheduledEvent(World* inWorld, int64 inTime, OSC_Packet* inPacket, PacketFreeFunc freeFunc):
        mTime(inTime),
        mPacket(inPacket),
        mPacketFreeFunc(freeFunc),
        mWorld(inWorld) {}

    int64 Time() { return mTime; }
    void Perform();

    struct key_t {
        int64 time, stabilityCount;

        bool operator<(key_t const& rhs) const {
            if (time < rhs.time)
                return true;
            if (time > rhs.time)
                return false;
            return stabilityCount < rhs.stabilityCount;
        }

        bool operator>(key_t const& rhs) const {
            if (time > rhs.time)
                return true;
            if (time < rhs.time)
                return false;
            return stabilityCount > rhs.stabilityCount;
        }

        bool operator==(key_t const& rhs) const { return (time == rhs.time) && (stabilityCount == rhs.stabilityCount); }
    };

    key_t key() const {
        key_t ret;
        ret.time = mTime;
        ret.stabilityCount = mStabilityCount;
        return ret;
    }

    int64 mTime;
    int64 mStabilityCount;
    OSC_Packet* mPacket;
    PacketFreeFunc mPacketFreeFunc;
    World* mWorld;
};

typedef MsgFifo<FifoMsg, 65536> EngineFifo;

// Functions to be implemented by the driver backend
extern "C" {
int32 server_timeseed();
int64 oscTimeNow();
};

void initializeScheduler();

/** Denotes whether an OSC packet has been performed immediately or has been scheduled for later execution.

    If the package has been scheduled, memory ownership is transferred from the caller to the scheduler.
*/
enum PacketStatus { PacketPerformed, PacketScheduled };

/** Perform a completion message in the realtime thread.

    The return value denotes whether ownership is transferred to the scheduler or not.
 */
PacketStatus PerformCompletionMsg(World* world, const OSC_Packet& packet);

class SC_AudioDriver {
protected:
    int64 mOSCincrement;
    World* mWorld;
    double mOSCtoSamples;
    int mSampleTime;
    float mSafetyClipThreshold;

    // Common members
    uint32 mHardwareBufferSize; // bufferSize returned by kAudioDevicePropertyBufferSize
    EngineFifo mFromEngine, mToEngine;
    EngineFifo mOscPacketsToEngine;
    SC_SyncCondition mAudioSync;
    SC_Thread mThread;
    bool mRunThreadFlag;
    uint32 mSafetyOffset;
    PriorityQueueT<SC_ScheduledEvent, 2048> mScheduler;
    int mNumSamplesPerCallback;
    uint32 mPreferredHardwareBufferFrameSize;
    uint32 mPreferredSampleRate;
    std::optional<uint32> mExplicitSampleRate;
    double mBuffersPerSecond;
    double mAvgCPU, mPeakCPU;
    int mPeakCounter, mMaxPeakCounter;
    double mOSCincrementNumerator;

    double mStartHostSecs;
    double mPrevHostSecs;
    double mStartSampleTime;
    double mPrevSampleTime;
    double mSmoothSampleRate;
    double mSampleRate;

    /**
     * DriverSetup() should init the driver and write the num of samples per callback
     * and the sample rate into the two addresses supplied as arguments.
     */
    virtual bool DriverSetup(int* outNumSamplesPerCallback, double* outSampleRate) = 0;
    virtual bool DriverStart() = 0;
    virtual bool DriverStop() = 0;

public:
    SC_AudioDriver(World* inWorld);
    virtual ~SC_AudioDriver();

    int64 mOSCbuftime;

    bool Setup();
    bool Start();
    bool Stop();

    void RunThread();

    bool SendMsgFromEngine(FifoMsg& inMsg);
    bool SendMsgToEngine(FifoMsg& inMsg);
    bool SendOscPacketMsgToEngine(FifoMsg& inMsg);

    void AddEvent(SC_ScheduledEvent& event) { mScheduler.Add(event); }
    void ClearSched() { mScheduler.Empty(); }

    void SetPreferredHardwareBufferFrameSize(int inSize) { mPreferredHardwareBufferFrameSize = inSize; }
    void SetPreferredSampleRate(int inRate) { mPreferredSampleRate = inRate; }
    void SetSafetyClipThreshold(float thr) { mSafetyClipThreshold = thr; }

    double GetAvgCPU() const { return mAvgCPU; }
    double GetPeakCPU() const { return mPeakCPU; }
    double GetSampleRate() const { return mSampleRate; }
    double GetActualSampleRate() const { return mSmoothSampleRate; }
};

extern SC_AudioDriver* SC_NewAudioDriver(World* inWorld);


#ifndef SC_WASM

#    if SC_AUDIO_API == SC_AUDIO_API_COREAUDIO || SC_AUDIO_API == SC_AUDIO_API_AUDIOUNITS
class SC_CoreAudioDriver : public SC_AudioDriver {
    AudioBufferList* mInputBufList;
    AudioDeviceID mInputDevice;
    AudioDeviceID mOutputDevice;

    AudioStreamBasicDescription inputStreamDesc;
    AudioStreamBasicDescription outputStreamDesc;

    template <bool IsClipping>
    friend OSStatus appIOProc(AudioDeviceID inDevice, const AudioTimeStamp* inNow, const AudioBufferList* inInputData,
                              const AudioTimeStamp* inInputTime, AudioBufferList* outOutputData,
                              const AudioTimeStamp* inOutputTime, void* defptr);

    friend OSStatus appIOProcSeparateIn(AudioDeviceID device, const AudioTimeStamp* inNow,
                                        const AudioBufferList* inInputData, const AudioTimeStamp* inInputTime,
                                        AudioBufferList* outOutputData, const AudioTimeStamp* inOutputTime,
                                        void* defptr);

    bool isClippingEnabled() const { return mSafetyClipThreshold > 0 && mSafetyClipThreshold < INFINITY; }

protected:
    virtual bool DriverSetup(int* outNumSamplesPerCallback, double* outSampleRate);
    virtual bool DriverStart();
    virtual bool DriverStop();

    AudioDeviceIOProcID mOutputID;
    AudioDeviceIOProcID mInputID;

public:
    int builtinoutputflag_;

    SC_CoreAudioDriver(World* inWorld);
    virtual ~SC_CoreAudioDriver();

    bool StopStart();

    template <bool IsClipping>
    void Run(const AudioBufferList* inInputData, AudioBufferList* outOutputData, int64 oscTime);

    bool UseInput() { return mInputDevice != kAudioDeviceUnknown; }
    bool UseSeparateIO() { return UseInput() && mInputDevice != mOutputDevice; }
    AudioDeviceID InputDevice() { return mInputDevice; }
    AudioDeviceID OutputDevice() { return mOutputDevice; }

    void SetInputBufferList(AudioBufferList* inBufList) { mInputBufList = inBufList; }
    AudioBufferList* GetInputBufferList() const { return mInputBufList; }
};
#    endif // SC_AUDIO_API_COREAUDIO || SC_AUDIO_API_AUDIOUNITS

#endif // SC_WASM
