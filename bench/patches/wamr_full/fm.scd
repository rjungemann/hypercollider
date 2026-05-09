// wamr-full FM: 4-op FM with envelope, sent as raw /d_recv + /s_new.
//
// Mirrors bench/patches/fm.scd but bypasses Server.default boot (not
// wired in the wamr-full pipeline; see HCLANG_NATIVE_PLAN.md §12.4b).
// The destination host/port is overridden by hclang_native's
// --scsynth-host / --scsynth-port flags.

var n   = NetAddr("127.0.0.1", 57110);
var def = SynthDef(\bench_fm, {
    var env  = EnvGen.kr(Env.perc(0.01, 4.5), doneAction: 2);
    var mod3 = SinOsc.ar(880) * 220 * env;
    var mod2 = SinOsc.ar(440 + mod3) * 110 * env;
    var mod1 = SinOsc.ar(220 + mod2) * 55  * env;
    var sig  = SinOsc.ar(110 + mod1) * 0.2 * env;
    Out.ar(0, sig ! 2);
}).asBytes;
n.sendBundle(0, ["/d_recv", def]);
// Two voices: one at head, one at tail (matches the Server.default
// version which calls Synth twice with \addToHead / \addToTail).
n.sendBundle(0, ["/s_new", "bench_fm", 1001, 0, 0]);
n.sendBundle(0, ["/s_new", "bench_fm", 1002, 1, 0]);
