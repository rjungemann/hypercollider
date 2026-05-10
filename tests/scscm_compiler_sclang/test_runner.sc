// test_runner.sc - Unit test runner for scscm compiler components
// Part of Phase P0: Harness bootstrap

ScscmTestRunner : Object {
	var <>tests, <>results, <>options;

	// Constructor
	*new { |options = nil|
		^super.new.init(options)
	}

	init { |options|
		this.options = options ? (
			verbose: true,
			stopOnFailure: false
		) ++ options;
		this.tests = List.new;
		this.results = List.new;
		^this
	}

	// Add a test
	add { |name, testFn|
		this.tests = this.tests.add(ScscmTest.new(name, testFn));
		^this
	}

	// Run all tests
	run { 
		this.results = List.new;
		
		if (this.options[\verbose]) {
			"Running {this.tests.size} tests...\n".post
		};
		
		this.tests.do({ |test|
			var result = this.runTest(test);
			this.results = this.results.add(result);
			
			if (this.options[\verbose]) {
				"{result.statusString} {test.name}\n".post;
				if (result.failed) {
					"  {result.message}\n".post
				}
			}
			
			if (this.options[\stopOnFailure] and: { result.failed }) {
				^this
			}
		});
		
		// Print summary
		this.printSummary
	}

	// Run a single test
	runTest { |test|
		var start = Main.elapsedTime;
		var passed = true;
		var message = "";
		var error = nil;
		
		try {
			test.fn.value
		} { |err|
			passed = false;
			message = err.asString;
			error = err
		};
		
		var elapsed = Main.elapsedTime - start;
		
		^ScscmTestResult.new(test, passed, message, elapsed, error)
	}

	// Print summary
	printSummary { 
		var total = this.results.size;
		var passed = this.results.select({ |r| r.passed }).size;
		var failed = total - passed;
		
		"\n=== Test Summary ===\n".post;
		"Total: {total}\n".post;
		"Passed: {passed}\n".post;
		"Failed: {failed}\n".post;
		
		if (total > 0) {
			var pct = (passed / total) * 100;
			"Pass rate: {pct.round(0.1)}%\n".post
		}
		
		// Show failures
		if (failed > 0) {
			"\n--- Failures ---\n".post;
			this.results.select({ |r| r.failed }).do({ |r|
				"FAIL: {r.test.name}\n".post;
				"  {r.message}\n".post
			})
		}
	}

	// Get results
	getResults { 
		^this.results
	}

	// Get pass rate
	getPassRate { 
		var total = this.results.size;
		if (total == 0) { ^0 };
		var passed = this.results.select({ |r| r.passed }).size;
		^(passed / total)
	}

	// Reset
	reset { 
		this.results = List.new;
		^this
	}
}

// Test representation
ScscmTest : Object {
	var <>name, <>fn;

	*new { |name, fn|
		^super.new.copy(name: name, fn: fn)
	}
}

// Test result
ScscmTestResult : Object {
	var <>test, <>passed, <>message, <>elapsed, <>error;

	*new { |test, passed, message = "", elapsed = 0, error = nil|
		^super.new.copy(
			test: test,
			passed: passed,
			message: message,
			elapsed: elapsed,
			error: error
		)
	}

	failed { 
		^this.passed.not
	}

	statusString { 
		^(this.passed ? "PASS" : "FAIL")
	}
}

// ==================== Unit Tests ====================

// Token tests
ScscmTokenTests { 
	*all { 
		var runner = ScscmTestRunner.new;
		
		// Test token creation
		runner.add("Token creation", { 
			var token = ScscmToken.new(ScscmToken.const[\symbol], "foo", 1, 5, "test.scscm");
			Assertion.test(token.type == ScscmToken.const[\symbol], "Token type mismatch");
			Assertion.test(token.value == "foo", "Token value mismatch");
			Assertion.test(token.line == 1, "Token line mismatch");
			Assertion.test(token.col == 5, "Token column mismatch");
		});
		
		// Test token equality
		runner.add("Token equality", { 
			var token1 = ScscmToken.new(ScscmToken.const[\symbol], "foo", 1, 0);
			var token2 = ScscmToken.new(ScscmToken.const[\symbol], "foo", 1, 0);
			var token3 = ScscmToken.new(ScscmToken.const[\number], "42", 1, 0);
			
			Assertion.test(token1 == token2, "Same tokens should be equal");
			Assertion.test((token1 == token3).not, "Different tokens should not be equal")
		});
		
		runner.run;
		^runner.getPassRate
	}
}

// Lexer tests
ScscmLexerTests { 
	*all { 
		var runner = ScscmTestRunner.new;
		
		// Test basic tokenization
		runner.add("Lexer - basic symbols", { 
			var lexer = ScscmLexer.new("foo bar baz");
			var tokens = lexer.lex;
			Assertion.test(tokens.size == 4, "Should have 3 symbols + EOF");
			Assertion.test(tokens[0].type == ScscmToken.const[\symbol], "First token should be symbol");
			Assertion.test(tokens[0].value == "foo", "First token value should be 'foo'");
		});
		
		// Test parentheses
		runner.add("Lexer - parentheses", { 
			var lexer = ScscmLexer.new("( )");
			var tokens = lexer.lex;
			Assertion.test(tokens.size == 3, "Should have (, ), EOF");
			Assertion.test(tokens[0].type == ScscmToken.const[\leftParen], "First should be left paren");
			Assertion.test(tokens[1].type == ScscmToken.const[\rightParen], "Second should be right paren");
		});
		
		// Test numbers
		runner.add("Lexer - numbers", { 
			var lexer = ScscmLexer.new("42 3.14 -5 +10");
			var tokens = lexer.lex;
			Assertion.test(tokens.size == 5, "Should have 4 numbers + EOF");
			Assertion.test(tokens[0].type == ScscmToken.const[\number], "First should be number");
			Assertion.test(tokens[0].value == "42", "First number should be 42");
			Assertion.test(tokens[1].value == "3.14", "Second number should be 3.14");
		});
		
		// Test strings
		runner.add("Lexer - strings", { 
			var lexer = ScscmLexer.new("\"hello\" \"world\"");
			var tokens = lexer.lex;
			Assertion.test(tokens.size == 3, "Should have 2 strings + EOF");
			Assertion.test(tokens[0].type == ScscmToken.const[\string], "First should be string");
			Assertion.test(tokens[0].value == "hello", "First string should be 'hello'");
		});
		
		// Test quotes
		runner.add("Lexer - quotes", { 
			var lexer = ScscmLexer.new("'foo `bar ,baz ,@qux");
			var tokens = lexer.lex;
			Assertion.test(tokens.size == 6, "Should have 5 tokens + EOF");
			Assertion.test(tokens[0].type == ScscmToken.const[\quote], "First should be quote");
			Assertion.test(tokens[1].type == ScscmToken.const[\symbol], "Second should be symbol");
			Assertion.test(tokens[2].type == ScscmToken.const[\quasiquote], "Third should be quasiquote");
			Assertion.test(tokens[3].type == ScscmToken.const[\unquote], "Fourth should be unquote");
			Assertion.test(tokens[4].type == ScscmToken.const[\unquoteSplicing], "Fifth should be unquote-splicing");
		});
		
		runner.run;
		^runner.getPassRate
	}
}

// Parser tests
ScscmParserTests { 
	*all { 
		var runner = ScscmTestRunner.new;
		
		// Test basic parsing
		runner.add("Parser - symbols", { 
			var parser = ScscmParser.parseString("foo bar");
			Assertion.test(parser.success, "Should parse successfully");
			Assertion.test(parser.ast.size == 2, "Should have 2 forms");
		});
		
		// Test list parsing
		runner.add("Parser - list", { 
			var parser = ScscmParser.parseString("(+ 1 2)");
			Assertion.test(parser.success, "Should parse successfully");
			Assertion.test(parser.ast.size == 1, "Should have 1 form");
			var list = parser.ast[0];
			Assertion.test(list.isKindOf(ScscmAstList), "Should be a list");
			Assertion.test(list.elements.size == 3, "Should have 3 elements");
		});
		
		// Test nested lists
		runner.add("Parser - nested lists", { 
			var parser = ScscmParser.parseString("(+ (1 2) (3 4))");
			Assertion.test(parser.success, "Should parse successfully");
			var list = parser.ast[0];
			Assertion.test(list.elements.size == 3, "Should have 3 elements");
			Assertion.test(list.elements[1].isKindOf(ScscmAstList), "Second element should be list");
		});
		
		// Test def
		runner.add("Parser - def", { 
			var parser = ScscmParser.parseString("(def x 42)");
			Assertion.test(parser.success, "Should parse successfully");
			var def = parser.ast[0];
			Assertion.test(def.isKindOf(ScscmAstDef), "Should be a def");
			Assertion.test(def.name.isKindOf(ScscmAstSymbol), "Name should be symbol");
			Assertion.test(def.name.value == "x", "Name should be 'x'");
		});
		
		// Test fn
		runner.add("Parser - fn", { 
			var parser = ScscmParser.parseString("(fn [x] (* x x))");
			Assertion.test(parser.success, "Should parse successfully");
			var fn = parser.ast[0];
			Assertion.test(fn.isKindOf(ScscmAstFn), "Should be a fn");
			Assertion.test(fn.args.size == 1, "Should have 1 arg");
			Assertion.test(fn.args[0].value == "x", "Arg should be 'x'");
		});
		
		// Test if
		runner.add("Parser - if", { 
			var parser = ScscmParser.parseString("(if true \"yes\" \"no\")");
			Assertion.test(parser.success, "Should parse successfully");
			var ifNode = parser.ast[0];
			Assertion.test(ifNode.isKindOf(ScscmAstIf), "Should be an if");
			Assertion.test(ifNode.alternate.notNil, "Should have alternate");
		});
		
		// Test quoted form
		runner.add("Parser - quote", { 
			var parser = ScscmParser.parseString("'foo");
			Assertion.test(parser.success, "Should parse successfully");
			var quoted = parser.ast[0];
			Assertion.test(quoted.isKindOf(ScscmAstQuoted), "Should be quoted");
		});
		
		runner.run;
		^runner.getPassRate
	}
}

// Compiler tests
ScscmCompilerTests { 
	*all { 
		var runner = ScscmTestRunner.new;
		
		// Test compile string
		runner.add("Compiler - compile string", { 
			var result = ScscmCompiler.compile("42");
			Assertion.test(result.success, "Should compile successfully");
			Assertion.test(result.code.notNil, "Should have code");
		});
		
		// Test compile def
		runner.add("Compiler - compile def", { 
			var result = ScscmCompiler.compile("(def x 42)");
			Assertion.test(result.success, "Should compile successfully");
			Assertion.test(result.code.includes("def"), "Code should contain 'def'");
		});
		
		// Test compile fn
		runner.add("Compiler - compile fn", { 
			var result = ScscmCompiler.compile("(fn [x] (* x x))");
			Assertion.test(result.success, "Should compile successfully");
			Assertion.test(result.code.includes("fn"), "Code should contain 'fn'");
		});
		
		// Test error handling
		runner.add("Compiler - error handling", { 
			var result = ScscmCompiler.compile("(def)");
			Assertion.test(result.success.not, "Should fail to compile");
			Assertion.test(result.diagnostics.notEmpty, "Should have diagnostics");
		});
		
		runner.run;
		^runner.getPassRate
	}
}

// Run all tests
ScscmAllTests { 
	*run { 
		var allPassed = true;
		
		"Running all unit tests...\n".post;
		
		[ScscmTokenTests.all, ScscmLexerTests.all, ScscmParserTests.all, ScscmCompilerTests.all].do({ |testFn|
			try {
				var rate = testFn.value;
				"Test suite pass rate: {(rate * 100).round(0.1)}%\n".post;
				if (rate < 1.0) { allPassed = false }
			} { |err|
				"Test suite error: {err.asString}\n".post;
				allPassed = false
			}
		});
		
		^allPassed
	}
}

// Convenience: run all tests
if (Main.args.notNil and: { Main.args.size > 0 and: { Main.args[0] == "--run-tests" } }) {
	var passed = ScscmAllTests.run;
	SystemExit.exit(passed ? 0 : 1)
}
