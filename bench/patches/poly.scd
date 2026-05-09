// 16 simultaneous Saw voices with RLPF and EnvGen - stresses polyphony
(
SynthDef(\bench_poly_voice, { |freq = 440, cutoff = 2000, rq = 0.3|
    var env = EnvGen.kr(Env.perc(0.005, 4.0), doneAction: 2);
    var sig = Saw.ar(freq) * 0.06 * env;
    Out.ar(0, RLPF.ar(sig, cutoff, rq) ! 2);
}).add;

// 16 voices across two octaves
[55, 58, 62, 65, 69, 72, 74, 77, 79, 81, 83, 84, 86, 88, 91, 93].do { |midi, i|
    Synth(\bench_poly_voice, [
        freq:   midi.midicps,
        cutoff: 800 + (i * 150),
        rq:     0.2 + (i * 0.03),
    ]);
};
"BENCH_PATCH_poly: OK".postln;
)
