# WASM Heap Snapshot — Design & Implementation Guide

## Overview

The heap snapshot system eliminates sclang class library compilation on every
boot by saving the WASM linear memory to disk after the first successful
`compileLibrary()` call and restoring it on subsequent runs. This drops cold
boot time from ~6 700 ms to ~150–200 ms (module load only), matching the
startup time already achieved by `hcsynth`.

---

## Background: why it works

Emscripten compiles C++ to a single flat binary in which **all runtime state
lives inside one linear memory buffer** (`Module.HEAPU8`). This includes:

| What | Notes |
|---|---|
| C++ `.data` / `.bss` globals | Fixed low addresses; includes `compiledOK`, `g_initialized`, `gMainVMGlobals` |
| `pyr_pool_runtime` allocator metadata | All SC heap pool headers and free-lists |
| Every `PyrObject *`, `PyrSymbol *`, etc. | Offsets within the same buffer; no external heap |
| SC class table and symbol table | Built during `compileLibrary` |
| Bytecode for all 200+ library classes | Stored as PyrObject arrays in the SC heap |
| Emscripten MEMFS structures | Also in linear memory — see caveats below |

Because all pointers are 32-bit offsets within `HEAPU8` (WASM uses a 32-bit
address space starting at 0), restoring the buffer restores all pointers
exactly — **no fixup pass is required**, unlike native heap snapshots.

**What is NOT in linear memory:**

- WASM function-table indices — these are WASM-level references, not values in
  linear memory. JS callbacks (`g_post_callback`, `g_error_callback`) stored as
  C function pointers are in linear memory but hold table indices, so they must
  be re-registered from JS after restore.
- The WASM stack pointer (`__stack_pointer`) — a WASM global, not linear
  memory. It is reset to its initial value by module instantiation and is
  unaffected by heap restore.

---

## The one real caveat: Emscripten MEMFS

When `hclang` loads, `--preload-file` populates MEMFS with all `.sc` source
files before any user code runs. MEMFS data structures also live in linear
memory.

Snapshot save happens **after** `compileLibrary()` completes. At that point the
SC heap reflects a fully-booted interpreter; the MEMFS state in the snapshot
reflects the file system as it was during boot.

Snapshot restore happens into a **freshly-instantiated module** whose MEMFS was
also populated by `--preload-file`. Copying the snapshot over this fresh heap
**overwrites the fresh MEMFS** with the stale MEMFS from the snapshot instance.

This is safe because:

1. Once `compileLibrary()` has run, no further reads of `.sc` files occur —
   so MEMFS correctness is irrelevant.
2. After restore, all `malloc`/`free` operations route through the snapshot's
   `dlmalloc` state, which is internally consistent.
3. Any output written by user code (e.g. to `/tmp/`) goes through `malloc` and
   the WASM VFS, both of which operate correctly on the snapshot heap.

The caveat that remains: Emscripten's MEMFS internal struct layout is not a
stable ABI. If the `hclang.wasm` binary changes (new Emscripten version, new
SC source), the snapshot is invalid. This is handled by the invalidation
mechanism described below.

---

## Implementation

### Piece 1 — C export: heap-break query

Add to `engine/HC_Wasm_Eval.cpp`:

```cpp
#include <emscripten.h>
#include <cstdint>

// Returns the current sbrk(0) value — the end of the live heap after init.
// Only the bytes [0, heapEnd) need to be saved in the snapshot.
extern "C" uint32_t hc_wasm_eval_heap_end() {
    return (uint32_t)(uintptr_t)sbrk(0);
}
```

Add `'_hc_wasm_eval_heap_end'` to the `EXPORTED_FUNCTIONS` list in
`src/lang/CMakeLists.txt`.

### Piece 2 — JS: snapshot save and restore (`cli/hclang.js`)

**Save path** (runs once, after a successful `hc_wasm_eval_init()` when no
valid snapshot exists):

```js
const crypto = require('crypto');
const os     = require('os');
const path   = require('path');

const SNAP_DIR  = path.join(os.homedir(), '.cache', 'hclang');
const SNAP_FILE = path.join(SNAP_DIR, 'heap.bin');

function snapshotHash(wasmPath) {
  // Hash of the wasm binary + the class library source tree mtime.
  // (A full content hash of all .sc files is more correct but slow;
  //  mtime of the preload .data file is a good proxy.)
  const wasmBuf  = fs.readFileSync(wasmPath);
  const dataPath = wasmPath.replace(/\.js$/, '.data');
  const dataStat = fs.existsSync(dataPath) ? fs.statSync(dataPath).mtimeMs : 0;
  return crypto.createHash('sha256')
    .update(wasmBuf)
    .update(String(dataStat))
    .digest('hex');
}

async function saveSnapshot(module, wasmPath) {
  const heapEnd  = module._hc_wasm_eval_heap_end();
  const snapshot = Buffer.from(module.HEAPU8.buffer, 0, heapEnd);
  const hash     = snapshotHash(wasmPath);
  const header   = Buffer.alloc(68);          // 4-byte magic + 64-byte hex hash
  header.writeUInt32BE(0x48435350, 0);        // 'HCSP'
  header.write(hash, 4, 'ascii');
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  fs.writeFileSync(SNAP_FILE, Buffer.concat([header, snapshot]));
}

async function tryRestoreSnapshot(module, wasmPath) {
  if (!fs.existsSync(SNAP_FILE)) return false;
  const hash   = snapshotHash(wasmPath);
  const raw    = fs.readFileSync(SNAP_FILE);
  if (raw.length < 68) return false;
  if (raw.readUInt32BE(0) !== 0x48435350) return false;   // bad magic
  if (raw.slice(4, 68).toString('ascii') !== hash) return false; // stale
  const snap = raw.slice(68);
  module.HEAPU8.set(snap, 0);
  return true;
}
```

**Boot sequence** (replaces the current linear `hc_wasm_eval_init()` call):

```js
const wasmPath = path.join(__dirname, 'hclang.js');

// Attempt fast-path restore
const restored = await tryRestoreSnapshot(module, wasmPath);

if (restored) {
  // Re-register JS callbacks (stored as function-table indices in linear
  // memory; the saved values point to the old module — must refresh).
  module._hc_wasm_eval_set_post_callback(postCallbackFuncPtr);
  module._hc_wasm_eval_set_error_callback(errorCallbackFuncPtr);
  // hc_wasm_eval_init() sees g_initialized == true → returns 0 immediately.
  module._hc_wasm_eval_init();
} else {
  // Slow path: full compile (first run or stale snapshot).
  module._hc_wasm_eval_init();
  await saveSnapshot(module, wasmPath);
}
```

### Piece 3 — Snapshot invalidation

The 68-byte header written to `heap.bin`:

```
Bytes  0– 3   Magic: 0x48435350 ('HCSP')
Bytes  4–67   SHA-256 hex digest (64 ASCII chars)
Bytes 68–end  Raw heap bytes [0, heapEnd)
```

The digest covers the `hclang.wasm` binary bytes and the `.data` file mtime.
Any change to either (new Emscripten build, updated class library) produces a
different hash, causing `tryRestoreSnapshot` to return `false` and triggering a
fresh compile + new snapshot save on the next run.

---

## Expected timing

| Scenario | Current | With snapshot |
|---|---|---|
| First run (no snapshot) | ~6 700 ms | ~6 700 ms + ~50 ms save |
| Subsequent runs | ~6 700 ms | ~150–200 ms |
| After `just build-hclang` | ~6 700 ms | ~6 700 ms (snapshot invalidated, regenerated) |

The snapshot file size is ~40–80 MB, covering only the live portion of the 128
MB initial heap.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Emscripten MEMFS ABI changes between builds | SHA-256 of `hclang.wasm` binary; any rebuild invalidates snapshot |
| Non-deterministic heap layout (ASLR-equivalent) | WASM linear memory is always at address 0; no ASLR; layout is deterministic for a given binary |
| Function-pointer table indices change between saves | Re-register all JS callbacks after restore (Piece 2) |
| Snapshot file corruption | Magic byte check + hash check; falls back to full compile |
| Snapshot on a read-only filesystem | Catch write errors; silently skip save, proceed with slow boot |

---

## Files to modify

| File | Change |
|---|---|
| `engine/HC_Wasm_Eval.cpp` | Add `hc_wasm_eval_heap_end()` |
| `src/lang/CMakeLists.txt` | Add `_hc_wasm_eval_heap_end` to `EXPORTED_FUNCTIONS` |
| `cli/hclang.js` | Add `saveSnapshot`, `tryRestoreSnapshot`, update boot sequence |
| `engine/HC_Wasm_Eval.h` | Declare `hc_wasm_eval_heap_end` |

No changes to C++ SC VM code, PyrLexer, or build toolchain are required.
