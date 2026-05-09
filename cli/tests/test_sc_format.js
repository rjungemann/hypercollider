#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs   = require('node:fs');
const { format, Lexer, TT } = require('../sc_formatter');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
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

function fmt(src) {
  return format(src);
}

function assertIdempotent(src, label) {
  let once, twice;
  try {
    once  = fmt(src);
    twice = fmt(once);
  } catch (e) {
    assert(false, `${label}: threw ${e.message}`);
    return;
  }
  assert(once === twice, `${label}: format(format(x)) == format(x)`);
}

// ============================================================================
// LEXER TESTS
// ============================================================================

testSection('LEXER TESTS');

{
  const { Lexer } = require('../sc_formatter');
  const lexer = new Lexer('MyClass : Object {\n\tvar <>x;\n}');
  const tokens = lexer.tokenize().filter(t => t.type !== TT.WHITESPACE && t.type !== TT.NEWLINE && t.type !== TT.EOF);
  assert(tokens[0].type === TT.IDENT  && tokens[0].value === 'MyClass', 'Lex class name');
  assert(tokens[1].type === TT.COLON,                                    'Lex colon');
  assert(tokens[2].type === TT.IDENT  && tokens[2].value === 'Object',  'Lex superclass name');
  assert(tokens[3].type === TT.LBRACE,                                   'Lex lbrace');
}

{
  const lexer = new Lexer('// comment line\nfoo');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === TT.COMMENT_LINE, 'Lex line comment');
  assert(tokens[0].value === '// comment line', 'Line comment value');
}

{
  const lexer = new Lexer('/* block */');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === TT.COMMENT_BLOCK, 'Lex block comment');
}

{
  const lexer = new Lexer('"hello\\nworld"');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === TT.STRING, 'Lex string with escape');
  assert(tokens[0].value === '"hello\\nworld"', 'String value preserved');
}

{
  const lexer = new Lexer('\\sine');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === TT.SYMBOL, 'Lex symbol');
  assert(tokens[0].value === '\\sine', 'Symbol value');
}

{
  const lexer = new Lexer('3.14 440 0xFF');
  const tokens = lexer.tokenize().filter(t => t.type !== TT.WHITESPACE && t.type !== TT.EOF);
  assert(tokens[0].type === TT.NUMBER && tokens[0].value === '3.14', 'Lex float');
  assert(tokens[1].type === TT.NUMBER && tokens[1].value === '440',  'Lex integer');
  assert(tokens[2].type === TT.NUMBER && tokens[2].value === '0xFF', 'Lex hex');
}

{
  // Note: `|` is PIPE (not OP) in this lexer — `||` becomes two PIPE tokens
  const lexer = new Lexer('== != <= >= << >> ++ <> && ** -> ?? <-');
  const tokens = lexer.tokenize().filter(t => t.type !== TT.WHITESPACE && t.type !== TT.EOF);
  assert(tokens.every(t => t.type === TT.OP), 'Lex two-char operators (excl. ||)');
  assert(tokens[0].value === '==', 'Lex ==');
  assert(tokens[2].value === '<=', 'Lex <=');
}

{
  const lexer = new Lexer('...');
  const tokens = lexer.tokenize().filter(t => t.type !== TT.EOF);
  assert(tokens[0].type === TT.OP && tokens[0].value === '...', 'Lex ellipsis');
}

{
  const lexer = new Lexer('$A $\\n');
  const tokens = lexer.tokenize().filter(t => t.type !== TT.WHITESPACE && t.type !== TT.EOF);
  assert(tokens[0].type === TT.CHAR && tokens[0].value === '$A',   'Lex char $A');
  assert(tokens[1].type === TT.CHAR && tokens[1].value === '$\\n', 'Lex char $\\n');
}

// ============================================================================
// ROUND-TRIP (IDEMPOTENCY) TESTS
// ============================================================================

testSection('ROUND-TRIP TESTS');

assertIdempotent('', 'Empty source');
assertIdempotent('\n\n\n', 'Blank lines only');
assertIdempotent('MyClass : Object {\n\tvar <>x;\n\n\tinit { ^this }\n}\n', 'Simple class');
assertIdempotent('Foo {\n\tgo { arg n = 4;\n\t\t^n\n\t}\n}\n', 'Method with arg default');
assertIdempotent('[1, 2, 3].do { |i| i.postln };\n', 'Block one-liner');
assertIdempotent(
  'Foo {\n\trun {\n\t\tif(cond, {\n\t\t\t^a\n\t\t}, {\n\t\t\t^b\n\t\t});\n\t}\n}\n',
  'Nested blocks'
);
assertIdempotent(
  '// top-level comment\nFoo {\n\t// method comment\n\tbar { ^1 }  // inline\n}\n',
  'Comments preserved'
);
assertIdempotent('x = "hello  world\\n";\n', 'String contents unchanged');
assertIdempotent('/* block\n   comment */\nFoo {\n}\n', 'Block comment');
assertIdempotent(
  'SynthDef(\\sine, {\n\t|freq = 440, amp = 0.1|\n\tOut.ar(0, SinOsc.ar(freq) * amp);\n}).add;\n',
  'SynthDef'
);
assertIdempotent('Foo {\n\tvar <x, >y, <>z;\n\tclassvar <count;\n}\n', 'Var accessors');
assertIdempotent('Foo {\n\t*new { ^super.new.init }\n}\n', 'Class method');
assertIdempotent('x = [1, 2, 3];\n', 'Array literal');
assertIdempotent('x = arr[0];\n', 'Array subscript');
assertIdempotent('x = a + b * c - d / 2;\n', 'Binary ops');
assertIdempotent('Foo {\n\tbar { ^(x + y) }\n}\n', 'Return with paren');
assertIdempotent('A : Object {\n\tvar <>x;\n}\n\nB : A {\n\tvar <>y;\n}\n', 'Multi-class');

// ============================================================================
// STYLE RULE SPOT-CHECKS
// ============================================================================

testSection('STYLE RULE TESTS');

{
  const result = fmt('Bag:Collection {\n}\n');
  assert(result.includes('Bag : Collection'), 'Class inheritance colon gets spaces');
}

{
  const result = fmt('Foo {\n\t* new { ^super.new }\n}\n');
  assert(result.includes('*new'), 'Class method * has no space before name');
  assert(!result.includes('* new'), 'Class method * has no space before name (neg)');
}

{
  const result = fmt('Foo {\n\tgo { arg n=4; ^n }\n}\n');
  assert(result.includes('n = 4'), 'Default arg gets spaces around =');
}

{
  const result = fmt('Foo {\n\tvar < x, > y, <> z;\n}\n');
  assert(result.includes('<x'),  'Var accessor < no space');
  assert(result.includes('>y'),  'Var accessor > no space');
  assert(result.includes('<>z'), 'Var accessor <> no space');
}

{
  const result = fmt('Foo {\n\tclassvar < count;\n}\n');
  assert(result.includes('<count'), 'classvar accessor < no space');
}

{
  const result = fmt('Foo {\n\tbar {^1}\n}\n');
  assert(result.includes('{ ^1 }'), 'One-liner block gets interior spaces');
}

{
  const result = fmt('x = obj .size;\n');
  assert(result.includes('obj.size'), 'No space before dot');
}

{
  const result = fmt('f(a,b,c);\n');
  assert(result.includes('a, b, c'), 'Space after comma');
}

{
  const result = fmt('SynthDef(\\s, {freq:440});\n');
  assert(result.includes('freq: 440'), 'Space after colon (keyword message)');
}

{
  const result = fmt('Foo {\n\tgo { f(key : val) }\n}\n');
  assert(!result.includes('key : val'), 'No space before colon in keyword message');
  assert(result.includes('key: val'),   'Space after colon in keyword message');
}

{
  const result = fmt('x = { | a, b | a + b };\n');
  assert(result.includes('|a, b|'), 'Pipe args: no interior spaces after | / before |');
}

{
  const result = fmt('x = arr [0];\n');
  assert(result.includes('arr[0]'),  'No space before [ for array subscript');
  assert(!result.includes('arr [0]'), 'No space before [ for array subscript (neg)');
}

{
  const result = fmt('Foo {\n\tbar { ^ (x + y) }\n}\n');
  assert(result.includes('^(x + y)'),  'No space between ^ and (');
  assert(!result.includes('^ ('),      'No space between ^ and ( (neg)');
}

{
  const result = fmt('if(c, {a},{b});\n');
  assert(result.includes('}, {'), 'Space between }, {');
}

{
  const result = fmt('if ( c, { ^a });\n');
  assert(result.includes('if(c,'), 'No space before ( for if');
}

{
  const result = fmt('x = 1;   \n');
  const lines = result.split('\n');
  assert(lines.every(l => l === l.trimEnd()), 'Trailing whitespace stripped');
}

{
  const result = fmt('x = 1;');
  assert(result.endsWith('\n'), 'Final newline always present');
}

{
  const result = fmt('a = 1;\n\n\n\n\nb = 2;\n');
  assert(!result.includes('\n\n\n\n'), 'Max 2 consecutive blank lines at top level');
}

// ============================================================================
// FILE ROUND-TRIP: SCClassLibrary/Common/Collections
// ============================================================================

testSection('FILE ROUND-TRIP TESTS');

{
  const collectionsDir = path.join(__dirname, '..', '..', '..', 'SCClassLibrary', 'Common', 'Collections');
  if (!fs.existsSync(collectionsDir)) {
    console.log('  (skipping file round-trip: SCClassLibrary not found at expected path)');
  } else {
    let checked = 0;
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name));
        } else if (entry.name.endsWith('.sc')) {
          const filePath = path.join(dir, entry.name);
          const src = fs.readFileSync(filePath, 'utf-8');
          assertIdempotent(src, `SCClassLibrary/.../Collections/${entry.name}`);
          checked++;
        }
      }
    }
    walk(collectionsDir);
    assert(checked > 0, `Found ${checked} .sc files to round-trip`);
  }
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(60));

if (testsFailed > 0) process.exit(1);
