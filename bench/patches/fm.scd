// 4-op FM: SinOsc carrier + 3 modulators with amplitude envelopes
(
SynthDef(\bench_fm, {
    var env  = EnvGen.kr(Env.perc(0.01, 4.5), doneAction: 2);
    var mod3 = SinOsc.ar(880) * 220 * env;
    var mod2 = SinOsc.ar(440 + mod3) * 110 * env;
    var mod1 = SinOsc.ar(220 + mod2) * 55  * env;
    var sig  = SinOsc.ar(110 + mod1) * 0.2 * env;
    Out.ar(0, sig ! 2);
}).add;

Synth(\bench_fm);
Synth(\bench_fm, [], nil, \addToTail);
"BENCH_PATCH_fm: OK".postln;
)
