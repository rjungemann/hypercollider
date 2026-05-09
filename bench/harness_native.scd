// Native harness: wraps patch in Score.recordNRT for scsynth offline rendering.
// argv[0] = patch .scd path
// argv[1] = output OSC score path  (e.g. /tmp/bench_<name>.osc)
// argv[2] = output WAV path        (e.g. /tmp/bench_<name>.wav)
// argv[3] = duration in seconds    (optional, default 5)
(
var patchPath  = thisProcess.argv[0];
var oscPath    = thisProcess.argv[1];
var wavPath    = thisProcess.argv[2];
var duration   = thisProcess.argv[3] !? _.asFloat ?? 5.0;

// Evaluate the patch inside a Score recording context so that all server
// messages are captured into a Score bundle list.
var score = Score.new;
score.record(oscPath, wavPath,
    headerFormat: "WAVE", sampleFormat: "int16",
    numChannels: 2, sampleRate: 48000, duration: duration
);

// Load and run the patch; bundles go into the Score.
load(patchPath);

score.saveToFile(oscPath);
0.exit;
)
