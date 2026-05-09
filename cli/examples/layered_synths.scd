(
SynthDef(\subBass, {
  var modFreq = LFNoise1.kr(0.5).range(80, 120);
  var osc = LFSaw.ar(modFreq) * 0.2;
  osc ! 2
}).add;

SynthDef(\highPad, {
  var freq = LFNoise1.kr(0.3).range(440, 880);
  var osc = SinOsc.ar(freq) * EnvGen.kr(Env.perc(0.5, 3), doneAction: 2) * 0.1;
  osc ! 2
}).add;

Synth(\subBass);
Synth(\highPad);
)
