// 4-voice variant of poly.scd — together with poly_64.scd this
// brackets the polyphony-vs-perf scaling needed to attribute the
// WAMR synth gap (per-UGen dispatch slope vs per-block intercept).
// See docs/WAMR_PERF_PARITY_PLAN.md §P7.6.
(
SynthDef(\bench_poly_voice, { |freq = 440, cutoff = 2000, rq = 0.3|
    var env = EnvGen.kr(Env.perc(0.005, 4.0), doneAction: 2);
    var sig = Saw.ar(freq) * 0.06 * env;
    Out.ar(0, RLPF.ar(sig, cutoff, rq) ! 2);
}).add;

[55, 62, 69, 77].do { |midi, i|
    Synth(\bench_poly_voice, [
        freq:   midi.midicps,
        cutoff: 800 + (i * 600),
        rq:     0.2 + (i * 0.1),
    ]);
};
)
