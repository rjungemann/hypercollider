# scscm Quick Start

Get your first scscm patch making sound in about 5 minutes.

> **Reading time:** ~10 min · **Hands-on time:** ~5 min  
> **Prerequisite:** Node.js 16+ and the SuperCollider CLI tools installed (see project README).

---

## What is scscm?

**scscm** (pronounced "ess-cee-skim") is a Scheme-like surface syntax that compiles to native sclang (SuperCollider). You write s-expressions; the compiler emits sclang code that the SuperCollider engine runs.

```
.scscm  →  lhc.js (compiler)  →  .sc  →  sclang  →  audio
```

Why s-expressions? Two reasons: (1) parens are easier to balance than sclang's mixed brace/bracket/paren grammar, and (2) the structure is regular, which makes it trivial to generate scscm code programmatically.

---

## Before you start

You have two options for installing the compiler.

**Option A — Standalone single-file release (no source checkout):**

Download `lhc.js` from the latest [GitHub Release](https://github.com/anthropics/hypercollider/releases) (look for the `lhc-standalone-vX.Y.Z` artifact) and run it with stock Node.js:

```bash
node lhc.js --version
node lhc.js -i piece.scscm -o piece.sc
```

The bundle is fully self-contained — no `npm install`, no adjacent files.

**Option B — From source:**

```bash
cd /path/to/hypercollider/cli
node lhc.js --help
```

If you see a help screen you're ready; if not, run `npm install` from `cli/`.

To build the standalone bundle locally: `just bundle-lhc` writes it to `dist/lhc.js`.

You'll also want headphones or speakers — you're about to make sound.

---

## Your first patch — a single sine tone

Create `examples/quick_start_1.scscm` (or use the existing one):

```scheme
; quick_start_1.scscm — Your first scscm patch
(defsynth sine (freq 440 amp 0.1 gate 1)
  (Out.ar 0
    (* (SinOsc.ar freq 0)
       (EnvGen.kr (Env.adsr 0.01 0.1 0.8 0.1) gate
                  (dict :doneAction 2))
       amp)))

(Synth "sine" (dict :freq 440 :amp 0.1))
```

Run it:

```bash
node lhc.js -i cli/examples/quick_start_1.scscm
```

**What you should hear:** a clean 440 Hz sine tone (A4) for about a second.

---

## Understanding the patch

Let's read it line by line.

### The synth definition

```scheme
(defsynth sine (freq 440 amp 0.1 gate 1)
  ...)
```

`defsynth` is shorthand for "define a SynthDef and add it to the server."

- `sine` is the name of this synth (used later when we play it).
- `(freq 440 amp 0.1 gate 1)` is the parameter list. Each pair is *name default* — so `freq` defaults to 440, `amp` to 0.1, `gate` to 1.

### The audio graph

```scheme
(Out.ar 0
  (* (SinOsc.ar freq 0)
     (EnvGen.kr (Env.adsr 0.01 0.1 0.8 0.1) gate
                (dict :doneAction 2))
     amp))
```

Read inside-out:

1. `(SinOsc.ar freq 0)` — a sine oscillator at `freq` Hz, phase 0.
2. `(EnvGen.kr (Env.adsr ...) gate (dict :doneAction 2))` — an ADSR envelope: 10 ms attack, 100 ms decay, 0.8 sustain level, 100 ms release. `:doneAction 2` frees the synth when the envelope completes.
3. `(* sine envelope amp)` — multiply: the oscillator scaled by the envelope and overall amplitude.
4. `(Out.ar 0 ...)` — write the result to audio bus 0 (the default speakers).

### Playing the synth

```scheme
(Synth "sine" (dict :freq 440 :amp 0.1))
```

This spawns one instance of `sine`, passing `freq: 440` and `amp: 0.1`. The dict becomes a SuperCollider `Event`.

### Try it

Tweak and re-run:

| Change                                   | What you'll hear        |
|------------------------------------------|-------------------------|
| `:freq 440` → `:freq 660`                | Higher pitch (E5)       |
| `:amp 0.1` → `:amp 0.3`                  | Louder                  |
| `(Env.adsr 0.01 0.1 0.8 0.1)` → `(Env.adsr 1 0 1 1)` | Slow fade-in/out |
| `(SinOsc.ar freq 0)` → `(Saw.ar freq)`   | Buzzy sawtooth          |

---

## Your second patch — a melodic pattern

Create `examples/quick_start_2.scscm`:

```scheme
; quick_start_2.scscm — A four-note arpeggio
(defsynth sine (freq 440 amp 0.1 gate 1)
  (Out.ar 0
    (* (SinOsc.ar freq 0)
       (EnvGen.kr (Env.adsr 0.01 0.1 0.8 0.1) gate
                  (dict :doneAction 2))
       amp)))

(. (pbind
     :instrument "sine"
     :midinote   (pseq (list 60 64 67 72) inf)   ; C4 E4 G4 C5
     :dur        0.25
     :amp        0.2
     :legato     0.8)
   play)
```

Run it:

```bash
node lhc.js -i cli/examples/quick_start_2.scscm
```

**What you should hear:** an ascending arpeggio (C-E-G-C) that loops indefinitely until you stop it.

Press **Ctrl-C** to stop.

### What's new

- **`pbind`** — a "pattern bind." It maps event keys (`:instrument`, `:midinote`, `:dur`, …) to streams of values. Each event in the stream becomes a played note.
- **`pseq`** — a sequenced stream. `(pseq (list 60 64 67 72) inf)` walks through the list, repeating forever (`inf`).
- **`:midinote`** — instead of `:freq` (in Hz), use MIDI note numbers (60 = C4, 64 = E4, 67 = G4, 72 = C5).
- **`:dur 0.25`** — each note lasts a quarter-second.
- **`:legato 0.8`** — the gate is held for 80% of the duration before releasing.
- **`(. ... play)`** — call `.play` on the pattern to start it.

### Try it

| Change                                         | What you'll hear              |
|------------------------------------------------|-------------------------------|
| `(list 60 64 67 72)` → `(list 60 62 64 65 67 69 71 72)` | C major scale          |
| `(pseq ... inf)` → `(prand (list 60 62 64 67) inf)`     | Random walk             |
| `:dur 0.25` → `:dur (pseq (list 0.25 0.25 0.5) inf)`    | Long-short-short rhythm |
| `:amp 0.2` → `:amp (pseq (list 0.3 0.1 0.1 0.1) inf)`   | Accent on first beat    |

---

## Single notes vs. patterns

You've now seen the two main ways to make sound in scscm:

| Approach           | When to use                                              |
|--------------------|----------------------------------------------------------|
| `(Synth ...)`      | Spawn a single voice. Use for one-shots and held drones. |
| `(. (pbind ...) play)` | Sequence many notes over time with rich event data.   |

You can mix them: spawn a long-running drone with `Synth`, layer a `pbind` on top for melody.

---

## Naming conventions

scscm uses lowercase-with-hyphens; sclang gets underscores:

```scheme
(var my-synth (Synth "sine"))     ; → var my_synth = Synth("sine");
(ctl my-synth :freq 660)          ; → my_synth.set(\freq, 660);
```

Class names like `SinOsc`, `EnvGen`, `Pbind` are kept as-is.  
Keywords like `:freq` become symbols (`\freq`).

See [SCSCM_LANGUAGE_REFERENCE.md §12](SCSCM_LANGUAGE_REFERENCE.md#12-name-conversion) for the full table.

---

## Next steps

You now know enough to read most scscm code in `cli/examples/`. From here:

| If you want to…                              | Read…                                                         |
|----------------------------------------------|---------------------------------------------------------------|
| Build a generative ambient piece, hands-on   | [SCSCM_LIVE_CODING_TUTORIAL.md](SCSCM_LIVE_CODING_TUTORIAL.md) |
| Look up a specific pattern technique         | [SCSCM_PATTERN_TECHNIQUES.md](SCSCM_PATTERN_TECHNIQUES.md)    |
| One-page syntax reference                    | [SCSCM_CHEAT_SHEET.md](SCSCM_CHEAT_SHEET.md)                  |
| Formal language spec                         | [SCSCM_LANGUAGE_REFERENCE.md](SCSCM_LANGUAGE_REFERENCE.md)    |
| sclang → scscm migration snippets            | [SCSCM_LANGUAGE_REFERENCE.md § Appendix C](SCSCM_LANGUAGE_REFERENCE.md#appendix-c-sclang--scscm-migration) |

---

## Common gotchas

**"Unexpected token"** — usually a missing close paren. Count `(` vs `)`.

**Silence** — the synth ran but you set `:amp 0` or the envelope already finished. Check `Env.adsr`'s release time and `:doneAction`.

**"Symbol foo not found"** — sclang doesn't recognize the name. Most often a typo in a class name (case-sensitive) or a forgotten import.

**Pattern doesn't stop** — `(pseq xs inf)` repeats forever. Use a finite count, e.g. `(pseq xs 4)`, or interrupt with Ctrl-C.

For more, see [SCSCM_LANGUAGE_REFERENCE.md § 14](SCSCM_LANGUAGE_REFERENCE.md#14-error-handling) on error handling.

---

*Welcome to scscm. Make some noise.*
