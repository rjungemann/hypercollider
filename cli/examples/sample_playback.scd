// Wavetable sample playback.
// Allocates a buffer, fills it with an additive waveform, then plays it
// back with PlayBuf at a series of pitches.
// For real sample files: replace Buffer.sine1 with Buffer.read(s, "path/to/file.wav").
(
SynthDef(\sampler, { |bufnum = 0, rate = 1, amp = 0.35|
    var sig = PlayBuf.ar(1, bufnum, rate * BufRateScale.kr(bufnum), loop: 1) * amp;
    Out.ar(0, sig ! 2);
}).add;

Buffer.alloc(s, s.sampleRate.asInteger, 1, { |buf|
    buf.sine1([1, 0.5, 0.33, 0.25, 0.2], action: {
        var rates = [1.0, 1.189, 1.335, 1.587]; // whole-tone-ish steps
        rates.do { |r, i|
            SystemClock.sched(i * 0.8, {
                Synth(\sampler, [\bufnum, buf, \rate, r]);
            });
        };
    });
});
)
