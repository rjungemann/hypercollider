// TGrains granulator over a short in-memory buffer - tests buffer read and scheduling
(
var bufSize = 48000;  // 1 second at 48kHz
var b = Buffer.alloc(s, bufSize, 1);

// Fill with a simple sine - avoids file I/O dependency in NRT mode
b.sine1([1.0, 0.5, 0.25, 0.125]);

SynthDef(\bench_granular, { |buf = 0|
    var trig    = Impulse.ar(18);
    var pos     = LFNoise1.kr(0.5).range(0.1, 0.9);
    var grainDur = 0.08;
    var sig     = TGrains.ar(2, trig, buf, 1.0, pos, grainDur, 0, 0.3, 2);
    Out.ar(0, sig);
}).add;

Synth(\bench_granular, [buf: b]);
"BENCH_PATCH_granular: OK".postln;
)
