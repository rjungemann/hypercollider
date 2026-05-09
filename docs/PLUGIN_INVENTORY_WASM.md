# sc3-plugins WASM Compatibility Inventory

**Date:** 2026-05-04 (updated 2026-05-06)  
**Status:** Phase 5 + Tier 2 ✅ **COMPLETE** | Tier 3 ✅ **COMPLETE** (all 7 viable plugins building)
**Total Plugins:** 43 plugin directories | **Tier-1:** 13 ✅ | **Tier-2:** 10 + 3 extras ✅ | **Tier-3:** 7 implemented (ATK, BatUGens, BBCut2UGens, JoshUGens, MCLDUGens, OteyPianoUGens, SCMIRUGens) + StkUGens (Stages 0–2 complete)

---

## Overview

This document categorizes sc3-plugins by WASM compatibility and external dependencies. The goal was to identify Tier-1 (high-priority for WASM Preview 1) and Tier-2 (deferrals) plugin sets.

**Current Status**: ✅ **Phase 5 COMPLETE** - All 13 Tier-1 plugins building and registered  
✅ **Tier-2 COMPLETE** - 10 + 3 extra plugins building (GlitchUGens, NHUGens, QuantityUGens, RFWUGens, RMEQSuiteUGens, TagSystemUGens, MdaUGens, VBAPUGens, BhobUGens, NCAnalysisUGens, AYUGens, TJUGens, MembraneUGens)  
✅ **Tier-3 COMPLETE** - All 7 viable plugins now building:
  - ✅ **ATK** (2.4k lines, Ambisonics toolkit)
  - ✅ **BatUGens** (813 lines, beat analysis + PV processing)
  - ✅ **BBCut2UGens** (3.5k lines, beat-cutting + drum tracking)
  - ✅ **JoshUGens** (namespace conflicts resolved)
  - ✅ **MCLDUGens** (namespace conflicts resolved)
  - ✅ **OteyPianoUGens** (namespace conflicts resolved)
  - ✅ **SCMIRUGens** (namespace conflicts resolved)
  - ✅ **StkUGens + StkInst** (Stages 0–2 complete; Stage 3 polish/tests pending)

---

## Plugin Categorization

### Tier 1: High Priority (WASM Preview 1 Candidates)

Minimal external dependencies, purely C++/built-in math, deterministic behavior. These should be the first focus.

| Plugin | Files | Dependencies | Notes | Priority |
|--------|-------|--------------|-------|----------|
| **ChaosUGens** | 1 | None | Chaotic oscillators, pure math | ⭐⭐⭐ |
| **AntiAliasingOscillators** | 1 | None | BandLimitedSaw, etc. | ⭐⭐⭐ |
| **DemandUGens** | 1 | None | Demand-rate control generators | ⭐⭐⭐ |
| **DelayUGens** | 1 | None | DelayC, DelayL, DelayN variants | ⭐⭐⭐ |
| **PanUGens** | 1 | None | Panning & spatialisation | ⭐⭐⭐ |
| **GrainUGens** | 1 | None | Granulation synthesis | ⭐⭐⭐ |
| **GendynUGens** | 1 | None | Gendy oscillators | ⭐⭐⭐ |
| **DistortionUGens** | 1 | None | Waveshaping, saturation | ⭐⭐⭐ |
| **LoopBufUGens** | 1 | None | Granular playback with looping | ⭐⭐⭐ |
| **BinaryOpUGens** | 1 | None | Binary operations | ⭐⭐⭐ |
| **MulAddUGens** | 1 | None | Multiply-add operations | ⭐⭐⭐ |
| **DemandUGens** | 1 | None | Demand rate units | ⭐⭐⭐ |
| **BetablockerUGens** | 1 | None | Filters (Betablocking) | ⭐⭐ |
| **DWGUGens** | 1 | None | Digital waveguide models | ⭐⭐ |
| **SummerUGens** | 1 | None | Summation utilities | ⭐⭐ |

**Estimated Effort:** 1–2 weeks to port all Tier-1 plugins  
**Risk Level:** Low

---

### Tier 2: Medium Priority (🟢 Building - 10/11 Implemented)

Moderate complexity, pure C++ or uses SC's own FFT (Green FFT), now feasible for WASM.

| Plugin | Dependencies | Difficulty | WASM Status | Notes |
|--------|--------------|-----------|-------------|-------|
| **GlitchUGens** | None | Low | ✅ BUILDING | Pure C++ filters |
| **NHUGens** | Local headers only | Low | ✅ BUILDING | NHHall reverb |
| **QuantityUGens** | None | Low | ✅ BUILDING | Quantity-based operations |
| **RFWUGens** | None | Low | ✅ BUILDING | RFW oscillators |
| **RMEQSuiteUGens** | None | Low | ✅ BUILDING | Parametric EQ suite |
| **TagSystemUGens** | None | Low | ✅ BUILDING | Tag system UGens |
| **MdaUGens** | None (Paul Kellett's VST ports) | Low | ✅ BUILDING | Classic piano + DSP filters |
| **VBAPUGens** | nova-simd (header-only) | Low | ✅ BUILDING | Vector-based amplitude panning |
| **BhobUGens** | SC_fftlib (Green FFT) | Low | ✅ BUILDING | 5 files (Chaos, FFT, Filt, Grain, Noise) |
| **NCAnalysisUGens** | SC_fftlib (Green FFT) | Low | ✅ BUILDING | SMS, TPV, LPC analysis |
| **AYUGens** | Local AY_libayemu (AY-3-8912 emulator) | Low | ✅ BUILDING | Amstrad CPC sound chip |
| **TJUGens** | Local headers (DFM1, NoiseGen) | Low | ✅ BUILDING | TJ oscillators |
| **MembraneUGens** | None (Membrane_shape.c local) | Low | ✅ BUILDING | Physical membrane synthesis |
| **PitchDetection** | vDSP FFT (Tartini only) | Medium | 🟡 PARTIAL | ⚠️ Tartini requires radix-3 FFT (vDSP-specific, not portable); Qitch is ✅ viable with Green FFT |

**Estimated Effort:** 2–3 weeks (mostly done, just fixes and docs)  
**Risk Level:** Low (all pure C++ or use built-in FFT)

---

### Tier 3: Lower Priority (Phase 4+)

**Status:** ✅ **Detailed Viability Assessment Complete**

Tier 3 plugins have been analyzed in detail. Results: **7 plugins VIABLE, 2 CHALLENGING (large/complex), 2 NOT VIABLE (incompatible)**.

#### ✅ VIABLE Tier 3 Plugins (Ready for Future Implementation)

| Plugin | Size | Key Dependencies | Difficulty | WASM Status | Notes |
|--------|------|------------------|-----------|-------------|-------|
| **ATK** | 2.4k lines | SC_PlugIn.h only | Low | 🟢 READY | Audio Toolkit; minimal includes; pure C++ |
| **BatUGens** | 813 lines | SC_fftlib.h (Green FFT) | Low | 🟢 READY | FFT-based units; clean implementation |
| **BBCut2UGens** | 3.5k lines | SC_fftlib.h (Green FFT) | Low | 🟢 READY | Beat-cutting UGens; uses STL (<stdlib>) |
| **JoshUGens** | 19.9k lines | SC_fftlib.h (Green FFT), SCComplex.h | Low | 🟢 READY | Ambisonic, grain, PV UGens; 6 files |
| **MCLDUGens** | 6.1k lines | SC_fftlib.h (Green FFT) | Medium | 🟢 READY | Buffer/FFT/Chaos/Distortion/Spectral; wintime.h ifdef'd (won't block WASM) |
| **OteyPianoUGens** | 1.2k lines | DWGUGens (Tier 1), local headers | Low | 🟢 READY | Physical piano model; depends on DWG.cpp which is already ported |
| **SCMIRUGens** | 3.2k lines | SC_fftlib.h (Green FFT) | Low | 🟢 READY | Music information retrieval; uses STL <deque> |

**Action:** First 3 plugins (ATK, BatUGens, BBCut2UGens) now building successfully. Remaining 4 (JoshUGens, MCLDUGens, OteyPianoUGens, SCMIRUGens) deferred to Phase 5 due to C++ namespace conflicts with SC_Wasm_RegisterPlugin.h; technical solutions available but require deeper refactoring.

#### 🟡 CHALLENGING Tier 3 Plugins (Large/Complex, Defer to Phase 5+)
#### ⏳ DEFERRED Tier 3 Plugins (Namespace Compilation Issues, Phase 5+)

| Plugin | Size | Issue | Recommendation | Notes |
|--------|------|-------|-----------------|-------|
| **JoshUGens** | 19.9k lines (6 files) | Namespace conflicts with STL headers in SC_Wasm_RegisterPlugin.h | Defer to Phase 5 | Complex plugin with 6 PluginLoad functions; namespacing requires architectural refactoring |
| **MCLDUGens** | 6.1k lines (13 sub-plugins) | Namespace conflicts in complex multi-file structure | Defer to Phase 5 | 13 separate PluginLoads; similar issue to JoshUGens |
| **OteyPianoUGens** | 1.2k lines (5 files) | Namespace propagation from dependent plugins | Defer to Phase 5 | Low-complexity piano model; deferred due to namespace issues in build chain |
| **SCMIRUGens** | 3.2k lines (8 sub-plugins) | Namespace conflicts in feature extractors | Defer to Phase 5 | 8 separate PluginLoads; music analysis UGens |

**Cause:** SC_Wasm_RegisterPlugin.h includes are creating namespace scope pollution when multiple C++ files with complex STL usage attempt to register. Technical solution: centralize registration or refactor header to avoid scope issues.

#### 🟡 CHALLENGING Tier 3 Plugins (Large/Complex, Defer to Phase 5+)

| Plugin | Size | Issue | Viability | Recommendation |
|--------|------|-------|-----------|-----------------|
| **HOAUGens** | 201.6k lines (96 files) | Massive codebase; pure C++ but extreme size | ✅ VIABLE | Defer to Phase 5+ (maintenance burden) |
| **StkUGens** | 1.6k lines + bundled STK library + StkInst | Runtime rawwave asset dependency; requires packaging STK rawwaves into WASM FS and shipping `StkInst`/`StkGlobals` alongside `StkUGens` | 🟡 VIABLE WITH CAVEATS | Stage 0 compile/link verified; Stage 1 pure-synth gating and Stage 2 rawwave preload prototype are both implemented |

**Details:**
- **HOAUGens:** Pure C++, uses STL containers (<map>, <algorithm>, <string>), no FFT. No external dependencies. Compiler flag `-fbracket-depth=4096` already supported by Emscripten. Primary concern is code maintenance due to 96 separate unit implementations (HOAAzimuthRotator1-10, HOABeamDirac2HOA1-10, etc.).
- **StkUGens build-time viability:** The bundled STK build already excludes incompatible realtime/networking sources (`Rt*.cpp`, `Inet*.cpp`, `Socket.cpp`, `Tcp*.cpp`, `UdpSocket.cpp`, `Thread.cpp`, `Mutex.cpp`, `Messager.cpp`) in [sc3-plugins/source/StkInst/CMakeLists.txt](../sc3-plugins/source/StkInst/CMakeLists.txt#L10). This makes the core DSP portion compatible with WASM compilation.
- **StkUGens runtime caveat:** Many STK instruments are sample-backed and call `Stk::rawwavePath()` + `FileWvIn` / `FileLoop` to load `.raw` assets at runtime. The bundled STK rawwave set is small enough to ship in WASM: **45 files / ~388 KB**.
- **Stage 1 now implemented:** With `SC_WASM_STK_PRELOAD_RAWWAVES=OFF`, vendored STK builds in a pure-synth-only mode. `StkUGens` registers only the pure-synth subset, and `StkInst` rejects sample-backed instruments at runtime.
- **Stage 2 prototype now implemented:** With `SC_WASM_STK_PRELOAD_RAWWAVES=ON`, `server/scsynth/CMakeLists.txt` preloads the STK rawwaves into `/stksc/rawwaves/`, generating `build/wasm/server/scsynth/scsynth.data`. `StkUGens` and `StkInst` both set `/stksc/rawwaves/` as the default rawwave path in that configuration.
- **StkUGens pure-synth subset:** A meaningful subset does **not** need sample assets and is therefore straightforward for WASM: `BandedWG`, `BlowHole`, `Bowed`, `Clarinet`, `Flute`, `Saxofony`, `Shakers`, `Sitar`, `StifKarp`. For `StkInst`, 15/28 wrapped instruments are pure-synth (`Clarinet`, `BlowHole`, `Saxofony`, `Flute`, `Brass`, `BlowBotl`, `Bowed`, `Plucked`, `StifKarp`, `Sitar`, `BandedWG`, `Shakers`, `Mesh2D`, `Resonate`, `Whistle`).
- **StkUGens sample-backed subset:** `BeeThree`, `ModalBar`, `Moog`, `VoicForm`, `Mandolin`, `TubeBell` in [sc3-plugins/source/StkUGens/StkAll.cpp](../sc3-plugins/source/StkUGens/StkAll.cpp#L1575) and 13 instruments in `StkInst` require rawwave asset packaging.
- **Important integration note:** `StkUGens` itself does not expose a rawwave-path setter; `StkGlobals` is defined in [sc3-plugins/source/StkInst/StkInst.cpp](../sc3-plugins/source/StkInst/StkInst.cpp#L422). In practice, a robust WASM port should ship **both** `PluginLoad(Stk)` and `PluginLoad(StkUnit)` so `StkGlobals` can initialize `Stk::setRawwavePath(...)` before sample-backed STK instruments are instantiated.
- **Recommended strategy:** Port `StkUGens` and `StkInst` together as **Tier 3 conditional/asset-backed support**. This is now prototyped: Phase 1 pure-synth gating and Phase 2 rawwave preloading both exist in the vendored WASM build path.
- **Implementation plan:** See [docs/STKUGENS_WASM_IMPLEMENTATION_PLAN.md](docs/STKUGENS_WASM_IMPLEMENTATION_PLAN.md) for the staged vendored-submodule plan.

#### ❌ NOT VIABLE (Incompatible with WASM)

| Plugin | Blockers | Reason | Recommendation |
|--------|----------|--------|-----------------|
| **DEINDUGens** | Faust DSP framework (faust/dsp/dsp.h) | Requires Faust compiler (domain-specific language); would need full port | ❌ EXCLUDE from WASM |
| **LadspaUGen** | LADSPA plugin interface + POSIX APIs | `dlopen()`/`dlsym()` (dlfcn.h) for dynamic plugin loading; `dirent.h` for filesystem access; browser sandbox prevents both | ❌ EXCLUDE from WASM |

**Lessons Learned:**
- Plugins using dynamic loading (`dlopen`, `dlsym`) are WASM-incompatible (no filesystem access in browser)
- Plugins requiring external DSLs (like Faust) are defer-worthy unless toolchain is ported
- Virtual instrument frameworks (STK, Faust) need case-by-case analysis but may be viable

---

### Platform-Specific / Not Applicable

| Plugin | Reason | Tier |
|--------|--------|------|
| **DEINDUGens** | Requires Faust DSP compiler; no WASM port available | Tier 3 (Not Viable) |
| **LadspaUGen** | LADSPA is host-specific plugin interface; uses dlopen/dlsym (browser incompatible) | Tier 3 (Not Viable) |
| **BetablockerUGens** | Removed from WASM Tier 1; uses threading API not available in WASM | Removed |
| **NovaDiskIO** | Disk I/O; browser sandbox incompatible | Not in tiers |

---

## Recommended WASM Implementation Pipeline

### ✅ Phase 1-2: COMPLETE (Tier 1 + Tier 2 = 23 plugins)

All Tier-1 and Tier-2 plugins are building successfully in WASM. Estimated combined effort: **3–4 weeks** (now done).

**Tier-1 (13 plugins):**
AntiAliasingOscillators, BlackrainUGens, BerlachUGens, ChaosUGens, ConcatUGens, DistortionUGens, DWGUGens, LoopBufUGens, Neuromodules, SkUGens, SLUGens, SummerUGens, VOSIMUGens

**Tier-2 (10 plugins + 3 extras):**
GlitchUGens, NHUGens, QuantityUGens, RFWUGens, RMEQSuiteUGens, TagSystemUGens, MdaUGens, VBAPUGens, BhobUGens, NCAnalysisUGens, AYUGens, TJUGens, MembraneUGens

**Justification:** Pure C++ synthesis, no problematic external dependencies, deterministic behavior, high pedagogical value.

### ✅ Phase 3: Complete (All 7 Viable Tier-3 Plugins + StkUGens)

All 7 VIABLE Tier-3 plugins are now building: ATK, BatUGens, BBCut2UGens, JoshUGens, MCLDUGens, OteyPianoUGens, SCMIRUGens. StkUGens + StkInst Stages 0–2 also complete.

### 🟡 Phase 4+: Deferred (HOAUGens, StkUGens)

Large, complex plugins requiring additional testing/validation. Recommend after Phase 3 stabilization.

### ❌ Out of Scope (DEINDUGens, LadspaUGen)

Not WASM-compatible due to external framework requirements or POSIX-only APIs.

---

## External Dependency Status for WASM

### ✅ Fully Supported in WASM
- **Green FFT** (SC_fftlib.h) — used by NCAnalysisUGens, BhobUGens, and all WASM builds (default)
- **nova-simd** — header-only SIMD library in `external_libraries/nova-simd`, used by VBAPUGens
- **Local bundled libraries** — AY_libayemu, DFM1, etc. (all self-contained)

### 🟡 Partially Supported
- **FFTW3** — not available in WASM (Green FFT used instead)
- **vDSP** (macOS Accelerate framework) — not available in WASM; affects **Tartini pitch detection only** (see detailed analysis below)
- **PitchDetection (Tartini)** — uses radix-3 FFT specific to vDSP; **PitchDetection (Qitch)** uses standard power-of-2 FFT and is compatible with Green FFT

### ❌ Not Applicable to WASM
- **Aubio** — complex FFT-based analysis library, not ported to Emscripten
- **STK** — large library, deferred to Tier 3+
- **JACK/ALSA/CoreAudio** — audio backend APIs, not applicable to browser target
- **LADSPA** — host plugin interface, not applicable to WASM

---

## Detailed Analysis: PitchDetection Plugin

### Background
The PitchDetection plugin contains **three pitch detection implementations**:
1. **Tartini** — Phil McLeod's autocorrelation-based algorithm (primary, vDSP-dependent)
2. **Qitch** — Brown/Puckette constant-Q-based algorithm (secondary)
3. **PitchDetection UGen** — Wrapper interface to Tartini

### The Tartini Problem: Radix-3 FFT

**Issue:** Tartini uses `vDSP_fft3_zop()` which requires **radix-3 FFT** (odd sizes: 3 × 2^n)
- Hard-coded FFT sizes: 512→768, 1024→1536, 2048→3072
- Setup: `vDSP_create_fftsetup(n, FFT_RADIX3)` — FFT_RADIX3 is vDSP-specific
- Autocorrelation buffer calculation: `size = n + k` where both are odd (for FFT efficiency)

**Why Not Portable to Green FFT:**
- Green FFT (and standard FFT libraries) only support power-of-2 sizes
- Tartini's algorithm is **specifically optimized for these odd sizes** for autocorrelation efficiency
- Porting would require:
  1. Complete algorithm reimplementation with power-of-2 sizes
  2. Re-tuning all parameters and frequency resolution
  3. Validation that pitch detection accuracy is preserved
  4. ~1-2 weeks effort with uncertain outcome

**Verdict:** ❌ **NOT VIABLE for WASM** (too much effort relative to benefit)

### The Qitch Solution: ✅ VIABLE

**Qitch Implementation:**
- Uses `scfft_*` functions (SC FFT abstraction layer compatible with Green FFT)
- Uses standard power-of-2 FFT sizes
- Pre-computed constant-Q kernel buffers (no vDSP-specific features)
- Already works with Green FFT on platforms where FFTW is unavailable

**Architecture:**
1. Input signal → FFT (power-of-2 compatible)
2. Multiply by constant-Q kernels (pre-computed in buffer)
3. Spectral peak picking → pitch estimate

**Why Qitch Works in WASM:**
- No vDSP dependencies
- No dynamic loading or POSIX APIs
- Minimal code changes needed (conditional compilation only)
- Already validated with multiple FFT backends

**Effort:** ~1-2 days (minimal)

### Recommended Action: Port Qitch Only

**Strategy:**
1. Add `#ifdef SC_FFT_GREEN` guards around Tartini initialization in PitchDetection.cpp
2. Keep Qitch enabled unconditionally
3. WASM builds get Qitch pitch detection ✅
4. Native builds keep both Tartini and Qitch (users choose)

**Result:**
- ✅ WASM users have working pitch detection (via Qitch)
- ✅ No algorithm reimplementation
- ✅ Native builds unaffected
- ✅ Alternative: BatUGens provides FFT-based pitch detection in Tier 3

| Algorithm | FFT Type | WASM Compatible | Notes |
|-----------|----------|-----------------|-------|
| **Tartini** | Radix-3 (odd sizes) | ❌ NO | vDSP-specific, not portable |
| **Qitch** | Power-of-2 | ✅ YES | Uses standard Green FFT |
| **BatUGens alternative** | Power-of-2 | ✅ YES | Viable Tier 3 plugin |

---

## Build Integration Plan for Phase 1

### CMake Option
```cmake
option(SC_WASM_PLUGINS "Include plugins in WASM build" ON)
set(SC_WASM_PLUGIN_TIERS "1" CACHE STRING "Plugin tiers to build (1,2,3 comma-separated)")
```

### Plugin Registration Macro
Each plugin will use a static registration function:
```cpp
SC_WASM_REGISTER_UGENS(ChaosUGens, "Logistic", "Henon", "Gendyn", ...);
```

This macro expands to populate a compile-time registry (no dlopen needed).

### Directory Structure
```
sc3-plugins/
├── CMakeLists.txt         (add SC_WASM option)
├── source/
│   ├── ChaosUGens/
│   │   ├── wasm_register.cpp (NEW - registration glue)
│   │   └── ...
│   └── ...
└── cmake_modules/
    └── WasmPluginRegistry.cmake (NEW)
```

---

## Next Steps

### Completed ✅
1. **Tier 1 portability confirmed:** All 13 Tier-1 plugins building successfully
2. **Tier 2 implementation:** 10 main + 3 extra plugins ported and building
3. **Tier 3 viability assessment:** 7 plugins identified as viable, 2 deferred (size/complexity), 2 identified as not applicable
4. **Tier 3 partial implementation:** ATK, BatUGens, BBCut2UGens now building successfully in Phase 3
5. **PitchDetection optimization:** Qitch algorithm verified working; Tartini disabled in WASM builds

### Completed ✅
1. **Resolved namespace compilation issues** in all 4 deferred Tier 3 plugins (JoshUGens, MCLDUGens, OteyPianoUGens, SCMIRUGens)
2. **StkUGens + StkInst** ported — Stages 0–2 complete (compile/link, pure-synth gating, rawwave preload)

### Remaining / Optional
1. **Cross-browser validation:** Test WASM builds in Firefox, Safari, Chrome
2. **Performance benchmarking:** Compare Tier 3 plugin performance (WASM vs. native)
3. **Golden test suite:** Create verification tests for critical UGens (StkUGens Stage 3)
4. **Validate HOAUGens compilation** (optional — large codebase, maintenance concern)

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Plugin builds fail due to unexpected deps | Spot-check analysis before committing to build |
| Performance regression vs. native | Benchmark first Tier-1 set against native; defer optimization to Phase 2 |
| Plugin licensing conflicts | Audit licenses (most sc3-plugins are GPL-compatible; confirm in Phase 1 review) |
| Registry bloat | Keep Tier-1 set tight (~20 plugins); add more in Phase 2 if successful |

---

**Owner:** WASM Porting Initiative  
**Last Updated:** 2026-05-06 (All Tier-3 plugins complete; namespace issues resolved; StkUGens Stages 0–2 done)
