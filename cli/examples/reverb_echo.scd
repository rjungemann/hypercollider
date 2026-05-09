// Reverb and echo effect chain.
// A decaying impulse train drives a sine oscillator;
// the signal passes through a comb delay (echo) then FreeVerb (reverb).
(
SynthDef(\reverbEcho, {
    var trig = Impulse.ar(2);
    var env  = EnvGen.ar(Env.perc(0.005, 0.4), trig);
    var sig  = SinOsc.ar(440) * env * 0.4;
    var echo = CombL.ar(sig, 0.5, 0.25, 3.0);
    var verb = FreeVerb.ar(sig + echo, mix: 0.45, room: 0.85, damp: 0.4);
    Out.ar(0, verb ! 2);
}).add;

Synth(\reverbEcho);
)
