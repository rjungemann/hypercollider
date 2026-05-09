# `scope_buffer.hpp` — Stethoscope shared-memory buffer

## What the file is

A lock-free, single-producer/single-consumer triple-buffer that lives in
shared memory and ferries audio waveform data from the synth server to a
viewer process. It defines four cooperating types in `detail_server_shm`:

- [`scope_buffer_pool`](../src/common/scope_buffer.hpp#L39) — a thin wrapper around the TLSF allocator that owns the backing memory region.
- [`scope_buffer`](../src/common/scope_buffer.hpp#L56) — one slot's worth of state: status, channel count, frame count, and three equal-sized data regions used for triple-buffering.
- [`scope_buffer_writer`](../src/common/scope_buffer.hpp#L169) (server side) and [`scope_buffer_reader`](../src/common/scope_buffer.hpp#L195) (client side) — the public façades that the audio thread and the GUI thread use, respectively.

`offset_ptr<float>` is used for the data pointers so the same struct is
valid in both processes — each process maps the shared region at a
different virtual address, so absolute pointers wouldn't survive the
trip.

## "Stethoscope" — what's being implemented

In SuperCollider, **Stethoscope** (the `s.scope` GUI) is the realtime
oscilloscope that visualizes the contents of a `Bus`/`Buffer` while the
synth is running. The audio server (`scsynth`) writes blocks of samples
into a `ScopeOut` UGen; the language process (or IDE) reads them out and
draws the waveform.

The mechanism here is exactly that pipeline:

1. The audio thread calls [`scope_buffer::write_address()`](../src/common/scope_buffer.hpp#L142) to get a pointer to the "out" region, fills it with `frames × channels` floats, then calls [`push(frames)`](../src/common/scope_buffer.hpp#L144) which marks the region `changed` and atomically swaps `_in` ↔ `_stage`.
2. The GUI/lang thread calls [`pull()`](../src/common/scope_buffer.hpp#L156); if it sees `_stage` as changed it swaps `_stage` ↔ `_out` and returns the new frame count, then reads via `read_address()`.

The three regions guarantee that writer and reader never touch the same
buffer simultaneously and the writer never has to block — when a frame
is missed, the writer simply overwrites the staged region.

The big comment block at line 70 documents this state machine. The
whole protocol is wait-free in the audio-thread direction, which is the
main constraint.

## Why TLSF

The pool is shared by up to `kMaxScopeBuffers = 128` scope slots
([server_shm.hpp:87-88](../src/common/server_shm.hpp#L87-L88)) and the
writer allocates/frees on demand whenever a `ScopeOut` UGen starts or
stops. Three properties make TLSF the right fit:

1. **Real-time safety — bounded O(1) alloc/free.** TLSF (Two-Level Segregated Fit) was designed for hard-realtime systems; both `malloc_ex` and `free_ex` complete in constant, predictable time regardless of pool fragmentation. The audio thread can call `pool.allocate(...)` without risking the variable-latency or worst-case behavior of a general-purpose allocator (which would underrun).
2. **Operates over a fixed, externally supplied memory block.** [`scope_buffer_pool::init`](../src/common/scope_buffer.hpp#L41) hands TLSF a pointer and size — it does not call the OS. That's exactly what's needed when the storage is `mmap`'d shared memory: the allocator's bookkeeping has to live *inside* the shared region so both processes see a consistent heap, with no kernel calls per allocation.
3. **Low fragmentation for variable-sized scope buffers.** Different scopes ask for different `channels × size × 3 × sizeof(float)` blocks, and they come and go over the lifetime of the server. Segregated free lists keep fragmentation bounded so the pool doesn't slowly poison itself.

So: TLSF gives you `malloc`-style flexibility for variably-sized scope
buffers, with allocator metadata co-located in the shared mapping and a
deterministic worst case the audio callback can tolerate. A regular
libc `malloc` satisfies none of those.

Historically (the 2011 Jakob Leben implementation referenced in the
header) this was layered on top of `boost::interprocess`'s allocator;
the current tree dropped Boost (commit `4253fad6e4 Remove boost`) and
uses the standalone TLSF in [src/external/tlsf/](../src/external/tlsf/)
directly via the `extern "C"` include at line 27.
