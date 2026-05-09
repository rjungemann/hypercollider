# WASM Feature Matrix (sclang + scsynth)

This matrix defines target behavior for the browser WASM runtime.

For the historical audited class-library gap list and owner-phase mapping, see `docs/ARCHIVE/WASM_STUB_ELIMINATION_PLAN.md` under `Current Class-Library Feature Gaps (sclang audit)`.

Last updated: 2026-05-06

- `Supported`: implemented and tested in WASM.
- `Constrained`: supported with WASM-specific semantics (documented and tested).
- `Unsupported (explicit error)`: must fail with a deterministic error, never no-op.
- `CLI only`: supported in Node-hosted WASM CLI; browser runtime returns an explicit error.
- `In progress`: active implementation work.

## sclang Runtime

| Area | Current | Target | Notes |
| --- | --- | --- | --- |
| Startup class init | Supported | Supported | Zero primitive bind failures. |
| Platform directory primitives | Supported | Supported | Real primitives under `SC_WASM` guards. |
| File primitives (`File`, `Pipe`, `UnixFILE`) | Constrained | Constrained | `PyrFilePrim.cpp` included in WASM build; Emscripten MEMFS/IDBFS backs browser I/O; native FS backs CLI I/O. |
| SoundFile primitives | Constrained | Constrained | WAV/RAW read-write via `SC_WasmSndFileCompat.hpp`; other formats unsupported with explicit error. |
| SystemClock scheduling | Constrained | Constrained | Real `addheap`/`getheap` heap; JS harness drives tick via `sc_wasm_process_system_clock_tasks()`. |
| TempoClock scheduling | Unsupported (explicit error) | Constrained | `PyrSched.cpp` excluded (threading model); TempoClock primitives are no-ops; see Phase 8.1 remainder. |
| Elapsed/monotonic time | Supported | Supported | Backed by `emscripten_get_now()` / `performance.now()`. |
| OSC/NetAddr primitives | Constrained | Constrained | Loopback-only addressing; routed through WASM transport shim. |
| Unix command/process primitives | CLI only | CLI only | Bridge-backed via `platform/wasm/cli/unix_bridge.js`; browser returns explicit `ENOSYS` errors. Covers `String.unixCmd`, `unixCmdGetStdOut`, `systemCmd`, `Main.pid`, `Integer.pidRunning`, `Unix.errno`. |
| MIDI primitives | Constrained | Constrained | CLI: `node-midi` bridge (`platform/wasm/cli/midi_bridge.js`); browser: Web MIDI API bridge (`wasm_browser_support.js`) with SysEx opt-in; Safari/iOS unsupported with explicit error. |
| Serial / HID primitives | Unsupported (explicit error) | Unsupported (explicit error) | Raw serial and HID device APIs unavailable in browser sandbox; no viable CLI alternative. `PyrSerialPrim.cpp` and `SC_HID_api.cpp` excluded. |
| GUI primitives | Unsupported (explicit error) | Unsupported (explicit error) | Browser IDE handles UI externally; no headless GUI path. |
| Terminal/CLI client runtime | Unsupported | Unsupported | See note below. |

### Terminal/CLI client runtime — why unsupported

Three source files are excluded from the WASM sclang build and have no bridge-backed replacement:

| File | Reason excluded |
| --- | --- |
| `LangSource/SC_CLIOptions.cpp` | Option-parsing logic is coupled to daemon-mode flags, Readline integration, and native process lifecycle options that have no WASM equivalent. The WASM CLI entry point (`platform/wasm/SC_Wasm_Eval.cpp`) handles initialization directly. |
| `LangSource/SC_TerminalClient.cpp` | The terminal client drives the main event loop via Boost.Asio async read on `stdin` and uses `std::thread` for the scheduler. Both are incompatible with Emscripten's cooperative single-threaded event model. |
| `LangSource/SC_LanguageClient.cpp` | The language client assumes a native terminal/network lifecycle (socket-backed IPC with the IDE, signal handlers, blocking reads) that cannot be ported to the browser sandbox without a fundamental redesign. |

Until a WASM-native language-client harness is designed (Phase 8.4), the Node CLI uses `platform/wasm/SC_Wasm_Eval.cpp` as the sole evaluation entry point and the browser IDE drives evaluation from JavaScript.

## scsynth Runtime

| Area | Current | Target | Notes |
| --- | --- | --- | --- |
| Server boot / status / sync | Supported | Supported | Must pass browser smoke tests. |
| Audio driver lifecycle | Constrained | Constrained | Explicit single-thread runtime/control-queue model in WASM. |
| DiskIO UGens (`DiskOut`, `DiskIn`, `VDiskIn`) | Constrained | Constrained | `DiskIO_UGens.cpp` re-enabled; browser backend is IDBFS-backed; CLI backend is native FS. Class-library constructors active with no `notYetImplemented` guards. |
| UIUGens | Unsupported (explicit error) | Unsupported (explicit error) | Explicit user-visible unsupported errors. |
| Plugin load/unload stubs | Removed | Removed | No linker-only no-op plugin symbols. |

## Plugin Support

| Plugin Tier | UGens | Current | Notes |
| --- | --- | --- | --- |
| Tier 1 (core server plugins) | FFT/IFFT, PV_*, IOUGens, OscUGens, DelayUGens, FilterUGens, GrainUGens, NoiseUGens, PanUGens, ReverbUGens, PhysicalModelingUGens, and all other `server/plugins/` UGens | Supported | Built into scsynth; FFT uses Green FFT backend (no FFTW3/vDSP). |
| Tier 1 (sc3-plugins) | AntiAliasingOscillators, BlackrainUGens, BerlachUGens, ChaosUGens, ConcatUGens, DistortionUGens, DWGUGens, LoopBufUGens, Neuromodules, SkUGens, SLUGens, SummerUGens, VOSIMUGens | Supported | Pure C++ sc3-plugins; statically linked via `SC_WASM_REGISTER_FOR_PLUGIN`. |
| Tier 2 (sc3-plugins FFT/spectral) | BhobUGens (PV_MagScale, PV_CommonMag, PV_CommonMul, PV_MagMinus, PV_MagGate, PV_Compander, PV_Morph, PV_XFade, PV_SoftWipe, PV_Cutoff), GlitchUGens, NHUGens, QuantityUGens, RFWUGens, RMEQSuiteUGens, TagSystemUGens, MdaUGens, VBAPUGens, NCAnalysisUGens, AY_UGen, TJUGens, MembraneUGens | Supported | Built with `SC_WASM_PLUGIN_TIER >= 2`; FFT UGens use SC's Green FFT API. |
| Tier 3 (sc3-plugins advanced) | ATK, BatUGens, BBCut2UGens, JoshUGens, MCLDUGens (FFTPower, FFTSubbandPower, PV_Whiten, FFTFlux, etc.), StkUGens, SCMIRUGens, OteyPianoUGens | Supported | Built with `SC_WASM_PLUGIN_TIER >= 3`; STK uses bundled rawwaves (preloaded via Emscripten). |
| Plugin discovery API | `_sc_wasm_list_ugens()` | Supported | Returns sorted newline-separated list of all registered UGen names; browser IDE Plugin Browser panel uses it. |
| Tier 4 (ML UGens — ONNX/WebNN) | SoundfileML, NNUGen, etc. | Unsupported | Requires ONNX Runtime WASM or WebNN bridge; significant effort; deferred. See feasibility note below. |

### Tier 4 ML UGen Feasibility Note

ONNX Runtime provides an official WASM build (`onnxruntime-web`) that runs in both browser and Node.js. A minimal integration path would be:

- Browser: load `onnxruntime-web` alongside the SC WASM module; expose model inference via a JS shim that the UGen calls through a registered callback table.
- The primary blocker is the UGen calling convention — ONNX inference is async (Promise-based) while the SC audio render loop is synchronous. A workable approach is double-buffering: queue inference requests from the audio thread, resolve them 1–2 blocks later, accept up to 1 block of latency for ML outputs.
- WebNN (native browser ML API) is an alternative but has limited browser support as of 2026 (Chrome 113+ only, no Firefox/Safari).
- Estimated effort: 3–4 weeks for a single model-inference UGen; generalised framework would be 6–8 weeks.
- Recommendation: defer until sc3-plugins Tier 2/3 are fully validated; revisit when WebNN lands in Firefox.

## Performance Notes

Measured on macOS arm64 (Node.js v22, `just bench`, 10 runs each):

| Metric | WASM | Native | Ratio |
| --- | --- | --- | --- |
| sclang startup latency | ~109 ms | ~133 ms | **0.82x (18% faster)** |
| NRT render throughput | ~4x slower than native | baseline | 4.0x–4.3x across all patch complexities |

The startup advantage comes from the preloaded `.data` bundle eliminating filesystem discovery at boot. The render gap is flat across patch complexities (sine through granular), indicating fixed per-cycle overhead at the Node.js↔WASM call boundary rather than WASM math performance.

## Platform Shims

| Area | Current | Target | Policy |
| --- | --- | --- | --- |
| pthread compatibility | Constrained wrappers | Narrow wrappers | Keep only wrappers required by supported features; unsupported paths fail explicitly (`ENOTSUP`). |
| socket compatibility | Constrained wrappers | Narrow wrappers | Explicitly gate unsupported socket paths; avoid silent success behavior. |
| dlopen/signal compatibility | Constrained wrappers | Narrow wrappers | Keep minimal compatibility wrappers for WASM bring-up and remove broad shims where possible. |

## Guardrails

- The guard script `tools/guard/check_wasm_stub_allowlist.sh` blocks fallback-file reintroduction drift for `lang/LangSource/SC_Wasm_Stubs_Extra.cpp` and `server/scsynth/SC_Wasm_UGenStubs.cpp` (if present).
- Baseline entries live in `tools/guard/wasm_stub_allowlist.txt` (current baseline is intentionally empty).
- Any temporary exception must be added to the allowlist in the same change as rationale.
