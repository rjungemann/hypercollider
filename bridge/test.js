#!/usr/bin/env node
/**
 * Test script for OSC Bridge Server - Phase 8.1
 * Tests OSC encoding/decoding and basic server functionality
 */

import { encodeOSC, decodeOSC, encodeOSCBundle, decodeOSCBundle } from './osc_codec.js';

// Test OSC message encoding/decoding
function testOSCMessage() {
  console.log('Testing OSC message encoding/decoding...');
  
  // Test 1: Simple message with int and float
  const msg1 = encodeOSC('/test', 'if', [42, 3.14]);
  const decoded1 = decodeOSC(msg1);
  console.assert(decoded1.address === '/test', 'Address mismatch');
  console.assert(decoded1.typetags === 'if', 'Typetags mismatch');
  console.assert(decoded1.args[0] === 42, 'Int argument mismatch');
  console.assert(Math.abs(decoded1.args[1] - 3.14) < 0.001, 'Float argument mismatch');
  console.log('✓ Test 1 passed: /test with int and float');
  
  // Test 2: Synth new message (common SC OSC pattern)
  // SuperCollider /s_new: synthdef-name, node-id, add-action, target
  const msg2 = encodeOSC('/s_new', 'siii', ['sine', 1000, 1, 0]);
  const decoded2 = decodeOSC(msg2);
  console.assert(decoded2.address === '/s_new', 's_new address mismatch');
  console.assert(decoded2.typetags === 'siii', 's_new typetags mismatch');
  console.assert(decoded2.args[0] === 'sine', 'SynthDef name mismatch');
  console.assert(decoded2.args[1] === 1000, 'Node ID mismatch');
  console.log('✓ Test 2 passed: /s_new message');
  
  // Test 3: String and symbol
  const msg3 = encodeOSC('/hello', 'ss', ['world', 'test']);
  const decoded3 = decodeOSC(msg3);
  console.assert(decoded3.args[0] === 'world', 'String argument mismatch');
  console.assert(decoded3.args[1] === 'test', 'Symbol argument mismatch');
  console.log('✓ Test 3 passed: String and symbol');
  
  // Test 4: Synth set message (node-id, control-name, value)
  const msg4 = encodeOSC('/n_set', 'isf', [1000, 'freq', 440.0]);
  const decoded4 = decodeOSC(msg4);
  console.assert(decoded4.address === '/n_set', 'n_set address mismatch');
  console.assert(decoded4.args[0] === 1000, 'Node ID mismatch');
  console.assert(decoded4.args[1] === 'freq', 'Control name mismatch');
  console.log('✓ Test 4 passed: /n_set message');
  
  // Test 5: Node free message
  const msg5 = encodeOSC('/n_free', 'i', [1000]);
  const decoded5 = decodeOSC(msg5);
  console.assert(decoded5.address === '/n_free', 'n_free address mismatch');
  console.assert(decoded5.args[0] === 1000, 'Node ID mismatch');
  console.log('✓ Test 5 passed: /n_free message');
  
  // Test 6: SynthDef receive (binary blob - simplified test)
  const msg6 = encodeOSC('/d_recv', 's', ['sine']);
  const decoded6 = decodeOSC(msg6);
  console.assert(decoded6.address === '/d_recv', 'd_recv address mismatch');
  console.assert(decoded6.args[0] === 'sine', 'SynthDef name mismatch');
  console.log('✓ Test 6 passed: /d_recv message');
  
  console.log('\n✅ All OSC message tests passed!');
}

// Test OSC bundle encoding/decoding
function testOSCBundle() {
  console.log('\nTesting OSC bundle encoding/decoding...');
  
  const messages = [
    { address: '/s_new', typetags: 'sii', args: ['sine', 1000, 1] },
    { address: '/n_set', typetags: 'isf', args: [1000, 'freq', 440] },
  ];
  
  const bundle = encodeOSCBundle(0, messages);
  const decoded = decodeOSCBundle(bundle);
  
  console.assert(decoded.messages.length === 2, 'Bundle message count mismatch');
  console.assert(decoded.messages[0].address === '/s_new', 'First message address mismatch');
  console.assert(decoded.messages[1].address === '/n_set', 'Second message address mismatch');
  console.log('✓ Bundle encoding/decoding test passed');
  
  console.log('\n✅ All OSC bundle tests passed!');
}

// Test padding
function testPadding() {
  console.log('\nTesting padding...');
  
  // Address "/a" should be padded: /a\0\0 (4 bytes) + ,i\0\0 (4 bytes) + int 1 (4 bytes) = 12 bytes
  const msg = encodeOSC('/a', 'i', [1]);
  console.assert(msg.length === 12, `Expected 12 bytes, got ${msg.length}`);
  console.log('✓ Padding test passed');
  
  console.log('\n✅ All padding tests passed!');
}

// Run all tests
function runTests() {
  console.log('========================================');
  console.log('  SC WASM OSC Bridge - Phase 8.1 Tests');
  console.log('========================================\n');
  
  testOSCMessage();
  testOSCBundle();
  testPadding();
  
  console.log('\n========================================');
  console.log('  ✅ All tests passed!');
  console.log('========================================\n');
}

runTests();
