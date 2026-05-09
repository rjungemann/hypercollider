// Single SinOsc panned center - baseline startup overhead patch
{ SinOsc.ar(440, 0, 0.15) ! 2 }.play;
"BENCH_PATCH_sine: OK".postln;
