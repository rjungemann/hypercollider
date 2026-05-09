// wamr-full poly: 16 simultaneous Saw + RLPF voices. Stresses polyphony
// without the Server.default boot path (see §12.4b).

var n   = NetAddr("127.0.0.1", 57110);
var def = SynthDef(\bench_poly_voice, { |freq = 440, cutoff = 2000, rq = 0.3|
    var env = EnvGen.kr(Env.perc(0.005, 4.0), doneAction: 2);
    var sig = Saw.ar(freq) * 0.06 * env;
    Out.ar(0, RLPF.ar(sig, cutoff, rq) ! 2);
}).asBytes;

// First send the synthdef, then 16 /s_new bundles in a single packet.
// The bench measures wall_synth_ms which is dominated by the actual
// render, not the OSC dispatch — sending all voices at t=0 mirrors the
// original patch's behaviour.
n.sendBundle(0, ["/d_recv", def]);
[55, 58, 62, 65, 69, 72, 74, 77, 79, 81, 83, 84, 86, 88, 91, 93].do { |midi, i|
    n.sendBundle(0, ["/s_new", "bench_poly_voice", 1001 + i, 0, 0,
        "freq", midi.midicps,
        "cutoff", 800 + (i * 150),
        "rq", 0.2 + (i * 0.03),
    ]);
};
