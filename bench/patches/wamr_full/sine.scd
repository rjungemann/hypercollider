// wamr-full sine: 440 Hz sine, sent as raw /d_recv + /s_new.
//
// The wamr-full bench toolchain forwards any UDP OSC from hclang_native
// to hcsynth_native; SC's `.play` requires a booted Server.default which
// isn't wired in this pipeline yet (Phase 7 follow-up). So the patch
// constructs the synthdef and sends the bundle directly via NetAddr.
// The destination host/port is overridden by hclang_native's
// --scsynth-host / --scsynth-port flags, so any address here works.

var n   = NetAddr("127.0.0.1", 57110);
var def = SynthDef(\sine, {
    Out.ar(0, SinOsc.ar(440, 0, 0.15) ! 2);
}).asBytes;
n.sendBundle(0, ["/d_recv", def]);
n.sendBundle(0, ["/s_new", "sine", 1001, 0, 0]);
