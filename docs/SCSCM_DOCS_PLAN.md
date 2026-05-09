# scscm Documentation Organization Plan

**Date**: 2026-05-09  
**Status**: ✅ Phases 1–5 complete (2026-05-09)  
**Goal**: Create a comprehensive, multi-format documentation suite for scscm that serves learners at all levels — from first-time users to advanced pattern designers.

## Implementation Status

| Phase | Status | Files delivered |
|-------|--------|-----------------|
| Phase 1a — Language Reference | ✅ Done | [`docs/scscm/SCSCM_LANGUAGE_REFERENCE.md`](scscm/SCSCM_LANGUAGE_REFERENCE.md) |
| Phase 1b — Cheat Sheet | ✅ Done | [`docs/scscm/SCSCM_CHEAT_SHEET.md`](scscm/SCSCM_CHEAT_SHEET.md) |
| Phase 1c — Quick Start examples | ✅ Done | `cli/examples/quick_start_{1,2}.scscm` |
| Phase 2 — Quick Start guide | ✅ Done | [`docs/scscm/SCSCM_QUICK_START.md`](scscm/SCSCM_QUICK_START.md) |
| Phase 3 — Live Coding Tutorial | ✅ Done | [`docs/scscm/SCSCM_LIVE_CODING_TUTORIAL.md`](scscm/SCSCM_LIVE_CODING_TUTORIAL.md), `cli/examples/ambient_step_{1..4}.scscm`, `cli/examples/exercises/live_coding_{1..3}.scscm` |
| Phase 4 — Pattern Techniques | ✅ Done | [`docs/scscm/SCSCM_PATTERN_TECHNIQUES.md`](scscm/SCSCM_PATTERN_TECHNIQUES.md), `cli/examples/techniques/*.scscm` (11 files) |
| Phase 5 — Polish & Integration | ✅ Done | `docs/README.md` index updated; cross-links verified |

Adaptation note: the original plan sketched a JavaScript-like surface syntax. During execution, all examples were rewritten in the actual Scheme s-expression syntax that scscm uses today (verified against `cli/examples/` and the existing scscm spec). The pedagogical structure of the plan was preserved. Also during cleanup, the legacy `SCSCM_GUIDE.md`, `SCSCM_SPEC.md`, and `SCSCM_LANGUAGE_FEATURES.md` were absorbed into `SCSCM_LANGUAGE_REFERENCE.md` and deleted.

---

## Overview

scscm currently lacks organized, progressive documentation. This plan consolidates learner journeys into five complementary documents that form a coherent progression: onboarding → hands-on learning → reference → specialized deep dives.

### Design Principles

1. **Progressive disclosure**: start with essentials (quick start), then build depth (tutorials, reference).
2. **Learning by doing**: prioritize examples and live coding over abstract theory.
3. **Multiple entry points**: a learner can enter at cheat sheet (quick lookup) or quick start (first hour).
4. **Reusable content**: pattern techniques reference the language, language reference links back to examples.

### Target Audience

- **Beginners** (0-1 hour): quick start, cheat sheet
- **Intermediate** (1-8 hours): live coding tutorial, basic pattern-making
- **Advanced** (8+ hours): language reference, pattern techniques, source code

---

## Component 1: Cheat Sheet

### Purpose

Single-page lookup for syntax, operators, and common idioms. Printed reference or browser tab while coding.

### Format

Markdown table + compact code blocks. ~2-4 pages when printed.

### Sections

1. **Literals & Types** — integers, floats, strings, arrays, dictionaries
2. **Variables & Assignment** — `let`, scoping, mutation
3. **Functions & Lambdas** — `fn`, `|args|`, return semantics
4. **Operators** — arithmetic, comparison, logical, bitwise
5. **Control Flow** — `if`/`else`, `when`, loops (`for`, `while`)
6. **Collections** — indexing, slicing, iteration, common methods
7. **Pattern Syntax** — `note`, `dur`, `amp`, `pan` shortcuts; `,` chaining
8. **Built-in Functions** — `random`, `range`, `len`, `round`, etc. (top 20 most-used)
9. **Common Mistakes** — off-by-one, type mismatches, pattern scope

### Acceptance Criteria

- Fits on 2-4 printed pages (or single browser scroll on mobile)
- Every feature shown has a minimal example
- No explanatory prose; examples speak for themselves
- Links to Language Reference for detailed explanation

### Files to Create

- `docs/SCSCM_CHEAT_SHEET.md`

---

## Component 2: Quick Start

### Purpose

Get a first scscm patch running in < 5 minutes. Answer: "What does scscm code actually look like?"

### Format

Narrative + code + expected output. ~10 minutes to read, ~5 minutes to code.

### Learning Objectives

By the end of this component, a reader should be able to:
- Write and run a simple scscm patch from the command line
- Understand the basic structure: synth definition → pattern → output
- Modify numeric parameters and hear/see the effect
- Know where to go next for deeper learning

### Detailed Structure

#### 1. **What is scscm?** (1 min)

Two paragraphs:
- First: "scscm is a live-coding language for generative audio synthesis. You write code to describe patterns of notes, durations, and effects, and scscm generates audio or MIDI."
- Second: "You can run scscm patches from the command line. Each patch defines synthesizers and patterns; you listen/record the output."

Visual: Show a simple flow diagram:
```
Code → Synth Engine → Audio/MIDI Output
```

#### 2. **Before You Start** (1 min)

- Prerequisite: scscm CLI installed (link to installation guide)
- Hardware: headphones or speakers (for listening)
- Editor: any text editor (VS Code, Vim, etc.); optional syntax highlighting
- Time: 5-10 minutes

Section: "If you're on macOS/Linux and have Node.js 16+, installation is one command" (show it).

#### 3. **Your First Pattern — A Simple Metronome** (3 min)

**Goal**: Hear generated audio. Understand: note, duration, amplitude.

**Code block** (copy-paste ready):

```javascript
// quick_start_1.scscm — A simple metronome
synth sine = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: 60,
  dur: 0.5,
  amp: 0.3
}
```

**How to run**:
```bash
hclang examples/quick_start_1.scscm
```

**What you should hear**:
- A steady beeping sound (sine wave at middle C, 60 Hz)
- Each beep lasts 0.5 seconds, with silence between
- A metronome-like click pattern
- Total duration: 8 seconds (adjust by changing `dur`)

**Visual output** (ASCII art or spectrogram description):
```
Time (s)  │ Audio
0.0-0.5   │ ▁▂▃▄▅▆▇█▆▅▄▃▂▁   (sine wave beep)
0.5-1.0   │                      (silence)
1.0-1.5   │ ▁▂▃▄▅▆▇█▆▅▄▃▂▁   (sine wave beep)
...
```

**What just happened**:
- `synth sine`: defined an oscillator function (takes frequency and amplitude, outputs a sine wave)
- `pattern { ... }`: described one musical event (note = middle C, dur = 0.5 sec, amp = 0.3)
- hclang ran the code and synthesized 0.5 sec of audio, repeated ~8 times

#### 4. **Understanding the Pattern** (2 min)

**Line-by-line breakdown**:

```javascript
synth sine = (freq, amp) => amp * sin(2 * pi * freq * t);
```
- `synth`: keyword that defines a sound-generating function
- `sine`: name for this synth (you use this name when playing notes)
- `(freq, amp)`: inputs (frequency in Hz, amplitude 0-1)
- `=> ...`: the body (return value); generates a sine wave at `freq` with volume `amp`
- `sin(2 * pi * freq * t)`: the math (standard sine oscillator formula)

```javascript
pattern {
  note: 60,
  dur: 0.5,
  amp: 0.3
}
```
- `pattern { ... }`: start of a musical pattern block
- `note: 60`: play MIDI note 60 (middle C, ~262 Hz). MIDI is international standard: 60 = C4, 61 = C#4, etc.
- `dur: 0.5`: duration of this note in seconds
- `amp: 0.3`: amplitude (0 = silent, 1 = loud). 0.3 = quiet beep

**Try it**:
- Change `dur: 0.5` to `dur: 0.2` → faster beeps
- Change `amp: 0.3` to `amp: 0.6` → louder beeps
- Change `note: 60` to `note: 67` → higher pitch (G4)

#### 5. **Your Second Pattern — Two-Voice Harmony** (3 min)

**Goal**: Layer sounds. Learn: arrays, repetition, chaining.

**Code block**:

```javascript
// quick_start_2.scscm — Two voices in harmony
synth sine = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: [60, 64],     // bass (C4) and midrange (E4)
  dur: [0.5, 0.5],    // both for 0.5 sec
  amp: [0.3, 0.2]     // bass slightly louder
}
```

**How to run**:
```bash
hclang examples/quick_start_2.scscm
```

**What you should hear**:
- Two pitches playing simultaneously (a major third interval: C and E)
- Each note is 0.5 seconds long
- A more harmonious, less mechanical sound than the metronome

**What changed**:
- `note: [60, 64]`: array of two notes, played at the same time (not sequentially)
- `dur: [0.5, 0.5]`: each note plays for 0.5 seconds
- `amp: [0.3, 0.2]`: E is quieter than C (creates a balanced mix)

**Concept**: When `note`, `dur`, and `amp` are arrays, scscm creates multiple voices (polyphony).

**Try it**:
- Add a third voice: `note: [60, 64, 67]` (C-E-G major chord)
- Make it longer: `dur: [2, 2, 2]` (held chord)
- Change the second note: `note: [60, 65]` (C and F, a different interval)

#### 6. **Understanding Arrays and Repetition** (1 min)

Concept box:

| Code | Meaning | Result |
|------|---------|--------|
| `note: 60` | Single note | One voice plays C4 |
| `note: [60, 64]` | Two notes | Two voices play C4 and E4 simultaneously |
| `dur: 0.5` | Single duration | All voices play for 0.5 sec |
| `dur: [0.5, 0.3]` | Two durations | Voice 1 plays for 0.5 sec, Voice 2 for 0.3 sec (overlapping) |

**Naming conventions** (preview for later):
```javascript
let bass_notes = [60, 64, 60, 62];    // lower pitches
let high_notes = [72, 76, 74, 77];    // higher pitches
```

#### 7. **Next Steps** (1 min)

**You've completed the essentials.** To go deeper:

1. **Add more voices and variation** → see LIVE_CODING_TUTORIAL
2. **Stuck on syntax?** → see CHEAT_SHEET
3. **Want to understand every feature?** → see LANGUAGE_REFERENCE
4. **Ready to design patterns?** → see PATTERN_TECHNIQUES

**Common questions**:
- "How do I change the instrument sound?" → Chapter 3 of LIVE_CODING_TUTORIAL (FM synthesis, filtering)
- "How do I make a rhythm?" → PATTERN_TECHNIQUES (Euclidean rhythms, timing)
- "What other MIDI notes are there?" → LANGUAGE_REFERENCE (Note table)

#### 8. **Where to Get Help** (30 sec)

- **Error: `command not found: hclang`** → See installation guide in README
- **Error: `Syntax error at line X`** → Check CHEAT_SHEET for correct syntax
- **My patch doesn't sound right** → Try the LIVE_CODING_TUTORIAL exercises
- **Community** → Links to Discord/issue tracker (if available)

### Acceptance Criteria

- A complete beginner (musicians or programmers, no prior scscm knowledge) can:
  - Copy-paste code blocks and run them without errors
  - Hear output within 30 seconds of running the command
  - Modify one parameter (`note`, `dur`, `amp`) and understand the effect
  - Identify where to go next (quick reference table pointing to other docs)
- Code snippets are syntactically correct in the current scscm version
- Each subsection is readable in 2-3 minutes
- All example code lives in `examples/quick_start_*.scscm` and is tested on CI
- Spectrogram/ASCII output is included so reader knows what to expect

### Files to Create

- `docs/SCSCM_QUICK_START.md` (3000-4000 words, ~15-20 min read + hands-on)
- `examples/quick_start_1.scscm` (metronome patch, 4-5 lines)
- `examples/quick_start_2.scscm` (two-voice harmony patch, 6-7 lines)

---

## Component 3: Extended Live Coding Tutorial

### Purpose

Deep dive into interactive, real-time pattern development. Teach the mindset and workflow of live coding through a guided, hands-on project.

### Format

Narrative + runnable examples + progressive refinement + exercises. ~1-2 hours to work through.

### Learning Objectives

By the end of this component, a reader should be able to:
- Write and iteratively refine a multi-voice generative patch
- Understand the relationship between code structure and emergent behavior
- Use arrays, randomness, and constraints to create variation
- Modify code mid-performance (redefine patterns in real time)
- Debug patches by listening and reading patterns back
- Compose simple ambient/generative music

### Detailed Structure

#### 1. **The Live Coding Mindset** (5 min)

**Core principles**:

1. **Write → Hear → Modify (tight loop)**
   - You are not writing code for a compiler; you are sculpting sound in real time
   - Each change is immediately audible; your ear is the test suite
   - Mistakes are **features** (weird arpeggios, unexpected polyrhythms)

2. **Redefine without restarting**
   - Unlike traditional programming, you don't stop the program to edit
   - Change a pattern array mid-performance; the synth adapts next cycle
   - Build intuition by trying wild ideas (synths often surprise you)

3. **Embrace constraints**
   - Limiting the note range (scale) creates coherence
   - Repeating patterns with small variations feels intentional
   - Randomness within bounds feels organic, not chaotic

4. **Listen as a feedback mechanism**
   - Timing problems reveal themselves immediately (notes out of sync, rhythm feels off)
   - Pitch problems jump out (clashing intervals, wrong scale)
   - Texture problems become obvious (too busy, too sparse, missing harmonics)

**Mindset shift**: You're not debugging code; you're listening to a performance and adjusting it live.

#### 2. **Project: Build a Generative Ambient Patch** (90 min)

This section guides you through four progressive steps, each adding a layer to a simple ambient piece.

**Overall goal**: Create a 3-4 voice generative patch that evolves unpredictably but sounds coherent. The piece should feel calm, spacious, and ever-changing without explicit repetition.

##### **Step 1: The Foundation — Ambient Pad** (20 min)

**Goal**: A slow, stable foundation. Learn: FM synthesis, long durations, slow modulation.

**Code** (`examples/ambient_step_1.scscm`):

```javascript
// ambient_step_1.scscm — A simple pad voice
synth pad = (freq, amp) => {
  let lfo = 0.5 * sin(2 * pi * 0.1 * t);  // slow wobble (0.1 Hz = 1 cycle per 10 sec)
  let modulated_freq = freq * (1 + lfo);
  amp * sin(2 * pi * modulated_freq * t)
};

pattern {
  note: 60,          // C4, held for 8 seconds
  dur: 8,
  amp: 0.15
}
```

**What you'll hear**:
- A single, warm sine tone at C4
- Gradual pitch wobble (LFO = low-frequency oscillator)
- Very quiet (0.15 amp) so it feels like a subtle background
- Lasts 8 seconds, then loops

**Explanation of new concepts**:

- `let lfo = ...`: define a local variable inside the synth function
- `sin(2 * pi * 0.1 * t)`: generate a slow oscillation (0.1 Hz = 10 second cycle)
- `freq * (1 + lfo)`: modulate the frequency by ±50% (scale from 0.5× to 1.5× original)
- **FM synthesis**: varying frequency over time creates a "breathing" effect

**Try it**:
- Change `0.1` to `0.05` → slower wobble (20 second cycle)
- Change `0.1` to `0.5` → faster wobble (2 second cycle)
- Change `lfo = 0.5 * sin(...)` to `lfo = 0.2 * sin(...)` → less extreme pitch shift (more subtle)
- Change `note: 60` to `note: 55` → lower fundamental (darker mood)

**Listen check**: Does it feel spacious and meditative? If it feels too prominent, lower `amp` to 0.1.

##### **Step 2: Add a Bass Walking Pattern** (20 min)

**Goal**: Introduce motion via a simple bass line. Learn: arrays for sequences, rhythm patterns.

**Code** (`examples/ambient_step_2.scscm`):

```javascript
// ambient_step_2.scscm — Add a walking bass
synth pad = (freq, amp) => {
  let lfo = 0.5 * sin(2 * pi * 0.1 * t);
  let modulated_freq = freq * (1 + lfo);
  amp * sin(2 * pi * modulated_freq * t)
};

synth bass = (freq, amp) => amp * sin(2 * pi * freq * t);

// Pad voice (unchanged)
pattern {
  note: 60,
  dur: 8,
  amp: 0.15
}

// Bass walking line (new)
pattern {
  note: [36, 38, 40, 38],    // C2, D2, E2, D2 (walking up and back down)
  dur: 2,                     // each note 2 seconds
  amp: 0.25
}
```

**What you'll hear**:
- The pad still there, but now underneath a slow bass line
- Bass notes: C2 → D2 → E2 → D2 (walking pattern repeats)
- Each bass note lasts 2 seconds (full pattern = 8 seconds, same loop length as pad)
- Bass is louder (0.25) so it anchors the harmony

**Explanation**:

- `note: [36, 38, 40, 38]`: array of 4 notes
- When used with `dur: 2`, scscm plays each note for 2 seconds sequentially
- Total: 4 notes × 2 sec = 8 seconds (syncs with pad loop)
- **MIDI note 36 = C2** (very low, bass register); 38 = D2; 40 = E2

**Try it**:
- Change the walking pattern: `[36, 40, 43, 40]` (wider leaps)
- Add more notes: `[36, 38, 40, 41, 40, 38]` (more motion, faster)
- Change `dur: 2` to `dur: 1` → bass moves faster (8 notes in 8 sec)
- Add another pad on a different note: `note: 62, dur: 8, amp: 0.12` (third voice)

**Listen check**: Does the bass feel like it grounds the pad? Or does it fight it? If fighting, try lower bass amplitude (0.2 instead of 0.25).

##### **Step 3: Add a Melody with Constraints** (25 min)

**Goal**: Introduce intentional randomness. Learn: random functions, scale constraints, probability.

**Code** (`examples/ambient_step_3.scscm`):

```javascript
// ambient_step_3.scscm — Add constrained melody
synth pad = (freq, amp) => {
  let lfo = 0.5 * sin(2 * pi * 0.1 * t);
  let modulated_freq = freq * (1 + lfo);
  amp * sin(2 * pi * modulated_freq * t)
};

synth bass = (freq, amp) => amp * sin(2 * pi * freq * t);

synth melody = (freq, amp) => {
  let envelope = exp(-2 * t);     // fade out over time (exponential decay)
  envelope * amp * sin(2 * pi * freq * t)
};

// Pad
pattern {
  note: 60,
  dur: 8,
  amp: 0.15
}

// Bass
pattern {
  note: [36, 38, 40, 38],
  dur: 2,
  amp: 0.25
}

// Melody (new)
let scale = [60, 62, 64, 65, 67, 69, 71];  // C major scale starting at C4
pattern {
  note: random(scale),        // pick a random note from the scale
  dur: random([0.5, 1, 1.5]), // vary the duration
  amp: 0.3
}
```

**What you'll hear**:
- The pad and bass continue as before
- A new higher voice that plays random notes from the C major scale
- Each note lasts 0.5, 1.0, or 1.5 seconds (randomized)
- Melodic line feels organic, never the same twice, but always in-key

**Explanation**:

- `let scale = [60, 62, 64, ...]`: define a scale (C major: C-D-E-F-G-A-B)
- `random(scale)`: pick a random element from the array
- `random([0.5, 1, 1.5])`: pick a random duration
- `let envelope = exp(-2 * t)`: exponential decay envelope (note gets quieter over time) — adds musicality to quick notes

**Key insight**: Randomness within a scale sounds like intentional variation, not chaos. A random note from C major will always fit with C major bass/pad.

**Try it**:
- Change the scale: `let scale = [60, 63, 65, 67, 70];` (pentatonic, more "meditative")
- Remove the envelope: change `melody = ...` to just `amp * sin(...)` (straighter timbre)
- Add a lower melody: another `pattern { note: random([48, 50, 52, 53, 55]), dur: 1, amp: 0.2 }`
- Make melody more likely to repeat: `note: random([random(scale), random(scale), random(scale), 64])` (mostly scale, but biased toward C4)

**Listen check**: Does the melody feel random or chaotic? If chaotic, try a simpler scale (pentatonic). Does it feel alive? If static, add more variation to `dur`.

##### **Step 4: Add High-Frequency Texture** (25 min)

**Goal**: Finalize the soundscape with shimmer. Learn: granular techniques, mixing multiple voices.

**Code** (`examples/ambient_step_4.scscm`):

```javascript
// ambient_step_4.scscm — Complete ambient patch
synth pad = (freq, amp) => {
  let lfo = 0.5 * sin(2 * pi * 0.1 * t);
  let modulated_freq = freq * (1 + lfo);
  amp * sin(2 * pi * modulated_freq * t)
};

synth bass = (freq, amp) => amp * sin(2 * pi * freq * t);

synth melody = (freq, amp) => {
  let envelope = exp(-2 * t);
  envelope * amp * sin(2 * pi * freq * t)
};

synth granular = (freq, amp) => {
  let grain_density = 10;  // ~10 grains per second
  let grain_dur = 0.05;    // each grain is 50 ms
  let grain_phase = (t * grain_density) % 1;  // repeating sawtooth, 0-1
  let in_grain = grain_phase < grain_dur * grain_density ? 1 : 0;  // trigger pulse
  let freq_shimmer = freq * (1 + 0.5 * sin(2 * pi * t * 2));  // shimmer at 2 Hz
  in_grain * amp * sin(2 * pi * freq_shimmer * t)
};

// Pad
pattern {
  note: 60,
  dur: 8,
  amp: 0.15
}

// Bass
pattern {
  note: [36, 38, 40, 38],
  dur: 2,
  amp: 0.25
}

// Melody
let scale = [60, 62, 64, 65, 67, 69, 71];
pattern {
  note: random(scale),
  dur: random([0.5, 1, 1.5]),
  amp: 0.3
}

// High texture (new)
pattern {
  note: random([84, 86, 88, 90, 91]) ,  // high notes (C5 and up)
  dur: random([0.2, 0.3, 0.4]),         // short bursts
  amp: 0.08                              // quiet shimmer
}
```

**What you'll hear**:
- A complete soundscape: low pad, walking bass, melodic line, and high shimmer
- High texture adds sparkle without overwhelming (quiet, brief notes)
- Altogether feels like a coherent piece, each layer playing its role

**Explanation**:

- `granular` synth: simplified granular synthesis (triggered bursts at a high frequency)
- `grain_density = 10`: 10 grain triggers per second
- `freq_shimmer`: high note pitch wobbles at 2 Hz for extra shimmer
- High notes (84+): high register, above the main melody, adds brightness

**Try it**:
- Add more high voices: duplicate the high texture pattern with different scales/amps
- Slow the granular rate: `grain_density = 5` → sparser texture
- Change high note scale: `[80, 82, 84, 85, 86]` (different timbre)
- Add a very low sub-bass: `note: 24, dur: 8, amp: 0.1` (sub-audio frequencies for feel)

**Listen check**: Does it feel complete and balanced? If shimmers too loud, lower to 0.05. If too sparse, add more high texture voices.

#### 3. **Pattern Design Patterns** (20 min)

Now that you have a working patch, understand the **design choices** that make it work:

**Euclidean Rhythms**:
- Distribute N events across M beats evenly
- Example: 3 events in 8 beats = [1, 0, 0, 1, 0, 0, 1, 0] (every 2-3 beats)
- Creates natural, "groove" feel without sounding mechanical
- Use case: bass line rhythm, drum patterns

**Scale Constraints**:
- Define a scale (pentatonic, diatonic, chromatic); always choose notes from it
- Prevents accidental pitch clashes
- Pentatonic (5 notes) feels folk/ambient; chromatic (12 notes) feels dense

**Layered Repetition**:
- Main melody: clear pattern (8 or 16 beat loop)
- Accompaniment: slower (bass), same loop length, different notes
- Texture: faster random events, still in-key
- Result: groove at multiple time scales simultaneously

**Probabilistic Variation**:
- Random within constraints (e.g., 80% scale notes, 20% chromatic "accents")
- Random duration (long holds + short bursts) feels organic
- Random amplitude (soft melody + rare loud punctuation)
- vs. Deterministic: fixed pattern plays identically each time (less interesting long-form)

#### 4. **Live Modification Techniques** (15 min)

**In a live performance, you don't stop to edit.** You redefine patterns on the fly:

**Technique 1: Redefine arrays**
```javascript
// Before (baseline)
pattern { note: [60, 62, 64, 65], dur: 1, amp: 0.3 }

// Mid-performance, type (in REPL):
// → note: [67, 69, 71, 72]  // higher harmony, still same rhythm
```
The next pattern cycle uses the new notes. No restart needed.

**Technique 2: Swap functions**
```javascript
// Before
synth melody = (freq, amp) => amp * sin(2 * pi * freq * t);

// During
synth melody = (freq, amp) => {
  // Add FM modulation
  let mod = 10 * sin(2 * pi * 5 * t);
  amp * sin(2 * pi * (freq + mod) * t)
};
```
Next note plays with the new timbre.

**Technique 3: Gradual parameter sweep**
```javascript
// Fade in a new voice over 4 cycles:
pattern { note: 72, dur: 8, amp: 0 }     // silent
// → amp: 0.05                             // cycle 1
// → amp: 0.1                              // cycle 2
// → amp: 0.2                              // cycle 3 (full volume)
```

**When to reset vs. when to evolve**:
- **Reset** (stop and restart everything): major structural change (new synth, new scale, key change)
- **Evolve** (change patterns on the fly): variation within structure (new melody notes, tempo, amplitude)

#### 5. **Debugging by Ear** (10 min)

**Common problems and how to hear them**:

| Problem | How it sounds | Fix |
|---------|---------------|-----|
| Notes out of sync | Jittery, uneven timing | Check `dur` values sum to same total as other voices |
| Wrong scale | Dissonant, clashing | Verify all notes in arrays match the scale |
| Too many simultaneous notes | Muddy, cacophony | Lower `amp` or reduce number of active patterns |
| Timing inconsistency | Rhythm feels off, not groovy | Ensure `dur` values are multiples of a common beat |
| Envelope too slow | Notes never really start | Reduce `exp` decay rate (e.g., `exp(-5 * t)` instead of `-2`) |

**Use ear as test suite**: If it sounds wrong, tweak nearest parameter.

#### 6. **Exercises** (30 min)

**Exercise 1: Change the key and mood** (10 min)

Start with `examples/ambient_step_4.scscm`.

1. Change the scale to pentatonic (5 notes): `let scale = [60, 62, 65, 67, 70];` (remove chromatic 64, 69, 71)
2. Lower the pad: `note: 55` (darker background)
3. What changed? How does it feel different?

**Solution sketch** (`examples/exercises/live_coding_1.scscm`):
- Pentatonic is missing half steps → feels more "modal," less Western-classical
- Lower pad adds gravity
- Overall: more meditative, less structured

**Exercise 2: Add a fourth voice** (10 min)

Add a percussion-like high hat or reverb tail:

```javascript
synth hihat = (freq, amp) => {
  let noise = random(-1, 1);     // white noise
  let decay = exp(-10 * t);      // very fast fade
  decay * noise * amp
};

pattern {
  note: 0,                       // (ignored for noise synth)
  dur: 0.2,
  amp: 0.05
}
```

What does the patch sound like now? Too busy or nicely filled out?

**Solution sketch** (`examples/exercises/live_coding_2.scscm`):
- Adds click/texture, fills the soundscape
- If too busy, lower `amp` to 0.02 or increase `dur` to 0.5

**Exercise 3: Make the patch evolve vs. loop predictably** (10 min)

Current patch: random notes but same structure every 8 seconds (all voices loop at 8 sec).

Make it evolve:
- Change `dur: 8` to `dur: random([6, 7, 8, 9, 10])` on the pad (de-sync the loop)
- Change melody scale every 32 seconds: use a "mode" variable that changes over time
- Result: same voices, but never align perfectly, feels ever-changing

**Solution sketch** (`examples/exercises/live_coding_3.scscm`):
- De-sync loop lengths → more organic, less repetitive
- Changing scales → key modulation, even more evolution
- Tradeoff: harder to predict, can become chaotic if too many variables change

### Acceptance Criteria

- A user with music or programming background can follow the entire tutorial in REPL
- All example code (`examples/ambient_step_*.scscm`) runs without errors in the current scscm version
- At each step, the reader can hear the effect of each layer (pad alone → bass added → melody added → texture)
- Each subsection is completable in 15-30 minutes
- Links to LANGUAGE_REFERENCE are present for every new concept (e.g., `exp()` function, array indexing, `random()`)
- Links to CHEAT_SHEET for quick syntax lookups (e.g., `let`, pattern syntax)
- All three exercises have complete solution sketches in `examples/exercises/`
- The final ambient patch (`step_4`) sounds coherent and could be extended further

### Files to Create

- `docs/SCSCM_LIVE_CODING_TUTORIAL.md` (8000-10000 words, ~60-90 min to work through)
- `examples/ambient_step_1.scscm` (pad foundation)
- `examples/ambient_step_2.scscm` (add bass)
- `examples/ambient_step_3.scscm` (add melody)
- `examples/ambient_step_4.scscm` (add texture; complete)
- `examples/exercises/live_coding_1.scscm` (change scale)
- `examples/exercises/live_coding_2.scscm` (add hi-hat)
- `examples/exercises/live_coding_3.scscm` (evolving loops)

---

## Component 4: Pattern-Making Techniques & Ideas

### Purpose

Reference guide for advanced pattern design: algorithms, mathematical structures, and creative strategies. Techniques are modular and can be mixed and matched.

### Format

Technique gallery: each technique is 2-3 pages (theory + code example + variations). Reader can jump to any technique. ~4-6 hours to read all, but techniques are independent—can be read in any order.

### Learning Objectives

By the end of this component, a reader should be able to:
- Understand 15+ specific pattern-generation algorithms
- Recognize when each technique is musically useful
- Combine multiple techniques in a single patch
- Adapt techniques to their own creative goals
- Know the trade-offs (deterministic vs. random, simple vs. complex)

### Detailed Sections

#### **1. Rhythm & Timing**

##### **1.1 Euclidean Rhythms**

**Purpose**: Distribute N onset events across M beats as evenly as possible. Feels "natural" and groovy.

**Intuition**: If you want 3 drum hits spread over 8 beats, the "most even" distribution is beats [0, 3, 5] (roughly every 2-3 beats). This avoids the mechanical regularity of a simple repeating pattern.

**Algorithm**:
1. Start with an empty M-beat grid
2. Distribute N events across it such that gaps between events are as equal as possible
3. Classic example (invented by Godfried Toussaint): Euclidean(3, 8) = [1, 0, 1, 0, 1, 0, 0, 0] (3 hits in 8 beats)

**Code example** (`examples/techniques/euclidean.scscm`):

```javascript
// Helper: generate Euclidean pattern
fn euclidean(n, m) {
  let pattern = [];
  for i in range(m) {
    let should_hit = (i * n) % m < n;  // simple distributing rule
    pattern.push(should_hit ? 1 : 0);
  }
  return pattern;
}

synth kick = (freq, amp) => {
  let envelope = exp(-5 * t);
  envelope * amp * sin(2 * pi * freq * t)
};

// Use Euclidean(5, 8) for a dance rhythm
let kick_pattern = euclidean(5, 8);  // [1, 1, 0, 1, 1, 0, 1, 0]
let kick_notes = [];
for i in range(8) {
  if kick_pattern[i] {
    kick_notes.push(45);  // sub-bass kick
  }
}

pattern {
  note: kick_notes,
  dur: 0.5,             // 8 hits × 0.5 sec = 4 sec loop
  amp: 0.4
}
```

**What you hear**: 5 kick drums spread evenly across 8 beats, feels groovy and dance-like.

**Variations**:
- Euclidean(7, 16): complex polyrhythmic kick
- Rotate the pattern: `[1, 0, 1, 0, 1, 0, 0, 0]` → `[0, 1, 0, 1, 0, 0, 0, 1]` (shifts the "feel" while keeping the same count)
- Combine multiple Euclidean rhythms in different instruments for emergent polyrhythm

**Cross-reference**: LANGUAGE_REFERENCE for `%` (modulo), `for` loop, `exp()` function.

**Creative use case**: Drums, hi-hats, melodic rhythm (staccato notes with Euclidean spacing).

---

##### **1.2 Polyrhythms**

**Purpose**: Multiple rhythms at different loop lengths running simultaneously. Creates complex, self-evolving cycles.

**Intuition**: If instrument A loops every 4 beats and instrument B every 6 beats, they'll align every 12 beats (LCM = 4×6/GCD = 12). They drift apart, then re-sync, creating emergent variation.

**Code example** (`examples/techniques/polyrhythm.scscm`):

```javascript
synth bass = (freq, amp) => amp * sin(2 * pi * freq * t);
synth high = (freq, amp) => amp * sin(2 * pi * freq * t);

// Rhythm 1: loop every 4 sec (4 notes × 1 sec)
pattern {
  note: [40, 42, 44, 42],
  dur: 1,
  amp: 0.3
}

// Rhythm 2: loop every 6 sec (3 notes × 2 sec)
pattern {
  note: [60, 64, 62],
  dur: 2,
  amp: 0.2
}

// They re-align every LCM(4, 6) = 12 seconds
// Create 5+ minutes of evolving variation just from these two loops
```

**What you hear**: First 12 seconds feel "new," then they almost-but-not-quite repeat. Minimal code, but endless variation.

**Variations**:
- Use coprime numbers (5 and 7, 3 and 11) for longer periods before repeat
- Gradually change tempo on one loop (time stretch one voice)
- Add a third rhythm at a different multiple (e.g., 4, 6, 9 beats → LCM = 36 sec)

**Creative use case**: Generative/ambient music, minimalist composition, polyrhythmic jazz/afrobeat.

---

##### **1.3 Syncopation via Phase Shift**

**Purpose**: Shift a regular rhythm off the beat. Adds tension, bounce, or "swing."

**Intuition**: A kick on beat 1 and 3 feels square. Move it slightly early (syncopate), and it feels playful or urgent.

**Code example** (`examples/techniques/syncopation.scscm`):

```javascript
synth kick = (freq, amp) => exp(-4 * t) * amp * sin(2 * pi * freq * t);

// Straight kick: beats 0, 2, 4, 6 (quarter notes)
let straight = [0, 2, 4, 6];

// Syncopated: shift every other kick 0.4 beats early (adds swing)
let syncopated = [0, 1.6, 4, 5.6];

// To play syncopated timing, use irregular dur values:
pattern {
  note: [45, 45, 45, 45],
  dur: [1.6, 2.4, 1.6, 2.4],   // alternates off-beat
  amp: 0.3
}
```

**What you hear**: Steady kicks that push and pull against the implicit beat. Feels alive, not mechanical.

**Variations**:
- Swing ratio (triplet feel): 2:1 ratio on offbeats (e.g., 0.66 and 1.33 instead of 1 and 1)
- Gradual phase shift: slowly change the offset over time (e.g., `dur: [1.6, 2.4, 1.55, 2.45, 1.5, 2.5, ...]`)

**Creative use case**: Funk/groove, adding humanization, intentional tension.

---

#### **2. Pitch & Harmony**

##### **2.1 Scale Modes and Character**

**Purpose**: Use different modes of a scale to evoke different moods without changing the notes.

**Intuition**: Major scale: C-D-E-F-G-A-B. If you start on a different note and use the same scale, it feels different:
- Start on C (Ionian/Major): bright, resolved
- Start on D (Dorian): minor, jazzy
- Start on E (Phrygian): dark, Spanish
- Start on G (Mixolydian): rock, dominant

**Code example** (`examples/techniques/modes.scscm`):

```javascript
// All built from the same 7 notes: C-D-E-F-G-A-B (C major scale)
// But starting from different roots

let c_major = [60, 62, 64, 65, 67, 69, 71];        // C Ionian (major, bright)
let d_dorian = [62, 64, 65, 67, 69, 71, 60];       // D Dorian (minor, jazzy)
let e_phrygian = [64, 65, 67, 69, 71, 60, 62];     // E Phrygian (dark, exotic)
let g_mixolydian = [67, 69, 71, 60, 62, 64, 65];   // G Mixolydian (rock, funky)

synth melody = (freq, amp) => amp * sin(2 * pi * freq * t);

// Same melody pattern, different modes
pattern {
  note: random(c_major),
  dur: 0.5,
  amp: 0.3
}

// To switch to Dorian, just redefine during performance:
// → note: random(d_dorian)
```

**What you hear**: 
- C major: happy, resolved, complete
- D Dorian: minor vibe, but less dark than natural minor
- E Phrygian: exotic, minor, almost Spanish
- G Mixolydian: bluesy, "unresolved" dominant

All use the same 7 pitches, just different starting points.

**Variations**:
- Transpose modes up/down by octave to create bass/melody registers
- Layer multiple modes simultaneously (one voice in Dorian, one in Mixolydian) for harmonic tension
- Change modes every 8 bars for implied key modulation without changing notes

**Creative use case**: Ambient, jazz, world music, creating harmonic color without chord changes.

---

##### **2.2 Arpeggiation Strategies**

**Purpose**: Break a chord into individual notes in different patterns. Common technique for creating movement.

**Intuition**: Chord C-E-G (C major) can be played:
- Up: C → E → G → C (ascending)
- Down: G → E → C (descending)
- Random: E → C → G → E (unpredictable)
- Alternating: C → G → E → G → C → G → ... (bouncing between outer notes)

**Code example** (`examples/techniques/arpeggiation.scscm`):

```javascript
let chord = [60, 64, 67];  // C major triad: C, E, G

// Strategy 1: ascending arpeggio
let ascending = [60, 64, 67, 72];  // up octave, then repeat

// Strategy 2: descending
let descending = [67, 64, 60, 55];  // down from high

// Strategy 3: alternating (pedal point on C)
let alternating = [60, 67, 60, 64, 60, 67, 60, 64];

// Strategy 4: random permutation
let random_arp = [random(chord), random(chord), random(chord)];

synth arp = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: alternating,
  dur: 0.25,   // fast
  amp: 0.2
}
```

**What you hear**:
- Ascending: uplifting, energetic
- Descending: winding down, reflective
- Alternating: rhythmic, hypnotic (like a finger-picking pattern)
- Random: playful, less predictable

**Variations**:
- Harp roll: very fast ascending/descending (dur: 0.1)
- Octave jump: alternate between octaves (e.g., 60 and 72)
- Walking arpeggio: move through chord members in sequence, then move to next chord
- Permutation: systematically reorder (C-E-G, E-G-C, G-C-E) to cycle through rotations

**Creative use case**: Chordal accompaniment, fingerpicking guitar simulation, string arrangements.

---

##### **2.3 Constraint Satisfaction**

**Purpose**: Keep pitches within a range while still sounding intentional. Prevent unwanted leaps.

**Intuition**: Random walk in a scale: from current note, only jump to adjacent notes in the scale. Sounds vocal/natural (singers don't jump wildly).

**Code example** (`examples/techniques/constrained_walk.scscm`):

```javascript
let scale = [60, 62, 64, 65, 67, 69, 71];  // C major scale

// Constrain motion: from current note, pick only adjacent scale tones
fn next_note(current_index, scale) {
  let options = [];
  if current_index > 0 {
    options.push(scale[current_index - 1]);  // down one step
  }
  options.push(scale[current_index]);         // same note
  if current_index < len(scale) - 1 {
    options.push(scale[current_index + 1]);  // up one step
  }
  return random(options);
}

// Generate a constrained melody
let melody = [60];  // start at C
for i in range(10) {
  let current_idx = scale.find(melody[len(melody) - 1]);  // find index of last note
  melody.push(next_note(current_idx, scale));
}

synth voice = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: melody,
  dur: 0.5,
  amp: 0.3
}
```

**What you hear**: Melody that wanders unpredictably but always sounds like a coherent vocal line (no shocking leaps).

**Variations**:
- Larger leap options: allow jumps of 2-3 scale steps (less constrained, more dramatic)
- Bias toward certain directions: `options = [down_step, down_step, same, up_step]` (weighted random)
- Avoidance: forbid certain intervals (e.g., no tritones)
- Contour direction: track whether it's been ascending/descending, bias toward reversal (creates shape)

**Creative use case**: Vocal melody simulation, lyrical instrumental lines, avoiding harsh intervallic jumps.

---

#### **3. Texture & Timbre**

##### **3.1 Granular Synthesis**

**Purpose**: Create evolving textures by layering many short sound bursts ("grains"). Useful for pads, noise, shimmer.

**Intuition**: A grain is a very short sound (~10-100 ms). Layer thousands, and they blend into a texture. Vary the pitch/timing of grains slightly, and you get a shimmering pad.

**Code example** (`examples/techniques/granular.scscm`):

```javascript
synth granular_pad = (freq, amp) => {
  let grain_rate = 50;                // 50 grains per second
  let grain_dur = 0.02;               // each grain: 20 ms
  
  // Repeating pulse: trigger every 1/grain_rate seconds
  let phase = (t * grain_rate) % 1;
  let is_in_grain = phase < (grain_dur * grain_rate) ? 1 : 0;
  
  // Frequency shimmer: vary freq by ±50% with slow LFO
  let freq_lfo = freq * (1 + 0.5 * sin(2 * pi * 0.5 * t));
  
  // Amplitude envelope: each grain decays internally
  let grain_env = exp(-40 * (phase % (grain_dur * grain_rate)));
  
  is_in_grain * grain_env * amp * sin(2 * pi * freq_lfo * t)
};

pattern {
  note: 50,        // low, spacious frequency
  dur: 8,          // hold for 8 seconds
  amp: 0.2
}
```

**What you hear**: Shimmering, cloud-like pad. Sounds organic, evolving, never static.

**Variations**:
- Grain pitch: randomize `freq` per grain for "sparkle" effect
- Density: increase `grain_rate` to 200+ for denser, buzzy texture
- Envelope: use `exp()` decay or linear ramp for different grain shapes
- Multiple frequencies: sum grains at different pitches (chord shimmer)

**Creative use case**: Ambient pads, evolving textures, background shimmer, granular soundscapes.

---

##### **3.2 Noise and Spectral Complexity**

**Purpose**: Add raw, chaotic energy. Useful for texture, effects, "air."

**Intuition**: White noise = all frequencies at once, sounds like static. Filtered noise = noise with some frequencies boosted (sounds more "musical"). Colored noise (pink, brown) has different spectral balances.

**Code example** (`examples/techniques/filtered_noise.scscm`):

```javascript
fn white_noise() {
  return random(-1, 1);
}

fn pink_noise() {
  // Simplified pink noise: filter white noise with low-pass
  // Real implementation would use historical sample accumulation
  let white = white_noise();
  let filtered = white * 0.5 + (prev_pink * 0.5);  // simple IIR filter
  return filtered;
}

synth noise_texture = (freq, amp) => {
  let noise = white_noise();
  let freq_filter = freq;  // control spectral brightness
  
  // Simulate low-pass by attenuating high frequencies
  // (Simplified; real filter would use DSP)
  let filtered = noise * sin(2 * pi * freq_filter * t);
  
  amp * filtered
};

pattern {
  note: 5000,   // "frequency" controls noise brightness/filtering
  dur: 2,
  amp: 0.1      // keep noise quiet so it blends
}
```

**What you hear**: Whooshing, breathy noise texture. Adds "air" and organic quality to patches.

**Variations**:
- Noise gates: fade noise in and out (via `amp` modulation)
- Colored noise: pink/brown noise sounds mellower than white
- Spectral shaping: boost certain frequencies (e.g., boost high for "bright" noise, boost low for "warm")
- Noise bursts: short (0.1 sec) staccato noise events mixed with pitched synths

**Creative use case**: Wind/breath sounds, texture, adding "humanness," noise percussion, filter automation.

---

#### **4. Repetition & Variation**

##### **4.1 Theme and Variations**

**Purpose**: Repeat a pattern, changing one parameter at a time. Creates recognizability with evolution.

**Intuition**: Theme = 4-bar melody. Variation 1: same melody, higher octave. Variation 2: same melody, different rhythm. Variation 3: same rhythm, different pitch. Listener recognizes the skeleton.

**Code example** (`examples/techniques/theme_variations.scscm`):

```javascript
let theme = [60, 62, 64, 65, 67];  // simple 5-note melody

// Variation 1: same pitches, slower
pattern {
  note: theme,
  dur: 1,
  amp: 0.3
}

// Variation 2: transposed up an octave, same rhythm
pattern {
  note: [60 + 12, 62 + 12, 64 + 12, 65 + 12, 67 + 12],  // octave up
  dur: 1,
  amp: 0.25
}

// Variation 3: same pitches, different rhythm (long-short-long)
pattern {
  note: theme,
  dur: [2, 0.5, 1, 0.5, 2],
  amp: 0.3
}

// Variation 4: transposed down, inverted (upside-down melody)
// (more complex; requires computing mirror around a pivot note)
```

**What you hear**: The melodic contour repeats, but each version feels fresh. Still feels like one piece.

**Variations**:
- Retrograde: play theme backwards
- Inversion: flip intervals (up becomes down)
- Augmentation: double all note durations
- Diminution: halve all note durations
- Combination: inversion + retrograde = retrograde-inversion

**Creative use case**: Classical minimalism, theme-based composition, building coherent pieces, recognizable motifs.

---

##### **4.2 Canons and Rounds**

**Purpose**: Layer the same pattern with different delays. Creates a "chasing" effect.

**Intuition**: Voice 1 plays theme, then Voice 2 enters 2 beats later playing the same theme, then Voice 3 enters 2 beats after that. All voices in canon (round-like).

**Code example** (`examples/techniques/canon.scscm`):

```javascript
let theme = [60, 62, 64, 65, 67, 69, 71, 69];  // 8-note melody

synth voice = (freq, amp) => amp * sin(2 * pi * freq * t);

// Voice 1: starts at time 0
pattern {
  note: theme,
  dur: 0.5,
  amp: 0.3
}

// Voice 2: same theme, but with delay (later in the loop)
// Trick: prepend silence to shift the pattern
pattern {
  note: [0, 0, 0, 0] + theme,  // 2 beats of silence, then theme (0 = silence/rest)
  dur: 0.5,
  amp: 0.25
}

// Voice 3: 4 beats later
pattern {
  note: [0, 0, 0, 0, 0, 0, 0, 0] + theme,
  dur: 0.5,
  amp: 0.2
}
```

**What you hear**: Voices enter in sequence, stacking up. All singing the same tune but offset. Creates harmonic complexity from a simple melody.

**Variations**:
- Different delays: 1 beat, 3 beats, etc.
- Different tempos: Voice 2 twice as fast as Voice 1
- Retrograde canon: Voice 2 plays theme backwards
- Different transpositions: Voice 2 plays theme up a fifth

**Creative use case**: Bach-inspired canons, minimalist loops, complex harmony from simple melody.

---

##### **4.3 Permutation and Rotation**

**Purpose**: Reorder a pattern systematically. Creates variation while keeping the same material.

**Intuition**: Motif = [C, E, G]. Rotate: [E, G, C], then [G, C, E]. Same three notes, different order, feels different.

**Code example** (`examples/techniques/permutation.scscm`):

```javascript
let motif = [60, 64, 67];  // C, E, G

// Rotation 1: original
let rot_1 = [60, 64, 67];

// Rotation 2: shift left by 1
let rot_2 = [64, 67, 60];

// Rotation 3: shift left by 2
let rot_3 = [67, 60, 64];

synth note_player = (freq, amp) => amp * sin(2 * pi * freq * t);

// Play all three rotations in sequence
pattern {
  note: rot_1 + rot_2 + rot_3,  // concatenate
  dur: 0.5,
  amp: 0.3
}
```

**What you hear**: The same three pitches appear in different orders, creating a sense of reordering/transformation.

**Variations**:
- Systematic permutation: generate all possible orderings (3! = 6 for 3 notes)
- Weighted permutations: some orderings more likely than others
- Transposition + rotation: transpose, then rotate
- Interval inversion: flip the intervals between notes

**Creative use case**: Serialist/12-tone composition, generating themes, exploring harmonic space systematically.

---

##### **4.4 Fractals and Self-Similarity**

**Purpose**: Create patterns that look similar at different time scales. Feels coherent without being repetitive.

**Intuition**: A rhythm at the beat level matches a rhythm at the measure level. E.g., if beats follow [long, short, short], measures might also follow [long, short, short].

**Code example** (`examples/techniques/fractal.scscm`):

```javascript
// Fractal rhythm: same pattern at different scales
let micro_rhythm = [0.5, 0.25, 0.25];     // beat-level: 3 hits in 1 beat
let macro_rhythm = [4, 2, 2];             // measure-level: measures of length 4, 2, 2

// Combine: micro pattern plays within each macro measure
// Result: self-similar rhythm at multiple time scales

let melody_scale = [60, 62, 64, 65, 67];  // pentatonic

let full_pattern = [];
for macro in macro_rhythm {
  for micro in micro_rhythm {
    full_pattern.push(random(melody_scale));
  }
}

synth fractal_synth = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: full_pattern,
  dur: micro_rhythm,  // play micro durations
  amp: 0.3
}
```

**What you hear**: Rhythm feels natural, with echoes of the same pattern at different scales. Feels "intentional" not random.

**Variations**:
- Tree fractals: divide each beat into smaller beats following the same pattern
- Mandelbrot-inspired: use recursive self-similarity (beat n contains a miniature copy of the whole pattern)
- Spectral fractals: frequency ratios at multiple scales

**Creative use case**: Generative music, natural-sounding rhythms, minimalist compositions, evolving pieces.

---

#### **5. Interactive & Responsive**

##### **5.1 Data-Driven Patterns**

**Purpose**: Load data from external sources (files, APIs) and use it to generate patterns. Bridges live coding and data visualization.

**Intuition**: Read a list of integers from a file, map them to MIDI notes, play them. Now the pattern is data-dependent; changing the data changes the music.

**Code example** (`examples/techniques/data_driven.scscm`):

```javascript
// Simulated data: read from external source
let data = [5, 12, 8, 15, 3, 10, 7, 14];  // e.g., stock prices, sensor values

// Map data to musical range (scale the data to MIDI octave)
fn scale_to_midi(value, data_min, data_max, note_min, note_max) {
  let normalized = (value - data_min) / (data_max - data_min);
  return note_min + normalized * (note_max - note_min);
}

let data_min = 3;
let data_max = 15;

let melody = [];
for value in data {
  melody.push(scale_to_midi(value, data_min, data_max, 60, 72));
}

synth data_synth = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: melody,
  dur: 0.5,
  amp: 0.3
}
```

**What you hear**: Music derived from external data. Patterns emerge from the data structure.

**Variations**:
- Map data to durations: slower/faster based on data values
- Map to amplitude: louder/quieter
- Combine multiple data sources: one for pitch, one for rhythm, one for timbre
- Real-time streaming: read data from a network source, update pattern live

**Creative use case**: Sonification (turning data into sound), interactive installations, performance with live data feeds.

---

##### **5.2 Reactive Changes**

**Purpose**: Modify patterns in response to external input (MIDI keyboard, OSC messages, network events).

**Intuition**: User presses a key, synth responds with a new scale or changes the tempo. Real-time interaction between performer and algorithm.

**Code example** (`examples/techniques/reactive.scscm`):

```javascript
// Pseudo-code: subscribe to MIDI input
on_midi_note_down(midi_note) {
  // Change scale based on note pressed
  if midi_note == 60 {
    current_scale = c_major;
  } else if midi_note == 62 {
    current_scale = d_dorian;
  }
}

on_midi_control_change(cc_number, value) {
  if cc_number == 1 {  // modulation wheel
    tempo = value / 128 * 2;  // map 0-127 to 0-2x tempo
  }
}

// Main pattern uses current_scale and tempo
let current_scale = c_major;
let tempo = 1;

pattern {
  note: random(current_scale),
  dur: 0.5 / tempo,  // scale dur by tempo
  amp: 0.3
}
```

**What you hear**: Pattern changes in real-time as you interact with a MIDI controller or external input.

**Variations**:
- Network input: receive OSC messages to change patterns
- Sensor input: use accelerometer, microphone, or other sensor data to modulate
- User gestures: mouse position, touch screen, game controller
- Feedback loop: output of one synth feeds input of another

**Creative use case**: Live performance, interactive installations, human-machine improvisation.

---

##### **5.3 State Machines**

**Purpose**: Define discrete "states" and transitions between them. Pattern changes in response to internal logic, not random.

**Intuition**: A pattern has states: ["intro", "build", "climax", "decay"]. It spends 8 bars in intro, then transitions to build after a certain condition (e.g., time elapsed). Each state plays different patterns.

**Code example** (`examples/techniques/state_machine.scscm`):

```javascript
let current_state = "intro";
let state_time = 0;
let state_duration = 8;  // 8 bars per state

fn transition() {
  state_time = state_time + 1;
  if state_time >= state_duration {
    if current_state == "intro" {
      current_state = "build";
    } else if current_state == "build" {
      current_state = "climax";
    } else if current_state == "climax" {
      current_state = "decay";
    }
    state_time = 0;
  }
}

fn get_pattern_for_state(state) {
  if state == "intro" {
    return [60, 64, 67];  // simple triad
  } else if state == "build" {
    return [60, 64, 67, 71];  // add more notes
  } else if state == "climax" {
    return [60, 64, 67, 71, 60, 64, 67, 71];  // fast repetition
  } else {
    return [67, 64, 60];  // descending, winding down
  }
}

synth state_synth = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: get_pattern_for_state(current_state),
  dur: 0.5,
  amp: 0.3
}

// Each cycle: call transition() to advance state
transition();
```

**What you hear**: Pattern evolves through distinct phases. Feels like a narrative arc: introduction, building tension, climax, resolution.

**Variations**:
- Conditional transitions: move to next state only if a condition is met (e.g., randomness: 10% chance per cycle)
- Time-based: spend a fixed duration in each state
- Event-based: transition on external signal (MIDI note, OSC message)
- Sub-states: states within states (fractals of behavior)

**Creative use case**: Structured compositions, narrative arcs, emergent storytelling, performance pieces.

---

#### **6. Hybrid & Experimental**

##### **6.1 Combining Live Coding with Pre-Rendered Audio**

**Purpose**: Blend generative synth with recorded samples. Leverage best of both worlds.

**Intuition**: Record a drum loop. Play it alongside generative bass and melody. Synths lock to the tempo of the sample.

**Code example** (`examples/techniques/hybrid_live_prerendered.scscm`):

```javascript
// (Pseudo-code; assume sample playback API exists)
let drum_sample = load_sample("examples/drums.wav");
play_looped(drum_sample, tempo: 120);

// Generative synths now sync to drum tempo
let bass_notes = [36, 38, 40, 38];
let melody_scale = [60, 62, 64, 65, 67];

synth bass = (freq, amp) => amp * sin(2 * pi * freq * t);
synth melody = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: bass_notes,
  dur: 0.5,
  amp: 0.3
}

pattern {
  note: random(melody_scale),
  dur: 0.5,
  amp: 0.2
}
```

**What you hear**: Drums anchor the groove; synths improvise over them, locked to the tempo.

**Variations**:
- Layered samples: multiple drum/bass samples playing simultaneously
- Real-time sample processing: pitch-shift, time-stretch, filter recorded audio
- Loop layering: record a live take, play it back, record another layer, loop them together

**Creative use case**: Blending live performance with loops, sample-based hip-hop/electronic music, hybrid productions.

---

##### **6.2 Markov Chains for Probabilistic Sequences**

**Purpose**: Generate sequences based on probability distributions learned from a "training" sequence. Feels like the original, but generates new variations.

**Intuition**: Analyze a melody: C → D (50%), C → E (30%), C → C (20%). Build a transition table. Generate new melodies: always start with C, then pick next note based on probabilities.

**Code example** (`examples/techniques/markov_chain.scscm`):

```javascript
// Training data: analyze existing melody
let training = [60, 62, 60, 65, 64, 65, 67, 65, 67, 69];

// Build transition table: from each note, what comes next?
fn build_markov_table(sequence) {
  let table = {};
  for i in range(len(sequence) - 1) {
    let current = sequence[i];
    let next = sequence[i + 1];
    
    if !table[current] {
      table[current] = [];
    }
    table[current].push(next);
  }
  return table;
}

let transitions = build_markov_table(training);

// Generate new sequence using Markov chain
fn generate_markov_sequence(table, start_note, length) {
  let sequence = [start_note];
  let current = start_note;
  
  for _ in range(length - 1) {
    if table[current] {
      let options = table[current];
      current = random(options);  // pick a random next note based on table
      sequence.push(current);
    }
  }
  return sequence;
}

let generated = generate_markov_sequence(transitions, 60, 16);

synth markov_synth = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: generated,
  dur: 0.5,
  amp: 0.3
}
```

**What you hear**: Melody that sounds like it was extracted from the training sequence, but is completely new. Feels "natural" because it follows observed transition probabilities.

**Variations**:
- Higher-order chains: track pairs of notes (trigrams), not just single notes
- Weighted probabilities: some transitions more likely than others
- Combine multiple training sequences: blend styles
- Real-time retraining: analyze user input and learn their playing style

**Creative use case**: Algorithmic composition, style learning, infinite variation on a theme.

---

##### **6.3 Agent-Based and Cellular Automata Patterns**

**Purpose**: Define simple rules for individual "agents" that interact. Complex emergent behavior arises from simple interactions.

**Intuition**: Each agent (note generator) has a state (frequency, amplitude). Rules: if neighbor is playing, join in; if alone, solo. Result: emergent waves of sound.

**Code example** (`examples/techniques/cellular_automata.scscm`):

```javascript
// Simple 1D cellular automaton: each cell is a note generator
let grid = [1, 0, 1, 0, 1, 0, 1, 0];  // 8 cells, 1 = active, 0 = inactive

// Rule: a cell is alive next generation if:
// - It is alive and has 1+ alive neighbors, OR
// - It is dead and has exactly 1 alive neighbor
fn next_generation(grid) {
  let new_grid = [];
  for i in range(len(grid)) {
    let left = grid[i - 1] || 0;
    let center = grid[i];
    let right = grid[i + 1] || 0;
    let neighbors = left + right;
    
    let next = 0;
    if center == 1 && neighbors >= 1 {
      next = 1;  // stay alive
    } else if center == 0 && neighbors == 1 {
      next = 1;  // birth
    }
    new_grid.push(next);
  }
  return new_grid;
}

let scale = [60, 62, 64, 65, 67, 69, 71];

// Map grid to pitches: grid[i] = 1 means play scale[i]
let melody = [];
for i in range(len(grid)) {
  if grid[i] == 1 {
    melody.push(scale[i]);
  }
}

synth automata_synth = (freq, amp) => amp * sin(2 * pi * freq * t);

pattern {
  note: melody,
  dur: 0.5,
  amp: 0.3
}

// Every generation, update the grid
grid = next_generation(grid);
```

**What you hear**: Pattern that evolves unpredictably but follows internal logic. Starts simple, develops complexity, may stabilize or oscillate.

**Variations**:
- Conway's Game of Life: more complex rules, richer dynamics
- 2D grids: map to both pitch and volume
- Continuous values: cells have amplitude 0-1, not binary on/off
- Multiple rule sets: switch rules mid-performance

**Creative use case**: Generative, evolving soundscapes, live algorithm performance, exploring emergent behavior musically.

---

### Acceptance Criteria

- Each of the 15+ techniques is presented in a separate, modular section (can be read in any order)
- Every technique has:
  - Clear purpose statement (1 sentence)
  - Intuitive explanation (2-3 sentences, non-technical)
  - Complete, runnable code example
  - "What you hear" section describing the auditory result
  - 2-3 variations on the core technique
  - Use case examples
  - Cross-links to LANGUAGE_REFERENCE for any language features used
- Techniques are organized by category (rhythm, pitch, texture, repetition, interactive, hybrid) but are internally independent
- Code examples use consistent naming and style
- All code examples are tested on CI
- Readers can mix and match techniques (e.g., "Use Euclidean rhythm from Section 1.1 with Markov melody from Section 6.2")
- The document is approachable for intermediate programmers (assume reader has completed QUICK_START and LIVE_CODING_TUTORIAL)

### Files to Create

- `docs/SCSCM_PATTERN_TECHNIQUES.md` (10000-15000 words, ~4-6 hours to read all, but modular)
- Example files in `examples/techniques/`:
  - `euclidean.scscm`
  - `polyrhythm.scscm`
  - `syncopation.scscm`
  - `modes.scscm`
  - `arpeggiation.scscm`
  - `constrained_walk.scscm`
  - `granular.scscm`
  - `filtered_noise.scscm`
  - `theme_variations.scscm`
  - `canon.scscm`
  - `permutation.scscm`
  - `fractal.scscm`
  - `data_driven.scscm`
  - `reactive.scscm` (pseudo-code, as MIDI API may not exist yet)
  - `state_machine.scscm`
  - `hybrid_live_prerendered.scscm` (pseudo-code if sample API doesn't exist)
  - `markov_chain.scscm`
  - `cellular_automata.scscm`

---

## Component 5: Language Reference

### Purpose

Complete, formal specification of scscm syntax, semantics, and built-ins.

### Format

Structured reference (chapters by topic). Used for lookup, not narrative reading. ~40-60 pages.

### Chapters

1. **Lexical Structure** — literals, identifiers, comments, whitespace
2. **Types & Values** — number, string, array, dictionary, function, nil; type coercion
3. **Variables & Binding** — `let`, scoping rules, shadowing, immutability guarantees
4. **Functions** — definition, arguments, closures, tail recursion, higher-order functions
5. **Operators** — precedence table, semantics of each operator
6. **Control Flow** — `if`/`else`/`when`, loop semantics, `break`/`continue`, early return
7. **Built-in Functions** — alphabetical listing with signature, behavior, examples
8. **Pattern Language** — `note`, `dur`, `amp`, `pan`; chaining with `,`; scoping within patterns
9. **Standard Library** — modules, imports (if applicable)
10. **Error Handling** — error types, stack traces, debugging
11. **Performance** — complexity of built-in functions, optimization tips
12. **Appendix: BNF Grammar** — formal syntax definition

### Acceptance Criteria

- Covers 100% of language features
- Each feature has a signature and at least one example
- Cross-indexed (table of contents, internal links)
- Formally correct (matches implementation)
- Kept in sync with language changes via CI checks

### Files to Create

- `docs/SCSCM_LANGUAGE_REFERENCE.md`

---

## Documentation Architecture

### File Structure

```
docs/
├── SCSCM_DOCS_PLAN.md               (this file)
├── SCSCM_CHEAT_SHEET.md             (1-pager)
├── SCSCM_QUICK_START.md             (5-10 min)
├── SCSCM_LIVE_CODING_TUTORIAL.md    (1-2 hours)
├── SCSCM_PATTERN_TECHNIQUES.md      (3-5 hours)
└── SCSCM_LANGUAGE_REFERENCE.md      (reference)

examples/
├── quick_start_1.scscm
├── quick_start_2.scscm
├── ambient_step_1.scscm
├── ambient_step_2.scscm
├── ambient_step_3.scscm
├── ambient_step_4.scscm
├── exercises/
│   ├── live_coding_1.scscm
│   ├── live_coding_2.scscm
│   └── live_coding_3.scscm
└── techniques/
    ├── euclidean.scscm
    ├── polyrhythm.scscm
    ├── arpeggiation.scscm
    ├── granular.scscm
    └── ...
```

### Navigation Map

```
Entry points:
├─ "I want to learn scscm in 5 min"
│  └─> QUICK_START → live_coding_tutorial (if interested)
├─ "I'm stuck on syntax"
│  └─> CHEAT_SHEET → LANGUAGE_REFERENCE
├─ "How do I make <X> pattern?"
│  └─> PATTERN_TECHNIQUES (lookup) → examples
├─ "I want to get creative"
│  └─> LIVE_CODING_TUTORIAL (guided project) → PATTERN_TECHNIQUES
└─ "What does this feature do?"
   └─> LANGUAGE_REFERENCE → examples linked from each section
```

### Cross-Linking

Every document links to others at contextually relevant points:

- QUICK_START → CHEAT_SHEET (for syntax lookup during examples)
- QUICK_START → LIVE_CODING_TUTORIAL (next step after first patch)
- LIVE_CODING_TUTORIAL → PATTERN_TECHNIQUES (learn advanced strategies)
- PATTERN_TECHNIQUES → LANGUAGE_REFERENCE (implement techniques)
- CHEAT_SHEET ↔ LANGUAGE_REFERENCE (detailed explanation of each item)

---

## Phased Implementation

### Phase 1: Foundation (1–2 weeks)

- [ ] Write SCSCM_LANGUAGE_REFERENCE.md (formal, complete)
- [ ] Write SCSCM_CHEAT_SHEET.md (derive from reference)
- [ ] Create quick_start_1.scscm and quick_start_2.scscm (verified to run)

**Acceptance**: Language reference is authoritative and linked; cheat sheet is 1-pager; quick start examples run without errors.

### Phase 2: Quick Start & Basics (1 week)

- [ ] Write SCSCM_QUICK_START.md (using examples from Phase 1)
- [ ] Verify all code examples run end-to-end
- [ ] Add navigation links from Quick Start to other docs

**Acceptance**: A new user can follow QUICK_START and run their first patch in 5 minutes without external help.

### Phase 3: Live Coding Tutorial (2 weeks)

- [ ] Design the ambient patch progression (4 steps)
- [ ] Write SCSCM_LIVE_CODING_TUTORIAL.md
- [ ] Create ambient_step_*.scscm examples
- [ ] Create exercises and solution sketches
- [ ] Internal review: can a musician follow the tutorial?

**Acceptance**: Reader can follow tutorial in REPL; exercises have solution sketches; all examples run.

### Phase 4: Pattern Techniques (2–3 weeks)

- [ ] Identify top 10–15 pattern-design techniques
- [ ] Write SCSCM_PATTERN_TECHNIQUES.md
- [ ] Create example for each technique
- [ ] Cross-link to Language Reference
- [ ] Organize techniques by category (rhythm, pitch, texture, etc.)

**Acceptance**: Each technique has a clear purpose, runnable example, and cross-links; covers common use cases.

### Phase 5: Polish & Integration (1 week)

- [ ] Audit all cross-links (no broken references)
- [ ] Ensure examples use consistent style (naming, indentation)
- [ ] Add to main README as entry point
- [ ] Consider: PDF/HTML export of full suite
- [ ] Update CI to verify all code examples compile/run

**Acceptance**: Documentation is discoverable, internally consistent, and kept in sync with language changes.

---

## Success Metrics

- **Completeness**: 100% of language features documented in reference
- **Discoverability**: a user asking "how do I make a rhythm" finds PATTERN_TECHNIQUES within 2 clicks
- **Learnability**: first-time user reaches a working patch in < 5 minutes (QUICK_START)
- **Depth**: user can go from tutorial → advanced techniques → reference without gaps
- **Maintainability**: adding a language feature requires updates in max 2 documents (reference + cheat sheet)

---

## Known Risks

1. **Examples rot**: code examples may break as scscm evolves. Mitigation: CI test all examples on each commit.
2. **Keeping sync**: multiple documents refer to the same concepts. Mitigation: derive cheat sheet from reference; use consistent terminology.
3. **Scope creep**: temptation to add musicology, signal processing theory, etc. Mitigation: stay focused on scscm-specific techniques; link to external resources.
4. **Audience mismatch**: tutorials may be too slow for experienced programmers, too fast for musicians. Mitigation: multiple entry points (quick start vs. reference); exercises have hints, not solutions.

---

## Next Steps

1. **Phase 1 kickoff**: Start with SCSCM_LANGUAGE_REFERENCE.md using existing docs and source code as reference.
2. **Parallel Phase 1 & 2**: quick start examples can be developed while reference is being written.
3. **Review gates**: After each phase, ask: does this doc meet acceptance criteria? Is it useful?
4. **Feedback loop**: Share drafts with users (musicians, programmers); iterate based on questions they ask.
