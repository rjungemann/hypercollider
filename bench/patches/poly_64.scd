// 64-voice variant of poly.scd. Together with poly_4.scd this brackets
// the polyphony-vs-perf scaling needed to attribute the WAMR synth gap
// (per-UGen dispatch slope vs per-block intercept). 64 voices is a
// conservative upper bound — enough headroom for slope extraction
// without OOMing weaker machines. See docs/WAMR_PERF_PARITY_PLAN.md §P7.6.
(
SynthDef(\bench_poly_voice, { |freq = 440, cutoff = 2000, rq = 0.3|
    var env = EnvGen.kr(Env.perc(0.005, 4.0), doneAction: 2);
    var sig = Saw.ar(freq) * 0.015 * env;  // gain reduced to keep mix in -1..1
    Out.ar(0, RLPF.ar(sig, cutoff, rq) ! 2);
}).add;

64.do { |i|
    var midi = 36 + (i % 48);  // span 4 octaves, repeat as needed
    Synth(\bench_poly_voice, [
        freq:   midi.midicps,
        cutoff: 400 + ((i * 47) % 4000),
        rq:     0.15 + ((i * 0.013) % 0.5),
    ]);
};
"BENCH_PATCH_poly_64: OK".postln;
)
