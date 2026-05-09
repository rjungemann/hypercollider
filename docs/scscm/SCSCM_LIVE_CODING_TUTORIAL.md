# scscm Live Coding Tutorial

A guided, hands-on introduction to live coding with scscm. Over the next 1–2 hours you'll build a generative ambient piece from a single drone, layer by layer, learning the live-coding mindset along the way.

> **Prerequisite:** complete [SCSCM_QUICK_START.md](SCSCM_QUICK_START.md) first. You should be comfortable running a `.scscm` file from the command line.

---

## What you'll build

A four-voice generative ambient patch:

1. **Pad** — a sustained drone with slow detuning
2. **Bass** — a four-note walking line
3. **Melody** — random in-scale notes with varying durations
4. **Shimmer** — sparse high-register sparkle

The finished piece never repeats exactly but always sounds coherent. Final code lives in `cli/examples/ambient_step_4.scscm`.

---

## The live coding mindset

Before we touch code: live coding is a mindset shift, not just a skill.

### Four principles

**1. Tight feedback loop.**  
Write a few lines, hear them, modify, repeat. Your ear is the test suite. The faster the loop, the better the music.

**2. Redefine, don't restart.**  
Once a synth is running, you can change its inputs without stopping. `(ctl my-synth :freq 880)` retunes a held note. New `(. (pbind ...) play)` calls add layers. Keep the engine running.

**3. Constrain to liberate.**  
Total freedom paralyzes. A scale, a rhythm, or a fixed loop length removes infinite choices and lets you focus on the interesting decisions. Embrace constraints; surprise yourself within them.

**4. Mistakes are material.**  
The "wrong" chord, the off-by-one note, the accidentally-too-fast loop — these are often the most interesting moments. Stay with them long enough to evaluate before correcting.

---

## Step 1 — The Foundation Pad (15 min)

**Goal:** one held voice that sounds *alive*. We'll add subtle frequency modulation so it doesn't feel static.

Create `cli/examples/ambient_step_1.scscm`:

```scheme
; ambient_step_1.scscm — foundation pad
(defsynth pad (freq 220 amp 0.15 gate 1)
  (var lfo  (* 3 (SinOsc.kr 0.1)))            ; ±3 Hz wobble at 0.1 Hz
  (var osc  (SinOsc.ar (+ freq lfo) 0))
  (var env  (EnvGen.kr (Env.asr 4 1 4) gate
                       (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp 0.5)))

(Synth "pad" (dict :freq 220 :amp 0.15))
```

Run:

```bash
node lhc.js -i cli/examples/ambient_step_1.scscm
```

**What you should hear:** a low A3 tone that gently oscillates around its center pitch. The 0.1 Hz LFO makes one full cycle every 10 seconds, so the wobble is barely perceptible — like breath.

### What's new

| Form | Meaning |
|------|---------|
| `(SinOsc.kr 0.1)` | A control-rate oscillator at 0.1 Hz; outputs values in `[-1, 1]` |
| `(* 3 ...)` | Scale to ±3 Hz |
| `(+ freq lfo)` | Add the wobble to the base frequency |
| `Env.asr 4 1 4` | Attack 4 s, sustain level 1, release 4 s |
| `:doneAction 2` | Free the synth when the envelope completes |

### Try it

Modify *one* parameter at a time and listen:

| Change | Effect |
|--------|--------|
| `(SinOsc.kr 0.1)` → `(SinOsc.kr 0.5)` | Faster wobble (one cycle per 2 sec) |
| `(* 3 ...)` → `(* 0.5 ...)` | Subtler detuning |
| `(* 3 ...)` → `(* 15 ...)` | Audible vibrato |
| `:freq 220` → `:freq 110` | Octave lower (A2) |

> **Listen check:** does it feel calm and alive? If it feels static, increase the LFO frequency. If it feels seasick, decrease the depth.

---

## Step 2 — Walking Bass (15 min)

**Goal:** add motion under the pad. A four-note walking figure that loops every 8 seconds.

Append to your patch (don't replace the pad):

```scheme
(defsynth bass (freq 110 amp 0.25 gate 1)
  (var osc (* (SinOsc.ar freq 0) 0.7))
  (var sub (* (SinOsc.ar (* freq 0.5) 0) 0.3))
  (var env (EnvGen.kr (Env.perc 0.05 1.5) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* (+ osc sub) env amp)))

(. (pbind
     :instrument "bass"
     :midinote   (pseq (list 36 38 40 38) inf)   ; C2 D2 E2 D2
     :dur        2
     :amp        0.25)
   play)
```

The complete file is `cli/examples/ambient_step_2.scscm`.

### What's new

- **Two oscillators in parallel** — the main `osc` at the fundamental, plus a `sub` an octave lower (`* freq 0.5`) at lower amplitude. Together they sound fatter than either alone.
- **`Env.perc`** — a percussive envelope: fast attack, exponential release. Each note swells and fades.
- **`pbind` + `pseq`** — the pattern player walks through the four MIDI notes (36 38 40 38 = C2 D2 E2 D2) repeating forever. Each note lasts `:dur 2` seconds, so the full loop is 8 seconds.

### Why these notes?

C2 → D2 → E2 → D2 is a stepwise figure that rises a third and falls back. Stepwise motion (no big leaps) sounds intentional even when generated. The same principle applies to longer melodies.

### Try it

| Change | Effect |
|--------|--------|
| `(list 36 38 40 38)` → `(list 36 40 43 41)` | Wider intervals (more dramatic) |
| `(list 36 38 40 38)` → `(list 36 36 36 36)` | Stuck on root (hypnotic) |
| `:dur 2` → `:dur 1` | Twice as fast |
| `:dur 2` → `:dur (pseq (list 1 1 2) inf)` | Triplet feel |

> **Listen check:** does the bass anchor the pad without overpowering it? If it's stepping on the pad, lower its amp to 0.2.

---

## Step 3 — Constrained Melody (20 min)

**Goal:** introduce randomness *within constraints*. We'll pick random notes from the C-major scale and random durations from a small set.

Add to your patch:

```scheme
(defsynth melody (freq 440 amp 0.2 gate 1)
  (var osc (SinOsc.ar freq 0))
  (var env (EnvGen.kr (Env.perc 0.02 0.6) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))

(. (pbind
     :instrument "melody"
     :midinote   (prand (list 60 62 64 65 67 69 71) inf)
     :dur        (prand (list 0.5 1.0 1.5) inf)
     :amp        0.2)
   play)
```

The complete file is `cli/examples/ambient_step_3.scscm`.

### Random within constraints

This is the heart of generative music. **`prand`** (random pick) chooses uniformly from its list. The list is the constraint:

- Notes drawn from `(60 62 64 65 67 69 71)` — the C-major scale. *Every* note will fit harmonically with the C-rooted pad and bass.
- Durations drawn from `(0.5 1.0 1.5)` — every note is at least an eighth-note, never longer than a dotted quarter. Rhythmic variety without rhythmic chaos.

Constrained randomness sounds *intentional*. Pure randomness sounds like noise. The art is choosing the right constraints.

### Try it

| Change | Effect |
|--------|--------|
| `(list 60 62 64 65 67 69 71)` → `(list 60 63 65 67 70)` | Pentatonic (more open) |
| `(list 60 62 64 65 67 69 71)` → `(list 60 62 63 65 67 68 70)` | Natural minor |
| `(list 0.5 1.0 1.5)` → `(list 0.25 0.25 0.5 1)` | Faster, more varied |
| `(prand ...)` → `(pseq (list 60 64 67 64) inf)` | Predictable pattern (test contrast) |

> **Listen check:** is the melody finding its voice, or fighting the bass? If it fights, drop the amp. If it sounds aimless, switch to `pwhite` for an integer range or to a smaller scale.

---

## Step 4 — Shimmer (20 min)

**Goal:** finish the soundscape with a quiet high-register layer. Sparkle without crowding.

Add to your patch:

```scheme
(defsynth shimmer (freq 880 amp 0.06 gate 1)
  (var osc  (SinOsc.ar freq 0))
  (var env  (EnvGen.kr (Env.perc 0.005 0.3) gate
                       (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))

(. (pbind
     :instrument "shimmer"
     :midinote   (prand (list 84 86 88 90 91) inf)
     :dur        (prand (list 0.2 0.3 0.4) inf)
     :amp        0.06)
   play)
```

The complete file is `cli/examples/ambient_step_4.scscm`.

### Why it works

- **Very quiet (0.06).** Shimmer is texture, not melody. It should be felt more than heard.
- **High register (84+).** MIDI 84 = C6. Above the melody, in a frequency range the ear hears as "air."
- **Short notes (0.2–0.4 sec) with fast envelope.** Click-like attacks add brightness.
- **Different scale degrees than the melody.** Picks from C, D, E, F#, G in the C6 octave. The F# adds a hint of Lydian color without committing to it.

### The complete picture

You now have four asynchronous voices:

| Voice    | Loop length | Quality        |
|----------|-------------|----------------|
| Pad      | continuous  | foundation     |
| Bass     | 8 sec       | rhythmic anchor |
| Melody   | per-note random | melodic content |
| Shimmer  | per-note random | air/texture     |

Because melody and shimmer pick durations randomly, they never align with each other or with the bass. The patch evolves indefinitely.

> **Listen check:** is everything balanced? Bass should be felt at the bottom, pad in the middle, melody as foreground, shimmer as accent. Adjust amps until each voice has its own space.

---

## Live modification techniques

You've built the patch by appending. In real live coding, you change it without stopping. Three core moves:

### 1. Redefine arrays mid-flight

In a REPL or interactive session, evaluate just:

```scheme
; Re-bind the bass figure
(set! bass-pattern (list 36 41 43 41))   ; new walking line
```

If your `pbind` reads from a variable, the next cycle picks up the new value.

### 2. Retune a held synth

```scheme
(var pad-instance (Synth "pad" (dict :freq 220)))

; Later, while the pad is still playing:
(ctl pad-instance :freq 165)             ; retune to E3
```

`ctl` sends a control message; the synth's frequency updates immediately. No restart.

### 3. Crossfade by amplitude

To swap voices smoothly:

```scheme
; Bring in a new layer at zero amp
(var new-voice (Synth "melody" (dict :amp 0)))

; Gradually raise amp — in a routine, REPL, or by re-evaluating
(ctl new-voice :amp 0.05)
(ctl new-voice :amp 0.10)
(ctl new-voice :amp 0.20)
```

For real fades, use a control-rate envelope or `Line.kr` inside the synth itself.

### When to reset

Most changes can be live. Reset (re-launch the patch) when:

- You change a `defsynth`'s shape (new oscillator chain, different I/O)
- You break the audio graph and want a clean slate
- You're moving to a new musical section deliberately

---

## Debugging by ear

Live coding has no compiler errors for "this sounds bad." Trust your ear; here's how to localize problems.

| What you hear | Likely cause | Fix |
|---|---|---|
| Click at note onset | Envelope attack too fast | Lengthen `Env.perc 0.005 ...` to `0.01 ...` |
| Notes never decay | `:doneAction 0` on a one-shot | Use `:doneAction 2` to free the synth |
| Out of tune | Mixed scales or off-by-octave | Check MIDI numbers: 60 = C4, +12 = octave |
| Muddy low end | Two voices both have sub-bass | Drop the `sub` octave on one voice |
| Random feels chaotic | Too many free parameters | Constrain durations, then notes, then amp |
| Loops align too cleanly | All voices have same total duration | Use coprime cycle lengths (8 vs 9 sec) |

---

## Exercises (30 min)

Solutions in `cli/examples/exercises/live_coding_*.scscm`. Try yours first.

### Exercise 1 — Switch to G minor pentatonic

Take `ambient_step_4.scscm` and:

1. Drop the pad to G2 (MIDI 55, freq ≈ 196 Hz).
2. Change the bass walk to G minor pentatonic (G A B♭ A = 31 33 34 33).
3. Switch the melody scale to G minor pentatonic in C5 octave (G B♭ C D F = 67 70 72 74 77).

What does the same patch structure feel like in a different mode?

→ See [`cli/examples/exercises/live_coding_1.scscm`](../../cli/examples/exercises/live_coding_1.scscm)

### Exercise 2 — Add a hi-hat

Add a fifth voice: a noise-based hi-hat. Hint:

```scheme
(defsynth hihat (amp 0.05 gate 1)
  (var osc (HPF.ar (WhiteNoise.ar) 6000))   ; high-pass white noise
  (var env (EnvGen.kr (Env.perc 0.002 0.08) gate
                      (dict :doneAction 2)))
  (Out.ar 0 (* osc env amp)))
```

Play it sparsely — too many hits and it'll dominate.

→ See [`cli/examples/exercises/live_coding_2.scscm`](../../cli/examples/exercises/live_coding_2.scscm)

### Exercise 3 — De-sync the loops

The default patch's bass loops every 8 seconds; everything else is random. Make the bass loop every 9 seconds (3 notes × 3 sec) and listen — the patch never quite "lines up" the same way twice.

What does this do to the perceived structure of the piece? Does it feel longer? Shorter? More or less coherent?

→ See [`cli/examples/exercises/live_coding_3.scscm`](../../cli/examples/exercises/live_coding_3.scscm)

---

## Where to go from here

You've covered the live-coding fundamentals: synth definition, pattern playback, constrained randomness, and live modification. To go deeper:

- **More techniques:** [SCSCM_PATTERN_TECHNIQUES.md](SCSCM_PATTERN_TECHNIQUES.md) covers Euclidean rhythms, polyrhythms, Markov chains, and 15 other pattern strategies.
- **Quick syntax lookup:** [SCSCM_CHEAT_SHEET.md](SCSCM_CHEAT_SHEET.md).
- **Full reference:** [SCSCM_LANGUAGE_REFERENCE.md](SCSCM_LANGUAGE_REFERENCE.md).
- **Read existing patches:** browse `cli/examples/hypercollider/` for a library of synth definitions (kick, snare, pluck, bass).

The best next step is to build something of your own. Pick a mood, set three constraints (scale, tempo, voices), and start small. Iterate.

---

*"The art is choosing the right constraints."*
