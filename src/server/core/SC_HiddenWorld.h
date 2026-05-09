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

#include "SC_Types.h"
#include "SC_Rate.h"
#include "SC_SndBuf.h"
#include "SC_RGen.h"
#include "HashTable.h"
#include "SC_World.h"
#include "SC_Reply.h"
#include "msg_fifo.h"
#include <map>
#include <deque>
#include <set>

// `std::counting_semaphore` (C++20) is what the desktop build wants here
// but Emscripten's wasi-sdk libc++ traps in its constructor under
// single-threaded WASM (no pthread_mutex_init). Roll a tiny atomic-based
// stand-in: World_WaitForQuit polls until counter > 0, AudioQuitCmd's
// Stage4 increments it. Single producer, single consumer, no contention
// expected — atomic suffices.
#if defined(SC_WASM)
#include <atomic>
#include <thread>
namespace detail_sc_world {
struct mini_semaphore {
    explicit mini_semaphore(int /*initial*/) noexcept : counter_(0) {}
    void release() noexcept { counter_.fetch_add(1, std::memory_order_release); }
    void acquire() noexcept {
        while (counter_.fetch_sub(1, std::memory_order_acquire) <= 0) {
            counter_.fetch_add(1, std::memory_order_relaxed);
            std::this_thread::yield();
        }
    }
private:
    std::atomic<int> counter_;
};
} // namespace detail_sc_world
using sc_quit_semaphore = detail_sc_world::mini_semaphore;
#else
#include <semaphore>
using sc_quit_semaphore = std::counting_semaphore<std::numeric_limits<int>::max()>;
#endif

#include "../../common/server_shm.hpp"

#if !defined(NO_LIBSNDFILE) || defined(SC_WASM_SNDFILE_COMPAT)
#    include "../../common/sndfile_helpers.hpp" // includes sndfile.h with appropriate configuration
#endif

extern HashTable<struct UnitDef, Malloc>* gUnitDefLib;


struct TriggerMsg {
    World* mWorld;
    int32 mNodeID;
    int32 mTriggerID;
    float mValue;

    void Perform();
};


struct NodeReplyMsg {
    World* mWorld;
    int32 mNodeID;
    int32 mID;
    int32 mNumArgs;
    float* mValues;
    int32 mCmdNameSize;
    char* mCmdName;
    void* mRTMemory;
    void Perform();
};


struct NodeEndMsg {
    World* mWorld;
    int32 mNodeID;
    int32 mGroupID;
    int32 mPrevNodeID;
    int32 mNextNodeID;
    int32 mIsGroup;
    int32 mHeadID;
    int32 mTailID;
    int32 mState;

    void Perform();
};

struct DeleteGraphDefMsg {
    struct GraphDef* mDef;

    void Perform();
};


typedef MsgFifoNoFree<TriggerMsg, 1024> TriggersFifo;
typedef MsgFifoNoFree<NodeReplyMsg, 1024> NodeReplyFifo;
typedef MsgFifoNoFree<NodeEndMsg, 1024> NodeEndsFifo;
typedef MsgFifoNoFree<DeleteGraphDefMsg, 512> DeleteGraphDefsFifo;
typedef HashTable<struct GraphDef, Malloc> GrafDefTable;

typedef std::map<struct ReplyAddress, uint32> ClientIDDict;
typedef std::deque<int> ClientIDs;
typedef std::set<ReplyAddress> Clients;

struct HiddenWorld {
    class AllocPool* mAllocPool;
    IntHashTable<struct Node, AllocPool>* mNodeLib;
    GrafDefTable* mGraphDefLib;
    uint32 mMaxUsers;
    Clients* mUsers;
    ClientIDs* mAvailableClientIDs;
    ClientIDDict* mClientIDdict;

    class SC_AudioDriver* mAudioDriver;
    char mPassword[32];

    uint32 mMaxWireBufs;
    float* mWireBufSpace;

    TriggersFifo mTriggers;
    NodeReplyFifo mNodeMsgs;
    NodeEndsFifo mNodeEnds;
    DeleteGraphDefsFifo mDeleteGraphDefs;

    sc_quit_semaphore* mQuitProgram;
    bool mTerminating;

#if !defined(NO_LIBSNDFILE) || defined(SC_WASM_SNDFILE_COMPAT)
    SNDFILE* mNRTInputFile;
    SNDFILE* mNRTOutputFile;
    FILE* mNRTCmdFile;
#endif

    int32 mHiddenID;
    int32 mRecentID;

#ifdef __APPLE__
    const char* mInputStreamsEnabled;
    const char* mOutputStreamsEnabled;
#endif

    const char* mInDeviceName;
    const char* mOutDeviceName;
    class server_shared_memory_creator* mShmem;
};

typedef struct HiddenWorld HiddenWorld;

inline SC_AudioDriver* AudioDriver(World* inWorld) { return inWorld->hw->mAudioDriver; }
