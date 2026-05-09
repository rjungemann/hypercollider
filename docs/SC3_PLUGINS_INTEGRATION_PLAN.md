# sc3-plugins Source-Tree Integration Plan

**Date:** 2026-05-08
**Status:** Draft
**Scope:** Dissolve `src/server/sc3/` (now `src/server/plugins_sc3/` as of Phase 3a)
from a vendored, self-contained sub-project into a first-class part of
the hypercollider source tree and CMake ecosystem.

**Related history:**
- The sc3-plugins strip-down (completed 2026-05-06) pruned non-WASM plugins.
- The CPM migration (completed 2026-05-08) flagged sc3 external-library
  dedup as deferred — closing it is part of this plan.

**Related reference:**
- [`SC3_PLUGINS_LICENSES.md`](SC3_PLUGINS_LICENSES.md) — license/attribution roll-up to be kept in sync.

---

## Why

The vendored sc3-plugins tree still behaves as if it were a standalone
upstream checkout:

- It declares its own `project(sc3-plugins)` and is added with
  `add_subdirectory(... EXCLUDE_FROM_ALL)` plus an out-of-tree binary dir
  hack (`${CMAKE_BINARY_DIR}/../build/sc3-plugins`,
  [CMakeLists.txt:81](../CMakeLists.txt#L81)).
- It uses `find_package(SuperCollider3)` against a fake
  `SC_PATH=${CMAKE_SOURCE_DIR}` to locate plugin headers
  ([sc3/CMakeLists.txt:36](../src/server/sc3/CMakeLists.txt#L36)).
- It vendors three libraries already (or nearly) deduped at the root:
  `external_libraries/{nova-simd, stk, TLSF-2.4.6}` (~15 MB).
- It carries dead-code branches for paths nobody runs in WASM:
  SUPERNOVA, SYSTEM_STK, OSX_PACKAGE, QUARKS, NOVA_DISK_IO, ccache
  hookup, gcc-4.0 detection, dual install destinations, custom uninstall
  target, CPack DMG packaging.

That posture made sense when the directory was a git submodule. After
the strip plan it is no longer upstream-trackable in any meaningful
way: the plugin set has been pruned, build flags are WASM-specific,
several plugins were patched (`Tartini.cpp` `SC_WASM` guard,
`MCLD_CQ_UGens.cpp.OFF` removed), and the upstream build infrastructure
(`website/`, `quarks/`, `osx_package/`, `_data/`, etc.) was deleted.

Treating the directory as a fully integrated part of the source tree
unlocks:

1. **One CMake project** — easier to reason about, simpler IDE
   navigation, no nested `project()` warnings, single source of truth
   for compile flags.
2. **Shared externals** — STK/nova-simd/TLSF fetched once via CPM and
   reused by both the root build and former sc3 sub-build. Closes the
   CPM-migration follow-ups for sc3-plugins external-library dedup.
3. **Cheaper future plugin cleanup** — dropping or splitting a plugin
   becomes an edit to one CMake list rather than two. Per-tier filtering
   sits next to the built-in `src/server/plugins/` enumeration.
4. **Fewer ghost files** — `cmake_modules/FindFFTW3f.cmake`,
   `FindSTK.cmake`, `FindSuperCollider3.cmake`, `cmake_uninstall.cmake.in`,
   `launch-c.in`, `launch-cxx.in` all go away.

---

## Current state inventory

**Note:** As of Phase 3a (rename), `src/server/sc3/` is now `src/server/plugins_sc3/`.

```
src/server/plugins_sc3/
├── CMakeLists.txt              # thin wrapper (5 lines); see Phase 1
├── assets/                     # 252 KB — STK rawwaves preload list / plugin metadata
├── license.txt                 # GPL v2 project license + per-plugin notices
└── source/
    ├── CMakeLists.txt          # tier filtering + BUILD_PLUGIN macro
    └── 40+ plugin directories  # per-plugin source trees

External dependencies now via CPM (see Phase 2):
- nova-simd: HC_NOVA_SIMD_DIR
- STK: HC_STK_SOURCE_DIR, HC_STK_RAWWAVES_DIR
- TLSF: unused in sc3-plugins (deleted)

Deleted (Phase 3a cleanup):
- cmake_modules/ (FindFFTW3f, FindSTK, FindSuperCollider3, etc.)
- external_libraries/ (TLSF, nova-simd, stk — all moved to CPM or deleted)
- source/local/ (user-local plugin slot; empty and unused)
```

**Hooks into the root build (already wired):**

- [`CMakeLists.txt:80-89`](../CMakeLists.txt#L80) — `add_subdirectory(${SC3_PLUGINS_DIR} ${SC3_PLUGINS_BINARY_DIR} EXCLUDE_FROM_ALL)`. Sets `SC_PATH`, forces `SYSTEM_STK=OFF`, allows duplicate custom targets to dodge the unused `uninstall` collision.
- [`src/server/core/CMakeLists.txt:276`](../src/server/core/CMakeLists.txt#L276) — `--preload-file ${CMAKE_SOURCE_DIR}/src/server/sc3/external_libraries/stk/rawwaves@/stksc/rawwaves`. Couples STK assets to the hcsynth Emscripten link line.
- The combined plugin static library `SC_Wasm_Plugins` is produced inside the sub-build and consumed via `set_property(GLOBAL PROPERTY wasm_plugins_lib SC_Wasm_Plugins)`.

**Vestigial inside the sub-build (all of this can go):**

- `find_package(SuperCollider3)` — looks up SC headers via the dummy `SC_PATH` cache var; replace with direct in-tree include paths.
- `option(SUPERNOVA …)`, `option(NOVA_DISK_IO …)`, `option(QUARKS …)`, `option(OSX_PACKAGE …)`, `option(LADSPA …)`, `option(HOA_UGENS …)`, `option(NATIVE …)`, `option(USE_CCACHE …)`, `option(SYSTEM_STK …)`, `option(IN_PLACE_BUILD …)`, `option(AY …)` — none of them mean anything in the WASM build.
- `add_custom_target(uninstall …)` — duplicate of root's; the `ALLOW_DUPLICATE_CUSTOM_TARGETS` global property is currently swallowing the conflict.
- Per-arch SSE / `-msse2` / `-mfpmath=sse` checks — irrelevant under Emscripten.
- `CPack` block, `README_*.txt.in`, `find_package` for FFTW3f.
- gcc-4.0 detection block (`GET_GCC_VERSION`, gcc 4.0 SSE workaround).
- The `STKSources` list that hand-blacklists Rt/Inet/Socket/Tcp/Udp/Thread/Mutex/Messager STK TUs by file glob — fine, but lives inside `source/CMakeLists.txt`; needs to migrate without losing the exclusion list.

---

## Layout decision

### Recommended: dissolve in place

Keep plugin source files where they are (`src/server/sc3/source/<Plugin>/...`)
but **delete** the sub-project boundary. Rename the directory to
`src/server/sc3plugins/` (or leave as `src/server/sc3/`) and have its
`CMakeLists.txt` be a normal "leaf" included with `add_subdirectory()`
from `src/server/CMakeLists.txt`, no `project()` declaration, no
`EXCLUDE_FROM_ALL`, no fake `SC_PATH`.

Why this over flattening into `src/server/plugins/`:

- The built-in `src/server/plugins/` is a single flat directory of `.cpp`
  files, all under one license/attribution. sc3 plugins each carry
  per-directory authorship and need to keep that structure for
  `SC3_PLUGINS_LICENSES.md` to remain readable.
- Moving 41 directories worth of files generates a noisy diff that
  obscures the actual integration work. Renames can be done in a
  follow-up if desired.
- `local/` remains a meaningful per-user slot.

The rest of this plan assumes the recommended layout. An alternative
"flatten + relocate" path is sketched at the bottom for completeness.

---

## Phase 1 — Replace the sub-project boundary

**Touchpoints:**

1. **`src/server/sc3/CMakeLists.txt`** — strip aggressively:
   - Remove `cmake_minimum_required`, `project(sc3-plugins)` (root already declares both).
   - Remove `find_package(SuperCollider3)` and the `SC_PATH` checks.
   - Delete the `option(...)` block in its entirety.
   - Delete the SSE / `-msse2` compiler-flag detection block (root build sets WASM-appropriate flags).
   - Delete the `add_custom_target(uninstall …)` block.
   - Delete the `find_package`/`configure_file(README_*.in)` block.
   - Delete the `CPack` block.
   - Delete the `add_subdirectory(quarks)` / `add_subdirectory(osx_package)` blocks.
   - Delete `cmake_modules/cmake_uninstall.cmake.in`, `launch-c.in`, `launch-cxx.in`, `FindSuperCollider3.cmake`, `FindSTK.cmake`. Keep `FindFFTW3f.cmake` only if a current consumer still references it; the WASM plugin path uses Green FFT (`SC_FFT_GREEN=1`) so this can almost certainly go too — verify with `grep -rn FindFFTW3f src/server/sc3/`.
   - Reduce the file to: `add_subdirectory(source)` plus any include/define settings needed by sources.

2. **`src/server/CMakeLists.txt`** — add `add_subdirectory(sc3)` (or whatever the renamed dir is) at the appropriate point.

3. **Root [`CMakeLists.txt`](../CMakeLists.txt)** — remove lines 80-89:
   - Drop `SC3_PLUGINS_DIR`, `SC3_PLUGINS_BINARY_DIR`, `SC_PATH`, the forced-`SYSTEM_STK`, `ALLOW_DUPLICATE_CUSTOM_TARGETS`, the `add_subdirectory(... EXCLUDE_FROM_ALL)`, and the `if(TARGET SC_Wasm_Plugins)` debug message.

4. **`src/server/sc3/source/CMakeLists.txt`** — strip duplicated infra:
   - Remove `GET_GCC_VERSION` and the gcc-4.0 block (already deleted by the strip plan, verify nothing remains).
   - Replace `${SC_PATH}` with `${CMAKE_SOURCE_DIR}` everywhere (or, where it's purely an in-tree include path, use a relative path or a target-scoped `target_include_directories` on `SC_Wasm_Plugins`).
   - Drop the `if (NOVA_SIMD)` wrapper around `include_directories(external_libraries/nova-simd)` — handled by Phase 2.
   - Replace `include_directories(...)` global calls with `target_include_directories(SC_Wasm_Plugins PRIVATE ...)` so include scope follows the target instead of leaking.

**Acceptance:** WASM build configures and produces `hcsynth.wasm` /
`hclang.wasm` byte-identical to pre-integration (modulo build-id
metadata). `cmake --preset wasi_release && cmake --build build/wasi`
clean.

---

## Phase 2 — Dedup external libraries via CPM

This phase resolves the rows that were deferred at the end of the
2026-05 CPM migration: external libraries vendored under sc3 that
duplicate root-level CPM packages.

### 2a — nova-simd

Both copies of nova-simd go away in favour of the CPM-fetched single
copy at `${HC_NOVA_SIMD_DIR}` (already established at
[`src/external/CMakeLists.txt`](../src/external/CMakeLists.txt) per
Phase 3 of the CPM plan).

- Replace `include_directories(external_libraries/nova-simd)` in
  `src/server/sc3/source/CMakeLists.txt` with
  `target_include_directories(SC_Wasm_Plugins PRIVATE ${HC_NOVA_SIMD_DIR})`.
- Delete `src/server/sc3/external_libraries/nova-simd/`.

### 2b — TLSF

The sc3 path doesn't actually link TLSF — the `external_libraries/TLSF-2.4.6/`
copy is a leftover that never made it into a `BUILD_PLUGIN` source
list after the strip pass. Confirm with
`grep -rn TLSF src/server/sc3/source/`. If the grep is empty, simply
delete `src/server/sc3/external_libraries/TLSF-2.4.6/`. Phase 2b of
the CPM plan is then closed by removal, mirroring how Phase 4 (oscpack)
was closed.

### 2c — STK

STK is the bulk of the remaining dedup opportunity (14 MB) and is the
hardest. Two consumers exist:

1. The combined `SC_Wasm_Plugins` library compiles a curated subset of
   `external_libraries/stk/src/*.cpp` (excluding network/thread/Rt
   sources — see
   [`source/CMakeLists.txt:287-301`](../src/server/sc3/source/CMakeLists.txt#L287)).
2. The Emscripten link line preloads
   `external_libraries/stk/rawwaves` into the virtual filesystem at
   `/stksc/rawwaves`
   ([`src/server/core/CMakeLists.txt:276`](../src/server/core/CMakeLists.txt#L276)).

**Approach** (replicates the deferred Phase 6 of the CPM plan, but now
that we own the integration we can do it cleanly):

```cmake
# src/external/CMakeLists.txt — alongside nova-simd
CPMAddPackage(
    NAME stk
    GITHUB_REPOSITORY thestk/stk
    GIT_TAG 4.6.2                 # confirm minor diffs vs vendored 4.6.1
    DOWNLOAD_ONLY YES
)
set(HC_STK_SOURCE_DIR "${stk_SOURCE_DIR}" CACHE INTERNAL "")
set(HC_STK_RAWWAVES_DIR "${stk_SOURCE_DIR}/rawwaves" CACHE INTERNAL "")
```

Then in `src/server/sc3/source/CMakeLists.txt`:

```cmake
file(GLOB STKSources "${HC_STK_SOURCE_DIR}/src/*.cpp")
set(UnneededSTKSources
    "${HC_STK_SOURCE_DIR}/src/Rt*.cpp"
    "${HC_STK_SOURCE_DIR}/src/Inet*.cpp"
    "${HC_STK_SOURCE_DIR}/src/Socket.cpp"
    "${HC_STK_SOURCE_DIR}/src/Tcp*.cpp"
    "${HC_STK_SOURCE_DIR}/src/UdpSocket.cpp"
    "${HC_STK_SOURCE_DIR}/src/Thread.cpp"
    "${HC_STK_SOURCE_DIR}/src/Mutex.cpp"
    "${HC_STK_SOURCE_DIR}/src/Messager.cpp"
)
file(GLOB UnneededExpanded ${UnneededSTKSources})
list(REMOVE_ITEM STKSources ${UnneededExpanded})
```

And `src/server/core/CMakeLists.txt:276` → preload from
`${HC_STK_RAWWAVES_DIR}` instead of the in-tree path.

**Risk:** STK 4.6.2 may have diffs vs the vendored 4.6.1 snapshot. Do a
`diff -ur` between `src/server/sc3/external_libraries/stk/src` and the
CPM-fetched `${HC_STK_SOURCE_DIR}/src` and a `diff -ur` of the
`include/` and `rawwaves/` trees. If non-trivial, pin the CPM tag to
`4.6.1` (or to the exact commit SHA matching the vendored snapshot) to
keep behaviour identical. If the vendored copy contains local patches,
either upstream them or carry a small `.cmake` patch step (CPM's
`PATCHES` argument) — investigate before deleting.

After verification, delete `src/server/sc3/external_libraries/stk/`
(and the now-empty `external_libraries/` directory).

**Acceptance:** STK-backed plugins (`StkUGens`, `StkInst`,
`OteyPianoUGens` indirect) load and produce identical audio in the
node CLI smoke test (`bench/run_bench.sh` ?). Rawwave-loaded
instruments (PluckedString, Mandolin, etc.) work — the rawwave
preload list assets live in `assets/`, not in the STK fetch.

### 2d — Asset preload list

`src/server/sc3/assets/` holds the rawwaves preload manifest used by
`SC_WASM_STK_PRELOAD_RAWWAVES`. Move to
`src/server/sc3/stk_assets/` (renamed for clarity) or to
`src/server/plugins/stk/` next to the new home of any STK-related
build glue. Update the path in `src/server/core/CMakeLists.txt` to
point at the new location.

---

## Phase 3 — Settle the source-tree layout

Two follow-up structural choices are deferable, but worth listing so
the plan covers them:

### 3a — Rename `src/server/sc3/` → `src/server/plugins_sc3/`

Cosmetic; communicates "this is part of the plugin tree" rather than
"this is a bundled SC3 release". Keeps per-directory plugin layout. A
single `git mv` and a search/replace of `src/server/sc3` → new path
across `CMakeLists.txt` files plus docs.

Defer if the rest of the plan is already a large diff.

### 3b — Move `source/` → top level of the renamed directory

`source/CMakeLists.txt` exists for upstream-style "config at top,
plugins under `source/`" layout. After dissolving the project
boundary the `source/` indirection is not pulling its weight. Flatten:

```
src/server/plugins_sc3/
├── CMakeLists.txt              # was source/CMakeLists.txt
├── ATK/
├── AYUGens/
├── ...
├── local/
└── license.txt
```

Defer with 3a.

---

## Phase 4 — Documentation & licensing sync

1. **Update [`SC3_PLUGINS_LICENSES.md`](SC3_PLUGINS_LICENSES.md)**
   - Note that bundled STK now lives at `${HC_STK_SOURCE_DIR}` (CPM, `thestk/stk` `4.6.x`) rather than `src/server/sc3/external_libraries/stk/`.
   - Note that bundled nova-simd now lives at `${HC_NOVA_SIMD_DIR}` (CPM, `timblechmann/nova-simd`).
   - Leave per-plugin attribution unchanged.

2. **Move `src/server/sc3/license.txt` → `licenses/sc3-plugins/license.txt`** (or similar). The earlier strip-down deleted the upstream README, so a top-level, discoverable home for the GPL v2 statement is cleaner than burying it inside a build subdirectory.

---

## Phase 5 — Tighten the plugin-build glue

After Phases 1–2 the `source/CMakeLists.txt` BUILD_PLUGIN machinery
will still look like a simplified upstream copy. Optional follow-up:

- Replace the per-plugin `add_library(${PLUGIN_NAME} STATIC ...)` pattern with a single `target_sources(SC_Wasm_Plugins PRIVATE ...)` per plugin. Saves ~40 dummy CMake targets that exist only to populate `SC_WASM_PLUGIN_SOURCES`.
- Move tier filtering (`SC_WASM_PLUGIN_TIER`) up to
  `src/server/CMakeLists.txt` so it sits next to the built-in plugins
  list, making "which plugins ship?" answerable from one file.
- Delete the `local/` glob at the bottom unless someone is actively using it; it's a hook for upstream out-of-tree plugin development, not relevant to this fork. Confirm with `git log -- src/server/sc3/source/local/` before removing.

These are clean-up opportunities, not blockers — split into a separate
PR after the main integration lands.

---

## Phase ordering (Status: **Phases 1–3 Complete**, 4 Done, 5a Done, 5b/c Deferred)

| Phase | Effort | Risk | Status | Removes |
|---|---|---|---|---|
| 1 — Dissolve sub-project | Medium | Low | ✅ Done | Sub-project boundary, find_package, dead blocks |
| 2a — nova-simd dedup | Small | Low | ✅ Done | 1.1 MB |
| 2b — TLSF dedup | Trivial | Trivial | ✅ Done | 136 KB |
| 2c — STK via CPM | Medium | Medium | ✅ Done | 14 MB |
| 2d — Asset relocation | Small | Low | ✅ Done | — |
| 3a — Rename sc3/ → plugins_sc3/ | Small | Low (mechanical) | ✅ Done | — |
| 3b — Flatten source/ → top level | Small | Low (mechanical) | ✅ Done | One directory layer |
| 4 — Doc sync | Small | None | ✅ Done | — |
| 5a — Delete local/ slot | Trivial | None | ✅ Done | ~500 B |
| 5b — Simplify BUILD_PLUGIN | Medium | Low | ⏸ Deferred | ~40 dummy targets |
| 5c — Move tier filtering | Small | Low | ⏸ Deferred | — |

**Suggested PR split:**

- PR 1 — Phase 1 + Phase 2a + 2b + 2d + Phase 4. No `git mv` churn,
  unblocks the bigger STK migration.
- PR 2 — Phase 2c (STK CPM). Isolated so it can be reverted if STK
  4.6.x diverges in unexpected ways.
- PR 3 — Phases 3 + 5 (rename, flatten, BUILD_PLUGIN cleanup). Pure
  housekeeping.

---

## Risk register

- **STK API drift between 4.6.1 vendored and `thestk/stk` HEAD/4.6.2.**
  Mitigation: pin CPM to the exact commit matching `4.6.1`; bump
  separately once integration lands.
- **Hidden include-path leakage.** The current sub-build relies on
  global `include_directories()` — converting to target-scoped includes
  may surface plugins that secretly depend on a header brought in by
  another plugin's `include_directories`. Mitigation: build with
  `-DCMAKE_VERBOSE_MAKEFILE=ON` and grep for
  `external_libraries` / `nova-simd` / `STK` references after each
  phase.
- **`SC_PATH` references in non-build files.** The strip plan removed
  upstream READMEs; verify nothing in `tools/`, `.github/workflows/`,
  or `Justfile` still passes `SC_PATH=...` to CMake.
- **Asset preload list path.** Get `src/server/core/CMakeLists.txt:276`
  right on the first pass — a wrong path here silently produces a
  binary that loads but fails to find rawwaves at runtime.
- **CPM cache miss in CI.** The new STK fetch adds ~14 MB to the
  first-time CPM cache. CI cache key already keys on
  `**/CMakeLists.txt` (per the CPM plan's CI hint), so the new entry
  is picked up automatically; first build is slower, subsequent
  builds unaffected.

---

## Out of scope

- Replacing GPL-licensed plugins with permissive equivalents — orthogonal.
- Repackaging sc3 plugins as a separate optional component
  (`-DSC_BUILD_SC3_PLUGINS=OFF`). The strip plan already produced a
  WASM-only set; making the set optional is a separate decision.
- Generating per-plugin help / documentation. Out-of-tree plugin
  documentation lives in the SC class library / quarks pipeline.
- Resurrecting deleted plugins (HOAUGens, LadspaUGen, NovaDiskIO).

---

## Alternative: flatten into `src/server/plugins/`

If "integrate into the source tree" is read maximally — sc3 plugins
should live next to the built-in plugins with no `sc3` subtree at all
— the diff becomes:

- `git mv src/server/sc3/source/<Plugin>/*.cpp src/server/plugins/`
  for every directory, losing the per-directory grouping.
- `BUILD_PLUGIN` macro merges with whatever the built-in plugins use
  in `src/server/plugins/CMakeLists.txt`.
- Per-plugin license attribution moves entirely into
  `SC3_PLUGINS_LICENSES.md` (already its source of truth) since the
  directory grouping is gone.
- The combined `SC_Wasm_Plugins` static library either disappears
  (everything just becomes part of the main plugin library) or gets
  renamed.

**Trade-off:** much bigger diff, much louder in `git log`/`git
blame` for every sc3 plugin file going forward. Worth it only if the
intent is to erase the "sc3" identity from the codebase entirely.

The recommended in-place dissolution gets ~95% of the benefit with
~10% of the churn; revisit flattening as a follow-up only if
maintenance friction warrants it.
