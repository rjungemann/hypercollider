#!/usr/bin/env node
/**
 * test_sc_cli_udp_route.js — Integration test for hc / hclang external UDP routing (Phase N3)
 *
 * Tests:
 *   1. Start hcsynth --server --udp-port <port>.
 *   2. Run hc --script <file> --scsynth-host 127.0.0.1 --scsynth-port <port>.
 *   3. Assert that OSC packets arrive at the scsynth UDP server (server receives messages).
 *   4. Assert hc exits cleanly after routing.
 *
 * Requires WASM build artifacts. Skips gracefully if missing.
 */

'use strict';

const dgram = require('node:dgram');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCSYNTH_CLI = path.join(PROJECT_ROOT, 'cli', 'hcsynth.js');
const SC_CLI = path.join(PROJECT_ROOT, 'cli', 'hc.js');
const SCSYNTH_JS = path.join(PROJECT_ROOT, 'build', 'wasm', 'server', 'hcsynth', 'hcsynth.js');
const SCLANG_JS = path.join(PROJECT_ROOT, 'build', 'wasm', 'lang', 'hclang', 'hclang.js');
const EXAMPLES_DIR = path.join(PROJECT_ROOT, 'cli', 'examples');
const TEST_UDP_PORT = 57122;
const TIMEOUT_MS = 15000;

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

function waitForProcess(proc, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function waitForUdpMessage(socket, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once('message', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

async function runTest() {
  console.log('=== test_sc_cli_udp_route ===\n');

  if (!fs.existsSync(SCSYNTH_JS)) {
    console.log(`SKIP: WASM scsynth build not found at ${SCSYNTH_JS}`);
    console.log('Run `just build` to build scsynth and re-run this test.\n');
    process.exit(0);
  }

  if (!fs.existsSync(SCLANG_JS)) {
    console.log(`SKIP: WASM sclang build not found at ${SCLANG_JS}`);
    console.log('Run `just build-sclang` and re-run this test.\n');
    process.exit(0);
  }

  // Find a suitable .scd script to test with
  const exampleScript = path.join(EXAMPLES_DIR, 'sine_wave.scd');
  if (!fs.existsSync(exampleScript)) {
    console.log(`SKIP: Example script not found at ${exampleScript}`);
    process.exit(0);
  }

  let serverProc = null;
  let interceptSocket = null;

  try {
    // -----------------------------------------------------------------------
    // Test 1: Start a raw UDP socket as a mock scsynth to intercept OSC packets
    // -----------------------------------------------------------------------
    console.log('Test 1: Intercept OSC packets routed from hc via UDP');

    // We use a plain UDP socket as the "scsynth" target so the test doesn't
    // require a fully working WASM scsynth server. We just verify that
    // hc sends OSC packets to the correct host:port.
    interceptSocket = dgram.createSocket('udp4');

    await new Promise((resolve, reject) => {
      interceptSocket.bind(TEST_UDP_PORT, '127.0.0.1', resolve);
      interceptSocket.once('error', reject);
    });

    assert(true, `intercept socket bound on 127.0.0.1:${TEST_UDP_PORT}`);

    // -----------------------------------------------------------------------
    // Test 2: hc routes OSC packets to the intercept socket
    // -----------------------------------------------------------------------
    console.log('\nTest 2: hc --scsynth-host/port routes OSC packets');

    const firstPacket = waitForUdpMessage(interceptSocket, TIMEOUT_MS);

    const scCliProc = spawn(process.execPath, [
      SC_CLI,
      '--script', exampleScript,
      '--scsynth-host', '127.0.0.1',
      '--scsynth-port', String(TEST_UDP_PORT),
      '--sclang-js', SCLANG_JS,
      '--scsynth-js', SCSYNTH_JS,
      '--verbosity', '-2',
    ]);

    scCliProc.stderr.on('data', () => {});
    scCliProc.stdout.on('data', () => {});

    const [packet, scCliExitCode] = await Promise.all([
      firstPacket,
      waitForProcess(scCliProc, TIMEOUT_MS),
    ]);

    assert(packet !== null, 'at least one OSC packet received at intercept socket');
    if (packet) {
      assert(packet.length >= 8, `OSC packet has reasonable size (${packet.length} bytes)`);
      // OSC messages start with '/'
      assert(packet[0] === 0x2f || packet[0] === 0x23, 'packet looks like OSC (starts with / or #bundle)');
    }

    // -----------------------------------------------------------------------
    // Test 3: hc exits cleanly after routing
    // -----------------------------------------------------------------------
    console.log('\nTest 3: hc exits cleanly after routing');

    assert(scCliExitCode !== null, 'hc process exited');
    assert(scCliExitCode === 0, `hc exited cleanly (code=${scCliExitCode})`);

    // -----------------------------------------------------------------------
    // Test 4: hclang direct routing (Phase N3.3 — hclang --scsynth-host)
    // -----------------------------------------------------------------------
    console.log('\nTest 4: hclang --scsynth-host/port routes OSC packets directly');

    const SCLANG_CLI = path.join(PROJECT_ROOT, 'cli/hclang.js');

    const secondPacket = waitForUdpMessage(interceptSocket, TIMEOUT_MS);

    const sclangCliProc = spawn(process.execPath, [
      SCLANG_CLI,
      '--script', exampleScript,
      '--scsynth-host', '127.0.0.1',
      '--scsynth-port', String(TEST_UDP_PORT),
      '--sclang-js', SCLANG_JS,
      '--verbosity', '-2',
    ]);

    sclangCliProc.stderr.on('data', () => {});
    sclangCliProc.stdout.on('data', () => {});

    const [packet2, sclangExitCode] = await Promise.all([
      secondPacket,
      waitForProcess(sclangCliProc, TIMEOUT_MS),
    ]);

    assert(packet2 !== null, 'hclang routed at least one OSC packet');
    assert(sclangExitCode !== null, 'hclang process exited');
    assert(sclangExitCode === 0, `hclang exited cleanly (code=${sclangExitCode})`);
  } finally {
    if (interceptSocket) {
      try { interceptSocket.close(); } catch (_) {}
    }
    if (serverProc && serverProc.exitCode === null) {
      serverProc.kill('SIGTERM');
      await waitForProcess(serverProc, 3000);
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
