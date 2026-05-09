// hihat1.scd — ported from hyper-collider instruments/hihat/hihat1.sc
// Closed hi-hat: short burst of high-passed noise with a band-pass layer.

SynthDef(\hihat1, {
    var env   = EnvGen.kr(Env.perc(0.001, 0.06), doneAction: 2);
    var noise = WhiteNoise.ar();
    var hihat = HPF.ar(noise, 8000) * 0.5
              + BPF.ar(noise, 10500, 0.6) * 0.3;
    Out.ar(0, Pan2.ar(hihat * env * 0.5));
}).add;

s.sync;
Synth(\hihat1);
