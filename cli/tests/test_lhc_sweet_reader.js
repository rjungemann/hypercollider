#!/usr/bin/env node
'use strict';

/**
 * test_lhc_sweet_reader.js
 * 
 * Unit tests for the sweet-expression reader (PR-1).
 * Tests cover:
 *   - Curly-infix normalization
 *   - Neoteric call sugar
 *   - Mixed mode (explicit parens + sugar)
 *   - Error cases
 *   - Source map generation
 */

const { normalizeSweetToSexpr, SourceMap } = require('../lhc_sweet_reader');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message, context = {}) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    if (context.expected !== undefined) {
      console.error(`         Expected: ${JSON.stringify(context.expected)}`);
    }
    if (context.actual !== undefined) {
      console.error(`         Actual:   ${JSON.stringify(context.actual)}`);
    }
    testsFailed++;
  } else {
    console.log(`  ✓ PASS: ${message}`);
    testsPassed++;
  }
}

function testSection(name) {
  console.log(`\n${name}`);
  console.log('='.repeat(60));
}

function expectError(fn, expectedMessage) {
  try {
    fn();
    return false; // Should have thrown
  } catch (err) {
    if (expectedMessage && !err.message.includes(expectedMessage)) {
      console.error(`         Expected error containing "${expectedMessage}", got: ${err.message}`);
      return false;
    }
    return true;
  }
}

// ============================================================================
// CURLY-INFIX TESTS (M1)
// ============================================================================

testSection('CURLY-INFIX TESTS (M1)');

{
  const result = normalizeSweetToSexpr('{ a + b }');
  assert(result.source === '(+ a b)', 'Basic curly infix { a + b } -> (+ a b)');
}

{
  const result = normalizeSweetToSexpr('{x + y + z}');
  assert(result.source === '(+ x y z)', 'Chained infix {x + y + z} -> (+ x y z)');
}

{
  const result = normalizeSweetToSexpr('{ a * b }');
  assert(result.source === '(* a b)', 'Multiplication { a * b } -> (* a b)');
}

{
  const result = normalizeSweetToSexpr('{ a - b }');
  assert(result.source === '(- a b)', 'Subtraction { a - b } -> (- a b)');
}

{
  const result = normalizeSweetToSexpr('{ a / b }');
  assert(result.source === '(/ a b)', 'Division { a / b } -> (/ a b)');
}

{
  const result = normalizeSweetToSexpr('{ a = b }');
  assert(result.source === '(= a b)', 'Equality { a = b } -> (= a b)');
}

{
  const result = normalizeSweetToSexpr('{ a < b }');
  assert(result.source === '(< a b)', 'Less-than { a < b } -> (< a b)');
}

{
  const result = normalizeSweetToSexpr('{ a > b }');
  assert(result.source === '(> a b)', 'Greater-than { a > b } -> (> a b)');
}

{
  const result = normalizeSweetToSexpr('{ a <= b }');
  assert(result.source === '(<= a b)', 'Less-or-equal { a <= b } -> (<= a b)');
}

{
  const result = normalizeSweetToSexpr('{ a >= b }');
  assert(result.source === '(>= a b)', 'Greater-or-equal { a >= b } -> (>= a b)');
}

{
  const result = normalizeSweetToSexpr('{ freq = 440 }');
  assert(result.source === '(= freq 440)', 'Assignment-like { freq = 440 } -> (= freq 440)');
}

{
  const result = normalizeSweetToSexpr('{ 1 + 2 }');
  assert(result.source === '(+ 1 2)', 'Numeric infix { 1 + 2 } -> (+ 1 2)');
}

// Mixed operators should error in M1
{
  const didError = expectError(
    () => normalizeSweetToSexpr('{ a + b * c }'),
    'Mixed operators'
  );
  assert(didError, 'Mixed operators { a + b * c } should error');
}

// ============================================================================
// NEOTERIC CALL SUGAR TESTS (M1)
// ============================================================================

testSection('NEOTERIC CALL SUGAR TESTS (M1)');

{
  const result = normalizeSweetToSexpr('sin(x)');
  assert(result.source === '(sin x)', 'Function call sin(x) -> (sin x)');
}

{
  const result = normalizeSweetToSexpr('add(1 2)');
  assert(result.source === '(add 1 2)', 'Function with args add(1 2) -> (add 1 2)');
}

{
  const result = normalizeSweetToSexpr('printf("hello")');
  assert(result.source === '(printf "hello")', 'Function with string printf("hello") -> (printf "hello")');
}

{
  const result = normalizeSweetToSexpr('f()');
  assert(result.source === '(f)', 'Empty args f() -> (f)');
}

{
  const result = normalizeSweetToSexpr('f(x y)');
  assert(result.source === '(f x y)', 'Multiple args f(x y) -> (f x y)');
}

// Bracket variants
{
  const result = normalizeSweetToSexpr('foo[x]');
  assert(result.source === '(foo x)', 'Bracket variant foo[x] -> (foo x)');
}

{
  const result = normalizeSweetToSexpr('bar{a b}');
  assert(result.source === '(bar a b)', 'Brace variant bar{a b} -> (bar a b)');
}

// Nested neoteric
{
  const result = normalizeSweetToSexpr('f(g(x))');
  assert(result.source === '(f (g x))', 'Nested neoteric f(g(x)) -> (f (g x))');
}

{
  const result = normalizeSweetToSexpr('f(x g(y))');
  assert(result.source === '(f x (g y))', 'Nested neoteric in args f(x g(y)) -> (f x (g y))');
}

// With space should NOT be neoteric - it's already a valid s-expression
{
  const result = normalizeSweetToSexpr('printf ("hello")');
  assert(result.source === 'printf ("hello")', 'With space printf ("hello") stays as-is (not neoteric)');
}

// ============================================================================
// MIXED MODE TESTS
// ============================================================================

testSection('MIXED MODE TESTS (Explicit parens + sugar)');

{
  const result = normalizeSweetToSexpr('(+ 1 (add 2 3))');
  assert(result.source === '(+ 1 (add 2 3))', 'Mixed explicit parens (+ 1 (add 2 3))');
}

{
  const result = normalizeSweetToSexpr('(+ 1 add(2 3))');
  assert(result.source === '(+ 1 (add 2 3))', 'Mixed neoteric (+ 1 add(2 3)) -> (+ 1 (add 2 3))');
}

{
  const result = normalizeSweetToSexpr('(+ {1 + 2} 3)');
  assert(result.source === '(+ (+ 1 2) 3)', 'Mixed curly infix (+ {1 + 2} 3) -> (+ (+ 1 2) 3)');
}

{
  const result = normalizeSweetToSexpr('{ a + sin(x) }');
  assert(result.source === '(+ a (sin x))', 'Curly with neoteric { a + sin(x) } -> (+ a (sin x))');
}

// ============================================================================
// PASSTHROUGH TESTS (Regular s-expressions)
// ============================================================================

testSection('PASSTHROUGH TESTS (Regular s-expressions)');

{
  const result = normalizeSweetToSexpr('(+ 1 2)');
  assert(result.source === '(+ 1 2)', 'Regular s-expression (+ 1 2) passes through');
}

{
  const result = normalizeSweetToSexpr('(defn add (x y) (+ x y))');
  assert(
    result.source === '(defn add (x y) (+ x y))',
    'Complex s-expression passes through'
  );
}

{
  const result = normalizeSweetToSexpr('42');
  assert(result.source === '42', 'Bare number 42 passes through');
}

{
  const result = normalizeSweetToSexpr('"hello"');
  assert(result.source === '"hello"', 'Bare string "hello" passes through');
}

{
  const result = normalizeSweetToSexpr('; comment\n(+ 1 2)');
  assert(result.source === '(+ 1 2)', 'Comments are stripped, expression passes through');
}

// ============================================================================
// KEYWORDS AND SPECIAL FORMS
// ============================================================================

testSection('KEYWORDS AND SPECIAL FORMS');

{
  const result = normalizeSweetToSexpr(':freq');
  assert(result.source === ':freq', 'Keyword :freq passes through');
}

{
  const result = normalizeSweetToSexpr('(Synth:new \\kick [\\freq 440])');
  assert(
    result.source === '(Synth:new \\kick [\\freq 440])',
    'SuperCollider-style keywords pass through'
  );
}

{
  const result = normalizeSweetToSexpr("'x");
  assert(result.source === "'x", "Quote 'x passes through");
}

{
  const result = normalizeSweetToSexpr('`(1 2 3)');
  assert(result.source === '`(1 2 3)', 'Quasiquote `(1 2 3) passes through');
}

{
  const result = normalizeSweetToSexpr('~(1 2 3)');
  assert(result.source === '~(1 2 3)', 'Unquote ~(1 2 3) passes through');
}

{
  const result = normalizeSweetToSexpr('~@(1 2 3)');
  assert(result.source === '~@(1 2 3)', 'Unquote splicing ~@(1 2 3) passes through');
}

// ============================================================================
// VECTORS (Square brackets)
// ============================================================================

testSection('VECTOR TESTS');

{
  const result = normalizeSweetToSexpr('[1 2 3]');
  assert(result.source === '[1 2 3]', 'Vector [1 2 3] passes through');
}

{
  const result = normalizeSweetToSexpr('[a b c]');
  assert(result.source === '[a b c]', 'Symbol vector [a b c] passes through');
}

{
  const result = normalizeSweetToSexpr('[[1 2] [3 4]]');
  assert(result.source === '[[1 2] [3 4]]', 'Nested vector [[1 2] [3 4]] passes through');
}

// ============================================================================
// ERROR TESTS
// ============================================================================

testSection('ERROR TESTS');

{
  const didError = expectError(
    () => normalizeSweetToSexpr('{ a + b * c }'),
    'Mixed operators'
  );
  assert(didError, 'Mixed operators in curly form should error');
}

{
  const didError = expectError(
    () => normalizeSweetToSexpr('{ a + b'),
    'Unclosed'
  );
  assert(didError, 'Unclosed curly brace should error');
}

{
  const didError = expectError(
    () => normalizeSweetToSexpr('sin(x'),
    'Unclosed'
  );
  assert(didError, 'Unclosed paren in neoteric should error');
}

{
  const didError = expectError(
    () => normalizeSweetToSexpr('sin x)'),
    'Unmatched'
  );
  assert(didError, 'Unmatched closing paren should error');
}

{
  const didError = expectError(
    () => normalizeSweetToSexpr('"unterminated'),
    'Unterminated'
  );
  assert(didError, 'Unterminated string should error');
}

// ============================================================================
// SOURCE MAP TESTS
// ============================================================================

testSection('SOURCE MAP TESTS');

{
  const result = normalizeSweetToSexpr('{ a + b }');
  assert(result.map instanceof SourceMap, 'Source map is returned');
  assert(result.map.mappings.length > 0, 'Source map has mappings');
}

{
  const result = normalizeSweetToSexpr('sin(x)');
  const original = result.map.getOriginalPosition(1, 2);
  assert(original.line === 1, 'Source map maps generated position back to original line');
}

// ============================================================================
// EDGE CASES
// ============================================================================

testSection('EDGE CASES');

{
  const result = normalizeSweetToSexpr('');
  assert(result.source === '', 'Empty input returns empty string');
}

{
  const result = normalizeSweetToSexpr('   ');
  assert(result.source === '', 'Whitespace-only input returns empty string');
}

{
  const result = normalizeSweetToSexpr('; just a comment');
  assert(result.source === '', 'Comment-only input returns empty string');
}

{
  const result = normalizeSweetToSexpr('a');
  assert(result.source === 'a', 'Single symbol a passes through');
}

{
  const result = normalizeSweetToSexpr('a b');
  assert(result.source === 'a b', 'Multiple bare symbols a b pass through');
}

{
  const result = normalizeSweetToSexpr('\n\n');
  assert(result.source === '', 'Multiple newlines produce empty output');
}

// ============================================================================
// FITURE-SPECIFIC TESTS (scscm examples)
// ============================================================================

testSection('SCSCM-SPECIFIC EXAMPLES');

{
  // SuperCollider example with neoteric sugar
  const result = normalizeSweetToSexpr('Synth:new(\kick)');
  assert(result.source === '(Synth:new kick)', 'Synth:new(\kick) -> (Synth:new kick)');
}

{
  // Curly infix with SuperCollider
  const result = normalizeSweetToSexpr('{ freq + 100 }');
  assert(result.source === '(+ freq 100)', '{ freq + 100 } -> (+ freq 100)');
}

{
  // Mixed scscm with sugar
  const result = normalizeSweetToSexpr('(defn play (freq) sin(freq))');
  assert(result.source === '(defn play (freq) (sin freq))', 'Mixed scscm with neoteric sugar');
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n${'='.repeat(60)}`);
console.log('TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Total:  ${testsPassed + testsFailed}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  process.exit(1);
}

// ============================================================================
// M2 INDENTATION TESTS
// ============================================================================

testSection('INDENTATION-BASED GROUPING TESTS (M2)');

{
  const result = normalizeSweetToSexpr('play\n  Synth:new \\kick', { phase: 'm2' });
  assert(result.source === '(play (Synth:new \\kick))', 'Single indented line: play\\n  Synth:new \\kick');
}

{
  const result = normalizeSweetToSexpr('defn add\n  x y', { phase: 'm2' });
  assert(result.source === '(defn add (x y))', 'Function with params: defn add\\n  x y');
}

{
  const result = normalizeSweetToSexpr('defn add\n  x y\n  + x y', { phase: 'm2' });
  assert(result.source === '(defn add (x y) (+ x y))', 'Function with body: defn add\\n  x y\\n  + x y');
}

{
  const result = normalizeSweetToSexpr('let\n  x 10\n  y 20', { phase: 'm2' });
  assert(result.source === '(let (x 10) (y 20))', 'Let binding with multiple bindings');
}

{
  // Test that M1 still works with phase m2
  const result = normalizeSweetToSexpr('{ 1 + 2 }', { phase: 'm2' });
  assert(result.source === '(+ 1 2)', 'Curly infix still works in M2 phase');
}

{
  const result = normalizeSweetToSexpr('sin(x)', { phase: 'm2' });
  assert(result.source === '(sin x)', 'Neoteric still works in M2 phase');
}

{
  // Mixed M1 and M2
  const result = normalizeSweetToSexpr('defn add\n  { x + y }', { phase: 'm2' });
  assert(result.source === '(defn add ((+ x y)))', 'Mixed indentation and curly infix');
}
