(
SynthDef(\fm, { |carrierFreq = 440, modFreq = 5, modAmp = 100|
  var modOsc = SinOsc.ar(modFreq) * modAmp;
  var carrier = SinOsc.ar(carrierFreq + modOsc) * 0.1;
  carrier ! 2
}).add;

Synth(\fm, [carrierFreq: 440, modFreq: 5, modAmp: 50]);
Synth(\fm, [carrierFreq: 550, modFreq: 8, modAmp: 75]);
)
