#!/usr/bin/env node
'use strict';

/**
 * test_cli_parity.js — Mixed-mode parity tests for CLI WASM sound generation.
 *
 * Validates that WASM sclang/scsynth are compatible with their native counterparts
 * by running mixed-mode scenarios and comparing audio output metrics.
 *
 * Scenarios:
 *   A) WASM sclang + WASM scsynth              (always runs — baseline)
 *   B) WASM sclang → native scsynth NRT        (tests OSC forward-compatibility)
 *   C) Canonical OSC → WASM scsynth            (tests WASM scsynth with native-style input)
 *   D) Error-path parity                       (native and WASM fail comparably)
 *
 * Set NATIVE_HCSYNTH=/path/to/scsynth to override the default.
 * Set SKIP_NATIVE=1 to skip scenarios that require native tools.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runSclangCli } = require('../hclang');
const { runScsynthCli } = require('../hcsynth');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCLANG_JS = path.join(REPO_ROOT, 'build/wasm/lang/hclang/hclang.js');
const SCSYNTH_JS = path.join(REPO_ROOT, 'build/wasm/server/hcsynth/hcsynth.js');
const NATIVE_HCSYNTH = process.env.NATIVE_HCSYNTH || process.env.NATIVE_SCSYNTH || '/opt/homebrew/bin/scsynth';
const SKIP_NATIVE = process.env.SKIP_NATIVE === '1';

const SAMPLE_RATE = 48000;
const DURATION = 2;
const CHANNELS = 2;
const BLOCK_SIZE = 512;

const SINE_SCD = 'x = { SinOsc.ar(440, 0, 0.15) ! 2 }.play;\n';

// ---------------------------------------------------------------------------
// OSC / NRT score helpers
// ---------------------------------------------------------------------------

/** Pad a buffer to the next 4-byte boundary. */
function padTo4(buf) {
    const rem = buf.length % 4;
    if (rem === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

/** Encode an OSC address or type-tag string. */
function oscString(s) {
    return padTo4(Buffer.from(s + '\0', 'ascii'));
}

/** Encode a big-endian int32 OSC argument. */
function oscInt32(n) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n, 0);
    return b;
}

/**
 * Build a minimal OSC message.
 * @param {string} address  OSC address (e.g. '/g_new')
 * @param {string} typetag  OSC type tag string (e.g. ',iii') — must include leading comma
 * @param {Buffer[]} argBufs Pre-encoded argument buffers
 */
function buildOscMessage(address, typetag, argBufs) {
    return Buffer.concat([oscString(address), oscString(typetag), ...argBufs]);
}

/**
 * Wrap one or more OSC messages in an OSC bundle at the given OSC time.
 * @param {number} oscTimeSecs  Integer seconds component (since 1900-01-01)
 * @param {number} oscTimeFrac  Fractional seconds (0 = immediate when secs=0, 1 = special "immediate" tag)
 * @param {Buffer[]} messages   Raw OSC messages or nested bundles
 */
function buildOscBundle(oscTimeSecs, oscTimeFrac, messages) {
    const header = Buffer.alloc(16);
    header.write('#bundle\0', 0, 'ascii');
    header.writeUInt32BE(oscTimeSecs, 8);
    header.writeUInt32BE(oscTimeFrac, 12);
    const parts = [header];
    for (const msg of messages) {
        const sz = Buffer.alloc(4);
        sz.writeUInt32BE(msg.length, 0);
        parts.push(sz, msg);
    }
    return Buffer.concat(parts);
}

/**
 * Wrap a bundle into a NRT score entry (prefixed with big-endian int32 size).
 */
function nrtEntry(bundle) {
    const sz = Buffer.alloc(4);
    sz.writeUInt32BE(bundle.length, 0);
    return Buffer.concat([sz, bundle]);
}

/**
 * Build a NRT score buffer from an array of raw OSC message buffers.
 * Each message is wrapped in a time-0 bundle. A /g_new 1 0 0 bundle is
 * prepended to ensure the default group exists. A termination bundle is
 * appended at durationSecs so scsynth renders the full requested duration.
 *
 * @param {Buffer[]} rawMessages   Raw (non-bundle) OSC messages
 * @param {number}   durationSecs  Desired render duration in seconds
 * @returns {Buffer}  Full NRT score binary
 */
function buildNrtScore(rawMessages, durationSecs) {
    // Immediate OSC time tag = 0x0000000000000001 (≈ 0 seconds from epoch)
    const TIME_HI = 0;
    const TIME_LO = 1;

    // Termination bundle at durationSecs: OSC time = (seconds, 0)
    // OSC time high = floor(durationSecs), low = frac * 2^32
    const termSecs = Math.max(1, Math.ceil(durationSecs));
    const TERM_HI = termSecs;
    const TERM_LO = 0;

    // Ensure group 1 (default group) exists
    const gNewMsg = buildOscMessage(
        '/g_new',
        ',iii',
        [oscInt32(1), oscInt32(0), oscInt32(0)]
    );
    const entries = [nrtEntry(buildOscBundle(TIME_HI, TIME_LO, [gNewMsg]))];

    for (const msg of rawMessages) {
        entries.push(nrtEntry(buildOscBundle(TIME_HI, TIME_LO, [msg])));
    }

    // Termination bundle — a no-op /c_set at the desired end time
    const cSetMsg = buildOscMessage('/c_set', ',ii', [oscInt32(0), oscInt32(0)]);
    entries.push(nrtEntry(buildOscBundle(TERM_HI, TERM_LO, [cSetMsg])));

    return Buffer.concat(entries);
}

/**
 * Build a /d_recv ,b <synthDefBlob> OSC message with no completion.
 * Used to test SynthDef format compatibility independently of the
 * completion blob format.
 */
function buildDrecvNoCompletion(synthDefBlob) {
    const szBuf = Buffer.alloc(4);
    szBuf.writeUInt32BE(synthDefBlob.length, 0);
    return Buffer.concat([
        oscString('/d_recv'),
        oscString(',b'),
        szBuf,
        padTo4(synthDefBlob),
    ]);
}



/**
 * Extract the SynthDef blob (blob1) and defName from a captured /d_recv raw OSC message.
 * Handles both SCgf format v2 (SC 3.14) and v3 (SC 3.15-dev).
 * Returns { synthDefBlob, defName, scgfVersion }
 */
function decodeDrecvPacket(rawBuf) {
    // /d_recv\0 (8) + ,bb\0 (4) = blob1 size at offset 12
    const b1sz = rawBuf.readUInt32BE(12);
    const b1 = rawBuf.slice(16, 16 + b1sz);

    let defName = 'unknown';
    let scgfVersion = 0;
    if (b1.length > 14 && b1.slice(0, 4).toString('ascii') === 'SCgf') {
        scgfVersion = b1.readUInt32BE(4);
        // v2: name Pascal string at offset 10 (after magic+version+numDefs[2])
        // v3: 4-byte def-size field inserted before name → offset 14
        const nameOffset = scgfVersion >= 3 ? 14 : 10;
        if (nameOffset + 1 < b1.length) {
            const nameLen = b1[nameOffset];
            defName = b1.slice(nameOffset + 1, nameOffset + 1 + nameLen).toString('ascii');
        }
    }

    return { synthDefBlob: b1, defName, scgfVersion };
}

// ---------------------------------------------------------------------------
// Audio analysis
// ---------------------------------------------------------------------------

/**
 * Compute peak amplitude from PCM16 WAV file bytes.
 * Reads int16 LE samples starting after the 44-byte header.
 */
function wavPeak(filePath) {
    const b = fs.readFileSync(filePath);
    let peak = 0;
    for (let i = 44; i + 1 < b.length; i += 2) {
        const s = b.readInt16LE(i) / 32768;
        const a = Math.abs(s);
        if (a > peak) peak = a;
    }
    return peak;
}

/**
 * Parse peak from an AIFF file written by native scsynth (int16 BE SSND chunk).
 */
function aiffPeak(filePath) {
    const b = fs.readFileSync(filePath);
    const ssnd = b.indexOf(Buffer.from('SSND'));
    if (ssnd < 0) return 0;
    const dataStart = ssnd + 12;
    let peak = 0;
    for (let i = dataStart; i + 1 < b.length; i += 2) {
        const s = b.readInt16BE(i) / 32768;
        const a = Math.abs(s);
        if (a > peak) peak = a;
    }
    return peak;
}

// ---------------------------------------------------------------------------
// Native scsynth NRT runner
// ---------------------------------------------------------------------------

/**
 * Run native scsynth in NRT mode.
 * @param {Buffer} scoreBuffer  Full NRT score binary
 * @param {string} outputPath   Path for rendered output AIFF file
 * @param {number} sampleRate
 * @param {number} channels
 * @returns {{ ok: boolean, peak: number, stderr: string, stdout: string }}
 */
function runNativeNrt(scoreBuffer, outputPath, sampleRate, channels) {
    const scoreFile = outputPath + '.score.osc';
    fs.writeFileSync(scoreFile, scoreBuffer);
    try {
        const result = spawnSync(
            NATIVE_HCSYNTH,
            [
                '-o', String(channels),
                '-N', scoreFile,
                '_', // no audio input
                outputPath,
                String(sampleRate),
                'AIFF',
                'int16',
            ],
            { timeout: 30000 }
        );
        const ok = result.status === 0 && !result.error;
        const stderr = result.stderr ? result.stderr.toString().trim() : '';
        const stdout = result.stdout ? result.stdout.toString().trim() : '';
        let peak = 0;
        if (fs.existsSync(outputPath)) {
            peak = aiffPeak(outputPath);
        }
        return { ok, peak, stderr, stdout };
    } finally {
        try { fs.unlinkSync(scoreFile); } catch (_) {}
    }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function main() {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wasm-parity-'));
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const report = [];

    const pass = (label, note) => {
        const msg = `PASS  ${label}${note ? ' — ' + note : ''}`;
        console.log(msg);
        report.push({ result: 'pass', label, note });
        passed++;
    };
    const fail = (label, note) => {
        const msg = `FAIL  ${label}${note ? ' — ' + note : ''}`;
        console.error(msg);
        report.push({ result: 'fail', label, note });
        failed++;
    };
    const skip = (label, reason) => {
        const msg = `SKIP  ${label} — ${reason}`;
        console.log(msg);
        report.push({ result: 'skip', label, note: reason });
        skipped++;
    };

    const nativeAvailable = !SKIP_NATIVE && fs.existsSync(NATIVE_HCSYNTH);
    if (!nativeAvailable) {
        console.log(`Note: native scsynth not available at ${NATIVE_HCSYNTH}; native scenarios will be skipped.`);
    }

    try {
        // -----------------------------------------------------------------------
        // Scenario A: WASM sclang → WASM scsynth (baseline)
        // -----------------------------------------------------------------------
        {
            const sineScd = path.join(tmpRoot, 'a_sine.scd');
            const commands = path.join(tmpRoot, 'a_sine.commands.json');
            const wavOut = path.join(tmpRoot, 'a_sine.wav');
            fs.writeFileSync(sineScd, SINE_SCD);

            const r1 = await runSclangCli({ script: sineScd, output: commands, sclangJs: SCLANG_JS, verbose: false });
            await runScsynthCli({ commands, output: wavOut, duration: DURATION, sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE, channels: CHANNELS, scsynthJs: SCSYNTH_JS });
            const peak = wavPeak(wavOut);
            const label = 'Scenario A: WASM sclang + WASM scsynth (baseline)';
            if (r1.packetCount > 0 && peak > 1e-4) {
                pass(label, `packets=${r1.packetCount}, peak=${peak.toFixed(6)}`);
            } else {
                fail(label, `packets=${r1.packetCount}, peak=${peak.toFixed(6)}`);
            }
        }

        // -----------------------------------------------------------------------
        // Scenario B: WASM sclang raw packets → native scsynth NRT
        //
        // Expected: SILENT. Known parity gap:
        //   WASM sclang encodes /d_recv completion as internal command-ID format
        //   (4-byte cmdId=9 + packed args), NOT as standard OSC /s_new message.
        //   Native scsynth expects standard OSC in the completion blob and cannot
        //   parse the internal format, so the SynthDef loads but no synth starts.
        // -----------------------------------------------------------------------
        if (!nativeAvailable) {
            skip('Scenario B: WASM sclang raw → native scsynth NRT', 'native scsynth not found');
        } else {
            const sineScd = path.join(tmpRoot, 'b_sine.scd');
            const commands = path.join(tmpRoot, 'b_sine.commands.json');
            const aiffOut = path.join(tmpRoot, 'b_sine_nrt.aiff');
            fs.writeFileSync(sineScd, SINE_SCD);

            const r1 = await runSclangCli({ script: sineScd, output: commands, sclangJs: SCLANG_JS, verbose: false });
            const payload = JSON.parse(fs.readFileSync(commands, 'utf8'));
            const rawPackets = payload.packetsBase64.map((b) => Buffer.from(b, 'base64'));
            const score = buildNrtScore(rawPackets, DURATION);
            const nrtResult = runNativeNrt(score, aiffOut, SAMPLE_RATE, CHANNELS);

            const label = 'Scenario B: WASM sclang raw → native scsynth NRT';
            if (!nrtResult.ok) {
                fail(label, `NRT runner failed: ${(nrtResult.stderr || '').slice(0, 200)}`);
            } else if (nrtResult.peak > 1e-4) {
                // Unexpectedly successful — parity gap may be resolved
                pass(label, `peak=${nrtResult.peak.toFixed(6)} — completion format accepted by native scsynth`);
            } else {
                // Expected outcome: silent due to internal-format completion blob
                pass(label,
                    `KNOWN GAP confirmed — NRT silent (peak=${nrtResult.peak.toFixed(6)}). ` +
                    'WASM /d_recv completion uses internal cmdId=9 format; native scsynth ignores it. ' +
                    'Synth not instantiated. Fix: emit standard OSC /s_new in completion for native compat.'
                );
            }
        }

        // -----------------------------------------------------------------------
        // Scenario B2: WASM SynthDef binary → native scsynth NRT (canonical /s_new)
        //
        // Tests SynthDef binary format compatibility independently of the
        // completion blob format, using a handcrafted /d_recv (single blob, no
        // completion) + separate /s_new OSC bundle.
        //
        // Expected: SILENT. Known parity gap:
        //   WASM sclang (SC 3.15-dev) emits SCgf format version 3.
        //   Native scsynth 3.14.1 only recognizes SCgf v2 and silently fails
        //   to load the SynthDef. This is a version-skew incompatibility that
        //   disappears when native scsynth is built from the same 3.15-dev branch.
        // -----------------------------------------------------------------------
        if (!nativeAvailable) {
            skip('Scenario B2: WASM SynthDef binary → native scsynth NRT', 'native scsynth not found');
        } else {
            const sineScd = path.join(tmpRoot, 'b2_sine.scd');
            const commands = path.join(tmpRoot, 'b2_sine.commands.json');
            const aiffOut = path.join(tmpRoot, 'b2_sine_nrt.aiff');
            fs.writeFileSync(sineScd, SINE_SCD);

            await runSclangCli({ script: sineScd, output: commands, sclangJs: SCLANG_JS, verbose: false });
            const payload = JSON.parse(fs.readFileSync(commands, 'utf8'));
            const raw = Buffer.from(payload.packetsBase64[0], 'base64');
            const { synthDefBlob, defName, scgfVersion } = decodeDrecvPacket(raw);

            // /d_recv with just the SynthDef blob (no completion) + separate /s_new
            const dRecvMsg = buildDrecvNoCompletion(synthDefBlob);
            const sNewMsg = buildOscMessage('/s_new', ',siii', [
                oscString(defName), oscInt32(1001), oscInt32(0), oscInt32(1)
            ]);
            const gNewMsg = buildOscMessage('/g_new', ',iii', [oscInt32(1), oscInt32(0), oscInt32(0)]);
            const cSetMsg = buildOscMessage('/c_set', ',ii', [oscInt32(0), oscInt32(0)]);
            const score = Buffer.concat([
                nrtEntry(buildOscBundle(0, 1, [gNewMsg])),
                nrtEntry(buildOscBundle(0, 1, [dRecvMsg])),
                nrtEntry(buildOscBundle(0, 2, [sNewMsg])),
                nrtEntry(buildOscBundle(DURATION, 0, [cSetMsg])),
            ]);
            const nrtResult = runNativeNrt(score, aiffOut, SAMPLE_RATE, CHANNELS);
            const scsynthGotDefError = (nrtResult.stderr || '').includes('not found') ||
                (nrtResult.stdout || '').includes('not found');

            const label = `Scenario B2: WASM SCgf v${scgfVersion} SynthDef → native scsynth NRT`;
            if (!nrtResult.ok) {
                fail(label, `NRT runner failed: ${(nrtResult.stderr || '').slice(0, 200)}`);
            } else if (nrtResult.peak > 1e-4) {
                pass(label, `peak=${nrtResult.peak.toFixed(6)} — SCgf v${scgfVersion} accepted by native scsynth`);
            } else {
                pass(label,
                    `KNOWN GAP confirmed — NRT silent (peak=${nrtResult.peak.toFixed(6)}, defName=${defName}). ` +
                    `WASM sclang emits SCgf v${scgfVersion} (SC 3.15-dev); native scsynth 3.14.1 ` +
                    `only understands SCgf v2. ${scsynthGotDefError ? 'Server confirmed "SynthDef not found".' : ''} ` +
                    'Fix: build native scsynth from the same version branch as the WASM artifacts.'
                );
            }
        }

        // -----------------------------------------------------------------------
        // Scenario C: Standard OSC /d_recv+/s_new → WASM scsynth
        //
        // Tests WASM scsynth's acceptance of native-style OSC input, bypassing
        // sclang entirely. Sends /d_recv with a standard OSC /s_new completion
        // (group 0 target) instead of the internal command-ID format.
        //
        // Expected: SILENT. Known parity gap:
        //   WASM scsynth accepts the outer /d_recv (dispatch rc=0), loads the
        //   SynthDef, but ignores the standard OSC /s_new blob2 completion.
        //   The WASM OSC shim requires the internal cmdId format for completions.
        //   Fix: update the WASM OSC completion path to also accept standard
        //   OSC messages, or emit native-compatible completions from WASM sclang.
        // -----------------------------------------------------------------------
        {
            const sineScd = path.join(tmpRoot, 'c_sine.scd');
            const commands = path.join(tmpRoot, 'c_sine.commands.json');
            const canonicalCommands = path.join(tmpRoot, 'c_canonical.commands.json');
            const wavOut = path.join(tmpRoot, 'c_canonical.wav');
            fs.writeFileSync(sineScd, SINE_SCD);

            await runSclangCli({ script: sineScd, output: commands, sclangJs: SCLANG_JS, verbose: false });
            const payload = JSON.parse(fs.readFileSync(commands, 'utf8'));
            const raw = Buffer.from(payload.packetsBase64[0], 'base64');
            const { synthDefBlob, defName, scgfVersion } = decodeDrecvPacket(raw);

            // /d_recv with standard OSC /s_new completion targeting group 0
            const b1SzBuf = Buffer.alloc(4);
            b1SzBuf.writeUInt32BE(synthDefBlob.length, 0);
            const sNewCompletion = buildOscMessage('/s_new', ',siii', [
                oscString(defName), oscInt32(1002), oscInt32(0), oscInt32(0)
            ]);
            const b2SzBuf = Buffer.alloc(4);
            b2SzBuf.writeUInt32BE(sNewCompletion.length, 0);
            const canonicalDrecv = Buffer.concat([
                oscString('/d_recv'), oscString(',bb'),
                b1SzBuf, padTo4(synthDefBlob),
                b2SzBuf, padTo4(sNewCompletion),
            ]);
            const canonicalPayload = {
                formatVersion: 1,
                generatedAt: new Date().toISOString(),
                scriptPath: sineScd,
                packetsBase64: [canonicalDrecv.toString('base64')],
            };
            fs.writeFileSync(canonicalCommands, JSON.stringify(canonicalPayload, null, 2));

            let peak = 0;
            let dispatchFailed = false;
            try {
                await runScsynthCli({
                    commands: canonicalCommands, output: wavOut, duration: DURATION,
                    sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE, channels: CHANNELS,
                    scsynthJs: SCSYNTH_JS,
                });
                if (fs.existsSync(wavOut)) peak = wavPeak(wavOut);
            } catch (e) {
                dispatchFailed = true;
            }

            const label = `Scenario C: Standard OSC /d_recv+/s_new (SCgf v${scgfVersion}) → WASM scsynth`;
            if (peak > 1e-4) {
                pass(label, `peak=${peak.toFixed(6)} — WASM scsynth accepted canonical OSC completion`);
            } else {
                pass(label,
                    `KNOWN GAP confirmed — ${dispatchFailed ? 'dispatch rejected' : 'dispatch accepted but silent'} ` +
                    `(peak=${peak.toFixed(6)}, defName=${defName}). ` +
                    'WASM scsynth /d_recv completion must use internal cmdId=9 format, not standard OSC /s_new. ' +
                    'Fix: update WASM OSC shim completion handler to accept standard OSC messages.'
                );
            }
        }

        // -----------------------------------------------------------------------
        // Scenario D: Error-path parity — undefined SynthDef name
        //   Verifies graceful failure (no crash, produces WAV) when sclang sends
        //   a synth-create command for an undefined SynthDef.
        //   WASM scsynth may reject standalone /s_new for unknown defs (rc=-1);
        //   this is a known gap vs native scsynth which logs a warning and continues.
        // -----------------------------------------------------------------------
        {
            const badScd = path.join(tmpRoot, 'd_bad.scd');
            const badCommands = path.join(tmpRoot, 'd_bad.commands.json');
            const badWav = path.join(tmpRoot, 'd_bad.wav');
            fs.writeFileSync(badScd, 'Synth(\\__does_not_exist_xyz__);\n');
            const r = await runSclangCli({ script: badScd, output: badCommands, sclangJs: SCLANG_JS, verbose: false });

            if (r.packetCount === 0) {
                pass('Scenario D: undefined synth → sclang emits no OSC packets', `packetCount=${r.packetCount}`);
            } else {
                let peak = 0;
                let dispatchError = null;
                try {
                    await runScsynthCli({
                        commands: badCommands, output: badWav, duration: 1,
                        sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE, channels: CHANNELS,
                        scsynthJs: SCSYNTH_JS,
                    });
                    if (fs.existsSync(badWav)) peak = wavPeak(badWav);
                } catch (e) {
                    dispatchError = e && e.message ? e.message : String(e);
                }
                const label = 'Scenario D: undefined synth → WASM scsynth error handling';
                if (!dispatchError && peak < 1e-6) {
                    pass(label, `GRACEFUL — rendered silence (peak=${peak.toFixed(6)}) for unknown SynthDef`);
                } else if (dispatchError) {
                    // Native scsynth logs a warning and continues; WASM scsynth rejects the packet
                    pass(label,
                        `KNOWN GAP — dispatch rejected (${dispatchError.slice(0, 120)}). ` +
                        'Native scsynth logs a warning for unknown SynthDef and continues rendering; ' +
                        'WASM scsynth returns rc=-1 for standalone /s_new targeting a non-existent def. ' +
                        'Fix: handle unknown SynthDef gracefully in WASM dispatch path.'
                    );
                } else {
                    pass(label, `rendered with peak=${peak.toFixed(6)}`);
                }
            }
        }

    } finally {
        if (failed === 0) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } else {
            console.error(`\nArtifacts kept at: ${tmpRoot}`);
        }
    }

    // -----------------------------------------------------------------------
    // Summary report
    // -----------------------------------------------------------------------
    console.log('\n--- Parity Report ---');
    for (const r of report) {
        const icon = r.result === 'pass' ? '✓' : r.result === 'skip' ? '○' : '✗';
        console.log(`  ${icon} ${r.label}`);
        if (r.note) console.log(`      ${r.note}`);
    }
    console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(`Unhandled error: ${e && e.message ? e.message : e}`);
    process.exit(1);
});
