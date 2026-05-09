(
SynthDef(\polysynth, { |note = 60, amp = 0.1, attack = 0.01, decay = 0.5, sustain = 0.3, release = 1|
  var freq = note.midicps;
  var env = EnvGen.kr(Env.adsr(attack, decay, sustain, release), doneAction: 2);
  var osc = LFSaw.ar(freq) * amp * env;
  osc ! 2
}).add;

Synth(\polysynth, [note: 60, amp: 0.15, attack: 0.05, decay: 1]);
Synth(\polysynth, [note: 64, amp: 0.15, attack: 0.05, decay: 1]);
Synth(\polysynth, [note: 67, amp: 0.15, attack: 0.05, decay: 1]);
)
