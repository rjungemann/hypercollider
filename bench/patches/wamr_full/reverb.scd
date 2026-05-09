// wamr-full reverb: SinOsc → FreeVerb + CombC feedback. Sent as raw
// /d_recv + /s_new (Server.default boot not wired; see §12.4b).

var n   = NetAddr("127.0.0.1", 57110);
var def = SynthDef(\bench_reverb, {
    var trig = Impulse.ar(2.5);
    var env  = EnvGen.ar(Env.perc(0.005, 0.35), trig);
    var sig  = SinOsc.ar(440) * env * 0.35;
    var echo = CombC.ar(sig, 0.5, 0.22, 2.8);
    var verb = FreeVerb.ar(sig + echo, mix: 0.5, room: 0.9, damp: 0.3);
    Out.ar(0, verb ! 2);
}).asBytes;
n.sendBundle(0, ["/d_recv", def]);
n.sendBundle(0, ["/s_new", "bench_reverb", 1001, 0, 0]);
