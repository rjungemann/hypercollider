# `src/` Cleanup Plan — Removing Non-WASM Platform Code

HyperCollider is WASM-only (browser + Node via Emscripten). The README is
explicit: *"Native desktop targets (scide, supernova, Bela, Raspberry Pi)
have been removed."* But large amounts of upstream SuperCollider platform
code still live in `src/`: iPhone/iOS guards, X11 UI UGens, Win32 link
branches, Supernova plugin duplicates, SC_IDE detection, `scide_`
filesystem-platform strings, and so on. None of these compile in the WASM
build, but they make the source noisy, confuse search, and slow down
porting work.

This plan inventories the dead code by category, lists the concrete
files/lines, and proposes a safe removal order. Do **not** touch anything
under `src/server/plugins_sc3/` (vendored sc3-plugins / Faust headers) or
`src/external/` (CPM-managed third-party) as part of this cleanup — those
are upstream and the platform branches inside them are harmless ballast.

---

## Phase 1 — iPhone / iOS removal

The `SC_IPHONE` and `IPHONE_VEC` defines are never set in our build. Every
iOS-only file or branch is unreachable.

### 1.1 — Delete iOS-only files

- [src/server/plugins/iPhoneUGens.mm](src/server/plugins/iPhoneUGens.mm) —
  iOS-specific UGens (accelerometer etc.). Not referenced by any
  `CMakeLists.txt` we ship; safe to delete the whole file.
- [src/common/vfp11.h](src/common/vfp11.h) — 266 lines of VFP/NEON
  intrinsics for ARM. Header is not included anywhere (verify with `grep
  -rn 'vfp11' src/` — only self-references). Delete.

### 1.2 — Strip `SC_IPHONE` / `IPHONE_VEC` ifdef branches

In each file, the `#ifdef SC_IPHONE` / `#if defined(SC_IPHONE)` branch
is dead. Remove the dead arm and the surrounding preprocessor scaffolding.

- [src/server/core/SC_CoreAudio.h:36](src/server/core/SC_CoreAudio.h#L36) —
  `SC_AUDIO_API_COREAUDIOIPHONE` constant.
- [src/server/core/SC_CoreAudio.h:41-42](src/server/core/SC_CoreAudio.h#L41-L42),
  [:60](src/server/core/SC_CoreAudio.h#L60),
  [:272-303](src/server/core/SC_CoreAudio.h#L272-L303) — iPhone API
  blocks.
- [src/server/plugins/fft_ugens.cpp:26](src/server/plugins/fft_ugens.cpp#L26),
  [:306](src/server/plugins/fft_ugens.cpp#L306) — `!defined(SC_IPHONE)`
  guards (just drop the guard, keep the code).
- [src/server/plugins/io_ugens.cpp:24](src/server/plugins/io_ugens.cpp#L24),
  [:807](src/server/plugins/io_ugens.cpp#L807),
  [:1398](src/server/plugins/io_ugens.cpp#L1398),
  [:1535](src/server/plugins/io_ugens.cpp#L1535) — `SC_IPHONE` and
  `IPHONE_VEC` blocks (the latter is a vfp11.h fast path).
- [src/lang/primitives/unix_prim.cpp:152](src/lang/primitives/unix_prim.cpp#L152),
  [:171](src/lang/primitives/unix_prim.cpp#L171) — `SC_IPHONE` branches.
- [src/lang/primitives/osc_data.cpp:1454](src/lang/primitives/osc_data.cpp#L1454),
  [:1613](src/lang/primitives/osc_data.cpp#L1613),
  [:1637](src/lang/primitives/osc_data.cpp#L1637) — shared-memory-server
  iOS warning + guards.
- [src/lang/primitives/file_prim.cpp:61-64](src/lang/primitives/file_prim.cpp#L61-L64),
  [:1397](src/lang/primitives/file_prim.cpp#L1397) — `defined(__APPLE__)
  || defined(SC_IPHONE)` blocks.
- [src/include/common/clz.h:79](src/include/common/clz.h#L79) — iPhone
  `__builtin_clz` fallback (the WASM/clang path already covers this).

### 1.3 — Remove `"iphone"` from the `SC_Filesystem` platform name list

[src/common/filesystem.hpp:153](src/common/filesystem.hpp#L153),
[:239](src/common/filesystem.hpp#L239) and
[src/common/filesystem_wasm.cpp:47](src/common/filesystem_wasm.cpp#L47)
treat `"iphone"` as a known platform string. Drop it from the list and
update the comment ("one of windows, osx, linux, iphone" → just the
platforms we still recognise).

### 1.4 — Verify by build

After 1.1–1.3, do a full `cmake --build build --target hcsynth hclang`
and run `bench/run_bench.sh` to confirm no behaviour change.

---

## Phase 2 — Supernova removal

Supernova (the multi-threaded server) is on the README's removed list, but
[src/server/plugins/CMakeLists.txt](src/server/plugins/CMakeLists.txt)
still defines `_supernova` variants of every plugin behind
`if(SUPERNOVA)`. The `SUPERNOVA` option is never set, so this is
unreachable build logic.

### 2.1 — Delete Supernova branches in CMake

[src/server/plugins/CMakeLists.txt:140-202](src/server/plugins/CMakeLists.txt#L140-L202)
— the entire `if(SUPERNOVA) ... endif()` block (duplicates each plugin as
`<name>_supernova`).

[src/server/plugins/CMakeLists.txt:225-232](src/server/plugins/CMakeLists.txt#L225-L232) —
the `foreach(plugin ${supernova_plugins}) target_compile_definitions(...
SUPERNOVA)` loop.

[src/server/plugins/CMakeLists.txt:283-291](src/server/plugins/CMakeLists.txt#L283-L291) —
Win32 install logic for supernova plugins.

After removal, `${supernova_plugins}` is always empty; either keep the
empty list as a no-op or grep & remove every reference to it.

### 2.2 — Verify there is no `SUPERNOVA` C++ usage

Run `grep -rn 'defined(SUPERNOVA)\|#ifdef SUPERNOVA' src/` and confirm
zero hits in our code (only in `src/server/plugins_sc3/`, which we leave
alone).

---

## Phase 3 — UI UGens / X11 / Mac UI removal

`UIUGens` are desktop-only (Mac AppKit or Linux X11). The runtime already
prints *"WASM: UIUGens are disabled"*
([src/server/core/SC_Lib_Cintf.cpp:215](src/server/core/SC_Lib_Cintf.cpp#L215)),
but the source files and CMake plumbing are still here.

### 3.1 — Delete UI UGen sources

- [src/server/plugins/UIUGens.mm](src/server/plugins/UIUGens.mm) — Mac
  AppKit version.
- [src/server/plugins/ui_ugens.cpp](src/server/plugins/ui_ugens.cpp) —
  Win32/X11 stub version.

### 3.2 — Remove `UIUGens` build logic

[src/server/plugins/CMakeLists.txt:64-74](src/server/plugins/CMakeLists.txt#L64-L74)
— `if(NOT NO_X11)` branch defining `UIUGens` and adding it to `plugins`.

[src/server/plugins/CMakeLists.txt:240-258](src/server/plugins/CMakeLists.txt#L240-L258)
— the second `if(NOT NO_X11)` block linking X11 / AppKit frameworks.

### 3.3 — Remove `UIUGens_Unload` references

[src/server/core/SC_Lib_Cintf.cpp:139](src/server/core/SC_Lib_Cintf.cpp#L139),
[:146](src/server/core/SC_Lib_Cintf.cpp#L146),
[:215](src/server/core/SC_Lib_Cintf.cpp#L215) — `extern void
UIUGens_Unload`, the call, and the WASM-only `scprintf` warning. Once
the plugin is gone the unload symbol cannot exist; delete all three
sites.

---

## Phase 4 — SC_IDE / `scide_` artefacts

`SC_IDE` was the Qt IDE; never built here.

### 4.1 — Remove `SC_IDE` CMake branches

[src/server/plugins/CMakeLists.txt:273-281](src/server/plugins/CMakeLists.txt#L273-L281)
— `if(SC_IDE) ... endif()` Win32 install hook.

### 4.2 — Remove `scide_` platform-string special case

[src/common/filesystem.hpp:152](src/common/filesystem.hpp#L152),
[:234](src/common/filesystem.hpp#L234) — the
`s.substr(0,6)=="scide_"` check used to filter platform-specific class
files for the IDE. With no IDE, the whole branch (and the surrounding
`getIdeName()` machinery) is dead.

### 4.3 — Audit `getIdeName()` callers

Two callers:
- [src/common/filesystem.hpp:180](src/common/filesystem.hpp#L180) —
  accessor.
- [src/lang/primitives/platform_prim.cpp:86](src/lang/primitives/platform_prim.cpp#L86) —
  `_Platform_ideName` primitive; returned to sclang as `Platform.ideName`.

`Platform.ideName` is part of the upstream class library API — verify by
grepping the class library before removing. If the class library still
references it, keep the primitive but hard-code it to a constant string
(e.g. `"hypercollider"`) and drop the per-instance `mIdeName` field.

---

## Phase 5 — Win32 / Linux desktop CMake branches

These never fire under Emscripten, but they make the build files harder
to read.

- [src/server/plugins/CMakeLists.txt:209-213](src/server/plugins/CMakeLists.txt#L209-L213)
  — `if(WIN32) target_link_libraries(... wsock32 ws2_32)`.
- [src/server/plugins/CMakeLists.txt:235-238](src/server/plugins/CMakeLists.txt#L235-L238)
  — second WIN32 link block for supernova plugins.
- [src/server/plugins/CMakeLists.txt:260-300](src/server/plugins/CMakeLists.txt#L260-L300)
  — `if (WIN32) ... elseif(APPLE) ...` install/copy block (also covers
  scappauxresourcesdir).
- [src/server/plugins/CMakeLists.txt:14-26](src/server/plugins/CMakeLists.txt#L14-L26)
  — large-file-support `getconf LFS_CFLAGS` shell-out. `getconf` does
  not exist in the Emscripten toolchain path; this block is either a
  no-op or runs against the host `getconf`. Remove.
- [src/server/plugins/CMakeLists.txt:1-5](src/server/plugins/CMakeLists.txt#L1-L5)
  — `find_package(Sndfile)`. We force `NO_LIBSNDFILE` on at the top
  level ([CMakeLists.txt](CMakeLists.txt)), so the `if(NOT
  NO_LIBSNDFILE)` branch is unreachable. Remove the branch and the
  associated `DiskIO_UGens` build (we already build a WASM-specific
  `SC_Wasm_DiskIOBackend` in `src/server/core/`).

---

## Phase 6 — Boost residue

Recent commit *"Remove boost"* (4253fad) deleted vendored boost, but the
top-level CMake still injects boost defines:

[CMakeLists.txt:91-93](CMakeLists.txt#L91-L93) —
`-DBOOST_ASIO_DISABLE_VISIBILITY -DBOOST_DISABLE_EXPLICIT_SYMBOL_VISIBILITY
-DBOOST_CHRONO_HEADER_ONLY -DBOOST_CONFIG_SUPPRESS_OUTDATED_MESSAGE`. If
no source includes boost any more, drop these.

Verify with: `grep -rn '#include.*boost/' src/ | grep -v plugins_sc3 |
grep -v external`.

The comment two lines above (*"bundled boost is set up in
external/CMakeLists.txt"*) is stale and should also go.

---

## Phase 7 — Lang/server stubs that no longer protect anything

- [src/lang/core/wasm_stubs.h](src/lang/core/wasm_stubs.h) —
  `SC_LanguageClient` forward declaration + `createLanguageClient` /
  `destroyLanguageClient` no-ops. The corresponding caller in
  [src/lang/core/cmd_line_funcs.cpp:21-25](src/lang/core/cmd_line_funcs.cpp#L21-L25)
  could be inlined or removed. Verify whether the stubs are load-bearing
  for any sclang command-line entry points (they may be needed for the
  CLI's `sc_wasm_eval` startup); if so, keep but rename to
  `wasm_lang_client_shim.h` for clarity.
- [src/lang/core/wasm_platform.cpp:53](src/lang/core/wasm_platform.cpp#L53),
  [:85](src/lang/core/wasm_platform.cpp#L85) — TODO comments referencing
  Phase 8 work that has already shipped (per
  `WASM_POST_LAUNCH_ENHANCEMENTS.md`). Either implement and drop the
  TODO, or remove the TODO if behaviour is now correct.

---

## Phase 8 — Documentation / comment hygiene

Cleanup that is easy to do alongside the code changes above:

- [src/server/plugins/ui_ugens.cpp:21](src/server/plugins/ui_ugens.cpp#L21)
  — *"this version for windows and linux. for mac see UIUGens.mm"* —
  removed by Phase 3.
- [src/server/core/SC_Lib_Cintf.cpp:78](src/server/core/SC_Lib_Cintf.cpp#L78),
  [:509](src/server/core/SC_Lib_Cintf.cpp#L509) — `.so` deprecation
  warnings refer to plugin loading; verify this code path is actually
  reachable in the static-plugins WASM build (`STATIC_PLUGINS=1` is set
  globally). If not, remove dead branch.
- Comment sweep: `grep -rn 'TODO.*Phase\|TODO.*WASM' src/` and reconcile
  against the post-launch doc — many TODOs predate work that has shipped.

---

## What we are *not* touching

- `src/server/plugins_sc3/` — vendored sc3-plugins. Its Faust headers
  reference iOS/Android audio backends; leave as-is.
- `src/external/` — CPM-managed third-party (TLSF was just restored in
  commit 7aa29ff, do not "clean up").
- `src/include/plugin_interface/` — SC plugin ABI; downstream UGens may
  still rely on the existing macros.
- Anything that touches `Platform.ideName` or `Platform.platformName`
  without first auditing class-library usage.

---

## Suggested execution order

1. Phase 1 (iPhone) — biggest, most contained, highest signal/noise.
2. Phase 2 (Supernova) — purely CMake, easy to verify.
3. Phase 3 (UIUGens) — trims source files + CMake together.
4. Phase 4 (SC_IDE) — needs class-library audit; do once, carefully.
5. Phase 5 (Win32/Linux CMake), Phase 6 (boost defines), Phase 7
   (stubs), Phase 8 (comments) — small, do in any order.

After each phase: `cmake --build build --target hcsynth hclang` plus
`bench/run_bench.sh` and `src/platform/test/run_browser_tests.sh`.
