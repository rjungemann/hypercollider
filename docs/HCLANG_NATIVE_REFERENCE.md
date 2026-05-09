# WAMR Native Host — Architecture & Reference

Reference for the embedded-WAMR native binaries (`hclang_native`,
`hcsynth_native`). For outstanding work see
[HCLANG_NATIVE_PLAN.md](HCLANG_NATIVE_PLAN.md). For the cold-start gap vs the
Node.js + V8 path see [WAMR_PERF_PARITY_PLAN.md](WAMR_PERF_PARITY_PLAN.md).

---

## What this is

The C APIs (`HC_Wasm_Api.h`, `HC_Wasm_Eval.h`) are the stable boundary between
the host and the engine. This native host calls those same functions via
WAMR's embedding API rather than through Emscripten's JS glue, producing
self-contained statically-linked binaries with no Node.js / browser
dependency.

### What ships

| Artifact | Role |
|---|---|
| `native/hclang_host/main.cpp` | REPL, script, classlib pre-open, calls `__wasm_call_ctors` |
| `native/hclang_host/wasm_host.{h,cpp}` | Thin WAMR wrapper with mapped pre-opens |
| `native/hclang_host/CMakeLists.txt` | Builds `hclang_native` (~3.9 MB with embedded blobs) |
| `native/hcsynth_host/main.cpp` | Offline render, OSC server, optional AOT load |
| `native/hcsynth_host/CMakeLists.txt` | Builds `hcsynth_native` |
| `hclang.wasm` (WASI build) | 1.8 MB; imports `wasi_snapshot_preview1.path_open`, `fd_readdir`, etc. |
| `hcsynth.wasm` (WASI build) | Same toolchain as hclang |
| `hclang_classlib.pack` | 1.2 MB, 208 entries; embedded into `hclang_native` |
| `src/common/wasi_fs_shim.c` | Overrides Emscripten STANDALONE_WASM file syscall stubs |
| `.github/workflows/native-host.yml` | Linux + macOS arm64 CI matrix |

### End-to-end behaviour

`hclang_native --classlib-dir <path> --script <file.sc>` (or, with the
embedded pack, just `hclang_native --script ...`):

- Loads `hclang.wasm` into WAMR.
- Runs `__wasm_call_ctors` (manually exported because WAMR skips it for WASI
  modules — `wasm_runtime.c` line 1679: `&& !module->import_wasi_api`).
- Initialises memory pools and the primitive table.
- Compiles all 214 SC class files (~0.7 s) via WASI pre-open + the
  `wasi_fs_shim.c` (Emscripten's `__syscall_openat` stub returns -EPERM
  for everything; the shim translates POSIX file syscalls into real
  `__wasi_path_open` / `__wasi_path_filestat_get` / `__wasi_fd_readdir`
  calls and uses preopen-aware path resolution).
- Initialises the runtime, builds the class tree, prints the welcome banner.
- Returns cleanly from `Main.startup` via the `wasiEscape` flag (replacement
  for `longjmp(g->escapeInterpreter)` — Emscripten's
  `_emscripten_throw_longjmp` requires JS to actually throw).
- Evaluates user SC code via `hc_wasm_eval_string`.
- Forwards OSC packets to `--scsynth-host:--scsynth-port` via UDP.

`bash bench/run_bench.sh --toolchains wamr-full` produces JSON + Markdown rows
for cold/startup/warm; `node bench/summarize.js --md` renders dedicated
`wamr-full` columns.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  hclang_native  (single binary, statically linked)          │
│                                                             │
│  ┌──────────────┐   ┌────────────────────────────────────┐  │
│  │  CLI driver  │──▶│  WAMR runtime (libvmlib.a)         │  │
│  │  + linenoise │   │  ┌──────────────────────────────┐  │  │
│  │  + UDP out   │   │  │  hclang.wasm  (embedded blob) │  │  │
│  │              │   │  │  HC_Wasm_Eval exports         │  │  │
│  │  classlib    │   │  └──────────────────────────────┘  │  │
│  │  pack reader │   └────────────────────────────────────┘  │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  hcsynth_native (single binary, statically linked)          │
│                                                             │
│  ┌──────────────┐   ┌────────────────────────────────────┐  │
│  │  CLI driver  │──▶│  WAMR runtime (libvmlib.a)         │  │
│  │  + miniaudio │   │  ┌──────────────────────────────┐  │  │
│  │  + dr_wav    │   │  ┌──────────────────────────────┐  │  │
│  │  + tinyosc   │   │  │  hcsynth.wasm (embedded blob) │  │  │
│  │  UDP/TCP     │   │  │  HC_Wasm_Api exports          │  │  │
│  └──────────────┘   │  └──────────────────────────────┘  │  │
│                     └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

The `.wasm` blob is embedded at link time as a C byte array (see
`native/cmake/EmbedWasm.cmake`); the binary carries its own engine with no
runtime file I/O required. The class library pack rides alongside via the
same mechanism.

### Why WASI rather than Emscripten

Emscripten-generated `.wasm` files imported a large set of Emscripten-specific
host functions (`env.emscripten_date_now`, `env.invoke_*`, `env.___syscall_*`)
that are **not** standard WASI imports. Cleanest path was a new Emscripten
target that compiles to a WASI-compliant module (`-sSTANDALONE_WASM`) with a
host that provides only WASI + a small set of `hc_*` host imports.

---

## WAMR Embedding API

Public API in `core/iwasm/include/wasm_export.h` inside the WAMR source tree
(downloaded by CPM into `build/native/_deps/wamr-src/`).

### Lifecycle

```c
#include "wasm_export.h"

// 1. Init (call once at process start)
wasm_runtime_init();
// OR with a fixed pool (good for embedded):
RuntimeInitArgs args = {0};
args.mem_alloc_type = Alloc_With_Pool;
args.mem_alloc_option.pool.heap_buf  = g_heap;
args.mem_alloc_option.pool.heap_size = sizeof(g_heap);
wasm_runtime_full_init(&args);

// 2. Load
wasm_module_t mod = wasm_runtime_load(
    (uint8_t *)hcsynth_wasm_blob, hcsynth_wasm_blob_len,
    err, sizeof(err));

// 3. Instantiate
wasm_module_inst_t inst = wasm_runtime_instantiate(
    mod, 65536 /*stack*/, 4*1024*1024 /*heap*/, err, sizeof(err));

// 4. Create exec env (one per thread)
wasm_exec_env_t env = wasm_runtime_create_exec_env(inst, 65536);

// 5. Teardown
wasm_runtime_destroy_exec_env(env);
wasm_runtime_deinstantiate(inst);
wasm_runtime_unload(mod);
wasm_runtime_destroy();
```

### Calling exports

```c
wasm_function_inst_t fn =
    wasm_runtime_lookup_function(inst, "hc_wasm_world_create");

wasm_val_t results[1];
if (!wasm_runtime_call_wasm_v(env, fn, 1, results, 2,
                              (int32_t)48000, (int32_t)512)) {
    fprintf(stderr, "hc_wasm_world_create: %s\n",
            wasm_runtime_get_exception(inst));
    exit(1);
}
int world_id = results[0].of.i32;
```

### Passing buffers (render loop)

WAMR sandboxes linear memory. Buffers passed into WASM functions must be
allocated *inside* the WASM instance's memory space:

```c
void *native_ptr = NULL;
uint64_t wasm_ptr = wasm_runtime_module_malloc(
    inst, num_samples * channels * sizeof(float), &native_ptr);

wasm_runtime_call_wasm_v(env, fn_render, 1, results, 4,
        (int32_t)world_id, (int32_t)wasm_ptr,
        (int32_t)num_samples, (int32_t)channels);

float *audio = (float *)native_ptr;   // same physical memory

wasm_runtime_module_free(inst, wasm_ptr);
```

### Registering host functions

WASM modules cannot hold C function pointers across the boundary. Host
functions are declared as imports in the WASM binary and registered with
WAMR before `wasm_runtime_load`:

```c
static NativeSymbol hc_native_symbols[] = {
    { "hc_host_post",  (void*)hc_host_post_impl,  "($i)" },
    { "hc_host_error", (void*)hc_host_error_impl, "($i)" },
};
wasm_runtime_register_natives("env", hc_native_symbols,
    sizeof(hc_native_symbols) / sizeof(NativeSymbol));
```

Signature encoding: `$` = null-terminated string (auto-converted from WASM
linear memory address), `i` = i32 int, `*` = pointer (caller supplies
length). WAMR validates the boundary automatically.

---

## WASI filesystem

The hclang WASM module needs the SC class library at boot. Three approaches:

### Option A — Pre-opened directory (current dev path)

WAMR's `wasm_runtime_set_wasi_args` passes a list of pre-opened directory
file descriptors:

```c
const char *dir_list[] = { "/usr/share/SuperCollider/SCClassLibrary" };
wasm_runtime_set_wasi_args(mod, dir_list, 1, NULL, 0, NULL, 0, NULL, 0);
```

Class library lives on the host filesystem; WASM code opens files through
`wasi_snapshot_preview1` without any change to SC source. The binary is not
truly self-contained — needs the class library on the target.

### Option B — Embedded pack file (current dist path)

`tools/pack_sc_classlib.js` produces a single flat binary. The native host
extracts it to `mkdtemp(/tmp/hclang_classlib_XXXXXX)` at startup, passes
that path as the WASI pre-open, and `rm -rf`'s on exit. Pack bytes also feed
`hc_wasm_classlib_preload_bytes` so `passOne` reads files from RAM rather
than re-opening through WASI.

### Option C — Heap snapshot (future)

Existing `hc_wasm_eval_heap_end` mechanism could be extended to dump linear
memory after boot and reload it skip-the-class-library-parse on subsequent
runs. Would cut hclang cold start from ~1 s to ~50 ms but requires
deterministic memory layout. Heavy lift.

---

## Pitfalls and gotchas

### 1. WAMR + CPM: `runtime_lib.cmake` must come after `set()` flags

WAMR's `runtime_lib.cmake` reads the `WAMR_BUILD_*` variables at include
time. All `set(WAMR_BUILD_* ...)` calls must precede the `include(...)`.
CPM's `DOWNLOAD_ONLY YES` ensures the source is available before this point.

### 2. SIMD in fast interpreter requires SIMDe

`WAMR_BUILD_SIMD=1` alone is not sufficient for the fast interpreter; you
also need `WAMR_BUILD_SIMDE=1` and `WAMR_BUILD_LIB_SIMDE=1`. Without these,
SIMD instructions will be unimplemented and the module will trap.
Alternatively: use AOT mode (`wamrc`) where SIMD is natively supported.

### 3. wasm_runtime_module_malloc vs. native malloc

Buffers passed to WASM functions *must* be allocated via
`wasm_runtime_module_malloc`, not `malloc`. Passing a native-heap address as
a WASM linear memory offset will either trap (sandbox check) or silently
corrupt. The native pointer returned via `p_native_addr` is what you use on
the host side to read/write.

### 4. Emscripten `invoke_*` trampolines

If hcsynth/hclang use C++ exceptions or indirect calls through virtual
tables, Emscripten emits `invoke_i`, `invoke_vi`, etc. These are JS-specific
and appear as unresolved imports in WASI mode. Solutions:
- Compile with `-fno-exceptions` where safe (the WASI build does this for
  libhclang and libscsynth — `engine/CMakeLists.txt`).
- Or register stub `invoke_*` host functions that call
  `wasm_runtime_call_indirect()`. Provided in the host main files.

### 5. `__stack_chk_fail` and stack-protector builtins

Emscripten's libc includes stack-smashing protection. In STANDALONE_WASM
mode these link from WASI libc. If they appear as unresolved imports, add
`-fno-stack-protector` (already handled in `EmscriptenWasiToolchain.cmake`).

### 6. Module instantiation heap size

The `heap_size` argument to `wasm_runtime_instantiate` is the WASM heap
(malloc arena inside linear memory), separate from the WASM linear memory
(which grows with `memory.grow`). hclang needs a generous heap for the GC:
start with `32 * 1024 * 1024` and tune. AOT codegen needs more (hclang side
is currently 256 MB after the 12.3c bump).

### 7. Single exec_env per thread

A `wasm_exec_env_t` is not thread-safe. Any background ticker thread needs
its own `exec_env` created from the same module instance via
`wasm_runtime_spawn_exec_env(base_env)`. WAMR's thread manager
(`WAMR_BUILD_THREAD_MGR=1`) must be enabled when threading is used.

### 8. wamrc requires LLVM — it is not a CPM dependency

`wamrc` is a build-time tool, not a runtime dep. Only needed to produce AOT
artifacts. The `build-wamr-aot` recipe skips gracefully if `wamrc` is not on
PATH; AOT is optional.

### 9. WAMR skips `__wasm_call_ctors` for WASI modules

`wasm_runtime.c` line 1679: `&& !module->import_wasi_api`. We export the
symbol explicitly and call it from the host post-instantiate; otherwise C++
globals are uninitialised and the runtime crashes during
`hc_wasm_eval_init`.

### 10. `_emscripten_throw_longjmp` requires JS

Emscripten's `longjmp` implementation throws a JS exception; under WAMR
there's no JS, so it traps. We replaced `longjmp(g->escapeInterpreter)` in
the SC interpreter with a `g->wasiEscape` flag
(`src/lang/core/vm_globals.h`, `src/lang/core/interpreter3.cpp`) that the
dispatch loop checks each opcode.

### 11. Lang AOT requires `--opt-level=0`

wamrc's optimiser has bugs at `--opt-level=1/2/3` against the lang module
(SIGSEGV / "memory exhausted" trap). `--opt-level=0` is locked in
[native/CMakeLists.txt](../native/CMakeLists.txt). Lang AOT runs end-to-end
~22% faster than interpreted at this level. Synth side is fine across all
opt levels; AOT speed-up there is 2.2×.

### 12. Tail-call enabled across all three layers

scscm needs proper tail-call elimination. All three layers must stay on:

- Emit: `-mtail-call` in `cmake_modules/EmscriptenWasiToolchain.cmake`.
- Runtime: `WAMR_BUILD_TAIL_CALL=1` in `native/CMakeLists.txt`.
- AOT: `--enable-tail-call` to `wamrc` in `hc_add_aot_target()`.

Regression test: [tests/scscm/tail_call_recursion.scd](../tests/scscm/tail_call_recursion.scd)
(recursive `loop` at depth 200 000).

---

## Static linking strategy

| Platform | Compiler | Static flags |
|----------|----------|-------------|
| macOS | Clang | `-static-libstdc++ -static-libgcc`; CoreAudio linked via `-framework CoreAudio -framework AudioToolbox` (always static on macOS) |
| Linux | GCC/Clang | `-static` or `-static-libstdc++` + musl libc for fully static |
| Windows | MSVC | `/MT` (static CRT) — not yet wired |

WAMR is built as a static archive (`libvmlib.a`). CLI11, miniaudio, dr_libs,
and tinyosc are header-only or two-file libraries. Current release binary
is in the 3–6 MB range (WAMR ~1–2 MB + embedded .wasm 1.8 MB + classlib pack
1.2 MB).

---

## Forward-looking projects

Once the native host infrastructure exists, the embedded WAMR + C API
pattern opens several adjacent directions:

### HC Lite (Raspberry Pi / Embedded Linux)

A wasm3 backend (`native_host_wasm3` preset, sketched but not implemented)
for a ~1 MB hcsynth binary that runs on ARMv7/ARM64 Linux with miniaudio →
ALSA output. No package manager needed on target.

### DAW Plugin (VST3 / CLAP / AU)

Embed `hcsynth.wasm` inside a VST3 or CLAP plugin. The plugin hosts WAMR,
renders audio via `hc_wasm_render` inside the process block callback, and
exposes SynthDef parameters as plugin parameters. No external process or
IPC required. CPM dependencies: CLAP headers (`free-audio/clap`) or the
VST3 SDK.

### hcsynth as a C library

Expose `libhcsynth.h` / `libhcsynth.so` — a thin wrapper around the WAMR
host that lets any C/C++ program use hcsynth as an audio synthesis library.
Useful for game engines, creative coding frameworks, and language bindings.

### Language bindings via the C library

With `libhcsynth` in place, thin bindings are straightforward:
- **Python**: `ctypes` or `cffi`; installable via PyPI.
- **Ruby**: `fiddle` or `ffi` gem.
- **Lua**: native C extension (~100 lines).
- **Go**: `cgo` binding.

### hclang as a scripting engine

Embed `hclang.wasm` + WAMR inside another application to use SuperCollider
as a scripting/pattern language — for example, a generative music game or a
live-coding tool in a terminal UI framework.

### WebAssembly Component Model

As WASI Component Model (preview 2) stabilizes, the hclang and hcsynth
modules could be repackaged as WASM components with typed interface
definitions (WIT), enabling composition with other WASM components via
`wasm-tools compose`.

---

## Key files

| File | Role |
|---|---|
| `native/CMakeLists.txt` | Top-level native host project; WAMR pin (2.4.3); CPM packages |
| `native/cmake/EmbedWasm.cmake` | WASM blob → C array helper |
| `native/cmake/EmbedWasmRun.cmake` | Per-blob hex-emit script (cmake -P) |
| `native/cmake/CPM.cmake` | Vendored CPM bootstrap |
| `native/hclang_host/main.cpp` | Host entry point: CLI, WAMR init, classlib pack extraction, SIGINT handler |
| `native/hclang_host/wasm_host.{h,cpp}` | Thin WAMR wrapper (`WasmHost`) |
| `native/hclang_host/CMakeLists.txt` | Build, blob embedding |
| `native/hcsynth_host/main.cpp` | Host entry point for synth |
| `native/hcsynth_host/{audio_out,osc_server}.{h,cpp}` | miniaudio + tinyosc wrappers |
| `engine/HC_Wasm_Eval.cpp` | Exports `hc_wasm_eval_*`; `hc_host_*` imports under WASI |
| `engine/HC_Wasm_OscShim.cpp` | `hc_wasm_osc_dispatch` for inbound OSC |
| `engine/HC_Wasm_Main.cpp` | Stub `main()` for WASI command-mode link |
| `src/lang/CMakeLists.txt` | Lang WASM link flags, `SC_WASM_WASI` guard, classlib pack target |
| `src/server/core/CMakeLists.txt` | Synth WASM link flags |
| `src/common/wasi_fs_shim.c` | POSIX → WASI file-syscall translation |
| `src/lang/core/vm_globals.h` | `wasiEscape` flag |
| `src/lang/core/interpreter3.cpp` | Bytecode dispatch with interrupt poll under WASI |
| `cmake_modules/EmscriptenWasiToolchain.cmake` | STANDALONE_WASM toolchain |
| `CMakePresets.json` | `wasi_release` preset |
| `bench/run_bench.sh` | Bench runner; `wamr-full`, `wamr-aot` toolchains; per-run timing; `--list-toolchains` |
| `bench/summarize.js` | Summary output; wamr-full / wamr-aot columns; RSS in MB |
| `bench/check_baselines.js` | Baseline regression checker; `--update` flag |
| `bench/baselines/wamr-full.json` | Recorded medians + per-row thresholds |
| `Justfile` | `bench`, `bench-wamr*`, `bench-check`, `bench-update-baselines` |
| `.github/workflows/native-host.yml` | CI matrix (Linux + macOS arm64) |

---

## Quick-start

```bash
# 1. Build everything the bench can measure (JS + WASI + WAMR hosts)
just build-all

# 2. Smoke test (no scsynth) — uses the embedded classlib pack
./build/native/hclang_host/hclang_native --script tests/hello.scd

# 3. Two-process pipeline
./build/native/hcsynth_host/hcsynth_native \
    --udp-port 57110 --output /tmp/out.wav --duration 5 &
./build/native/hclang_host/hclang_native \
    --script bench/patches/wamr_full/sine.scd \
    --scsynth-host 127.0.0.1 --scsynth-port 57110

# 4. Bench (build-all is auto-pulled by the bench recipes)
just bench-wamr-full
node bench/summarize.js --md bench/results/<latest>.json

# 5. Check what's available without running anything
bash bench/run_bench.sh --list-toolchains

# 6. AOT (optional; install wamrc per HCLANG_NATIVE_PLAN.md first)
just build-wamr-aot
just bench-wamr-aot
```

The lower-level cmake invocations are in [Justfile](../Justfile) — search
for `build-wasi`, `build-wamr-host`, `build-wamr-aot`.
