#!/usr/bin/env node
/**
 * test_hcsynth_mdns.js — Integration test for hcsynth mDNS service advertisement (Phase B1)
 *
 * Tests:
 *   1. hcsynth --server --udp-port <port> advertises _osc._udp via mDNS.
 *   2. hcsynth --server --no-zeroconf does NOT advertise.
 *   3. hcsynth --server --zeroconf-name <name> uses custom service name.
 *
 * Requires:
 *   - bonjour-service npm package
 *   - A working multicast DNS environment (macOS: built-in, Linux: avahi-daemon)
 *   - WASM scsynth build at build/wasm/server/hcsynth/hcsynth.js
 *
 * Skips gracefully if bonjour-service is not installed or if WASM build is missing.
 */

'use strict';

const dgram = require('node:dgram');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCSYNTH_CLI = path.join(PROJECT_ROOT, 'cli', 'hcsynth.js');
const SCSYNTH_JS = path.join(PROJECT_ROOT, 'build', 'wasm', 'server', 'hcsynth', 'hcsynth.js');
const TEST_UDP_PORT = 57129;
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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Try to require bonjour-service; skip if not available
let Bonjour;
try {
  Bonjour = require('bonjour-service');
} catch (_) {
  console.log('SKIP: bonjour-service not installed');
  process.exit(0);
}

async function waitForService(type, name, timeoutMs) {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const browser = bonjour.find({ type });
    let found = false;

    browser.on('up', (service) => {
      if (service.name === name) {
        found = true;
        browser.stop();
        bonjour.destroy();
        resolve(true);
      }
    });

    browser.on('error', () => {});

    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(found);
    }, timeoutMs);
  });
}

async function runTest() {
  console.log('=== test_hcsynth_mdns ===\n');

  if (!fs.existsSync(SCSYNTH_JS)) {
    console.log(`SKIP: WASM build not found at ${SCSYNTH_JS}`);
    console.log('Run `just build` to build scsynth and re-run this test.\n');
    process.exit(0);
  }

  let proc = null;

  try {
    // -----------------------------------------------------------------------
    // Test 1: server advertises _osc._udp by default
    // -----------------------------------------------------------------------
    console.log('Test 1: hcsynth advertises _osc._udp service by default');

    proc = spawn(process.execPath, [
      SCSYNTH_CLI,
      '--server',
      '--udp-port', String(TEST_UDP_PORT),
      '--bind-address', '0.0.0.0',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for server to start and advertise
    await wait(2000);

    const found = await waitForService('osc', 'SuperCollider', 5000);
    assert(found, 'Found _osc._udp "SuperCollider" service via mDNS');

    // Clean up
    proc.kill('SIGTERM');
    await wait(500);
    proc = null;

    // -----------------------------------------------------------------------
    // Test 2: --no-zeroconf suppresses advertisement
    // -----------------------------------------------------------------------
    console.log('\nTest 2: --no-zeroconf suppresses mDNS advertisement');

    proc = spawn(process.execPath, [
      SCSYNTH_CLI,
      '--server',
      '--udp-port', String(TEST_UDP_PORT + 1),
      '--bind-address', '0.0.0.0',
      '--no-zeroconf',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await wait(2000);

    const notFound = !(await waitForService('osc', 'SuperCollider', 3000));
    assert(notFound, 'No _osc._udp service found with --no-zeroconf');

    proc.kill('SIGTERM');
    await wait(500);
    proc = null;

    // -----------------------------------------------------------------------
    // Test 3: custom service name via --zeroconf-name
    // -----------------------------------------------------------------------
    console.log('\nTest 3: --zeroconf-name uses custom service name');

    const customName = 'MyCustomSynth';
    proc = spawn(process.execPath, [
      SCSYNTH_CLI,
      '--server',
      '--udp-port', String(TEST_UDP_PORT + 2),
      '--bind-address', '0.0.0.0',
      '--zeroconf-name', customName,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await wait(2000);

    const customFound = await waitForService('osc', customName, 5000);
    assert(customFound, `Found _osc._udp "${customName}" service via mDNS`);

    // Clean up
    proc.kill('SIGTERM');
    await wait(500);
    proc = null;

    // Give time for services to disappear from mDNS cache
    console.log('\nWaiting for mDNS cache to clear...');
    await wait(3000);

  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    if (proc) proc.kill('SIGTERM');
    failed++;
  } finally {
    if (proc) {
      proc.kill('SIGTERM');
      try { await wait(1000); } catch (_) {}
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error(`Test suite failed: ${err}`);
  process.exit(1);
});
