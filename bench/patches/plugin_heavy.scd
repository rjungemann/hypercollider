// DWGBowed + JPverb + VBAPan2 - tests sc3-plugin dispatch and Faust reverb path
// This patch is skipped by run_bench.sh when sc3-plugins are not installed.
(
SynthDef(\bench_plugin_heavy, {
    var bow  = DWGBowed.ar(69.midicps, 0.5, 0.1, 0.9, 0.1, 0.05) * 0.3;
    var verb = JPverb.ar(bow ! 2, t60: 2.5, damp: 0.4, size: 1.2);
    var pan  = VBAPan2.ar(verb[0], 0);
    Out.ar(0, pan ! 2);
}).add;

Synth(\bench_plugin_heavy);
)
