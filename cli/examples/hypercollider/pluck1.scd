// pluck1.scd — ported from hyper-collider instruments/pluck/pluck1.sc
// FM pluck: sharp attack with rapidly decaying modulation index.

SynthDef(\pluck1, {
    arg freq = 220, index = 6, mRatio = 2, decay = 0.6, amp = 0.5;
    var env    = EnvGen.kr(Env.perc(0.001, decay), doneAction: 2);
    var idxEnv = EnvGen.kr(Env.perc(0.001, decay * 0.15)) * index;
    var mod    = SinOsc.ar(freq * mRatio) * freq * idxEnv;
    var car    = SinOsc.ar(freq + mod);
    var filt   = RLPF.ar(car, freq * 6 * env + 200, 0.5);
    Out.ar(0, Pan2.ar(filt * env * amp));
}).add;

s.sync;
Synth(\pluck1, [\freq, 220, \index, 6, \mRatio, 2, \decay, 0.6, \amp, 0.5]);
