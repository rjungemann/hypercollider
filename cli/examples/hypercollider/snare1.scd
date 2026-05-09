// snare1.scd — ported from hyper-collider instruments/snare/snare1.sc
// Tonal body (two sine resonators) plus filtered white noise transient.

SynthDef(\snare1, {
    var freq1   = 185, freq2 = 330;
    var env     = EnvGen.kr(Env.perc(0.001, 0.15), doneAction: 2);
    var toneEnv = EnvGen.kr(Env.perc(0.001, 0.08), doneAction: 0);
    var tone    = (SinOsc.ar(freq1) + SinOsc.ar(freq2)) * toneEnv * 0.5;
    var noise   = BPF.ar(HPF.ar(WhiteNoise.ar(), 1800), 1200, 0.8) * env;
    var snare   = (tone + noise) * 0.6;
    Out.ar(0, Pan2.ar(snare));
}).add;

s.sync;
Synth(\snare1);
