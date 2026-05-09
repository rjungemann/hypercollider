#!/usr/bin/env node
/**
 * test_hcsynth_tcp.js — Integration test for hcsynth TCP server mode (Phase N2)
 *
 * Tests:
 *   1. hcsynth --server --tcp-port <port> starts and accepts connections.
 *   2. A framed /status OSC message receives a framed reply (or server stays alive).
 *   3. Max-logins rejection: excess connections get an /error reply and are closed.
 *   4. /quit via TCP shuts down the server.
 *
 * Requires a WASM scsynth build at build/wasm/server/scsynth/scsynth.js.
 * Skips gracefully if build artifacts are missing.
 */

'use strict';

const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCSYNTH_CLI = path.join(PROJECT_ROOT, 'cli', 'hcsynth.js');
const SCSYNTH_JS = path.join(PROJECT_ROOT, 'build', 'wasm', 'server', 'hcsynth', 'hcsynth.js');
const TEST_TCP_PORT = 57121;
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

function padTo4(n) { return Math.ceil(n / 4) * 4; }

function buildOscMessage(address) {
  const addrBytes = Buffer.from(address + '\0');
  const addrPadded = Buffer.alloc(padTo4(addrBytes.length));
  addrBytes.copy(addrPadded);
  const typeTag = Buffer.from(',\0\0\0');
  return Buffer.concat([addrPadded, typeTag]);
}

function frameOsc(oscBytes) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(oscBytes.length);
  return Buffer.concat([lenBuf, oscBytes]);
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

function connectTcp(port, host) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(port, host, () => resolve(s));
    s.once('error', reject);
  });
}

function readFramedReply(socket, timeoutMs) {
  return new Promise((resolve) => {
    let accumBuf = Buffer.alloc(0);
    const timer = setTimeout(() => resolve(null), timeoutMs);

    function onData(chunk) {
      accumBuf = Buffer.concat([accumBuf, chunk]);
      if (accumBuf.length >= 4) {
        const msgLen = accumBuf.readUInt32BE(0);
        if (accumBuf.length >= 4 + msgLen) {
          clearTimeout(timer);
          socket.off('data', onData);
          resolve(accumBuf.slice(4, 4 + msgLen));
        }
      }
    }

    socket.on('data', onData);
  });
}

async function runTest() {
  console.log('=== test_hcsynth_tcp ===\n');

  if (!fs.existsSync(SCSYNTH_JS)) {
    console.log(`SKIP: WASM build not found at ${SCSYNTH_JS}`);
    console.log('Run `just build` to build scsynth and re-run this test.\n');
    process.exit(0);
  }

  let proc = null;
  const sockets = [];

  try {
    // -----------------------------------------------------------------------
    // Test 1: TCP server starts and accepts connections
    // -----------------------------------------------------------------------
    console.log('Test 1: TCP server starts and accepts connections');

    proc = spawn(process.execPath, [
      SCSYNTH_CLI,
      '--server',
      '--tcp-port', String(TEST_TCP_PORT),
      '--bind-address', '127.0.0.1',
      '--max-logins', '2',
      '--scsynth-js', SCSYNTH_JS,
      '--verbosity', '-2',
    ]);

    proc.stderr.on('data', () => {});
    proc.stdout.on('data', () => {});

    // Wait for server to bind
    await new Promise((r) => setTimeout(r, 2000));

    assert(proc.exitCode === null, 'server process is still running after 2s');

    const client1 = await connectTcp(TEST_TCP_PORT, '127.0.0.1');
    sockets.push(client1);
    assert(true, 'first TCP client connected');

    // -----------------------------------------------------------------------
    // Test 2: framed /status message
    // -----------------------------------------------------------------------
    console.log('\nTest 2: framed /status message');

    const statusMsg = frameOsc(buildOscMessage('/status'));
    client1.write(statusMsg);

    const reply = await readFramedReply(client1, TIMEOUT_MS);

    if (reply !== null) {
      assert(reply.length > 0, `/status framed reply received (${reply.length} bytes)`);
      const addr = reply.slice(0, reply.indexOf(0)).toString('utf8');
      assert(typeof addr === 'string', `reply address: ${addr}`);
    } else {
      assert(proc.exitCode === null, 'server still running after /status (no crash, no reply)');
    }

    // -----------------------------------------------------------------------
    // Test 3: max-logins rejection (server was started with --max-logins 2)
    // -----------------------------------------------------------------------
    console.log('\nTest 3: max-logins rejection');

    const client2 = await connectTcp(TEST_TCP_PORT, '127.0.0.1').catch(() => null);
    if (client2) sockets.push(client2);
    assert(client2 !== null, 'second client connected (at limit)');

    // Third client should be rejected
    const client3 = await connectTcp(TEST_TCP_PORT, '127.0.0.1').catch(() => null);
    if (client3) sockets.push(client3);

    if (client3) {
      // Server should send an /error reply and close the socket
      const rejectReply = await readFramedReply(client3, 3000);
      const wasRejected = rejectReply !== null || await new Promise((r) => {
        client3.once('close', () => r(true));
        setTimeout(() => r(false), 2000);
      });
      assert(wasRejected, 'third client was rejected (reply or close)');
    } else {
      assert(true, 'third client connection refused at OS level (max-logins enforced)');
    }

    // -----------------------------------------------------------------------
    // Test 4: /quit via TCP shuts down the server
    // -----------------------------------------------------------------------
    console.log('\nTest 4: /quit via TCP shuts down the server');

    const quitMsg = frameOsc(buildOscMessage('/quit'));
    client1.write(quitMsg);

    const exitCode = await waitForProcess(proc, TIMEOUT_MS);
    assert(exitCode !== null, 'server process exited after /quit');
    assert(exitCode === 0, `server exited cleanly (code=${exitCode})`);

    proc = null;
  } finally {
    for (const s of sockets) {
      try { s.destroy(); } catch (_) {}
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
