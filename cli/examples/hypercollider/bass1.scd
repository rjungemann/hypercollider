// bass1.scd — ported from hyper-collider instruments/bass/bass1.sc
// Dark bass: three detuned saws through a resonant low-pass filter.

SynthDef(\bass1, {
    arg freq = 55, detune = 0.3, cutoff = 400, rq = 0.3, decay = 0.8, amp = 0.5;
    var env  = EnvGen.kr(Env.perc(0.005, decay), doneAction: 2);
    var saw1 = Saw.ar(freq);
    var saw2 = Saw.ar(freq * (1 + (detune * 0.01)));
    var saw3 = Saw.ar(freq * (1 - (detune * 0.01)));
    var mix  = (saw1 + saw2 + saw3) / 3;
    var filt = RLPF.ar(mix, cutoff * env + 60, rq);
    Out.ar(0, Pan2.ar(filt * env * amp));
}).add;

s.sync;
Synth(\bass1, [\freq, 55, \detune, 0.3, \cutoff, 400, \rq, 0.3, \decay, 0.8, \amp, 0.5]);
