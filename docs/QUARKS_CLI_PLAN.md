# Quarks Support Plan — CLI (Node.js WASM + WAMR)

Two CLI implementation tracks: the Emscripten/Node.js CLI and the WAMR native CLI.
Both use the same underlying strategy — route git/shell process spawning through
host-side execution infrastructure — but the wiring differs between the JS event-loop
host and the C++ WAMR host.

Neither track supports `thisProcess.recompile` as a hot-reload path. In both cases the
workflow is install-then-restart: run hclang once to clone the quark, then re-run and the
quark is compiled in automatically. This is a consequence of the preloaded class-library
architecture and is not specific to quarks.

For the browser implementation see `docs/QUARKS_BROWSER_PLAN.md`.

---

## Status & rollout

Coarse-grained checklist of the work below. Each item links to the detailed step where the per-file checkboxes live. Tracks A and B share two engine-level pieces (`hc_wasm_eval_add_include_path` export, `Quarks.supported`), so land those once and reuse from both.

### Critical path (lands first)

- [ ] **Engine — `hc_wasm_eval_add_include_path` export** (used by A3 and B5). Header `engine/HC_Wasm_Eval.h` (after line 71); impl in `engine/HC_Wasm_Eval.cpp`. See "Shared follow-up".
- [ ] **Class library — `Quarks.supported` + `String#include` guard** (used by all tracks). `src/class_library/Common/Quarks/Quarks.sc` and `src/class_library/Common/Collections/String.sc:455-461`. See "Shared follow-up".
- [ ] **Native primitive — `hc_wasm_quarks_available`** (browser path checks JS proxy; WAMR path checks `--quarks-dir` + `git`). See "Shared follow-up".

### Track A — Node.js CLI

- [ ] **A1** Pipe primitives (`_PipeOpen` / `_File_GetLine` / `_PipeClose`) in `src/lang/core/wasm_runtime_bridge.cpp`
- [ ] **A2** NODEFS mount of the quarks directory in `cli/hclang.js`
- [ ] **A3** `--extra-class-path` flag in `cli/hclang.js`
- [ ] **A4** Document the install-then-restart workflow (`--help` + `docs/CLI_REFERENCE.md`)

### Track B — WAMR Native CLI

- [ ] **B1** `hc_host_exec` / `hc_host_exec_capture` in `native/hclang_host/main.cpp`
- [ ] **B2** WASI-side import declarations in `wasm_runtime_bridge.cpp`
- [ ] **B3** Wire WASI paths of unix primitives (`prString_System_Wasm`, `prString_UnixCmdGetStdOut_Wasm`, `prPipeOpen_Wasm`, array variants)
- [ ] **B4** `--quarks-dir` WASI pre-open
- [ ] **B5** `--extra-class-path` for WAMR

### Test matrix

- [ ] All Track A tests TA-1 … TA-5 green
- [ ] All Track B tests TB-1 … TB-7 green
- [ ] Shared tests TS-1 … TS-4 green
- [ ] `just test-quarks` recipe runs the full matrix; CI runs on `ubuntu-latest` and `macos-14`

---

## Track A — Emscripten / Node.js CLI (`cli/hclang.js`)

### Background

`wasm_runtime_bridge.cpp` already routes several unix primitives through the JS unix bridge:

| SC Primitive | WASM impl | Bridge method |
|---|---|---|
| `_String_System` | `prString_System_Wasm` | `unix_bridge.system(cmd)` |
| `_String_POpen` | `prString_POpen_Wasm` | `unix_bridge.startCommand(cmd, post)` |
| `_ArrayPOpen` | `prArray_POpen_Wasm` | `unix_bridge.startArgvCommand(args, post)` |
| `_String_UnixCmdGetStdOutWasm` | `prString_UnixCmdGetStdOut_Wasm` | `unix_bridge.runCommandCapture(cmd)` |

The missing piece is `_PipeOpen` / `_File_GetLine` / `_PipeClose`, which back the `Pipe` SC
class. `Git.sc` uses `Pipe.callSync(cmd, onSuccess, onError)`, which calls these primitives
directly. They are not in the exclusion list in `src/lang/CMakeLists.txt` and are not
registered in `initUnixPrimitives()` in `wasm_runtime_bridge.cpp`, so they fall through to
`primitiveFailed` at runtime.

### Step A1 — Add `_PipeOpen` / `_File_GetLine` / `_PipeClose` to `wasm_runtime_bridge.cpp`

`Pipe.callSync` reads the entire output of a command line-by-line synchronously.
The unix bridge already has `runCommandCapture(cmd)` which returns the full stdout in one
synchronous call. The WASM-side implementation should use that and buffer the result:

**Data structure** (static, in `wasm_runtime_bridge.cpp`):
```cpp
struct WasmPipeBuffer {
    std::string output;
    size_t      pos = 0;
    bool        open = false;
};
static constexpr int kMaxPipeBuffers = 8;
static WasmPipeBuffer g_pipe_buffers[kMaxPipeBuffers];
// Returns a 1-based slot index (used as the fake "pid" returned to SC), or -1 on failure.
static int allocPipeBuffer() { ... }
static void freePipeBuffer(int slot) { ... }
```

**`prPipeOpen_Wasm`** (registers as `_PipeOpen`):
- Args: `(this Pipe object, commandLine String, mode String)` — `g->sp - 2`, `g->sp - 1`, `g->sp`
- Call `unix_bridge.runCommandCapture(command)` synchronously
- On success: store stdout in `g_pipe_buffers[slot]`, `SetInt(callerSlot, slot_index)`, return `errNone`
- On failure: return `errFailed`
- WASI path: return `failUnixBridgeUnavailable()`

**`prFile_GetLine_Wasm`** (registers as `_File_GetLine`):
- The existing `file_prim.cpp` registers `_File_GetLine` against the real libc `fgets` path.
  `wasm_runtime_bridge.cpp` must register a replacement that checks whether the int
  descriptor looks like a pipe buffer slot vs a real fd.
- Read the next newline-terminated segment from `g_pipe_buffers[slot].output`, advance
  `pos`, return the line as a PyrString. When `pos` is at end, return `nil`.

**`prPipeClose_Wasm`** (registers as `_PipeClose`):
- Free the buffer slot at the given index.

Register all three in `initUnixPrimitives()` in `wasm_runtime_bridge.cpp`:
```cpp
definePrimitive(base, index++, "_PipeOpen",      prPipeOpen_Wasm,      3, 0);
definePrimitive(base, index++, "_PipeClose",     prPipeClose_Wasm,     2, 0);
definePrimitive(base, index++, "_File_GetLine",  prFile_GetLine_Wasm,  2, 0);
```

Note: `_File_GetLine` is currently registered in `initFilePrimitives()` against the real
libc path. The WASM-specific override must inspect the pid/fd to determine whether to
route through the pipe buffer or the existing MEMFS file logic.

**Tasks:**

- [ ] Add `WasmPipeBuffer` struct + `g_pipe_buffers[8]` table near top of `src/lang/core/wasm_runtime_bridge.cpp` (alongside the existing post/error import declarations around lines 61–77).
- [ ] Implement `allocPipeBuffer()` / `freePipeBuffer(slot)` helpers; use 1-based slot indexing so a returned `0` can mean "failure".
- [ ] Implement `prPipeOpen_Wasm` — read args at `g->sp - 2 / -1 / 0`; call `unix_bridge.runCommandCapture(command)` (Emscripten path); on success store stdout in `g_pipe_buffers[slot]` and `SetInt(callerSlot, slot)`; WASI path defers to Track B (`hc_host_exec_capture` from B1).
- [ ] Implement `prFile_GetLine_Wasm` — inspect descriptor: if it indexes a pipe-buffer slot, return next newline-terminated segment and advance `pos`; else fall through to the existing MEMFS-backed path.
- [ ] Implement `prPipeClose_Wasm` — free the slot at the given index.
- [ ] Register the three primitives in `initUnixPrimitives()` at `src/lang/core/wasm_runtime_bridge.cpp:879+`, after the existing `_GetPid` block.
- [ ] Reconcile the duplicate `_File_GetLine` registration: either exclude the desktop `unix_prim.cpp` registration from the WASM build (extend `SC_WASM_LANG_EXCLUSION_ENTRIES` in `src/lang/CMakeLists.txt:106`) or guarantee the WASM override registers later so it wins. Pick one; document the choice inline.

**Acceptance:** TA-1 passes — `Pipe.callSync("echo hello", "r")` returns `["hello"]` from a script piped through `cli/hclang.js --script -`.

### Step A2 — NODEFS mount for persistent quark storage

`Quarks.folder` resolves to `Platform.userAppSupportDir ++ "/downloaded-quarks"`. On the
Emscripten build this path lives in MEMFS, which is session-ephemeral. Mounting the
host filesystem at that path makes quark installs persist across runs.

In `cli/hclang.js`, after `instantiateEmscriptenModule` returns:

```js
// Mount host quarks directory into WASM VFS so Quarks.folder is persistent.
// Called before the boot sequence runs so the path exists when SC tries to
// read Quarks.folder during startup.
function mountQuarksDir(module) {
  const hostDir = path.join(
    os.homedir(), '.local', 'share', 'SuperCollider', 'downloaded-quarks'
  );
  fs.mkdirSync(hostDir, { recursive: true });

  // Emscripten's default userAppSupportDir on the WASM platform resolves to
  // /home/user/.local/share/SuperCollider via the Platform.userAppSupportDir
  // primitive in wasm_runtime_bridge.cpp.  Ensure all parent directories exist
  // in MEMFS, then replace the leaf with a NODEFS mount.
  const guestParent = '/home/user/.local/share/SuperCollider';
  module.FS.mkdirTree(guestParent);
  const guestLeaf  = guestParent + '/downloaded-quarks';
  module.FS.mkdir(guestLeaf);
  module.FS.mount(module.NODEFS, { root: hostDir }, guestLeaf);
}
```

Call `mountQuarksDir(sclang)` before `hc_wasm_eval_boot_sequence` fires.

This requires `NODEFS` to be linked into the Emscripten build. Add to
`engine/CMakeLists.txt` (or the hclang link step in `src/lang/CMakeLists.txt`):
```cmake
target_link_options(libhclang INTERFACE -lnodefs.js)
```
(Emscripten's `-lnodefs.js` embeds the NODEFS JS library in the output.)

Verify that `Platform.userAppSupportDir` in `wasm_runtime_bridge.cpp` returns the path
expected above. If it returns a different root, update `guestParent` to match.

**Tasks:**

- [ ] Add the `mountQuarksDir(module)` helper to `cli/hclang.js`.
- [ ] Call `mountQuarksDir(sclang)` after `instantiateEmscriptenModule(...)` (`cli/hclang.js:256`) and before `_hc_wasm_eval_boot_sequence()` (`cli/hclang.js:344`) so the path exists before SC reads `Quarks.folder`.
- [ ] Link `-lnodefs.js` into the Emscripten libhclang build. Add `target_link_options(libhclang INTERFACE -lnodefs.js)` to `engine/CMakeLists.txt` (or the lang link step in `src/lang/CMakeLists.txt`).
- [ ] Confirm that `Platform.userAppSupportDir` resolved by `wasm_runtime_bridge.cpp` matches the `guestParent` used in the helper — adjust one or the other so they agree.
- [ ] Manual smoke test: install a quark, exit, re-run hclang, confirm the cloned files survive (covered by TA-2).

**Acceptance:** TA-2 passes — a quark cloned in run #1 is visible in run #2 without re-cloning.

### Step A3 — `--extra-class-path` CLI flag

Users may want to pre-stage a quark directory on disk and have hclang compile it in without
running `Quarks.install` first (useful for offline environments or CI). Add a repeatable
`--extra-class-path <dir>` flag to `cli/hclang.js`:

```js
// In parseArgs():
out.extraClassPaths = [];
// ...
else if (a === '--extra-class-path') out.extraClassPaths.push(next());

// After module instantiation, before boot:
for (const hostDir of opts.extraClassPaths) {
  const guestDir = '/extra-class-lib/' + path.basename(hostDir);
  module.FS.mkdir(guestDir);
  module.FS.mount(module.NODEFS, { root: hostDir }, guestDir);
  // Tell sclang to include this path
  const ptr = allocCString(module, guestDir);
  module._hc_wasm_eval_add_include_path(ptr);
  module._free(ptr);
}
```

This requires a new exported C function `hc_wasm_eval_add_include_path(const char*)` in
`engine/HC_Wasm_Eval.cpp` that calls `LanguageConfig::addIncludePath` before the boot
sequence runs. Add the declaration to `engine/HC_Wasm_Eval.h`.

**Tasks:**

- [ ] Extend `parseArgs()` in `cli/hclang.js:15-80`: add `extraClassPaths: []` default in the options bag, and an `else if (a === '--extra-class-path') out.extraClassPaths.push(next());` branch in the arg-parse loop.
- [ ] Add the engine export `hc_wasm_eval_add_include_path(const char*)` — declaration after `engine/HC_Wasm_Eval.h:71`, implementation in `engine/HC_Wasm_Eval.cpp` calling `LanguageConfig::instance().addIncludePath(path)`. (See "Shared follow-up" — single source of truth across A3 and B5.)
- [ ] In `cli/hclang.js`, after module instantiation and before boot, iterate `opts.extraClassPaths`: for each, `module.FS.mkdir(guestDir)`, `module.FS.mount(NODEFS, ...)`, then `module._hc_wasm_eval_add_include_path(allocCString(...))` followed by `_free`.
- [ ] Update the `--help` text and `printHelp()` examples to document `--extra-class-path` (repeatable).
- [ ] Decide guest-path scheme — `/extra-class-lib/<basename>` is fine but document so paths are predictable across invocations.

**Acceptance:** TA-3 passes — a one-class quark staged in `--extra-class-path` is callable from the script (`TestExtraClass.hello.postln`).

### Step A4 — Document the restart workflow

Add a note to `docs/CLI_REFERENCE.md` and the `hclang --help` text:

> Quarks are supported but require a restart after installation. Run hclang once with a
> script that calls `Quarks.install("QuarkName")` to clone the quark into the persistent
> quarks directory, then re-run hclang — the quark will be compiled in automatically on
> the next boot. `thisProcess.recompile` is not supported; restart hclang instead.

**Tasks:**

- [ ] Append the workflow note to `printHelp()` output in `cli/hclang.js`.
- [ ] Add a "Quarks" subsection to `docs/CLI_REFERENCE.md` that mirrors the help text and links back to this plan.
- [ ] Note the limitation in any quick-start guide that mentions quarks (e.g. `docs/scscm/SCSCM_QUICK_START.md` if it references quark-installable libraries).

### Known limitations (Node.js track)

- `thisProcess.recompile` is not wired; quark activation requires restart.
- Quarks that shell out to build native extensions (`PluginDependency`) will fail at
  the extension-load step even if the SC class files compile correctly.
- Network fetch for quark directory sync (`Quarks.update`) relies on `git fetch` being
  available on the host PATH. No browser-runtime fallback exists.
- NODEFS is not available in the browser bundle; this feature is Node.js-only.

---

## Track B — WAMR Native CLI (`native/hclang_host/`)

### Background

The WAMR build compiles hclang as a WASI module loaded by the C++ host in
`native/hclang_host/main.cpp`. All unix primitives in `wasm_runtime_bridge.cpp` guard
their body with `#ifndef SC_WASM_WASI` and return `failUnixBridgeUnavailable()` for the
WASI path. There is no JS event loop; everything is synchronous.

The host already uses WAMR's `NativeSymbol` table to register host functions (see
`hc_native_symbols[]` in `main.cpp`). The same mechanism can expose command-execution
functions to the WASM module.

### Step B1 — Add host execution functions to `native/hclang_host/main.cpp`

Add two new native host functions to `hc_native_symbols[]`:

**`hc_host_exec(cmd_ptr, cmd_len) → int32_t exit_code`** — synchronous fire-and-forget:
```cpp
static int32_t hc_host_exec_impl(wasm_exec_env_t env,
                                  void* cmd_ptr, int32_t cmd_len) {
    if (!cmd_ptr || cmd_len <= 0) return -1;
    std::string cmd(static_cast<char*>(cmd_ptr),
                    static_cast<size_t>(cmd_len));
    int rc = ::system(cmd.c_str());
    return WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
}
```

**`hc_host_exec_capture(cmd_ptr, cmd_len, out_ptr, out_len) → int32_t bytes_written`** —
synchronous capture of stdout into a WASM linear-memory buffer:
```cpp
static int32_t hc_host_exec_capture_impl(wasm_exec_env_t env,
                                          void* cmd_ptr,  int32_t cmd_len,
                                          void* out_ptr,  int32_t out_len) {
    if (!cmd_ptr || cmd_len <= 0 || !out_ptr || out_len <= 0) return -1;
    std::string cmd(static_cast<char*>(cmd_ptr),
                    static_cast<size_t>(cmd_len));
    FILE* pipe = ::popen(cmd.c_str(), "r");
    if (!pipe) return -1;
    int32_t total = 0;
    char*   dst   = static_cast<char*>(out_ptr);
    while (total < out_len - 1) {
        int c = fgetc(pipe);
        if (c == EOF) break;
        dst[total++] = static_cast<char>(c);
    }
    dst[total] = '\0';
    ::pclose(pipe);
    return total;
}
```

Register both in `hc_native_symbols[]`:
```cpp
{ "hc_host_exec",         (void*)hc_host_exec_impl,
                          "(*i)i"   },
{ "hc_host_exec_capture", (void*)hc_host_exec_capture_impl,
                          "(*i*i)i" },
```

Note on WAMR type signatures: `*` = pointer into WASM linear memory (auto-translated to
native pointer), `i` = i32, `I` = i64.

**Tasks:**

- [ ] Add `hc_host_exec_impl(env, cmd_ptr, cmd_len)` near the existing host-side helpers in `native/hclang_host/main.cpp` (above the `hc_native_symbols[]` declaration at line 405). Wrap `::system()` and decode `WIFEXITED` / `WEXITSTATUS`.
- [ ] Add `hc_host_exec_capture_impl(env, cmd_ptr, cmd_len, out_ptr, out_len)` using `popen` / `pclose`. Truncate at `out_len - 1` so the buffer is always null-terminated; never overrun.
- [ ] Register both in `hc_native_symbols[]` with WAMR signatures `(*i)i` and `(*i*i)i`.
- [ ] Choose buffer size for the capture: 64 KB static is fine for v1; document the cap so TS-4 can verify graceful truncation rather than overflow.

**Acceptance:** TB-1 (`hc_host_exec` round-trip) and TB-2 (`hc_host_exec_capture` captures stdout) both pass.

### Step B2 — Declare WASI imports in `wasm_runtime_bridge.cpp`

In the `#ifdef SC_WASM_WASI` block (alongside existing `hc_host_post` / `hc_host_error`
import declarations), add:

```cpp
#ifdef SC_WASM_WASI
__attribute__((import_module("env"), import_name("hc_host_exec")))
int hc_host_exec(const char* cmd, int len);

__attribute__((import_module("env"), import_name("hc_host_exec_capture")))
int hc_host_exec_capture(const char* cmd, int len, char* out_buf, int out_len);
#endif
```

**Tasks:**

- [ ] Add the two `__attribute__((import_module("env"), import_name(...)))` declarations to `src/lang/core/wasm_runtime_bridge.cpp` inside the existing `#ifdef SC_WASM_WASI` block (alongside lines 61–77 where `hc_host_post`, `hc_host_error`, `hc_host_poll_interrupt` are declared).
- [ ] Verify with a debug build that the WASM module's import table now contains `env.hc_host_exec` and `env.hc_host_exec_capture`; otherwise the host-side `NativeSymbol` registration from B1 won't bind.

**Acceptance:** linking `hclang.wasm` with B1 host symbols registered does not fail with "import not found" at WAMR load time.

### Step B3 — Wire WASI unix primitives through the host functions

Replace the WASI guard bodies in the relevant functions in `wasm_runtime_bridge.cpp`:

**`prString_System_Wasm`** (`#else` / WASI path):
```cpp
#else // SC_WASM_WASI
    int rc = hc_host_exec(command.c_str(), (int)command.size());
    SetInt(a, rc);
    return errNone;
#endif
```

**`prString_UnixCmdGetStdOut_Wasm`** (`#else` / WASI path):
```cpp
#else // SC_WASM_WASI
    static char s_capture_buf[65536];
    int n = hc_host_exec_capture(command.c_str(), (int)command.size(),
                                  s_capture_buf, (int)sizeof(s_capture_buf));
    if (n < 0) return errFailed;
    // Trim trailing newline (Pipe.callSync strips it on desktop too)
    while (n > 0 && (s_capture_buf[n-1] == '\n' || s_capture_buf[n-1] == '\r'))
        --n;
    return setSlotString(g, callerSlot, std::string(s_capture_buf, n));
#endif
```

**`prPipeOpen_Wasm`** (new, WASI path — see A1 for the buffer design):
The WASI path calls `hc_host_exec_capture` and buffers the result, exactly as the
Emscripten path calls `runCommandCapture`. The pipe buffer table (`g_pipe_buffers`) is
shared between both paths since it lives in WASM linear memory.

**`prArray_UnixCmdGetStdOut_Wasm`** and **`prArray_POpen_Wasm`** follow the same pattern:
join the args array with spaces (or use the argv variant), call `hc_host_exec_capture`.

**Tasks:**

- [ ] Replace the WASI `#else` body of `prString_System_Wasm` in `src/lang/core/wasm_runtime_bridge.cpp` to call `hc_host_exec(command.c_str(), (int)command.size())` and `SetInt(a, rc)`.
- [ ] Replace the WASI `#else` body of `prString_UnixCmdGetStdOut_Wasm` to call `hc_host_exec_capture` into a 64 KB static buffer; trim trailing `\n` / `\r`; return via `setSlotString`.
- [ ] Implement the WASI path of `prPipeOpen_Wasm` (the same one created in A1) by capturing into a `WasmPipeBuffer` slot from `hc_host_exec_capture`. The slot table is shared with the Emscripten path.
- [ ] Implement WASI paths of `prArray_UnixCmdGetStdOut_Wasm` and `prArray_POpen_Wasm`: join argv with spaces (or shell-quote each token if you want to be careful about whitespace) and reuse `hc_host_exec_capture`.
- [ ] Remove the now-unused `failUnixBridgeUnavailable()` returns from these specific functions on the WASI path. Leave it in place for primitives still unimplemented (e.g. async pipe variants).

**Acceptance:** `Pipe.callSync("echo from-wasi", "r")` returns `["from-wasi"]` from `hclang_native --script -`.

### Step B4 — WASI pre-open for the quarks directory

Add a `--quarks-dir` option to the `CLI::App` in `native/hclang_host/main.cpp`:

```cpp
std::string quarks_dir;
app.add_option("--quarks-dir,-q", opts.quarks_dir,
               "Host path to persist downloaded quarks (pre-opened into WASI sandbox)");
```

In the pre-open registration block (step 3.5, after `load` and before `instantiate`):
```cpp
if (!opts.quarks_dir.empty()) {
    // SC resolves Quarks.folder to Platform.userAppSupportDir/downloaded-quarks.
    // The WASI guest path must match what wasm_runtime_bridge.cpp returns for
    // Platform.userAppSupportDir on WASI (currently "/home/user/.local/share/SuperCollider").
    g_wasm_host.add_wasi_dir(opts.quarks_dir,
        "/home/user/.local/share/SuperCollider/downloaded-quarks");
}
```

Create the host directory if it does not exist:
```cpp
if (!opts.quarks_dir.empty()) {
    std::filesystem::create_directories(opts.quarks_dir);
    // ... then add_wasi_dir
}
```

Verify the guest path against `Platform.userAppSupportDir` in `wasm_runtime_bridge.cpp`.
If `SC_Filesystem::instance().getDirectory(DirName::UserAppSupport)` returns a different
path on WASI, update the guest path to match.

**Tasks:**

- [ ] Add `quarks_dir` to the `Options` struct and `app.add_option("--quarks-dir,-q", ...)` in the CLI11 block at `native/hclang_host/main.cpp:810-831`.
- [ ] Before `g_wasm_host.instantiate(...)` at `native/hclang_host/main.cpp:1074`, if `--quarks-dir` is set, `std::filesystem::create_directories(opts.quarks_dir)` then `g_wasm_host.add_wasi_dir(opts.quarks_dir, "/home/user/.local/share/SuperCollider/downloaded-quarks")` (mirror the existing `add_wasi_dir` call site at line 1059).
- [ ] Verify the guest path matches `Platform.userAppSupportDir` on the WASI build path. If `SC_Filesystem` returns something else, update either side so they agree.
- [ ] Wire `--quarks-dir` into the `hc_wasm_quarks_available` primitive (Shared follow-up): treat its presence at startup as the "WAMR has quarks support" signal.
- [ ] Update `--help` text to document the flag.

**Acceptance:** TB-3 passes — a class file dropped under `--quarks-dir` is callable from the script. TB-6 passes — `Quarks.supported` returns `true` only when this flag is present.

### Step B5 — `--extra-class-path` for pre-staged quarks

Add a repeatable `--extra-class-path` option (parallel to Track A):

```cpp
std::vector<std::string> extra_class_paths;
app.add_option("--extra-class-path", extra_class_paths,
               "Additional SC class library directories (host paths, pre-opened)");
```

For each entry, call `add_wasi_dir(hostPath, guestPath)` before `instantiate`, then
after boot-sequence expose them to `LanguageConfig` via `hc_wasm_eval_add_include_path`
(same exported function as Track A Step A3).

**Tasks:**

- [ ] Add `extra_class_paths: std::vector<std::string>` to the `Options` struct and `app.add_option("--extra-class-path", ...)` (repeatable) in the CLI11 block at `native/hclang_host/main.cpp:810-831`.
- [ ] For each entry, before `instantiate()` at line 1074: pick a stable guest path (e.g. `/extra-class-lib/<basename>`), call `g_wasm_host.add_wasi_dir(hostPath, guestPath)`.
- [ ] After `hc_wasm_eval_init` and before `hc_wasm_eval_boot_sequence`, call `hc_wasm_eval_add_include_path(guestPath)` for each entry — same exported symbol as Track A Step A3.
- [ ] Document the flag in `--help`. Note in docs that paths must exist on the host before launch (no auto-create, unlike `--quarks-dir`).

**Acceptance:** TB-7 passes — a class staged in `--extra-class-path` is callable from `hclang_native`.

### Known limitations (WAMR track)

- `git` must be installed on the host system and on `PATH`. There is no fallback.
- No network access from within the WASI sandbox. `git clone`/`git fetch` run on the
  host side via `hc_host_exec`, so outbound TCP works only if the host has git and
  network access.
- `hc_host_exec_capture` uses a fixed 64 KB static buffer. Large git operation outputs
  (e.g. `git for-each-ref` on a repo with many tags) will be truncated. Increase the
  buffer or make it dynamic if needed.
- `thisProcess.recompile` is not supported; quark activation requires restart.
- Quarks with native extension builds will fail at the extension-load step.

---

## Shared follow-up (both CLI tracks)

### `String#include` / `String#exclude` WASM guard

`src/class_library/Common/Collections/String.sc` (line 457) calls `Quarks.install(this)`
from `String#include`. On a WASM build where git is unavailable (WAMR without
`--quarks-dir`), this throws a runtime error rather than a clean message. The guard
checks `Quarks.supported` (see `QUARKS_BROWSER_PLAN.md` Step C6) rather than
blanket-disabling quarks on all WASM platforms:

```supercollider
include {
    if(thisProcess.platform.name == \wasm, {
        // Quarks.supported returns true only when the runtime has been configured
        // for quark operations (proxy URL in browser; --quarks-dir + git on PATH in WAMR).
        if(Quarks.supported.not, {
            ("hclang: Quarks are not supported in this environment. " ++
             "WAMR CLI: pass --quarks-dir and ensure git is on PATH. " ++
             "Browser: set window.__hclang_git_proxy. " ++
             "See docs/QUARKS_CLI_PLAN.md").postln;
            ^this
        });
    });
    if(Quarks.isInstalled(this).not) {
        Quarks.install(this);
        "... the class library may have to be recompiled.".postln;
    }
}
```

This resolves the open Task 9 follow-up: `String.sc` needs WASM-safe
patching before `Quarks/` can be excluded from the class library if desired.

**Tasks:**

- [ ] Add the `*supported` class method to `src/class_library/Common/Quarks/Quarks.sc` returning `true` on desktop and dispatching to `_HcWasmQuarksAvailable` on `\wasm` platform.
- [ ] Patch `src/class_library/Common/Collections/String.sc:455-461` with the guard above; keep the existing `Quarks.install` call inside the `Quarks.supported` branch so desktop behaviour is unchanged.
- [ ] Add the `_HcWasmQuarksAvailable` primitive: declare in `engine/HC_Wasm_Eval.h`, implement in `engine/HC_Wasm_Eval.cpp`, register in `wasm_runtime_bridge.cpp`. Browser path delegates to JS helper `hclang_quarks_available()`; WAMR path returns true iff `--quarks-dir` was registered (set a static flag from main.cpp at pre-open time and read it here).
- [ ] Verify the guard prints (and only prints — does not throw) the "not supported" message in TA-5 / TB-5 scenarios.

### `hc_wasm_eval_add_include_path` export (both tracks)

Add to `engine/HC_Wasm_Eval.h`:
```cpp
/** Add a path to the SC class library search list.
 *  Must be called after hc_wasm_eval_init() and before hc_wasm_eval_boot_sequence(). */
void hc_wasm_eval_add_include_path(const char* path);
```

Implement in `engine/HC_Wasm_Eval.cpp` by calling
`LanguageConfig::instance().addIncludePath(path)`.

**Tasks:**

- [ ] Declare `void hc_wasm_eval_add_include_path(const char* path);` in `engine/HC_Wasm_Eval.h` after line 71 (alongside `hc_wasm_eval_boot_sequence`).
- [ ] Implement in `engine/HC_Wasm_Eval.cpp` with the body `LanguageConfig::instance().addIncludePath(path);`. Document precondition: must be called after `hc_wasm_eval_init` and before `hc_wasm_eval_boot_sequence`.
- [ ] Verify the symbol is exported to JS in the Emscripten build (it must appear in `EXPORTED_FUNCTIONS` or be reachable via `EXPORTED_RUNTIME_METHODS`/`cwrap`).
- [ ] Verify the symbol is reachable from the WAMR host: either as a regular wasm export (preferred) or via `wasm_runtime_lookup_function` from `main.cpp`.

**Acceptance:** TS-1 passes — calling the symbol before boot causes class files in the registered path to be compiled in.

---

## Testing

All tests below should be automated in CI and runnable locally with a single recipe
(`just test-quarks` or equivalent). Each test is labelled with the track it applies to.

### Test checklist

Tick each test as it lands green in CI. Keep the per-test details below as the source of
truth for the scenario; this list is the dashboard.

- [ ] **TA-1** Pipe primitive round-trip (`Pipe.callSync("echo hello", "r")`)
- [ ] **TA-2** NODEFS quarks-directory persistence across restarts
- [ ] **TA-3** `--extra-class-path` compiles a pre-staged quark
- [ ] **TA-4** `Quarks.supported` returns `true` on Node.js
- [ ] **TA-5** `String#include` guard prints message when unsupported (runs against WAMR binary)
- [ ] **TB-1** `hc_host_exec` fires a host-side command
- [ ] **TB-2** `hc_host_exec_capture` captures stdout
- [ ] **TB-3** `--quarks-dir` pre-open exposes host directory
- [ ] **TB-4** `Quarks.install` clones into `--quarks-dir` (skipped when `git` not on PATH)
- [ ] **TB-5** `Quarks.supported` is `false` without `--quarks-dir`
- [ ] **TB-6** `Quarks.supported` is `true` with `--quarks-dir`
- [ ] **TB-7** `--extra-class-path` for WAMR
- [ ] **TS-1** `hc_wasm_eval_add_include_path` integration
- [ ] **TS-2** `Quarks.supported` matrix (TA-4 + TB-5 + TB-6 together)
- [ ] **TS-3** `String#include` guard does not regress on desktop sclang
- [ ] **TS-4** Large `hc_host_exec_capture` output is truncated, not overflowed
- [ ] **CI wiring** — `just test-quarks` runs the full matrix locally; `native-host.yml` runs it on `ubuntu-latest` and `macos-14`

### Track A (Node.js) tests

#### TA-1 — Pipe primitive round-trip

**Goal**: `_PipeOpen` / `_File_GetLine` / `_PipeClose` work end-to-end for a trivial
command.

**Setup**: a small SC script that calls `Pipe.callSync` with a known command (`echo hello`).

```bash
node cli/hclang.js --script - <<'SC'
var p = Pipe.callSync("echo hello", "r");
p[0].postln;
SC
```

**Expected stdout**: `hello`

**What it covers**: `prPipeOpen_Wasm`, `prFile_GetLine_Wasm`, `prPipeClose_Wasm`, and
the `runCommandCapture` path through the Node.js unix bridge.

#### TA-2 — NODEFS quarks directory persistence

**Goal**: a quark cloned in one process is visible in the next process without
re-cloning.

**Setup**: a real or mock quark directory on disk (a bare git repo with a `quark.yaml`).

```bash
HOST_DIR=$(mktemp -d)
git init --bare "$HOST_DIR/TestQuark.git"
# ... populate with minimal quark structure ...

# First run: install
node cli/hclang.js --script - <<SC
Quarks.install("file://$HOST_DIR/TestQuark.git");
SC

# Second run: verify installed without re-cloning
node cli/hclang.js --script - <<'SC'
Quarks.isInstalled("TestQuark").postln;
SC
```

**Expected stdout** (second run): `true`

**What it covers**: the NODEFS mount in `mountQuarksDir`, persistence across process
restarts, and `Quarks.isInstalled` on the Emscripten path.

#### TA-3 — `--extra-class-path` compiles pre-staged quark

**Goal**: a quark directory supplied via `--extra-class-path` is compiled into the class
library and its classes are accessible.

**Setup**: create a minimal quark directory with a single `.sc` file defining a new class
`TestExtraClass`.

```bash
QUARK_DIR=$(mktemp -d)
cat > "$QUARK_DIR/TestExtraClass.sc" <<'SC'
TestExtraClass { *hello { ^"hello from extra class" } }
SC

node cli/hclang.js --extra-class-path "$QUARK_DIR" --script - <<'SC'
TestExtraClass.hello.postln;
SC
```

**Expected stdout**: `hello from extra class`

**What it covers**: the `--extra-class-path` flag, `hc_wasm_eval_add_include_path`, and
NODEFS mounting of an arbitrary host directory.

#### TA-4 — `Quarks.supported` returns `true` on Node.js

```bash
node cli/hclang.js --script - <<'SC'
Quarks.supported.postln;
SC
```

**Expected stdout**: `true`

**What it covers**: `hc_wasm_quarks_available` primitive returns `1` when the unix
bridge is present (Node.js path always has it).

#### TA-5 — `String#include` guard prints message when unsupported

**Goal**: on the WASI/WAMR path, calling `"SomeMissingQuark".include` prints the
"not supported" message instead of crashing.

*This test runs against the WAMR binary, not the Node.js CLI.*

```bash
./build/native/hclang_host/hclang_native --script - <<'SC'
"SomeMissingQuark".include;
SC
```

**Expected**: stdout contains `Quarks are not supported in this environment`, process
exits 0.

**What it covers**: the `Quarks.supported.not` guard in `String#include`, `hc_wasm_quarks_available`
returning `0` on WAMR when `--quarks-dir` is absent.

---

### Track B (WAMR) tests

#### TB-1 — `hc_host_exec` fires a host-side command

**Goal**: `_String_System` in the WAMR path executes a command on the host and returns
its exit code.

```bash
./build/native/hclang_host/hclang_native --script - <<'SC'
var rc = "true".systemCmd;   // shell true(1) exits 0
rc.postln;
SC
```

**Expected stdout**: `0`

**What it covers**: `hc_host_exec_impl` in `main.cpp`, the WASI path of
`prString_System_Wasm`, and the NativeSymbol registration.

#### TB-2 — `hc_host_exec_capture` captures stdout

**Goal**: `_String_UnixCmdGetStdOut` in the WAMR path captures command output.

```bash
./build/native/hclang_host/hclang_native --script - <<'SC'
"echo capture-test".unixCmdGetStdOut.postln;
SC
```

**Expected stdout**: `capture-test`

**What it covers**: `hc_host_exec_capture_impl`, the WASI path of
`prString_UnixCmdGetStdOut_Wasm`, and the 64 KB capture buffer.

#### TB-3 — `--quarks-dir` pre-open exposes host directory

**Goal**: a quark staged in `--quarks-dir` is visible to SC's `Quarks.folder` path.

```bash
QUARKS_HOST=$(mktemp -d)
mkdir -p "$QUARKS_HOST/TestQuark"
cat > "$QUARKS_HOST/TestQuark/TestQuark.sc" <<'SC'
TestQuark { *ping { ^\pong } }
SC

./build/native/hclang_host/hclang_native \
    --quarks-dir "$QUARKS_HOST" \
    --script - <<'SC'
TestQuark.ping.postln;
SC
```

**Expected stdout**: `pong`

**What it covers**: the WASI pre-open for the quarks directory, the guest-path mapping
to `/home/user/.local/share/SuperCollider/downloaded-quarks`, and
`LanguageConfig`'s inclusion of `Quarks.folder` in the class search path.

#### TB-4 — `Quarks.install` with git on PATH clones into `--quarks-dir`

**Goal**: `Quarks.install("file://...")` calls through to `git clone` on the host and
deposits the clone in the pre-opened quarks directory.

**Prerequisite**: `git` is on `PATH` (skip in CI environments where it is not).

```bash
QUARKS_HOST=$(mktemp -d)
REPO=$(mktemp -d)
git init "$REPO"
git -C "$REPO" commit --allow-empty -m 'init'

./build/native/hclang_host/hclang_native \
    --quarks-dir "$QUARKS_HOST" \
    --script - <<SC
Quarks.install("file://$REPO");
SC

# Verify git cloned into the host directory
ls "$QUARKS_HOST"
```

**Expected**: the cloned directory appears under `$QUARKS_HOST`.

**What it covers**: `hc_host_exec_impl` running `git clone`, the WASI pre-open, and the
round-trip from `Quarks.install` → `Git.clone` → `hc_host_exec`.

#### TB-5 — `Quarks.supported` is `false` without `--quarks-dir`

```bash
./build/native/hclang_host/hclang_native --script - <<'SC'
Quarks.supported.postln;
SC
```

**Expected stdout**: `false`

#### TB-6 — `Quarks.supported` is `true` with `--quarks-dir`

```bash
QUARKS_HOST=$(mktemp -d)
./build/native/hclang_host/hclang_native \
    --quarks-dir "$QUARKS_HOST" \
    --script - <<'SC'
Quarks.supported.postln;
SC
```

**Expected stdout**: `true`

**What it covers** (TB-5 + TB-6): `hc_wasm_quarks_available` WASI primitive toggling on
the presence of the quarks pre-open.

#### TB-7 — `--extra-class-path` compiles a pre-staged quark (WAMR)

Same scenario as TA-3 but run against `hclang_native`:

```bash
QUARK_DIR=$(mktemp -d)
cat > "$QUARK_DIR/TestExtraClass.sc" <<'SC'
TestExtraClass { *hello { ^"hello from extra class" } }
SC

./build/native/hclang_host/hclang_native \
    --extra-class-path "$QUARK_DIR" \
    --script - <<'SC'
TestExtraClass.hello.postln;
SC
```

**Expected stdout**: `hello from extra class`

**What it covers**: the WAMR `--extra-class-path` flag, `add_wasi_dir` for the extra
path, and `hc_wasm_eval_add_include_path`.

---

### Shared tests (both tracks)

#### TS-1 — `hc_wasm_eval_add_include_path` is called before boot

**Goal**: calling `hc_wasm_eval_add_include_path` with a path after `hc_wasm_eval_init`
but before `hc_wasm_eval_boot_sequence` makes the path visible to the class library
compiler.

This is an integration test exercised transitively by TA-3 and TB-7. Add a unit-level
check in `tests/` that constructs the module, sets an include path pointing at a test
fixture directory, boots, and asserts the fixture class is defined.

#### TS-2 — `Quarks.supported` is consistent with actual capability

**Goal**: `Quarks.supported` returns `true` if and only if the environment can actually
complete a `Quarks.install` call.

Run TA-4 (Node.js, expects `true`) and TB-5/TB-6 (WAMR, expects `false`/`true`
respectively) as a matrix. CI should run all three.

#### TS-3 — `String#include` guard does not regress on desktop

Run the guard test on the standard desktop `sclang` (if available in CI) and assert
that `Quarks.supported` returns `true` and the guard does not block the install.

#### TS-4 — Large `hc_host_exec_capture` output is handled gracefully (WAMR)

**Goal**: a command producing output larger than the 64 KB static buffer does not
corrupt memory — the output is truncated rather than overflowing.

```bash
./build/native/hclang_host/hclang_native --script - <<'SC'
// Generate a string longer than 64 KB via the unix bridge.
var out = "python3 -c 'print(\"x\" * 100000)'".unixCmdGetStdOut;
out.size.postln;
SC
```

**Expected**: `size` is ≤ 65535; process does not crash.

**What it covers**: the truncation guard (`while (total < out_len - 1)`) in
`hc_host_exec_capture_impl`.

---

### Running the tests

Add a `just test-quarks` recipe that runs all of the above in sequence and reports
pass/fail. Tests that require `git` on `PATH` should be skipped gracefully with a
`command -v git` check. CI should run this suite on both `ubuntu-latest` and
`macos-14` (arm64) in the `native-host.yml` workflow alongside the existing smoke tests.
