// wamr-full granular: TGrains over a sine-filled buffer. Mirrors
// bench/patches/granular.scd but bypasses Server.default boot via raw
// /b_alloc + /b_gen sine1 + /d_recv + /s_new bundles.

(
var n      = NetAddr("127.0.0.1", 57110);
var bufNum = 0;
var bufSize = 48000;  // 1 s at 48 kHz
// /b_gen flags: bit 0 = normalize, bit 1 = wavetable, bit 2 = clear
// (bench/patches/granular.scd uses default sine1 = normalize+clear).
var bgenFlags = 1 + 4;
var def = SynthDef(\bench_granular, { |buf = 0|
    var trig    = Impulse.ar(18);
    var pos     = LFNoise1.kr(0.5).range(0.1, 0.9);
    var grainDur = 0.08;
    var sig     = TGrains.ar(2, trig, buf, 1.0, pos, grainDur, 0, 0.3, 2);
    Out.ar(0, sig);
}).asBytes;

n.sendBundle(0, ["/b_alloc", bufNum, bufSize, 1]);
n.sendBundle(0, ["/b_gen", bufNum, "sine1", bgenFlags, 1.0, 0.5, 0.25, 0.125]);
n.sendBundle(0, ["/d_recv", def]);
n.sendBundle(0, ["/s_new", "bench_granular", 1001, 0, 0, "buf", bufNum]);
)
