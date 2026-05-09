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
/*

Each virtual machine has a copy of VMGlobals, which contains the state of the virtual machine.

*/

#pragma once

#include "slot.h"
#include "alloc_pool.h"
#include "SC_RGen.h"
#include <setjmp.h>
#include <map>
#include <cstdint>

#define TAILCALLOPTIMIZE 1

typedef void (*FifoMsgFunc)(struct VMGlobals*, struct FifoMsg*);

struct FifoMsg {
    FifoMsg(): func(0), dataPtr(0) { dataWord[0] = dataWord[1] = 0; }
    void Perform(struct VMGlobals* g);
    void Free(struct VMGlobals* g);

    FifoMsgFunc func;
    void* dataPtr;
    std::int64_t dataWord[2];
};

struct VMGlobals {
    VMGlobals();

    // global context
    class AllocPool* allocPool;
    struct PyrProcess* process;
    class SymbolTable* symbolTable;
    class PyrGC* gc; // garbage collector for this process
    PyrObject* classvars;
    int tailCall; // next byte code is a tail call.
    bool canCallOS;

    // thread context
    struct PyrThread* thread;
    struct PyrMethod* method;
    struct PyrBlock* block;
    struct PyrFrame* frame;
    struct PyrMethod* primitiveMethod;
    unsigned char* ip; // current instruction pointer
    PyrSlot* sp; // current stack ptr
    PyrSlot* args;
    PyrSlot receiver; // the receiver
    PyrSlot result;
    int numpop; // number of args to pop for primitive
    std::int64_t primitiveIndex;
    RGen* rgen;
    jmp_buf escapeInterpreter;
    // WASI/WAMR-only flag-based escape: Emscripten's longjmp goes through
    // _emscripten_throw_longjmp + invoke_* wrappers, which cannot be
    // implemented natively under WAMR. Sites that would longjmp(escapeInterpreter)
    // set this flag instead, and Interpret() returns when it sees a non-zero
    // value (matching the longjmp-return path in setjmp(escapeInterpreter)).
    int wasiEscape;

    // scratch context
    std::int64_t execMethod;

    // primitive exceptions
    std::map<PyrThread*, std::pair<std::exception_ptr, PyrMethod*>> lastExceptions;
};

inline void FifoMsg::Perform(struct VMGlobals* g) { (func)(g, this); }

inline void FifoMsg::Free(struct VMGlobals* g) { g->allocPool->Free(dataPtr); }

extern VMGlobals gVMGlobals;
extern VMGlobals* gMainVMGlobals;
extern VMGlobals* gCompilingVMGlobals;
