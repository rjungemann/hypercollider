# sc3-plugins License & Attribution

**Date:** 2026-05-06  
**Scope:** All plugin directories included in the WASM build (Tiers 1–3 plus promoted plugins). Deleted plugins (HOAUGens, LadspaUGen, NovaDiskIO) are listed at the bottom for completeness.

The sc3-plugins project as a whole is distributed under the GNU GPL v2 (see `src/server/sc3/license.txt`). Individual plugins may carry their own author attributions and license variants; any GPL-incompatible license would be a conflict, but none have been found. Where a source file has no explicit license header it is covered by the project-level GPL v2.

**External dependencies** (as of Phase 2c of [SC3_PLUGINS_INTEGRATION_PLAN.md](SC3_PLUGINS_INTEGRATION_PLAN.md)):
- **nova-simd** — CPM-fetched from `timblechmann/nova-simd`; header-only SIMD helpers (no restriction on use).
- **STK (Synthesis ToolKit)** — CPM-fetched from `thestk/stk`; custom permissive license (see below).

---

## Tier 1

### AntiAliasingOscillators
- **Author:** Nicholas M. Collins
- **License:** GPL v3 (matches SC project)
- **Notes:** Implements algorithms from Juhan Nam, Vesa Välimäki, Jonathan S. Abel, and Julius O. Smith, "Efficient Antialiasing Oscillator Algorithms Using Low-Order Fractional Delay Filters," *IEEE Transactions on Audio, Speech, and Language Processing* 18(4), 2010.

### BlackrainUGens
- **Author:** "blackrain at realizedsound dot net" (2006)
- **License:** GPL v2 (inherits SC project license; no explicit statement in header)

### BerlachUGens
- **Author:** Bjoern Erlach (2006–2007)
- **License:** GPL v2 (inherits project license; copyright stated in source but no explicit license line)

### ChaosUGens
- **Authors:** Julian Parker & Till Bovermann (2013)
- **License:** GPL v2+

### ConcatUGens
- **Author:** SC project (James McCartney framework)
- **License:** GPL v2

### DistortionUGens
- **Author:** Unknown (no header attribution)
- **License:** GPL v2 (inherits project license)

### DWGUGens
- **Author:** Victor Bombi (2013)
- **License:** GPL v2

### LoopBufUGens
- **Author:** Lance Putnam (2004)
- **License:** GPL v2 (inherits project license; header has placeholder `__MyCompanyName__` but was contributed to sc3-plugins under project terms)

### Neuromodules
- **Authors:** Frank Pasemann and Julian Rohrhuber
- **License:** GPL v2

### SkUGens
- **Author:** Stefan Kersten (2005–2008)
- **License:** GPL v2

### SLUGens
- **Author:** Nick Collins (http://composerprogrammer.com)
- **License:** GPL v2

### SummerUGens
- **Author:** SC project (James McCartney framework)
- **License:** GPL v2

### VOSIMUGens
- **Author:** Léon Spek (http://www.dendriet.nl); SC framework James McCartney
- **License:** GPL v2

---

## Tier 2

### GlitchUGens
- **Author:** SC project framework; no individual attribution in header
- **License:** GPL v2

### NHUGens (NHHall)
- **Author:** No attribution in header
- **License:** **The Unlicense** (public domain dedication; see file header)

### QuantityUGens
- **Author:** SC project framework
- **License:** GPL v2

### RFWUGens
- **Author:** Rob Watson (2008; https://github.com/rfwatson)
- **License:** GPL v2

### RMEQSuiteUGens
- **Author:** Josh Parmenter (2008)
- **License:** GPL v2

### TagSystemUGens
- **Author:** Julian Rohrhuber (Emil Post Tag System UGens)
- **License:** GPL v2

### MdaUGens
- **Authors:** Paul Kellett (original mda VST plugins, http://mda.smartelectronix.com); SC3 port by Dan Stowell
- **License:** MIT **or** GPL v2+ (dual-licensed per source header: "The mda plug-ins are released under the MIT license or under the GPL, either version 2 of the License, or (at your option) any later version")

### VBAPUGens
- **Author:** Scott Wilson (BEASTmulch project, http://www.beast.bham.ac.uk/research/mulch.shtml)
- **License:** GPL v2

### BhobUGens
- **Author:** Bhob Rainey (http://www.bhobrainey.net); acknowledges Lance Putnam and Nick Collins
- **License:** GPL v2

### NCAnalysisUGens
- **Author:** Nick Collins (2009)
- **License:** GPL v2 (inherits SC project; copyright stated in file headers)

### AYUGens
- **Author (SC wrapper):** Dan Stowell
- **Bundled library:** libayemu (AY-3-8912 / YM2149 chip emulator)
  - **libayemu authors:** Mikhail Malyshev and others (see `AYUGens/AY_libayemu/`)
  - **libayemu license:** GPL v2
- **Combined license:** GPL v2

### TJUGens
- **Authors:** Tony Hardie-Bick (Java version); Jonny Stutters (SuperCollider port)
- **License:** GPL v2

### MembraneUGens
- **Author:** No attribution in header
- **License:** GPL v2 (explicit license block in `Membrane.cpp`)

---

## Tier 3

### ATK (Ambisonic Toolkit)
- **Authors:** Josh Parmenter, Joseph Anderson, and the ATK Community
- **License:** GPL v3

### BatUGens
- **Author:** SC project framework (based on SC/MachineListening work)
- **License:** GPL v2

### BBCut2UGens
- **Author:** Nick Collins (BBCut2 beat-cutting system); SC framework
- **License:** GPL v2

### JoshUGens
- **Author:** Josh Parmenter (2005)
- **License:** GPL v2

### MCLDUGens
- **Author:** Dan Stowell (2006–2010); ChaosUGens section credits Lance Putnam
- **License:** GPL v2

### SCMIRUGens
- **Author:** Nick Collins
- **License:** GPL v2

### OteyPianoUGens
- **Authors:** Clayton Otey (piano physical model); Victor Bombi (SuperCollider wrapper); depends on DWGUGens (Victor Bombi)
- **License:** No explicit license in source headers; distributed under sc3-plugins project GPL v2

### StkUGens + StkInst
- **SC wrapper author:** Josh Parmenter (StkUGens); sc3-plugins contributors (StkInst)
- **SC wrapper license:** GPL v2
- **STK library:** Synthesis ToolKit in C++ by Perry R. Cook and Gary P. Scavone
  - **STK license:** Custom permissive license (free for any use including commercial, with attribution; incompatible ONLY with licenses that prohibit attribution). Compatible with GPL.
  - **Source location:** Fetched via CPM from `thestk/stk` (Phase 2c of [SC3_PLUGINS_INTEGRATION_PLAN.md](SC3_PLUGINS_INTEGRATION_PLAN.md))
  - **Rawwaves assets:** Instruments that load `.raw` sample files require the STK rawwaves asset bundle (45 files, ~388 KB); these are preloaded in WASM via Emscripten FS at `/stksc/rawwaves`.

---

## Promoted (formerly excluded, now Tier 2)

### AuditoryModeling
- **Author:** Nick Collins (2009–2010)
- **License:** GPL v3 (explicitly stated: "SuperCollider is under GNU GPL version 3, these extensions released under the same license")
- **Notes:** Implements Meddis (1986) hair cell model and Gammatone filter bank per V. Hohmann, "Frequency analysis and synthesis using a Gammatone filterbank," *Acta Acustica* 88 (2002).

### BetablockerUGens
- **Authors:** Dave Griffiths (betablocker VM engine, 2010); SC UGen wrapper (no header attribution)
- **License:** GPL v2 (betablocker engine explicitly; SC wrapper inherits project GPL v2)
- **Notes:** Implements the Betablocker esoteric virtual machine (https://daveparrish.net/betablocker.html) as a UGen.

### DEINDUGens
- **Authors:**
  - `RMS`, `DiodeRingMod`, `complexRes`: Julian Parker & Till Bovermann (2013)
  - `JPverbRaw` (JPverb reverb): Julian Parker, with bug fixes by Till Bovermann (2013); Faust architecture by Stefan Kersten
  - `GreyholeRaw` (Greyhole reverb): Julian Parker, with bug fixes by Till Bovermann (2013); Faust architecture by Stefan Kersten
- **License:** GPL v2+
- **Bundled headers:** `DEINDUGens/include/faust/` — Faust architecture headers (GRAME, Centre National de Création Musicale; GPL v3). Only abstract C++ interface headers; no runtime Faust library is linked.

### PitchDetection (Qitch only)
- **Authors:**
  - `PitchDetection.cpp` (wrapper): James McCartney SC framework / Nick Collins
  - `Qitch.cpp`: Nick Collins (2005, updated 2011); based on Brown & Puckette constant-Q algorithm
  - `Tartini.cpp`: Philip McLeod (Tartini v1, Copyright 2002–2005, GPL v2); SC port by Nick Collins (2006). **Tartini is excluded from WASM builds** via `#ifdef SC_WASM` guard; Tartini requires `vDSP_create_fftsetup(FFT_RADIX3)` (macOS-only) or FFTW.
- **License:** GPL v2

---

## Deleted plugins (not in WASM build)

### HOAUGens *(deleted)*
- **Author:** Pierre Lecomte
- **License:** GPL (Faust 2.5.21 generated code)
- **Reason for deletion:** 96 files / 201k lines — impractical WASM build burden

### LadspaUGen *(deleted)*
- **Author:** Jonatan Liljedahl (2010)
- **License:** GPL v3 (explicitly stated)
- **Reason for deletion:** Uses `dlopen`/`dlsym` — incompatible with browser sandbox

### NovaDiskIO *(deleted)*
- **Author:** Tim Blechmann (2013)
- **License:** GPL v2
- **Reason for deletion:** Background disk-streaming thread + `boost::sync::semaphore` — incompatible with WASM
