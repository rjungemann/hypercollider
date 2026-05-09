/*
    SC_Wasm_AudioDriver.cpp - WASM audio driver implementation for SuperCollider

    Provides the audio driver infrastructure for WebAssembly builds.
    Replaces SC_CoreAudio.cpp for wasm targets:
      - SC_AudioDriver base class constructor/destructor (no-thread variant)
      - Common packet dispatch (PerformCompletionMsg, PerformOSCPacket, etc.)
      - SendMsgToEngine / SendMsgFromEngine (single-threaded stubs)
      - SC_WasmAudioDriver subclass (minimal DriverSetup/Start/Stop stubs)
      - SC_NewAudioDriver factory
      - Timing primitives (oscTimeNow, server_timeseed, initializeScheduler)

    In the single-threaded wasm model there is no separate NRT thread.
    Pending NRT messages are flushed synchronously during sc_wasm_render_block().
*/

#ifdef SC_WASM

#include "SC_CoreAudio.h"
#include "SC_Lib_Cintf.h"
#include "SC_HiddenWorld.h"
#include "SC_Prototypes.h"
#include "SC_SequencedCommand.h"
#include "SC_WorldOptions.h"
#include "SC_Endian.h"
// Timing
#include "lock.h"
#include "SC_Time.hpp"
#include <stdarg.h>
#include <stdlib.h>
#include <time.h>
#include <cmath>

#if !defined(SC_WASM_SINGLE_THREADED_RUNTIME)
#error "WASM audio driver requires SC_WASM_SINGLE_THREADED_RUNTIME"
#endif

// =========================================================================
// Notification callback support for WASM
// ============================================================================

#include <emscripten.h>

// EM_JS to call JS notification callback from C
EM_JS(void, js_notify, (int world_id, const char* msg_data, int msg_size), {
    if (typeof Module !== 'undefined' && Module._sc_wasm_notify_cb) {
        try {
            const msgArray = new Uint8Array(
                Module.HEAPU8.buffer,
                msg_data,
                msg_size
            );
            Module._sc_wasm_notify_cb(world_id, msgArray);
        } catch (e) {
            console.error('Notification callback error:', e);
        }
    }
});

// WASM-specific reply function that calls JS
void wasm_notify_reply_func(struct ReplyAddress* addr, char* msg, int size) {
    if (addr && addr->mReplyData) {
        int world_id = reinterpret_cast<intptr_t>(addr->mReplyData);
        js_notify(world_id, msg, size);
    }
}

// Function to register notification handler for a world
void SC_Wasm_RegisterNotificationHandler(World* world, int world_id) {
    ReplyAddress notificationAddr;
    memset(&notificationAddr, 0, sizeof(ReplyAddress));
    notificationAddr.mProtocol = kTCP;  // arbitrary, not used
    notificationAddr.mPort = 0;
    notificationAddr.mSocket = 0;
    notificationAddr.mReplyFunc = wasm_notify_reply_func;
    notificationAddr.mReplyData = reinterpret_cast<void*>(static_cast<intptr_t>(world_id));
    world->hw->mUsers->insert(notificationAddr);
}

// =====================================================================
// Timing=====================================================================
// Timing

extern int64 gStartupOSCTime;
int64 gStartupOSCTime = -1;

double gSampleRate;
double gSampleDur;

namespace {

struct WasmRuntimeState {
    bool schedulerInitialized = false;
    bool controlQueueActive = false;
};

WasmRuntimeState gWasmRuntimeState;

} // namespace

static int64 GetCurrentOSCTime() {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    // NTP epoch offset: OSC epoch is 1900, POSIX epoch is 1970
    static const uint64_t kSecsFrom1900to1970 = 2208988800ULL;
    uint64_t s = (uint64_t)ts.tv_sec + kSecsFrom1900to1970;
    // 2^32 / 1e9 for nanoseconds -> fractional
    uint64_t f = (uint64_t)((double)ts.tv_nsec * 4.294967296); // 2^32/1e9
    return (int64)((s << 32) | f);
}

int32 server_timeseed() {
    int64 time = GetCurrentOSCTime();
    return Hash((int32)(time >> 32) + Hash((int32)time));
}

int64 oscTimeNow() { return GetCurrentOSCTime(); }

void initializeScheduler() {
    if (gWasmRuntimeState.schedulerInitialized) {
        return;
    }

    gWasmRuntimeState.schedulerInitialized = true;
    scprintf("SC_WASM: scheduler initialized in single-threaded queue mode\n");
}

// =====================================================================
// Packet dispatch helpers (equivalent to the "Packets (Common)" section
// of SC_CoreAudio.cpp, reproduced here so SC_CoreAudio.cpp can stay
// excluded from the wasm build graph)

bool ProcessOSCPacket(World* inWorld, OSC_Packet* inPacket);
void PerformOSCBundle(World* inWorld, OSC_Packet* inPacket);
int PerformOSCMessage(World* inWorld, int inSize, char* inData, ReplyAddress* inReply);
PacketStatus PerformOSCPacket(World* world, OSC_Packet* packet, SC_ScheduledEvent::PacketFreeFunc);

void Perform_ToEngine_Msg(FifoMsg* inMsg);
void FreeOSCPacket(FifoMsg* inMsg);

struct IsBundle {
    IsBundle() { str4cpy(s, "#bundle"); }
    bool checkIsBundle(int32* in) { return in[0] == s[0] && in[1] == s[1]; }
    int32 s[2];
};
static IsBundle gIsBundle;

bool ProcessOSCPacket(World* inWorld, OSC_Packet* inPacket) {
    if (!inPacket)
        return false;
    bool result;
    static_cast<SC_Lock*>(inWorld->mDriverLock)->lock();
    SC_AudioDriver* driver = AudioDriver(inWorld);
    if (!driver) {
        static_cast<SC_Lock*>(inWorld->mDriverLock)->unlock();
        return false;
    }
    inPacket->mIsBundle = gIsBundle.checkIsBundle((int32*)inPacket->mData);
    FifoMsg fifoMsg;
    fifoMsg.Set(inWorld, Perform_ToEngine_Msg, FreeOSCPacket, (void*)inPacket);
    result = driver->SendOscPacketMsgToEngine(fifoMsg);
    static_cast<SC_Lock*>(inWorld->mDriverLock)->unlock();
    if (!result)
        scprintf("command FIFO full\n");
    return result;
}

int PerformOSCMessage(World* inWorld, int inSize, char* inData, ReplyAddress* inReply) {
    SC_LibCmd* cmdObj;
    int cmdNameLen;
    if (inData[0] == 0) {
        cmdNameLen = 4;
        uint32 index = inData[3];
        if (index >= NUMBER_OF_COMMANDS)
            cmdObj = nullptr;
        else
            cmdObj = gCmdArray[index];
    } else {
        cmdNameLen = OSCstrlen(inData);
        cmdObj = gCmdLib->Get((int32*)inData);
    }
    if (!cmdObj) {
        CallSendFailureCommand(inWorld, inData, "Command not found", inReply);
        scprintf("FAILURE IN SERVER: %s Command not found\n", inData);
        return kSCErr_NoSuchCommand;
    }
    return cmdObj->Perform(inWorld, inSize - cmdNameLen, inData + cmdNameLen, inReply);
}

void PerformOSCBundle(World* inWorld, OSC_Packet* inPacket) {
    char* data = inPacket->mData + 16;
    char* dataEnd = inPacket->mData + inPacket->mSize;
    while (data < dataEnd) {
        int32 msgSize = sc_ntohl(*(int32*)data);
        data += sizeof(int32);
        PerformOSCMessage(inWorld, msgSize, data, &inPacket->mReplyAddr);
        data += msgSize;
    }
    inWorld->mLocalErrorNotification = 0;
}

PacketStatus PerformOSCPacket(World* world, OSC_Packet* packet, SC_ScheduledEvent::PacketFreeFunc freeFunc) {
    SC_AudioDriver* driver = world->hw->mAudioDriver;

    if (!packet->mIsBundle) {
        PerformOSCMessage(world, packet->mSize, packet->mData, &packet->mReplyAddr);
        world->mLocalErrorNotification = 0;
        return PacketPerformed;
    } else {
        int64 time = OSCtime(packet->mData + 8);
        if (time == 0 || time == 1) {
            PerformOSCBundle(world, packet);
            return PacketPerformed;
        } else {
            if ((time < driver->mOSCbuftime) && (world->mVerbosity >= 0)) {
                double seconds = (driver->mOSCbuftime - time) * kOSCtoSecs;
                scprintf("late %.9f\n", seconds);
            }
            SC_ScheduledEvent event(world, time, packet, freeFunc);
            driver->AddEvent(event);
            return PacketScheduled;
        }
    }
}

void Perform_ToEngine_Msg(FifoMsg* inMsg) {
    World* world = inMsg->mWorld;
    OSC_Packet* packet = (OSC_Packet*)inMsg->mData;
    if (!packet)
        return;
    PacketStatus status = PerformOSCPacket(world, packet, SC_ScheduledEvent::FreeInNRT);
    if (status == PacketScheduled) {
        inMsg->mData = nullptr;
        inMsg->mFreeFunc = nullptr;
    }
}

PacketStatus PerformCompletionMsg(World* inWorld, const OSC_Packet& inPacket) {
    OSC_Packet* packet = (OSC_Packet*)World_Alloc(inWorld, sizeof(OSC_Packet));
    if (packet == nullptr)
        throw std::runtime_error("PerformCompletionMsg allocation failed: out of memory!\n");
    *packet = inPacket;
    packet->mIsBundle = gIsBundle.checkIsBundle((int32*)packet->mData);
    PacketStatus status = PerformOSCPacket(inWorld, packet, SC_ScheduledEvent::FreeInRT);
    if (status == PacketPerformed) {
        World_Free(inWorld, packet);
    }
    return status;
}

void FreeOSCPacket(FifoMsg* inMsg) {
    OSC_Packet* packet = (OSC_Packet*)inMsg->mData;
    if (packet) {
        inMsg->mData = nullptr;
        free(packet->mData);
        free(packet);
    }
}

void Free_FromEngine_Msg(FifoMsg* inMsg);
void Free_FromEngine_Msg(FifoMsg* inMsg) { World_Free(inMsg->mWorld, inMsg->mData); }

// =====================================================================
// SC_ScheduledEvent implementation

void SC_ScheduledEvent::FreeInRT(World* world, OSC_Packet* packet) {
    World_Free(world, packet->mData);
    World_Free(world, packet);
}

void SC_ScheduledEvent::FreeInNRT(World* world, OSC_Packet* packet) {
    FifoMsg msg;
    msg.Set(world, FreeOSCPacket, nullptr, (void*)packet);
    world->hw->mAudioDriver->SendMsgFromEngine(msg);
}

void SC_ScheduledEvent::Perform() {
    PerformOSCBundle(mWorld, mPacket);
    (*mPacketFreeFunc)(mWorld, mPacket);
}

// =====================================================================
// SC_AudioDriver - common base class implementation (no-thread variant)

SC_AudioDriver::SC_AudioDriver(World* inWorld):
    mWorld(inWorld),
    mSampleTime(0),
    mNumSamplesPerCallback(0),
    mSafetyClipThreshold(1.26) {
    mRunThreadFlag = false;
}

SC_AudioDriver::~SC_AudioDriver() {
    // No thread to join in single-threaded wasm build.
    mRunThreadFlag = false;
}

void SC_AudioDriver::RunThread() {
    // In single-threaded wasm, NRT processing is performed inline during render.
    // This body is never called.
}

bool SC_AudioDriver::SendMsgFromEngine(FifoMsg& inMsg) { return mFromEngine.Write(inMsg); }

bool SC_AudioDriver::SendMsgToEngine(FifoMsg& inMsg) {
    mToEngine.Free();
    return mToEngine.Write(inMsg);
}

bool SC_AudioDriver::SendOscPacketMsgToEngine(FifoMsg& inMsg) {
    mOscPacketsToEngine.Free();
    return mOscPacketsToEngine.Write(inMsg);
}

bool SC_AudioDriver::Setup() {
    // No NRT thread in wasm. Just configure driver parameters.
    int numSamples;
    double sampleRate;

    if (!DriverSetup(&numSamples, &sampleRate))
        return false;

    mNumSamplesPerCallback = numSamples;
    mOSCincrementNumerator = (double)mWorld->mBufLength * pow(2., 32.);
    mOSCincrement = (int64)(mOSCincrementNumerator / sampleRate);
    mOSCtoSamples = sampleRate / pow(2., 32.);

    World_SetSampleRate(mWorld, sampleRate);
    mSampleRate = mSmoothSampleRate = sampleRate;
    mBuffersPerSecond = sampleRate / mNumSamplesPerCallback;
    mMaxPeakCounter = (int)mBuffersPerSecond;

    if (mWorld->mVerbosity >= 0) {
        scprintf("SC_AudioDriver: sample rate = %f, driver's block size = %d\n", sampleRate, mNumSamplesPerCallback);
    }

    return true;
}

bool SC_AudioDriver::Start() {
    mAvgCPU = 0.;
    mPeakCPU = 0.;
    mPeakCounter = 0;

    mStartHostSecs = 0.;
    mPrevHostSecs = 0.;
    mStartSampleTime = 0.;
    mPrevSampleTime = 0.;

    World_Start(mWorld);

    gStartupOSCTime = oscTimeNow();

    return DriverStart();
}

bool SC_AudioDriver::Stop() {
    if (!DriverStop())
        return false;
    return true;
}

// =====================================================================
// Boost.ASIO network thread stubs
//
// SC_ComPort.cpp (excluded from wasm builds) normally defines these.
// In wasm there is no OSC network socket, so these are no-ops.

namespace scsynth {

static bool gAsioStarted = false;

void startAsioThread() {
    gAsioStarted = true;
    gWasmRuntimeState.controlQueueActive = true;
    scprintf("SC_WASM: control queue active (no native ASIO/network thread)\n");
}

void stopAsioThread() {
    gAsioStarted = false;
    gWasmRuntimeState.controlQueueActive = false;
}

bool asioThreadStarted() { return gAsioStarted; }

} // namespace scsynth

// =====================================================================
// SC_WasmAudioDriver subclass

class SC_WasmAudioDriver : public SC_AudioDriver {
public:
    explicit SC_WasmAudioDriver(World* inWorld) : SC_AudioDriver(inWorld) {}
    ~SC_WasmAudioDriver() override {}

    // Flush any pending NRT messages (called from sc_wasm_render_block).
    void FlushNRT() {
        mFromEngine.Perform();
        mToEngine.Perform();
    }

protected:
    bool DriverSetup(int* outNumSamplesPerCallback, double* outSampleRate) override {
        // Defaults; JS host will call World_SetSampleRate after setup.
        *outNumSamplesPerCallback = mPreferredHardwareBufferFrameSize > 0
            ? (int)mPreferredHardwareBufferFrameSize
            : 512;
        *outSampleRate = mPreferredSampleRate > 0
            ? (double)mPreferredSampleRate
            : 44100.0;
        return true;
    }

    bool DriverStart() override { return true; }
    bool DriverStop() override { return true; }
};

SC_AudioDriver* SC_NewAudioDriver(World* inWorld) {
    return new SC_WasmAudioDriver(inWorld);
}

// =====================================================================
// HC_Wasm_FlushNRT - drain async FIFOs inline (called from HC_Wasm_Api.cpp)

void HC_Wasm_FlushNRT(World* inWorld) {
    SC_AudioDriver* base = inWorld->hw->mAudioDriver;
    if (!base) return;

    static_cast<SC_WasmAudioDriver*>(base)->FlushNRT();
}

#endif // SC_WASM
