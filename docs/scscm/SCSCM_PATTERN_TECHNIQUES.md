# scscm Pattern Techniques

A gallery of pattern-design strategies for scscm. Each technique is independent — read in any order. Every section has a runnable example in `cli/examples/techniques/`.

> **Prerequisites:** [SCSCM_QUICK_START.md](SCSCM_QUICK_START.md) and ideally [SCSCM_LIVE_CODING_TUTORIAL.md](SCSCM_LIVE_CODING_TUTORIAL.md). For language details see [SCSCM_LANGUAGE_REFERENCE.md](SCSCM_LANGUAGE_REFERENCE.md).

---

## Table of Contents

**Rhythm & Timing**
1. [Euclidean Rhythms](#1-euclidean-rhythms)
2. [Polyrhythms](#2-polyrhythms)
3. [Syncopation via Phase Shift](#3-syncopation-via-phase-shift)

**Pitch & Harmony**
4. [Modal Color](#4-modal-color)
5. [Arpeggiation Strategies](#5-arpeggiation-strategies)
6. [Constraint Satisfaction](#6-constraint-satisfaction)

**Texture & Timbre**
7. [Granular Clouds](#7-granular-clouds)
8. [Filtered Noise](#8-filtered-noise)

**Repetition & Variation**
9. [Theme and Variations](#9-theme-and-variations)
10. [Canons and Rounds](#10-canons-and-rounds)
11. [Permutation and Rotation](#11-permutation-and-rotation)

**Interactive & Responsive**
12. [Data-Driven Patterns](#12-data-driven-patterns)
13. [State Machines](#13-state-machines)

**Hybrid & Experimental**
14. [Markov Chains](#14-markov-chains)
15. [Cellular Automata](#15-cellular-automata)
16. [L-Systems for Beats](#16-l-systems-for-beats)
17. [Logic Operations on Beat Patterns](#17-logic-operations-on-beat-patterns)

---

## 1. Euclidean Rhythms

**Idea:** distribute *N* hits across *M* beats as evenly as possible.

The 5-in-8 distribution (`1 0 1 1 0 1 1 0`) is the *tresillo*-plus-two pattern that powers a huge swath of dance music. The 3-in-8 distribution (`1 0 0 1 0 0 1 0`) is the Cuban tresillo itself.

**Code** (`cli/examples/techniques/euclidean.scscm`):

```scheme
(defsynth click (freq 200 amp 0.4 gate 1)
  (var osc (SinOsc.ar freq 0))
  (var env (EnvGen.kr (Env.perc 0.001 0.15) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))

(. (pbind
     :instrument "click"
     :midinote   60
     :dur        0.25
     :amp        (pseq (list 0.5 0 0.5 0.5 0 0.5 0.5 0) inf))
   play)
```

**What you hear:** a 5-against-8 pattern. The amp pattern alternates between `0.5` (hit) and `0` (rest), so the same `:dur 0.25` cell either sounds or stays silent.

**Variations:**

| Pattern        | Use                              |
|----------------|----------------------------------|
| 3-in-8: `1 0 0 1 0 0 1 0`     | Tresillo bassline                |
| 7-in-16: complex distribution | Polyrhythmic hi-hats             |
| Rotated `1 0 1 1 0 1 1 0` → `0 1 0 1 1 0 1 1` | Same density, different "feel" |

---

## 2. Polyrhythms

**Idea:** two voices loop at different lengths; they re-align every LCM(loop1, loop2) beats.

Coprime numbers (3 and 4, 5 and 7) maximise drift before re-alignment. Common time signatures don't.

**Code** (`cli/examples/techniques/polyrhythm.scscm`):

```scheme
; Voice A: 3 notes per second
(. (pbind :instrument "ping" :midinote (pseq (list 60 64 67) inf)
         :dur (/ 1.0 3))
   play)

; Voice B: 4 notes per second
(. (pbind :instrument "ping" :midinote (pseq (list 72 71 69 67) inf)
         :dur 0.25)
   play)
```

**What you hear:** a rolling 3-against-4 figure. Re-aligns every second (LCM(3, 4) = 12 sixteenths).

**Variations:** 5:7 over a longer span; 3:4:5 between three voices; gradually shifting tempo on one voice for a "drift."

---

## 3. Syncopation via Phase Shift

**Idea:** displace the strong beats. Instead of `[1 1 1 1]` durations, use `[2 1 2 1]` for a 2:1 swing.

**Code** (`cli/examples/techniques/syncopation.scscm`):

```scheme
(. (pbind
     :instrument "pluck"
     :midinote   (pseq (list 60 64 67 64) inf)
     :dur        (pseq (list 0.667 0.333) inf))
   play)
```

**What you hear:** a swung version of the same four notes. The first of each pair is twice as long.

**Variations:** triplet feel (3:1), compound (5:3), gradually-shifting (start at 1:1, end at 2:1).

---

## 4. Modal Color

**Idea:** the *same* seven pitches feel different depending on which one you treat as the root.

| Mode       | Root | Character             |
|------------|------|-----------------------|
| Ionian     | C    | bright, "happy"       |
| Dorian     | D    | minor, jazzy          |
| Phrygian   | E    | dark, exotic          |
| Lydian     | F    | dreamy, floating      |
| Mixolydian | G    | bluesy, dominant      |
| Aeolian    | A    | natural minor         |
| Locrian    | B    | unstable, dissonant   |

**Code** (`cli/examples/techniques/modes.scscm`):

```scheme
; D Dorian: D E F G A B C D
(. (pbind
     :instrument "tone"
     :midinote   (pseq (list 62 64 65 67 69 71 72 74) inf)
     :dur        0.25)
   play)
```

**Variations:** lower the 3rd of D Dorian to switch to D minor; raise the 4th of D Dorian to switch to D Lydian. Changing one note changes the mode.

---

## 5. Arpeggiation Strategies

**Idea:** break a chord into a sequence. The order shapes the feel.

| Strategy   | Pattern (C major triad)             | Feel                |
|------------|--------------------------------------|---------------------|
| Up         | `60 64 67 72`                        | rising, hopeful     |
| Down       | `72 67 64 60`                        | falling, reflective |
| Up-down    | `60 64 67 64`                        | settled, stable     |
| Outer↔inner| `60 67 64 67`                        | pendulum, hypnotic  |
| Alberti    | `60 67 64 67`                        | classical pulse     |

**Code** (`cli/examples/techniques/arpeggiation.scscm`):

```scheme
(. (pbind
     :instrument "pluck"
     :midinote   (pseq (list 60 67 64 67 60 67 64 72) inf)
     :dur        0.2)
   play)
```

**Variations:** harp roll (very fast); octave jumps; changing direction on every beat.

---

## 6. Constraint Satisfaction

**Idea:** within randomness, enforce rules. The most common: only step to adjacent scale tones.

**Sketch:**

```scheme
; Conceptual; needs a current-index variable threaded through
(var scale (list 60 62 64 65 67 69 71))

; In a routine or with custom pattern:
;   pick an index near the current one (±1 or stay)
;   read scale[index]
;   that's the next note
```

The result: random walks that always stay in-key and never leap awkwardly. Sounds vocal, not robotic.

**Variations:** weighted directions (bias upward); avoid certain intervals; lock to "target" notes every N steps.

---

## 7. Granular Clouds

**Idea:** tiny tones (10–50 ms) layered densely create a shimmering texture.

**Code** (`cli/examples/techniques/granular.scscm`):

```scheme
(defsynth grain (freq 880 amp 0.05 gate 1)
  (var osc (SinOsc.ar freq 0))
  (var env (EnvGen.kr (Env.perc 0.005 0.05) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))

(. (pbind
     :instrument "grain"
     :midinote   (pwhite 80 92 inf)
     :dur        0.04
     :amp        (pwhite 0.02 0.08 inf))
   play)
```

**What you hear:** a dense cloud of high random tones — a shimmery pad.

**Variations:** narrower pitch range for "swarm" feel; modulate density with an LFO; layer multiple granular voices in different registers.

---

## 8. Filtered Noise

**Idea:** white noise + a moving band-pass filter = wind, ocean, breath.

**Code** (`cli/examples/techniques/filtered_noise.scscm`):

```scheme
(defsynth wind (cf 800 rq 0.2 amp 0.15 gate 1)
  (var lfo  (* 600 (SinOsc.kr 0.05)))
  (var src  (WhiteNoise.ar))
  (var bp   (BPF.ar src (+ cf lfo) rq))
  (var env  (EnvGen.kr (Env.asr 2 1 2) gate
                       (dict :doneAction 2)))
  (Out.ar 0 (* bp env amp)))

(Synth "wind" (dict :cf 1200 :rq 0.15 :amp 0.4))
```

**What you hear:** wind blowing past a cave mouth. The LFO sweeps the filter, making the noise breathe.

**Variations:** pink noise (mellower); narrower Q for tonal pitched-noise; tracking — drive the filter from another synth's amp envelope.

---

## 9. Theme and Variations

**Idea:** a recognizable melody, transformed three or more ways. Listener tracks the skeleton.

| Variation   | Operation                                  |
|-------------|--------------------------------------------|
| Original    | as-written                                 |
| Octave up   | add 12 to every note                       |
| Octave down | subtract 12                                |
| Retrograde  | reverse the list                           |
| Inversion   | mirror around a pivot note                 |
| Augmentation| double all durations                       |
| Diminution  | halve all durations                        |

**Code** (`cli/examples/techniques/theme_variations.scscm`):

```scheme
(var theme            (list 60 62 64 65))
(var theme-up         (list 72 74 76 77))
(var theme-retrograde (list 65 64 62 60))

(. (pbind
     :instrument "tone"
     :midinote   (pseq (++ theme (++ theme-up theme-retrograde)) inf)
     :dur        0.3)
   play)
```

**What you hear:** the same shape, three times, in different guises. Cohesive without being repetitive.

---

## 10. Canons and Rounds

**Idea:** the same melody played by two voices, the second offset.

**Code** (`cli/examples/techniques/canon.scscm`):

```scheme
(var theme (list 60 62 64 65 67 65 64 62))

; Voice A
(. (pbind :instrument "tone" :midinote (pseq theme inf) :dur 0.4) play)

; Voice B — same theme, offset by half (4 rests + theme up an octave)
(. (pbind :instrument "tone"
         :midinote (pseq (list 0 0 0 0 72 74 76 77 79 77 76 74) inf)
         :dur 0.4
         :amp (pseq (list 0 0 0 0 0.18 0.18 0.18 0.18 0.18 0.18 0.18 0.18) inf))
   play)
```

**What you hear:** a Bach-style round. The voices weave.

**Variations:** more voices (3 or 4); different transpositions (fifth, third); inverted canon (Voice B plays the inverse).

---

## 11. Permutation and Rotation

**Idea:** the *same* set of notes in different orderings.

For 3 notes, there are 3 rotations and 6 total permutations. Cycling through them gives variety from minimal material.

**Code** (`cli/examples/techniques/permutation.scscm`):

```scheme
(. (pbind
     :instrument "tone"
     :midinote   (pseq (list 60 64 67   ; C E G
                             64 67 60   ; E G C  (rotation)
                             67 60 64)  ; G C E  (rotation)
                       inf)
     :dur        0.3)
   play)
```

**Variations:** all 6 permutations; weighted (some orderings more common); permute pairs instead of single notes.

---

## 12. Data-Driven Patterns

**Idea:** map an external dataset (rainfall, prices, sensor readings) to MIDI notes. Sonification.

**Code** (`cli/examples/techniques/data_driven.scscm`):

```scheme
(var data (list 5 12 8 15 3 10 7 14))

(. (pbind
     :instrument "tone"
     :midinote   (pseq (. data collect (fn (d) (+ 57 d))) inf)
     :dur        0.3)
   play)
```

**What you hear:** the shape of the data as melody. Outliers become high or low notes; trends become rises and falls.

**Variations:** map data to duration, amp, or filter cutoff; layer multiple data series; stream live data (in REPL: re-bind `data` and let the next cycle play it).

---

## 13. State Machines

**Idea:** the patch has discrete *states* (intro, build, climax, decay). A counter or condition triggers transitions.

**Sketch:**

```scheme
(var section "intro")
(var section-counter 0)

; In a routine:
;   while section == "intro":
;     play sparse pattern
;     section-counter += 1
;     if section-counter > 16: section = "build"
;   while section == "build":
;     play denser pattern with new voice
;     ...
```

**What you hear:** a piece with real dynamic structure — not just looping, but actually progressing through movements.

**Variations:** probabilistic transitions (10% chance per cycle); time-driven (fixed N seconds per section); event-driven (transition on MIDI input).

---

## 14. Markov Chains

**Idea:** observe transitions in a "training" melody, then generate new melodies that follow the same transition probabilities.

If C→D occurs 50% of the time and C→E 30%, then a generated melody starting at C will go to D about half the time. Result: new music that *sounds like* the training material.

**Sketch:**

```scheme
; Conceptual: build a transition table
;   training: C D C F E F G F G A
;   transitions: C→D, D→C, C→F, F→E, E→F, F→G, G→F, F→G, G→A
;
; To generate:
;   start at C
;   pick uniformly from {D, F} (the values C transitions to)
;   if D: pick from {C} (D's transitions)
;   continue
```

**What you hear:** new melodies stylistically similar to the source. Higher-order chains (track *pairs* of notes) sound more idiomatic.

**Variations:** train on multiple sources and blend; weight by recency; condition on harmonic context.

---

## 15. Cellular Automata

**Idea:** a 1D grid of cells; each cell follows simple rules based on its neighbors. Complex patterns emerge from simple rules.

Wolfram's Rule 30 produces aperiodic complex output from a single live cell. Mapping live cells to scale degrees gives a self-evolving melody.

**Sketch:**

```scheme
; Conceptual: 8-cell grid, Rule 30 evolution
;   gen 0:  0 0 0 1 0 0 0 0     ; single seed
;   gen 1:  0 0 1 1 1 0 0 0
;   gen 2:  0 1 1 0 0 1 0 0
;   gen 3:  1 1 0 1 1 1 1 0
;
; At each generation, map active cells to scale[i] and play them.
```

**What you hear:** a melody that evolves from a sparse seed into a complex, never-repeating texture. Ecological, lifelike.

**Variations:** different rules (Rule 90, Rule 110); 2D Conway's Game of Life mapped to pitch + rhythm; rule-switching mid-piece.

---

## 16. L-Systems for Beats

**Idea:** an L-system is a string-rewriting grammar invented to model plant growth (Lindenmayer, 1968). Define an *axiom* (initial string) and a set of *production rules* that replace symbols with longer strings. Iterate. Each generation expands the previous one — and because the rules apply uniformly, the result is **self-similar**: the same shapes appear at different scales.

For rhythm, treat each symbol as either a hit or a rest. A two-rule grammar can grow a 32-step phrase from a single seed.

**Example grammar:**

```
axiom: K
K → K . S
S → K . S .
. → .
```

| Generation | String                                |
|------------|---------------------------------------|
| 0          | `K`                                   |
| 1          | `K.S`                                 |
| 2          | `K.S.K.S.`                            |
| 3          | `K.S.K.S.K.S.K.S..`                   |
| 4          | (32 cells — used in the example below)|

The pattern grows organically: every kick "spawns" a snare two steps later; every snare "spawns" another kick. The recursion guarantees the rhythm never feels arbitrary.

**Code** (`cli/examples/techniques/lsystem.scscm`):

```scheme
(defsynth kick (freq 60 amp 0.5 gate 1)
  (var osc (SinOsc.ar (* freq (EnvGen.kr (Env.perc 0 0.05) 1 4 1))))
  (var env (EnvGen.kr (Env.perc 0.001 0.25) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))

(defsynth snare (freq 800 amp 0.4 gate 1)
  (var osc (HPF.ar (WhiteNoise.ar) freq))
  (var env (EnvGen.kr (Env.perc 0.001 0.12) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))

(. (pbind
     :instrument (pseq (list "kick" "kick" "snare" "kick"
                             "kick" "kick" "snare" "kick"
                             "kick" "kick" "snare" "kick"
                             "kick" "kick" "snare" "kick")
                       inf)
     :midinote   60
     :dur        0.2
     :amp        (pseq (list 0.5 0   0.4 0
                             0.5 0   0.4 0
                             0.5 0   0.4 0
                             0.5 0   0.4 0)
                       inf))
   play)
```

**What you hear:** a kick-and-snare pattern that has the unmistakable feel of a fractal — local repetition (kick-rest-snare-rest) embedded inside larger repetitions of the same shape.

**Why it works:** unlike pure randomness, every step is *justified* by a rule applied to a previous step. The rhythm has internal coherence. Unlike fixed loops, the same grammar generates different lengths just by changing iteration depth.

**Variations:**

- **Different rules.** `K → KSKS, S → SKK` produces denser kick patterns.
- **Stochastic L-systems.** Multiple right-hand sides; pick one with weighted probability. `K → K.S` (70%) or `K → K..` (30%) gives a "broken" feel.
- **Parametric L-systems.** Symbols carry parameters (`K(amp)`); rules transform them (`K(a) → K(a) . S(a*0.7)`) — letting amplitude or pitch evolve.
- **Pre-compute in the host.** scscm doesn't have a built-in string-rewriter, but you can generate the expanded list in any language and paste it as a literal — or write a small `defmacro` that expands a grammar at compile time.

**Mini-recipe — generating an L-system in your head:**

1. Pick an axiom (`K`).
2. Apply rules to every symbol simultaneously (left-to-right).
3. The result is generation 1. Repeat for the next generation.
4. Stop when the string is the length you want (4–32 steps usually).

**Listen for:** the moment you recognise a small motif (e.g. `K.S`) appearing inside a larger phrase that is itself a repetition of `K.S`. That's the fractal — and your ear catches it as "intentional structure."

---

## 17. Logic Operations on Beat Patterns

**Idea:** treat each rhythm as a boolean array — `1` for a hit, `0` for a rest. Combine two arrays element-wise with **AND**, **OR**, **XOR** to derive new rhythms from old ones. This is the same trick used by digital sequencers and Eurorack logic modules; mathematically it's a Boolean algebra over rhythm space.

**Example with two source patterns:**

| Op | Pattern A         | Pattern B         | Result            | Quality |
|----|-------------------|-------------------|-------------------|---------|
|    | `1 0 1 0 1 0 1 0` (every beat) | `1 1 0 0 1 1 0 0` (pairs) | — | — |
| AND | …                 | …                 | `1 0 0 0 1 0 0 0` | sparse — only when both agree |
| OR  | …                 | …                 | `1 1 1 0 1 1 1 0` | dense — anywhere either hits |
| XOR | …                 | …                 | `0 1 1 0 0 1 1 0` | off-beats — only when they disagree |
| NOT A | —              | —                 | `0 1 0 1 0 1 0 1` | inversion (rests become hits) |

Three operations, three new rhythms — all mathematically derived from the original two.

**Code** (`cli/examples/techniques/logic_ops.scscm`):

```scheme
(defsynth click (freq 200 amp 0.4 gate 1)
  (var osc (SinOsc.ar freq 0))
  (var env (EnvGen.kr (Env.perc 0.001 0.1) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))

(. (pbind
     :instrument "click"
     :midinote   72
     :dur        0.2
     :amp        (pseq (list
                        ; A — every beat
                        0.4 0   0.4 0   0.4 0   0.4 0
                        ; B — pairs
                        0.4 0.4 0   0   0.4 0.4 0   0
                        ; OR — dense
                        0.4 0.4 0.4 0   0.4 0.4 0.4 0
                        ; XOR — off-beats
                        0   0.4 0.4 0   0   0.4 0.4 0)
                       inf))
   play)
```

**What you hear:** four 8-step phrases played in succession. Each derives from the previous via a different logic operation; the family resemblance is unmistakable.

**Why it works:** each operation has a clear musical meaning.

| Op  | Musical meaning                                    |
|-----|-----------------------------------------------------|
| AND | "Coincidence" — fires only on shared beats. Sparser than either input. |
| OR  | "Union" — fires if *anything* hits. Denser than either input. |
| XOR | "Disagreement" — fires *between* the inputs. Often the most interesting; produces syncopation for free. |
| NOT | "Inversion" — turn the pattern inside-out. Reveals the rests as a rhythm. |

**Variations:**

- **Triple combination.** `(A AND B) OR C` blends three patterns hierarchically.
- **Live cross-fade.** Switch your kick from `A` to `A AND B` to `A OR B` to `A` — the hits get rarer, then richer, then sparser, all without changing the underlying source patterns.
- **Phase-shifted XOR.** XOR a pattern with a rotated copy of itself. The result depends on the rotation amount and reveals symmetries in the original.
- **Boolean × Euclidean.** Combine a Euclidean rhythm (Section 1) with a metric pulse via OR for "Euclidean plus downbeats."
- **Scale to amplitude.** Instead of binary, treat patterns as floats; `min` is AND, `max` is OR, `abs(a - b)` approximates XOR. Now you can blend continuously.

**Mini-recipe — sketching with a truth-table:**

```
beat:  1 2 3 4 5 6 7 8
A:     1 0 1 1 0 1 0 1
B:     0 1 0 1 1 0 1 0
A∧B:   0 0 0 1 0 0 0 0
A∨B:   1 1 1 1 1 1 1 1
A⊕B:   1 1 1 0 1 1 1 1
```

Pick A and B by ear; let the operations generate the rest. You'll often find the XOR or OR is more musical than your originals.

**Pairs well with:**

- **Section 1 (Euclidean):** XOR two Euclidean rhythms with different densities for syncopation.
- **Section 11 (Permutation):** rotate B before combining with A for many derived rhythms from one pair.
- **Section 13 (State machines):** switch operation per state — "intro uses AND (sparse), build uses OR (dense)."

---

## Combining Techniques

Most great patches combine several techniques:

- **Euclidean** rhythm + **modal** scale → ethnic-flavored grooves
- **Granular** texture + **slow modal** melody → ambient pad music
- **Markov** melody + **canon** structure → algorithmic Bach
- **State machine** + **theme variations** → narrative pieces

The best way to internalize these techniques is to combine two at a time and listen to what emerges. Constraints stack: each technique limits choices, but the intersection is often the most interesting territory.

---

*See also: [SCSCM_LIVE_CODING_TUTORIAL.md](SCSCM_LIVE_CODING_TUTORIAL.md) for hands-on practice, [SCSCM_LANGUAGE_REFERENCE.md](SCSCM_LANGUAGE_REFERENCE.md) for syntax details.*
