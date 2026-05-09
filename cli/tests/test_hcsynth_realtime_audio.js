#!/usr/bin/env node
/**
 * test_hcsynth_realtime_audio.js — Smoke test for hcsynth --realtime-audio server mode (N5.5)
 *
 * Tests:
 *   1. hcsynth --server --udp-port <port> --realtime-audio starts successfully.
 *   2. The "Real-time audio:" initialization line appears in stdout.
 *   3. The UDP server is still accepting connections (server survives audio init).
 *   4. /quit shuts down the server cleanly.
 *
 * Requires a WASM scsynth build at build/wasm/server/scsynth/scsynth.js.
 * Skips gracefully if build artifacts are missing or if 'speaker' is not installed.
 */

'use strict';

const dgram = require('node:dgram');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCSYNTH_CLI = path.join(PROJECT_ROOT, 'cli', 'hcsynth.js');
const SCSYNTH_JS = path.join(PROJECT_ROOT, 'build', 'wasm', 'server', 'hcsynth', 'hcsynth.js');
const TEST_UDP_PORT = 57122;
const TIMEOUT_MS = 10000;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function buildOscMessage(address) {
  function padTo4(n) { return Math.ceil(n / 4) * 4; }
  const addrBytes = Buffer.from(address + '\0');
  const addrPadded = Buffer.alloc(padTo4(addrBytes.length));
  addrBytes.copy(addrPadded);
  const typeTag = Buffer.from(',\0\0\0');
  return Buffer.concat([addrPadded, typeTag]);
}

function waitForProcess(proc, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function runTest() {
  console.log('=== test_hcsynth_realtime_audio ===\n');

  if (!fs.existsSync(SCSYNTH_JS)) {
    console.log(`SKIP: WASM build not found at ${SCSYNTH_JS}`);
    console.log('Run `just build` to build scsynth and re-run this test.\n');
    process.exit(0);
  }

  // Check that 'speaker' is loadable from the CLI package directory
  const speakerModulePath = path.join(PROJECT_ROOT, 'cli', 'node_modules', 'speaker');
  if (!fs.existsSync(speakerModulePath)) {
    console.log('SKIP: "speaker" npm package not installed in cli/node_modules');
    console.log('Run `npm install` in cli/ and re-run this test.\n');
    process.exit(0);
  }

  let proc = null;
  let socket = null;

  try {
    // -----------------------------------------------------------------------
    // Test 1: server starts with --realtime-audio and logs initialization
    // -----------------------------------------------------------------------
    console.log('Test 1: server starts with --realtime-audio');

    const stdoutLines = [];

    proc = spawn(process.execPath, [
      SCSYNTH_CLI,
      '--server',
      '--udp-port', String(TEST_UDP_PORT),
      '--bind-address', '127.0.0.1',
      '--scsynth-js', SCSYNTH_JS,
      '--realtime-audio',
      '--sample-rate', '44100',
      '--channels', '2',
      '--block-size', '512',
    ]);

    proc.stdout.on('data', (d) => stdoutLines.push(d.toString()));
    proc.stderr.on('data', () => {});

    // Give the server time to initialize audio and bind UDP
    await new Promise((r) => setTimeout(r, 3000));

    assert(proc.exitCode === null, 'server process is still running after 3s');

    // -----------------------------------------------------------------------
    // Test 2: real-time audio initialization log line present
    // -----------------------------------------------------------------------
    console.log('\nTest 2: real-time audio initialization logged');

    const allOutput = stdoutLines.join('');
    assert(
      allOutput.includes('Real-time audio:'),
      'stdout contains "Real-time audio:" initialization line'
    );

    // -----------------------------------------------------------------------
    // Test 3: UDP server responds (or stays alive) after audio init
    // -----------------------------------------------------------------------
    console.log('\nTest 3: UDP server is alive after audio init');

    socket = dgram.createSocket('udp4');

    const statusMsg = buildOscMessage('/status');

    const replyOrAlive = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), TIMEOUT_MS);

      socket.on('message', () => {
        clearTimeout(timer);
        resolve('reply');
      });

      socket.bind(0, '127.0.0.1', () => {
        socket.send(statusMsg, 0, statusMsg.length, TEST_UDP_PORT, '127.0.0.1');
      });
    });

    if (replyOrAlive === 'reply') {
      assert(true, '/status reply received from server');
    } else {
      assert(proc.exitCode === null, 'server still running after /status (no crash)');
    }

    // -----------------------------------------------------------------------
    // Test 4: /quit shuts down the server
    // -----------------------------------------------------------------------
    console.log('\nTest 4: /quit shuts down the server');

    const quitMsg = buildOscMessage('/quit');
    socket.send(quitMsg, 0, quitMsg.length, TEST_UDP_PORT, '127.0.0.1');

    const exitCode = await waitForProcess(proc, TIMEOUT_MS);
    assert(exitCode !== null, 'server process exited after /quit');
    assert(exitCode === 0, `server exited cleanly (code=${exitCode})`);

    proc = null;
  } finally {
    if (socket) {
      try { socket.close(); } catch (_) {}
    }
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await waitForProcess(proc, 3000);
    }
  }
}

runTest()
  .then(() => {
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  });
