#!/usr/bin/env node
'use strict';

const { Lexer } = require('../lhc_lexer');
const { Parser } = require('../lhc_parser');
const { CodeGenerator } = require('../lhc_codegen');

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

function compile(schecmeCode) {
  const lexer = new Lexer(schecmeCode);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const codegen = new CodeGenerator();
  return codegen.generate(ast);
}

// ============================================================================
// LEXER TESTS
// ============================================================================

testSection('LEXER TESTS');

{
  const lexer = new Lexer('(+ 1 2)');
  const tokens = lexer.tokenize();
  assert(tokens.length === 6, 'Tokenize simple expression (LPAREN, SYMBOL, NUMBER, NUMBER, RPAREN, EOF)');
  assert(tokens[0].type === 'LPAREN', 'First token is LPAREN');
  assert(tokens[1].type === 'SYMBOL' && tokens[1].value === '+', 'Second token is + symbol');
  assert(tokens[2].type === 'NUMBER' && tokens[2].value === 1, 'Third token is number 1');
  assert(tokens[5].type === 'EOF', 'Last token is EOF');
}

{
  const lexer = new Lexer('(defn add (x y) (+ x y))');
  const tokens = lexer.tokenize().filter((t) => t.type !== 'EOF');
  assert(tokens.length === 13, 'Tokenize function definition');
  assert(tokens[1].value === 'defn', 'Token sequence includes defn');
}

{
  const lexer = new Lexer('"hello world"');
  const tokens = lexer.tokenize();
  assert(
    tokens[0].type === 'STRING' && tokens[0].value === 'hello world',
    'String tokenization works'
  );
}

{
  const lexer = new Lexer('; this is a comment\n(+ 1 2)');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === 'LPAREN', 'Comments are skipped');
}

{
  const lexer = new Lexer(':freq :amp :doneAction');
  const tokens = lexer.tokenize().filter((t) => t.type !== 'EOF');
  assert(tokens.length === 6, 'Keyword tokenization (COLON + SYMBOL per keyword, 3 keywords = 6 tokens)');
  assert(tokens[0].type === 'COLON', 'Keywords tokenize as COLON + SYMBOL');
}

// ============================================================================
// PARSER TESTS
// ============================================================================

testSection('PARSER TESTS');

{
  const lexer = new Lexer('42');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  assert(ast.length === 1, 'Parse single number');
  assert(ast[0].type === 'number' && ast[0].value === 42, 'Number parses to NumberLiteral');
}

{
  const lexer = new Lexer('"hello"');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  assert(ast[0].type === 'string' && ast[0].value === 'hello', 'String parses correctly');
}

{
  const lexer = new Lexer('foo-bar');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  assert(ast[0].type === 'symbol' && ast[0].name === 'foo-bar', 'Symbol parses correctly');
}

{
  const lexer = new Lexer('(+ 1 2)');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  assert(ast[0].type === 'list', 'List parses to list type');
  assert(ast[0].elements.length === 3, 'List has 3 elements');
}

{
  const lexer = new Lexer('((+ 1 2) (+ 3 4))');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  assert(ast[0].type === 'list' && ast[0].elements[0].type === 'list', 'Nested lists parse');
}

{
  const lexer = new Lexer('[1 2 3]');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  assert(ast[0].type === 'vector', 'Vector parses to vector type');
  assert(ast[0].elements.length === 3, 'Vector has 3 elements');
}

// ============================================================================
// CODE GENERATION TESTS
// ============================================================================

testSection('CODE GENERATION TESTS');

{
  const sc = compile('(+ 1 2)');
  assert(sc.includes('1 + 2'), 'Binary operator + compiles');
}

{
  const sc = compile('(* 3.14 2)');
  assert(sc.includes('3.14 * 2'), 'Multiplication operator');
}

{
  const sc = compile('(fn (x) (+ x 1))');
  assert(sc.includes('{ |x|') && sc.includes('x + 1'), 'Lambda compiles to block');
}

{
  const sc = compile('(var x 10)');
  assert(sc.includes('var x = 10'), 'Variable declaration');
}

{
  const sc = compile('(var x 10 y 20)');
  assert(sc.includes('var x = 10, y = 20'), 'Multiple variable declarations');
}

{
  const sc = compile('(set! x 20)');
  assert(sc.includes('x = 20'), 'Assignment compiles');
}

{
  const sc = compile('(if (> x 5) x 0)');
  assert(sc.includes('if (x > 5)'), 'If condition compiles');
  assert(sc.includes('x') && sc.includes('0'), 'If branches compile');
}

{
  const sc = compile('(let ((x 10)) (+ x 5))');
  assert(sc.includes('{ |x| x + 5 }.value(10)'), 'Let binding compiles');
}

{
  const sc = compile('(. obj method)');
  assert(sc.includes('obj.method'), 'Method call without args');
}

{
  const sc = compile('(. obj method 1 2)');
  assert(sc.includes('obj.method(1, 2)'), 'Method call with args');
}

{
  const sc = compile('(list 1 2 3)');
  assert(sc.includes('[1, 2, 3]'), 'List literal compiles');
}

{
  const sc = compile('(dict :freq 440 :amp 0.1)');
  assert(sc.includes('(freq: 440, amp: 0.1)'), 'Dictionary literal compiles');
}

{
  const sc = compile('(Synth.new (dict :freq 440))');
  assert(
    sc.includes('Synth.new((freq: 440))'),
    'Constructor call with keyword args'
  );
}

{
  const sc = compile('(SinOsc.ar 440 0)');
  assert(sc.includes('SinOsc.ar(440, 0)'), 'Class method call');
}

{
  const sc = compile('foo-bar-baz');
  assert(sc.includes('foo_bar_baz'), 'Hyphens convert to underscores');
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

testSection('INTEGRATION TESTS');

{
  const schema = `
    (defn square (x)
      (* x x))

    (var result (square 5))
  `;
  const sc = compile(schema);
  assert(sc.includes('square = { |x| x * x }'), 'Function definition');
  assert(sc.includes('var result = square(5)'), 'Function call in variable');
}

{
  const schema = `
    (SynthDef "sine"
      (fn (freq)
        (Out.ar 0 (SinOsc.ar freq 0))))
  `;
  const sc = compile(schema);
  assert(sc.includes('SynthDef("sine"'), 'SynthDef compilation');
  assert(sc.includes('Out.ar'), 'Audio output UGen');
}

{
  const schema = `
    (cond
      ((< x 0) "negative")
      ((== x 0) "zero")
      (else "positive"))
  `;
  const sc = compile(schema);
  assert(sc.includes('cond('), 'Cond compiles');
}

{
  const schema = `
    (let ((freq 440)
          (amp 0.1))
      (Synth.new (dict :freq freq :amp amp)))
  `;
  const sc = compile(schema);
  assert(sc.includes('{ |freq, amp|'), 'Multiple let bindings');
  assert(sc.includes('Synth.new((freq: freq, amp: amp))'), 'Let with keyword args');
}

// ============================================================================
// THREADING MACRO TESTS  (-> and ->> are now implemented via defmacro)
// ============================================================================

testSection('THREADING MACRO TESTS');

// -> (thread-first) — implemented as a stdlib defmacro
{
  const sc = compile('(-> x)');
  assert(sc.includes('x'), '-> with no steps returns value');
}

{
  const sc = compile('(-> 440 (. midicps))');
  assert(sc.includes('440.midicps'), '-> threads into method call (no args)');
}

{
  const sc = compile('(-> 440 (. mul 0.5))');
  assert(sc.includes('440.mul(0.5)'), '-> threads into method call with args');
}

{
  const sc = compile('(-> 440 (. midicps) (. mul 0.5))');
  assert(sc.includes('440.midicps'), '-> multi-step: first step');
  assert(sc.includes('.mul(0.5)'), '-> multi-step: second step');
}

{
  const sc = compile('(-> freq midicps)');
  assert(sc.includes('freq.midicps'), '-> symbol step becomes method access');
}

{
  const sc = compile('(-> x (f a b))');
  assert(sc.includes('f(x, a, b)'), '-> threads as first arg of function call');
}

// ->> (thread-last) — implemented as a stdlib defmacro
{
  const sc = compile('(->> x)');
  assert(sc.includes('x'), '->> with no steps returns value');
}

{
  const sc = compile('(->> x (f a b))');
  assert(sc.includes('f(a, b, x)'), '->> threads as last arg of function call');
}

{
  const sc = compile('(->> x (f a) (g b c))');
  assert(sc.includes('f(a, x)'), '->> multi-step: first step');
  assert(sc.includes('g(b, c,'), '->> multi-step: second step');
}

{
  const sc = compile('(->> 440 midicps)');
  assert(sc.includes('midicps(440)'), '->> symbol step becomes function call');
}

// ============================================================================
// DEFMACRO TESTS
// ============================================================================

testSection('DEFMACRO TESTS');

{
  // Simple constant-returning macro
  const sc = compile('(defmacro answer () 42)\n(answer)');
  assert(sc.includes('42'), 'defmacro with no params expands body');
}

{
  // Macro that wraps its argument in a method call
  const sc = compile('(defmacro postit (x) `(. ~x postln))\n(postit freq)');
  assert(sc.includes('freq.postln'), 'defmacro quasiquote expansion');
}

{
  // Macro using rest params (dot notation)
  const sc = compile('(defmacro my-list (x . rest) `(list ~x ~@rest))\n(my-list 1 2 3)');
  assert(sc.includes('[1, 2, 3]'), 'defmacro rest-params with unquote-splicing');
}

{
  // defmacro forms are NOT emitted as sclang code
  const sc = compile('(defmacro noop (x) x)\n(+ 1 2)');
  assert(!sc.includes('defmacro'), 'defmacro is not emitted as sclang');
  assert(sc.includes('1 + 2'), 'code after defmacro still compiles');
}

{
  // Custom when macro (common Lisp idiom)
  const sc = compile('(defmacro when (c body) `(if ~c ~body nil))\n(when (> x 0) (. x postln))');
  assert(sc.includes('if (x > 0)'), 'custom when macro expands to if');
}

{
  // Macro expansion is recursive: macro can call another macro
  const sc = compile('(defmacro inc (x) `(+ ~x 1))\n(defmacro inc2 (x) `(inc (inc ~x)))\n(inc2 y)');
  assert(sc.includes('y + 1 + 1') || sc.includes('(y + 1) + 1'), 'recursive macro expansion');
}

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

testSection('ERROR HANDLING TESTS');

{
  try {
    compile('(unclosed-paren');
    assert(false, 'Catches unclosed parentheses');
  } catch (err) {
    assert(err.message.includes('Unexpected'), 'Error message is helpful');
  }
}

{
  try {
    compile('(fn x (+ x 1))');
    assert(false, 'Catches invalid fn syntax');
  } catch (err) {
    assert(err.message.includes('parameters'), 'Error explains the problem');
  }
}

// ============================================================================
// HASH-FN (#()) SHORTHAND TESTS
// ============================================================================

testSection('HASH-FN (#()) SHORTHAND TESTS');

{
  // % is the first positional arg
  const sc = compile('#(+ % 1)');
  assert(sc.includes('__p1 + 1'), '#(body) compiles with % → __p1');
}

{
  // %1 is an explicit alias for %
  const sc = compile('#(* %1 2)');
  assert(sc.includes('__p1 * 2'), '#() %1 is same as %');
}

{
  // two positional args
  const sc = compile('#(+ %1 %2)');
  assert(sc.includes('__p1') && sc.includes('__p2'), '#() %1 and %2 become two params');
  assert(sc.includes('|__p1, __p2|'), '#() generates correct param list');
}

{
  // method chain shorthand
  const sc = compile('#(. % midicps)');
  assert(sc.includes('__p1.midicps'), '#() used for method chaining');
}

{
  // % used twice in the same body
  const sc = compile('#(* % %)');
  assert(sc.includes('__p1 * __p1'), '#() % used twice produces single param');
  assert(!sc.includes('__p2'), '#() % used twice does not create a second param');
}

{
  // zero-arg shorthand (no % refs) — body becomes an implicit call
  const sc = compile('#(+ 1 2)');
  assert(sc.includes('{ 1 + 2 }'), '#() with no % produces zero-param fn');
}

{
  // rest arg %&
  const sc = compile('#(. %& size)');
  assert(sc.includes('...'), '#() %& produces rest param');
  assert(sc.includes('__rest'), '#() %& body uses __rest');
}

{
  // positional + rest
  const sc = compile('#(list %1 %2 %&)');
  assert(sc.includes('|__p1, __p2, ...__rest|'), '#() mixed positional and rest params');
}

{
  // used as an argument to a higher-order function
  const sc = compile('(. (list 1 2 3) collect #(* % %))');
  assert(sc.includes('[1, 2, 3].collect('), '#() passed to collect');
  assert(sc.includes('__p1 * __p1'), '#() body correct inside HOF');
}

{
  // nested #() — each expands to its own fn scope
  const sc = compile('(. (list 1 2 3) collect #(. (list %) collect #(* % 2)))');
  assert(sc.includes('.collect('), 'nested #() outer collect');
}

// ============================================================================
// FORMATTER ROUND-TRIP TESTS
// ============================================================================

testSection('FORMATTER ROUND-TRIP TESTS');

const { format } = require('../lhc_formatter');

function fmt(src) {
  return format(src);
}

function assertIdempotent(src, label) {
  let once, twice;
  try {
    once = fmt(src);
    twice = fmt(once);
  } catch (e) {
    assert(false, `${label}: threw ${e.message}`);
    return;
  }
  assert(once === twice, `${label}: format(format(x)) == format(x)`);
}

// Basic idempotency
assertIdempotent('(+ 1 2)', 'Simple addition');
assertIdempotent('(var x 5)\n(Post.put x)', 'var + method call');
assertIdempotent('(SinOsc.ar 440 0)', 'UGen call');

// Multi-form program
assertIdempotent(
  '(var freq 440)\n(var amp 0.1)\n(SinOsc.ar freq 0)',
  'Multi-form program'
);

// fn / defn forms
assertIdempotent('(fn (x) (+ x 1))', 'fn single param');
assertIdempotent('(fn (x y) (* x y))', 'fn two params');
assertIdempotent('(defn add (a b) (+ a b))', 'defn');

// Nested expressions
assertIdempotent('(Out.ar 0 (SinOsc.ar 440 0))', 'Nested UGen');
assertIdempotent('(if (> x 0) x (neg x))', 'if expression');

// let binding
assertIdempotent('(let ((x 1) (y 2)) (+ x y))', 'let binding');

// SynthDef pattern
assertIdempotent(
  '(SynthDef "sine"\n  (fn (freq)\n    (Out.ar 0 (SinOsc.ar freq 0))))',
  'SynthDef pattern'
);

// dict literal
assertIdempotent('(Synth "sine" (dict :freq 440 :amp 0.1))', 'Synth with dict');

// Comments survive round-trip
assertIdempotent('; leading comment\n(+ 1 2)', 'Leading comment');
assertIdempotent('(+ 1 2)  ; inline comment', 'Inline comment');

// Empty program
assertIdempotent('', 'Empty source');

// Round-trip all example .scscm files
{
  const fs = require('fs');
  const path = require('path');
  const examplesDir = path.join(__dirname, 'examples');
  if (fs.existsSync(examplesDir)) {
    const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.scscm'));
    for (const fn of files) {
      const src = fs.readFileSync(path.join(examplesDir, fn), 'utf8');
      assertIdempotent(src, `examples/${fn}`);
    }
    assert(files.length > 0, 'Found at least one .scscm example file');
  }
}

// Style spot-checks
{
  const result = fmt('(+   1   2)');
  assert(!result.includes('  '), 'Extra whitespace normalised');
}

{
  // Short expression stays on one line (ignoring the required trailing newline)
  const result = fmt('(+ 1 2)').trimEnd();
  assert(!result.includes('\n'), 'Short expression is one line');
}

// Threading macro round-trips
assertIdempotent('(-> 440 (. midicps) (. mul 0.5))', '-> formatter idempotent');
assertIdempotent('(->> x (f a b) (g c d))', '->> formatter idempotent');

// defmacro round-trips
assertIdempotent('(defmacro postit (x) `(. ~x postln))', 'defmacro formatter idempotent');

// ============================================================================
// PARAM DEFAULT / REST PARAM TESTS (fn fix)
// ============================================================================

testSection('FN DEFAULT AND REST PARAM TESTS');

{
  const sc = compile('(fn (x) (+ x 1))');
  assert(sc.includes('{ |x| x + 1 }'), 'fn single param has |..| syntax');
}

{
  const sc = compile('(fn (x y) (* x y))');
  assert(sc.includes('{ |x, y| x * y }'), 'fn two params has |..| syntax');
}

{
  const sc = compile('(fn (freq 440 amp 0.1) freq)');
  assert(sc.includes('{ |freq=440, amp=0.1| freq }'), 'fn with default values');
}

{
  const sc = compile('(fn (. args) args)');
  assert(sc.includes('{ |...args| args }'), 'fn with rest params');
}

{
  const sc = compile('(fn (x y . rest) x)');
  assert(sc.includes('{ |x, y, ...rest| x }'), 'fn with named params and rest');
}

{
  const sc = compile('(fn () 42)');
  assert(sc.includes('{ 42 }'), 'fn with no params');
}

// ============================================================================
// CONTROL FLOW MACRO TESTS
// ============================================================================

testSection('CONTROL FLOW MACRO TESTS');

{
  const sc = compile('(when (> x 0) (. x postln))');
  assert(sc.includes('if (x > 0)'), 'when expands to if');
  assert(sc.includes('nil'), 'when has nil else branch');
}

{
  const sc = compile('(unless muted (. x play))');
  assert(sc.includes('muted.not'), 'unless negates condition');
}

{
  const sc = compile('(do (var x 1) (var y 2) (+ x y))');
  assert(sc.includes('var x = 1'), 'do sequences statements');
  assert(sc.includes('var y = 2'), 'do second statement');
}

// ============================================================================
// ITERATION MACRO TESTS
// ============================================================================

testSection('ITERATION MACRO TESTS');

{
  const sc = compile('(doseq (n (list 1 2 3)) (. n postln))');
  assert(sc.includes('.do('), 'doseq expands to .do');
  assert(sc.includes('|n|'), 'doseq binds loop variable');
}

{
  const sc = compile('(dotimes (i 4) (. i postln))');
  assert(sc.includes('4.do('), 'dotimes calls .do on count');
  assert(sc.includes('|i|'), 'dotimes binds index variable');
}

{
  const sc = compile('(collect (n (list 1 2 3)) (* n n))');
  assert(sc.includes('.collect('), 'collect expands to .collect');
}

{
  const sc = compile('(accumulate (sum 0 v (list 1 2 3)) (+ sum v))');
  assert(sc.includes('.inject(0,'), 'accumulate expands to .inject');
}

// ============================================================================
// FUNCTION HELPER MACRO TESTS
// ============================================================================

testSection('FUNCTION HELPER MACRO TESTS');

{
  const sc = compile('(comp f g h)');
  assert(sc.includes('f('), 'comp chains function calls');
  assert(sc.includes('g('), 'comp includes middle function');
  assert(sc.includes('h('), 'comp includes last function');
}

{
  const sc = compile('(partial sine-wave :freq 440)');
  assert(sc.includes('valueArray'), 'partial uses valueArray');
  assert(sc.includes('\\freq'), 'partial captures keyword args');
}

// ============================================================================
// SC SHORTHAND MACRO TESTS
// ============================================================================

testSection('SC SHORTHAND MACRO TESTS');

{
  const sc = compile('(defsynth sine (freq 440 amp 0.1 gate 1) (Out.ar 0 (SinOsc.ar freq 0)))');
  assert(sc.includes('SynthDef("sine"'), 'defsynth creates SynthDef with string name');
  assert(sc.includes('Out.ar(0'), 'defsynth body included');
}

{
  const sc = compile('(definst sine-wave (freq 440 amp 0.3) (* (SinOsc.ar freq 0) amp))');
  assert(sc.includes('SynthDef("sine-wave"'), 'definst creates SynthDef');
  assert(sc.includes('Out.ar(0'), 'definst wraps with Out.ar');
  assert(sc.includes('.dup(2)'), 'definst duplicates for stereo');
  assert(sc.includes('sine_wave ='), 'definst binds name to synth factory');
  assert(sc.includes('Synth("sine-wave"'), 'definst factory creates Synth');
}

{
  const sc = compile('(routine (wait 1) (. Post nl))');
  assert(sc.includes('Routine('), 'routine wraps in Routine');
  assert(sc.includes('.play'), 'routine calls .play');
  assert(sc.includes('1.wait'), 'wait emits .wait');
}

{
  const sc = compile('(pbind :instrument "sine" :freq 440 :dur 0.25)');
  assert(sc.includes('Pbind.new('), 'pbind creates Pbind');
  assert(sc.includes('\\instrument'), 'pbind includes keyword args');
}

{
  const sc = compile('(pseq (list 440 550 660) 4)');
  assert(sc.includes('Pseq.new('), 'pseq creates Pseq');
}

{
  const sc = compile('(ctl my-synth :freq 880 :amp 0.5)');
  assert(sc.includes('my_synth.set('), 'ctl calls .set');
  assert(sc.includes('\\freq'), 'ctl passes keyword args');
}

{
  const sc = compile('(kill my-synth)');
  assert(sc.includes('my_synth.free'), 'kill calls .free');
}

// ============================================================================
// OVERTONE API MACRO TESTS
// ============================================================================

testSection('OVERTONE API MACRO TESTS');

{
  const sc = compile('(now)');
  assert(sc.includes('TempoClock.default.beats'), 'now returns clock beats');
}

{
  const sc = compile('(metronome 120)');
  assert(sc.includes('TempoClock.new(120 / 60)'), 'metronome creates TempoClock');
}

{
  const sc = compile('(at (now) (sine-wave))');
  assert(sc.includes('schedAbs'), 'at uses schedAbs');
}

{
  const sc = compile('(in 1.0 (sine-wave))');
  assert(sc.includes('sched'), 'in uses sched');
}

{
  const sc = compile('(demo 5 (* (SinOsc.ar 440 0) 0.3))');
  assert(sc.includes('.play'), 'demo calls .play');
  assert(sc.includes('EnvGen.kr'), 'demo has time-limited envelope');
}

{
  const sc = compile('(midi->hz 60)');
  assert(sc.includes('60.midicps'), 'midi->hz uses midicps');
}

{
  const sc = compile('(hz->midi 440)');
  assert(sc.includes('440.cpsmidi'), 'hz->midi uses cpsmidi');
}

{
  const sc = compile('(db->amp -6)');
  assert(sc.includes('-6.dbamp'), 'db->amp uses dbamp');
}

{
  const sc = compile('(amp->db 0.5)');
  assert(sc.includes('0.5.ampdb'), 'amp->db uses ampdb');
}

{
  const sc = compile('(adsr gate 0.01 0.1 0.8 0.3)');
  assert(sc.includes('EnvGen.kr'), 'adsr creates EnvGen');
  assert(sc.includes('Env.adsr('), 'adsr uses Env.adsr');
}

{
  const sc = compile('(perc 0.01 0.5)');
  assert(sc.includes('Env.perc('), 'perc uses Env.perc');
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(60));

if (testsFailed > 0) {
  process.exit(1);
}

// ============================================================================
// SYNTAX MODE TESTS (Sweet-exp integration)
// ============================================================================

const { compileScscmText } = require('../lhc_compile');

testSection('SYNTAX MODE TESTS');

{
  // Test that auto mode works with regular s-expressions
  const sc = compileScscmText('(+ 1 2)', 'test.scscm', { syntax: 'auto' });
  assert(sc.includes('1 + 2'), 'Auto mode compiles regular s-expressions');
}

{
  // Test that sexpr mode works with regular s-expressions
  const sc = compileScscmText('(+ 1 2)', 'test.scscm', { syntax: 'sexpr' });
  assert(sc.includes('1 + 2'), 'Sexpr mode compiles regular s-expressions');
}

{
  // Test that sweet mode compiles curly-infix
  const sc = compileScscmText('{ 1 + 2 }', 'test.scscm', { syntax: 'sweet' });
  assert(sc.includes('1 + 2'), 'Sweet mode compiles curly-infix to same output as sexpr');
}

{
  // Test that sweet mode compiles neoteric sugar
  const sc = compileScscmText('add(1 2)', 'test.scscm', { syntax: 'sweet' });
  assert(sc.includes('add(') && sc.includes('1') && sc.includes('2'), 'Sweet mode compiles neoteric sugar');
}

{
  // Test that sweet mode compiles mixed forms
  const sc = compileScscmText('(+ 1 add(2 3))', 'test.scscm', { syntax: 'sweet' });
  assert(sc.includes('+') && sc.includes('1') && sc.includes('2') && sc.includes('3'), 'Sweet mode compiles mixed forms');
}

{
  // Test error handling for invalid sweet syntax
  let didError = false;
  try {
    compileScscmText('{ a + b * c }', 'test.scscm', { syntax: 'sweet' });
  } catch (err) {
    didError = true;
  }
  assert(didError, 'Sweet mode errors on mixed operators in curly form');
}
