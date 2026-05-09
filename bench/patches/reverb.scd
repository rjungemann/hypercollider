// SinOsc into FreeVerb + CombC feedback - tests delay-line memory and DSP complexity
(
SynthDef(\bench_reverb, {
    var trig = Impulse.ar(2.5);
    var env  = EnvGen.ar(Env.perc(0.005, 0.35), trig);
    var sig  = SinOsc.ar(440) * env * 0.35;
    var echo = CombC.ar(sig, 0.5, 0.22, 2.8);
    var verb = FreeVerb.ar(sig + echo, mix: 0.5, room: 0.9, damp: 0.3);
    Out.ar(0, verb ! 2);
}).add;

Synth(\bench_reverb);
"BENCH_PATCH_reverb: OK".postln;
)
