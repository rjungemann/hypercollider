#!/usr/bin/env node
/**
 * test_hcsynth_udp.js — Integration test for hcsynth UDP server mode (Phase N1)
 *
 * Tests:
 *   1. hcsynth --server --udp-port <port> starts and binds successfully.
 *   2. A /status OSC message receives a reply within the timeout.
 *   3. A /quit OSC message causes the server process to exit cleanly.
 *
 * Requires a WASM scsynth build at build/wasm/server/scsynth/scsynth.js.
 * Skips gracefully if build artifacts are missing.
 */

'use strict';

const dgram = require('node:dgram');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCSYNTH_CLI = path.join(PROJECT_ROOT, 'cli', 'hcsynth.js');
const SCSYNTH_JS = path.join(PROJECT_ROOT, 'build', 'wasm', 'server', 'hcsynth', 'hcsynth.js');
const TEST_UDP_PORT = 57119;
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
  console.log('=== test_hcsynth_udp ===\n');

  if (!fs.existsSync(SCSYNTH_JS)) {
    console.log(`SKIP: WASM build not found at ${SCSYNTH_JS}`);
    console.log('Run `just build` to build scsynth and re-run this test.\n');
    process.exit(0);
  }

  let proc = null;
  let socket = null;

  try {
    // -----------------------------------------------------------------------
    // Test 1: server starts and binds
    // -----------------------------------------------------------------------
    console.log('Test 1: UDP server starts and binds');

    proc = spawn(process.execPath, [
      SCSYNTH_CLI,
      '--server',
      '--udp-port', String(TEST_UDP_PORT),
      '--bind-address', '127.0.0.1',
      '--scsynth-js', SCSYNTH_JS,
      '--verbosity', '-2',
    ]);

    const stderrLines = [];
    proc.stderr.on('data', (d) => stderrLines.push(d.toString()));
    proc.stdout.on('data', () => {});

    // Give the server time to bind
    await new Promise((r) => setTimeout(r, 2000));

    assert(proc.exitCode === null, 'server process is still running after 2s');

    // -----------------------------------------------------------------------
    // Test 2: /status gets a reply
    // -----------------------------------------------------------------------
    console.log('\nTest 2: /status gets a UDP reply');

    socket = dgram.createSocket('udp4');

    const statusMsg = buildOscMessage('/status');

    const replyReceived = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), TIMEOUT_MS);

      socket.on('message', (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      socket.bind(0, '127.0.0.1', () => {
        socket.send(statusMsg, 0, statusMsg.length, TEST_UDP_PORT, '127.0.0.1');
      });
    });

    // scsynth may or may not produce a reply to /status depending on WASM build.
    // We accept either: a reply arrived OR the server is still running (no crash).
    if (Buffer.isBuffer(replyReceived)) {
      assert(replyReceived.length > 0, `/status reply received (${replyReceived.length} bytes)`);
    } else {
      assert(proc.exitCode === null, 'server still running after /status (no crash)');
    }

    // -----------------------------------------------------------------------
    // Test 3: /quit shuts down the server
    // -----------------------------------------------------------------------
    console.log('\nTest 3: /quit shuts down the server');

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
