/**
 * Test suite for SuperCollider Language Interpreter
 */

// Simple test framework
class TestSuite {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(description, fn) {
    this.tests.push({ description, fn });
  }

  run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Test Suite: ${this.name}`);
    console.log('='.repeat(60));

    for (const t of this.tests) {
      try {
        t.fn();
        console.log(`✓ ${t.description}`);
        this.passed++;
      } catch (error) {
        console.log(`✗ ${t.description}`);
        console.log(`  Error: ${error.message}`);
        this.failed++;
      }
    }

    console.log('-'.repeat(60));
    console.log(`Results: ${this.passed} passed, ${this.failed} failed`);
    console.log('='.repeat(60));
    return this.failed === 0;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message ||
      `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`
    );
  }
}

function assertArrayEquals(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    throw new Error('Both values must be arrays');
  }
  if (actual.length !== expected.length) {
    throw new Error(
      `Array length mismatch: expected ${expected.length}, got ${actual.length}`
    );
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `Array element mismatch at index ${i}: expected ${expected[i]}, got ${actual[i]}`
      );
    }
  }
}

// Test suite for Lexer
const lexerTests = new TestSuite('Lexer');

lexerTests.test('Tokenize numbers', () => {
  const lexer = new Lexer('42 3.14 1e5');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === 'NUMBER' && tokens[0].value === 42);
  assert(tokens[1].type === 'NUMBER' && tokens[1].value === 3.14);
  assert(tokens[2].type === 'NUMBER' && tokens[2].value === 1e5);
});

lexerTests.test('Tokenize strings', () => {
  const lexer = new Lexer('"hello" "world"');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === 'STRING' && tokens[0].value === 'hello');
  assert(tokens[1].type === 'STRING' && tokens[1].value === 'world');
});

lexerTests.test('Tokenize symbols', () => {
  const lexer = new Lexer('\\note \\duration');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === 'SYMBOL' && tokens[0].value === 'note');
  assert(tokens[1].type === 'SYMBOL' && tokens[1].value === 'duration');
});

lexerTests.test('Tokenize identifiers', () => {
  const lexer = new Lexer('x y1 my_var');
  const tokens = lexer.tokenize();
  assert(tokens[0].type === 'IDENTIFIER' && tokens[0].value === 'x');
  assert(tokens[1].type === 'IDENTIFIER' && tokens[1].value === 'y1');
  assert(tokens[2].type === 'IDENTIFIER' && tokens[2].value === 'my_var');
});

lexerTests.test('Tokenize operators', () => {
  const lexer = new Lexer('+ - * / == != < >');
  const tokens = lexer.tokenize();
  assert(tokens[0].value === '+');
  assert(tokens[1].value === '-');
  assert(tokens[2].value === '*');
  assert(tokens[3].value === '/');
  assert(tokens[4].value === '==');
  assert(tokens[5].value === '!=');
});

lexerTests.test('Skip comments', () => {
  const lexer = new Lexer('1 // comment\n2 /* multi\nline */ 3');
  const tokens = lexer.tokenize();
  // Should have: 1, 2, 3, EOF
  assert(tokens[0].value === 1);
  assert(tokens[1].value === 2);
  assert(tokens[2].value === 3);
});

// Test suite for Parser
const parserTests = new TestSuite('Parser');

parserTests.test('Parse number', () => {
  const lexer = new Lexer('42');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'NumberLiteral' && ast[0].value === 42);
});

parserTests.test('Parse string', () => {
  const lexer = new Lexer('"hello"');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'StringLiteral' && ast[0].value === 'hello');
});

parserTests.test('Parse array', () => {
  const lexer = new Lexer('[1, 2, 3]');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'ArrayLiteral');
  assert(ast[0].elements.length === 3);
});

parserTests.test('Parse dict', () => {
  const lexer = new Lexer('{"a": 1, "b": 2}');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'DictLiteral');
  assert(ast[0].pairs.length === 2);
});

parserTests.test('Parse binary operation', () => {
  const lexer = new Lexer('1 + 2');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'BinaryOp');
  assert(ast[0].op === '+');
});

parserTests.test('Parse method call', () => {
  const lexer = new Lexer('"hello".size');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'MethodCall');
  assert(ast[0].methodName === 'size');
});

parserTests.test('Parse assignment', () => {
  const lexer = new Lexer('x = 5');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'Assignment');
  assert(ast[0].varName === 'x');
});

parserTests.test('Parse var declaration', () => {
  const lexer = new Lexer('var x = 5, y = 6');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'VarDeclaration');
  assert(ast[0].declarations.length === 2);
  assert(ast[0].declarations[0].name === 'x');
});

parserTests.test('Parse block literal', () => {
  const lexer = new Lexer('{ |x, y| x + y }');
  const parser = new Parser(lexer.tokenize());
  const ast = parser.parse();
  assert(ast[0].type === 'BlockLiteral');
  assert(ast[0].params.length === 2);
});

// Test suite for Evaluator
const evaluatorTests = new TestSuite('Evaluator');

evaluatorTests.test('Evaluate number', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('42');
  assertEquals(result.result, 42);
});

evaluatorTests.test('Evaluate string', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('"hello"');
  assertEquals(result.result, 'hello');
});

evaluatorTests.test('Arithmetic: addition', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('1 + 2');
  assertEquals(result.result, 3);
});

evaluatorTests.test('Arithmetic: subtraction', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('5 - 3');
  assertEquals(result.result, 2);
});

evaluatorTests.test('Arithmetic: multiplication', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('3 * 4');
  assertEquals(result.result, 12);
});

evaluatorTests.test('Arithmetic: division', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('10 / 2');
  assertEquals(result.result, 5);
});

evaluatorTests.test('Comparison: equality', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('5 == 5');
  assertEquals(result.result, true);
});

evaluatorTests.test('Comparison: inequality', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('5 != 3');
  assertEquals(result.result, true);
});

evaluatorTests.test('Comparison: less than', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('3 < 5');
  assertEquals(result.result, true);
});

evaluatorTests.test('String method: size', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('"hello".size');
  assertEquals(result.result, 5);
});

evaluatorTests.test('String method: reverse', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('"hello".reverse');
  assertEquals(result.result, 'olleh');
});

evaluatorTests.test('Array literal', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3]');
  assertArrayEquals(result.result, [1, 2, 3]);
});

evaluatorTests.test('Array method: size', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3].size');
  assertEquals(result.result, 3);
});

evaluatorTests.test('Array method: reverse', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3].reverse');
  assertArrayEquals(result.result, [3, 2, 1]);
});

evaluatorTests.test('Array indexing', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[10, 20, 30][1]');
  assertEquals(result.result, 20);
});

evaluatorTests.test('Dictionary literal', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('{"x": 1, "y": 2}');
  assert(result.result.type === 'Dictionary');
  assert(result.result.pairs.length === 2);
});

evaluatorTests.test('Dictionary indexing', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('{"x": 10}["x"]');
  assertEquals(result.result, 10);
});

evaluatorTests.test('Variable assignment', () => {
  const interp = new SCInterpreter();
  interp.eval('x = 42');
  const result = interp.eval('x');
  assertEquals(result.result, 42);
});

evaluatorTests.test('Var declaration', () => {
  const interp = new SCInterpreter();
  interp.eval('var x = 42');
  const result = interp.eval('x');
  assertEquals(result.result, 42);
});

evaluatorTests.test('Block literal call via variable', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('f = { |x| x * 2 }; f(21)');
  assertEquals(result.result, 42);
});

evaluatorTests.test('if true branch', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('if (1 > 0) { 42 } { 0 }');
  assertEquals(result.result, 42);
});

evaluatorTests.test('if false branch', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('if (0 > 1) { 99 } { 7 }');
  assertEquals(result.result, 7);
});

evaluatorTests.test('if with no else returns nil', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('if (false) { 42 }');
  assertEquals(result.result, null);
});

evaluatorTests.test('if result used in expression', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var x = 3; if (x == 3) { 100 } { 0 }');
  assertEquals(result.result, 100);
});

evaluatorTests.test('return via ^ exits block', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('f = { |x| if (x > 0) { ^x * 10 }; 0 }; f(5)');
  assertEquals(result.result, 50);
});

evaluatorTests.test('return via ^ falls through when false', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('f = { |x| if (x > 0) { ^x * 10 }; 0 }; f(-1)');
  assertEquals(result.result, 0);
});

evaluatorTests.test('message-style .if', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('(2 > 1).if({ 55 }, { 0 })');
  assertEquals(result.result, 55);
});

// ---- .value() on blocks ----

evaluatorTests.test('block .value() no args', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var f = { 42 }; f.value');
  assertEquals(result.result, 42);
});

evaluatorTests.test('block .value(arg)', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var f = { |x| x * 3 }; f.value(7)');
  assertEquals(result.result, 21);
});

evaluatorTests.test('block .value() lexical closure shared state', () => {
  const interp = new SCInterpreter();
  // Mirrors TestFunction::test_function_scope pattern
  const result = interp.eval(
    'var x = 0; var f = { |y| x = x + y }; f.value(10); f.value(5); x'
  );
  assertEquals(result.result, 15);
});

// ---- Integer do/collect/to ----

evaluatorTests.test('Integer do', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var s = 0; 5.do({ |i| s = s + i }); s');
  assertEquals(result.result, 10); // 0+1+2+3+4
});

evaluatorTests.test('Integer collect', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('3.collect({ |i| i * 2 })');
  assertArrayEquals(result.result, [0, 2, 4]);
});

evaluatorTests.test('Integer to', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('2.to(5)');
  assertArrayEquals(result.result, [2, 3, 4, 5]);
});

// ---- Array collect/do/select/reject with index ----

evaluatorTests.test('Array do with index', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var s = 0; [10, 20, 30].do({ |item, i| s = s + i }); s');
  assertEquals(result.result, 3); // 0+1+2
});

evaluatorTests.test('Array collect with index', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[10, 20, 30].collect({ |item, i| item + i })');
  assertArrayEquals(result.result, [10, 21, 32]);
});

evaluatorTests.test('Array select', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3, 4, 5].select({ |x| x > 2 })');
  assertArrayEquals(result.result, [3, 4, 5]);
});

evaluatorTests.test('Array reject', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3, 4, 5].reject({ |x| x > 2 })');
  assertArrayEquals(result.result, [1, 2]);
});

evaluatorTests.test('Array inject', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3, 4].inject(0, { |acc, x| acc + x })');
  assertEquals(result.result, 10);
});

// ---- Default arg values ----

evaluatorTests.test('Default arg values', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var f = { |x = 10, y = 20| x + y }; f.value');
  assertEquals(result.result, 30);
});

evaluatorTests.test('Default arg values partial override', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var f = { |x = 10, y = 20| x + y }; f.value(5)');
  assertEquals(result.result, 25); // 5 + 20
});

// ---- while loop ----

evaluatorTests.test('while loop', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var i = 0; while { i < 5 } { i = i + 1 }; i');
  assertEquals(result.result, 5);
});

evaluatorTests.test('while loop accumulates', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var i = 0; var s = 0; while { i < 4 } { s = s + i; i = i + 1 }; s');
  assertEquals(result.result, 6); // 0+1+2+3
});

// ---- inf/nan ----

evaluatorTests.test('inf constant', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('inf');
  assertEquals(result.result, Infinity);
});

evaluatorTests.test('isNaN on nan', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('(0.0 / 0.0).isNaN');
  assertEquals(result.result, true);
});

evaluatorTests.test('isInf on inf', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('(1.0 / 0.0).isInf');
  assertEquals(result.result, true);
});

evaluatorTests.test('Logical AND', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('true && false');
  assertEquals(result.result, false);
});

evaluatorTests.test('Logical OR', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('false || true');
  assertEquals(result.result, true);
});

evaluatorTests.test('Unary negation', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('-5');
  assertEquals(result.result, -5);
});

evaluatorTests.test('Number method: abs', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('(-5).abs');
  assertEquals(result.result, 5);
});

evaluatorTests.test('Number method: sqrt', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('16.sqrt');
  assertEquals(result.result, 4);
});

evaluatorTests.test('Error handling: undefined variable', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('undefined_var');
  assert(!result.success);
  assert(result.error.includes('Undefined variable'));
});

evaluatorTests.test('Error handling: syntax error', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2');
  assert(!result.success);
  assert(result.error.length > 0);
});

// ---- switch ----

evaluatorTests.test('switch match first case', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('switch(1, 1, { 100 }, 2, { 200 }, { 0 })');
  assertEquals(result.result, 100);
});

evaluatorTests.test('switch match second case', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('switch(2, 1, { 100 }, 2, { 200 }, { 0 })');
  assertEquals(result.result, 200);
});

evaluatorTests.test('switch default', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('switch(99, 1, { 100 }, 2, { 200 }, { 0 })');
  assertEquals(result.result, 0);
});

evaluatorTests.test('switch no match no default returns nil', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('switch(99, 1, { 100 }, 2, { 200 })');
  assertEquals(result.result, null);
});

// ---- try/catch ----

evaluatorTests.test('try no error', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('try { 42 } { |e| -1 }');
  assertEquals(result.result, 42);
});

evaluatorTests.test('try catches error', () => {
  const interp = new SCInterpreter();
  // Trigger an undefined-var error inside the try block
  const result = interp.eval('try { undeclaredVar } { |e| 99 }');
  assertEquals(result.result, 99);
});

// ---- Array.fill ----

evaluatorTests.test('Array.fill', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('Array.fill(4, { |i| i * i })');
  assertArrayEquals(result.result, [0, 1, 4, 9]);
});

evaluatorTests.test('Array.fill constant', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('Array.fill(3, 0)');
  assertArrayEquals(result.result, [0, 0, 0]);
});

// ---- .postln / .class / .isNil ----

evaluatorTests.test('.postln returns receiver', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('42.postln');
  assertEquals(result.result, 42);
});

evaluatorTests.test('.class on Integer', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('5.class');
  assertEquals(result.result, 'Integer');
});

evaluatorTests.test('.isNil on nil', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('nil.isNil');
  assertEquals(result.result, true);
});

evaluatorTests.test('.notNil on value', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('42.notNil');
  assertEquals(result.result, true);
});

// ---- forBy ----

evaluatorTests.test('forBy positive step', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var s = 0; 10.forBy(20, 3, { |i| s = s + i }); s');
  // i = 10, 13, 16, 19 => sum = 58
  assertEquals(result.result, 58);
});

evaluatorTests.test('forBy negative step', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var out = []; 5.forBy(1, -2, { |i| out = out.add(i) }); out');
  assertArrayEquals(result.result, [5, 3, 1]);
});

// ---- Keyword-style arguments ----

evaluatorTests.test('keyword arg: block .value(name: val)', () => {
  const interp = new SCInterpreter();
  // Block with named param; call via keyword arg
  const result = interp.eval('var f = { |freq = 440| freq * 2 }; f.value(freq: 220)');
  assertEquals(result.result, 440);
});

evaluatorTests.test('keyword arg: skip positional, fill by name', () => {
  const interp = new SCInterpreter();
  // First arg positional, second by name
  const result = interp.eval('var f = { |a, b, c| a + b + c }; f.value(1, c: 10, b: 100)');
  assertEquals(result.result, 111);
});

evaluatorTests.test('keyword arg: all kwargs', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var f = { |x, y| x - y }; f.value(y: 3, x: 10)');
  assertEquals(result.result, 7);
});

evaluatorTests.test('keyword arg: function call syntax', () => {
  const interp = new SCInterpreter();
  // Named function call with keyword arg
  const result = interp.eval('var add = { |a, b| a + b }; add.value(a: 5, b: 3)');
  assertEquals(result.result, 8);
});

evaluatorTests.test('keyword arg: Array.fill with positional args', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('Array.fill(3, { |i| i + 1 })');
  assertArrayEquals(result.result, [1, 2, 3]);
});

// ---- ++ concatenation ----

evaluatorTests.test('string concat ++', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('"hello" ++ " world"');
  assertEquals(result.result, 'hello world');
});

evaluatorTests.test('array concat ++', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2] ++ [3, 4]');
  assertArrayEquals(result.result, [1, 2, 3, 4]);
});

// ---- Trailing block argument syntax ----

evaluatorTests.test('trailing block: .do { |x| }', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var s = 0; [10, 20, 30].do { |x| s = s + x }; s');
  assertEquals(result.result, 60);
});

evaluatorTests.test('trailing block: .collect { |x| }', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3].collect { |x| x * 2 }');
  assertArrayEquals(result.result, [2, 4, 6]);
});

evaluatorTests.test('trailing block: .select { |x| }', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('[1, 2, 3, 4].select { |x| x > 2 }');
  assertArrayEquals(result.result, [3, 4]);
});

evaluatorTests.test('trailing block: Integer.do { |i| }', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var s = 0; 5.do { |i| s = s + i }; s');
  // 0+1+2+3+4 = 10
  assertEquals(result.result, 10);
});

// ---- boolean.not ----

evaluatorTests.test('true.not', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('true.not').result, false);
});

evaluatorTests.test('false.not', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('false.not').result, true);
});

// ---- List ----

evaluatorTests.test('List.new and add', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var l = List.new; l.add(10); l.add(20); l.size');
  assertEquals(result.result, 2);
});

evaluatorTests.test('List.do', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var l = List.new; var s = 0; l.add(10); l.add(20); l.do { |x| s = s + x }; s');
  assertEquals(result.result, 30);
});

evaluatorTests.test('List.asArray', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var l = List.new; l.add(1); l.add(2); l.asArray');
  assertArrayEquals(result.result, [1, 2]);
});

// ---- global forBy ----

evaluatorTests.test('global forBy function', () => {
  const interp = new SCInterpreter();
  const result = interp.eval('var out = []; forBy(0, 6, 2, { |i| out = out.add(i) }); out');
  assertArrayEquals(result.result, [0, 2, 4, 6]);
});

// ---- String.format / contains ----

evaluatorTests.test('string format single', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('"val: %".format(42)').result, 'val: 42');
});

evaluatorTests.test('string format multiple', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('"% and %".format(1, 2)').result, '1 and 2');
});

evaluatorTests.test('string contains', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('"hello world".contains("world")').result, true);
});

// ---- single-quoted symbol and $char ----

evaluatorTests.test("single-quoted symbol 'name'", () => {
  const interp = new SCInterpreter();
  const result = interp.eval("'hello'.class");
  assertEquals(result.result, 'Symbol');
});

evaluatorTests.test('char literal $A', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('$A').result, 'A');
});

// ---- dup ----

evaluatorTests.test('number dup', () => {
  const interp = new SCInterpreter();
  assertArrayEquals(interp.eval('5.dup(3)').result, [5, 5, 5]);
});

evaluatorTests.test('** exponentiation operator', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('2 ** 10').result, 1024);
  assertEquals(interp.eval('3 ** 2').result, 9);
});

evaluatorTests.test('number clip', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('5.clip(0, 3)').result, 3);
  assertEquals(interp.eval('(-2).clip(0, 10)').result, 0);
  assertEquals(interp.eval('5.clip(0, 10)').result, 5);
});

evaluatorTests.test('number wrap', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('7.wrap(0, 5)').result, 2);
  assertEquals(interp.eval('(-1).wrap(0, 5)').result, 4);
});

evaluatorTests.test('number linlin', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('0.5.linlin(0.0, 1.0, 0.0, 100.0)').result, 50);
  assertEquals(interp.eval('0.0.linlin(0.0, 1.0, 10.0, 20.0)').result, 10);
  assertEquals(interp.eval('1.0.linlin(0.0, 1.0, 10.0, 20.0)').result, 20);
});

evaluatorTests.test('number linexp', () => {
  const interp = new SCInterpreter();
  const r = interp.eval('0.5.linexp(0.0, 1.0, 1.0, 1000.0)').result;
  assert(r > 30 && r < 32, 'linexp(0.5) ~= 31.6');
});

evaluatorTests.test('number midicps and cpsmidi', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('69.midicps').result, 440);
  assertEquals(interp.eval('440.cpsmidi').result, 69);
});

evaluatorTests.test('number dbamp and ampdb', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('0.dbamp').result, 1);
  assertEquals(interp.eval('1.ampdb').result, 0);
});

evaluatorTests.test('number lcm and gcd', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('4.lcm(6)').result, 12);
  assertEquals(interp.eval('12.gcd(8)').result, 4);
});

evaluatorTests.test('number log log2 log10 exp', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('1.0.log').result, 0);
  assertEquals(interp.eval('4.0.log2').result, 2);
  assertEquals(interp.eval('100.0.log10').result, 2);
  assertEquals(interp.eval('0.0.exp').result, 1);
});

evaluatorTests.test('number mod trunc frac', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('10.mod(3)').result, 1);
  assertEquals(interp.eval('3.7.trunc').result, 3);
  const frac = interp.eval('3.7.frac').result;
  assert(Math.abs(frac - 0.7) < 0.0001, 'frac ~= 0.7');
});

evaluatorTests.test('number hypot', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('3.hypot(4)').result, 5);
});

evaluatorTests.test('number rand', () => {
  const interp = new SCInterpreter();
  const r = interp.eval('var x = 10.rand; x >= 0').result;
  assertEquals(r, true);
});

evaluatorTests.test('number rrand', () => {
  const interp = new SCInterpreter();
  const r = interp.eval('var x = 5.rrand(10); x >= 5 && (x <= 10)').result;
  assertEquals(r, true);
});

evaluatorTests.test('string asInteger', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('"42".asInteger').result, 42);
  assertEquals(interp.eval('"0".asInteger').result, 0);
});

evaluatorTests.test('string asFloat', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('"3.14".asFloat').result, 3.14);
});

evaluatorTests.test('string copyRange', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('"hello".copyRange(1, 3)').result, 'ell');
  assertEquals(interp.eval('"hello".copyRange(0, 4)').result, 'hello');
});

evaluatorTests.test('Array.series', () => {
  const interp = new SCInterpreter();
  assertArrayEquals(interp.eval('Array.series(5, 0, 1)').result, [0, 1, 2, 3, 4]);
  assertArrayEquals(interp.eval('Array.series(4, 10, 2)').result, [10, 12, 14, 16]);
});

evaluatorTests.test('Array.geom', () => {
  const interp = new SCInterpreter();
  assertArrayEquals(interp.eval('Array.geom(4, 1, 2)').result, [1, 2, 4, 8]);
  assertArrayEquals(interp.eval('Array.geom(3, 3, 3)').result, [3, 9, 27]);
});

evaluatorTests.test('array keep', () => {
  const interp = new SCInterpreter();
  assertArrayEquals(interp.eval('[1,2,3,4,5].keep(3)').result, [1, 2, 3]);
  assertArrayEquals(interp.eval('[1,2,3,4,5].keep(-2)').result, [4, 5]);
});

evaluatorTests.test('array drop', () => {
  const interp = new SCInterpreter();
  assertArrayEquals(interp.eval('[1,2,3,4,5].drop(2)').result, [3, 4, 5]);
  assertArrayEquals(interp.eval('[1,2,3,4,5].drop(-1)').result, [1, 2, 3, 4]);
});

evaluatorTests.test('array rotate', () => {
  const interp = new SCInterpreter();
  assertArrayEquals(interp.eval('[1,2,3,4].rotate(1)').result, [4, 1, 2, 3]);
  assertArrayEquals(interp.eval('[1,2,3,4].rotate(2)').result, [3, 4, 1, 2]);
});

evaluatorTests.test('array flat', () => {
  const interp = new SCInterpreter();
  assertArrayEquals(interp.eval('[[1,2],[3,4]].flat').result, [1, 2, 3, 4]);
  assertArrayEquals(interp.eval('[1,[2,[3]],4].flat').result, [1, 2, 3, 4]);
});

evaluatorTests.test('global rrand', () => {
  const interp = new SCInterpreter();
  const r = interp.eval('var x = rrand(1.0, 5.0); x >= 1.0').result;
  assertEquals(r, true);
});

// ---- Scheduling: Routine / fork / loop / wait / clocks ----

evaluatorTests.test('n.wait is a no-op returning n', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('1.0.wait').result, 1.0);
  assertEquals(interp.eval('0.5.yield').result, 0.5);
});

evaluatorTests.test('block.fork runs synchronously', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; { x = 42 }.fork; x').result, 42);
});

evaluatorTests.test('block.fork returns Routine', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('{ 1 }.fork.class').result, 'Routine');
});

evaluatorTests.test('Routine.new and play', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; var r = Routine.new({ x = 7 }); r.play; x').result, 7);
});

evaluatorTests.test('Routine { } trailing block', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; Routine { x = 3 }.play; x').result, 3);
});

evaluatorTests.test('Routine.class', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('Routine.new({ }).class').result, 'Routine');
});

evaluatorTests.test('Routine stop', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var r = Routine.new({ }); r.stop; r.isRunning').result, false);
});

evaluatorTests.test('SystemClock.sched runs fn', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; SystemClock.sched(0, { x = 99 }); x').result, 99);
});

evaluatorTests.test('TempoClock.play runs routine', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; var r = Routine.new({ x = 5 }); TempoClock.play(r); x').result, 5);
});

evaluatorTests.test('block.defer runs fn', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; { x = 7 }.defer(0); x').result, 7);
});

evaluatorTests.test('global loop { } with ^exit', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; loop { x = x + 1; if (x >= 5) { ^nil } }; x').result, 5);
});

evaluatorTests.test('loop inside block.value', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var x = 0; { loop { x = x + 1; if (x >= 3) { ^nil } } }.value; x').result, 3);
});

evaluatorTests.test('fork with do side effects', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var acc = 0; { 4.do { |i| acc = acc + i } }.fork; acc').result, 6);
});

evaluatorTests.test('wait is no-op inside do loop', () => {
  const interp = new SCInterpreter();
  assertEquals(interp.eval('var acc = 0; 3.do { |i| acc = acc + i; 0.1.wait }; acc').result, 3);
});


function runAllTests() {
  const allPassed =
    lexerTests.run() &&
    parserTests.run() &&
    evaluatorTests.run();

  console.log('\n');
  if (allPassed) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('❌ Some tests failed');
  }
  return allPassed;
}

// Export for use in browsers and Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TestSuite, runAllTests, assert, assertEquals, assertArrayEquals };
}
