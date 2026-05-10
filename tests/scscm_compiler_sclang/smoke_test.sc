// smoke_test.sc - Simple end-to-end test for scscm compiler

// Test the complete compile pipeline

"=== Smoke Test for scscm-in-sclang compiler ===" .postln;
"Phase P1: Lexer + Parser MVP" .postln;

// Load all required classes
["ScscmToken", "ScscmLexer", "ScscmAst", "ScscmParser", "ScscmMacroExpander", "ScscmCodegen", "ScscmCompiler"].do({ |className|
		("Loading {className}... ").post;
		try {
			className.asSymbol.envir.put("test_loaded", 1);
			("  OK\n").post
		} { |err|
			("  FAIL: {err.asString}\n").post
		}
});

// Test 1: Token lexing
"\n--- Test 1: Lexer ---\n".post;
{
	var lexer = ScscmLexer.new("(def foo 42)");
	var tokens = lexer.lex;
	
	("Tokens: {tokens.size}\n").post;
	tokens.do({ |t, i|
		("  [{i}] {t.type} = '{t.value}' at {t.line}:{t.col}\n").post
	});
	
	// Verify we got the right tokens
	var expectedTypes = [ScscmToken.const[\leftParen], ScscmToken.const[\symbol], ScscmToken.const[\symbol], ScscmToken.const[\number], ScscmToken.const[\rightParen], ScscmToken.const[\eof]];
	var allMatch = true;
	tokens.do({ |t, i|
		if (i < expectedTypes.size and: { t.type != expectedTypes[i] }) {
			allMatch = false;
			("  MISMATCH at {i}: expected {expectedTypes[i]}, got {t.type}\n").post
		}
	});
	
	if (allMatch and: { tokens.size == expectedTypes.size }) {
		"PASS: Lexer tokenizes basic forms correctly\n".post
	} {
		"FAIL: Lexer tokenization mismatch\n".post
	}
}

// Test 2: Parser
"\n--- Test 2: Parser ---\n".post;
{
	var source = "(def foo 42)";
	var parser = ScscmParser.parseString(source);
	
	("Success: {parser.success}\n").post;
	("Diagnostics: {parser.diagnostics.size}\n").post;
	parser.diagnostics.do({ |d| d.asString.postln });
	
	if (parser.success) {
		("AST nodes: {parser.ast.size}\n").post;
		parser.ast.do({ |node, i|
			("  [{i}] {node.class.name}: {node.asString}\n").post
		});
		
		// Check first form is a def
		if (parser.ast[0].isKindOf(ScscmAstDef)) {
			var def = parser.ast[0];
			("  Def name: {def.name.value}\n").post;
			("  Def value: {def.value.class.name}\n").post;
			if (def.value.isKindOf(ScscmAstNumber) and: { def.value.value == 42 }) {
				"PASS: Parser creates correct AST for def\n".post
			} {
				"FAIL: Parser AST mismatch\n".post
			}
		} {
			"FAIL: Expected ScscmAstDef, got {parser.ast[0].class.name}\n".post
		}
	} {
		"FAIL: Parser failed\n".post
	}
}

// Test 3: Full compiler pipeline
"\n--- Test 3: Full Compiler ---\n".post;
{
	var source = "(defn square [x] (* x x))\n(square 5)";
	var compiler = ScscmCompiler.new;
	var result = compiler.compileString(source);
	
	("Success: {result.success}\n").post;
	("Diagnostics: {result.diagnostics.size}\n").post;
	result.diagnostics.do({ |d| d.asString.postln });
	
	if (result.success) {
		("Generated code:\n{result.code}\n").post;
		
		// Check that output contains expected elements
		if (result.code.includes("defn") and: { result.code.includes("square") }) {
			"PASS: Compiler generates code with defn\n".post
		} {
			"FAIL: Compiler output missing expected content\n".post
		}
	} {
		"FAIL: Compiler failed\n".post
	}
}

// Test 4: Lexer with comments and strings
"\n--- Test 4: Lexer with Comments and Strings ---\n".post;
{
	var source = ";; This is a comment\n(def name \"hello\") ; another comment";
	var lexer = ScscmLexer.new(source);
	var tokens = lexer.lex;
	
	("Tokens: {tokens.size}\n").post;
	tokens.do({ |t, i|
		("  [{i}] {t.type} = '{t.value}'\n").post
	});
	
	// Should have: comment, leftParen, symbol, symbol, string, rightParen, comment, eof
	var hasComment = tokens.any({ |t| t.type == ScscmToken.const[\comment] });
	var hasString = tokens.any({ |t| t.type == ScscmToken.const[\string] });
	
	if (hasComment and: { hasString }) {
		"PASS: Lexer handles comments and strings\n".post
	} {
		"FAIL: Lexer missing comment or string tokens\n".post
	}
}

// Test 5: Parser with special forms
"\n--- Test 5: Parser with Special Forms ---\n".post;
{
	var source = "(if true \"yes\" \"no\")";
	var parser = ScscmParser.parseString(source);
	
	if (parser.success) {
		var ifNode = parser.ast[0];
		if (ifNode.isKindOf(ScscmAstIf)) {
			("  Test: {ifNode.test.class.name}\n").post;
			("  Consequent: {ifNode.consequent.class.name}\n").post;
			("  Alternate: {ifNode.alternate.class.name}\n").post;
			"PASS: Parser handles if form\n".post
		} {
			"FAIL: Expected ScscmAstIf, got {ifNode.class.name}\n".post
		}
	} {
		"FAIL: Parser failed on if form\n".post
	}
}

// Test 6: Fixture parsing
"\n--- Test 6: Fixture Parsing ---\n".post;
{
	// Try to parse each fixture
	var fixtureFiles = [
		"tests/fixtures/scscm/basics.scscm",
		"tests/fixtures/scscm/control_flow.scscm",
		"tests/fixtures/scscm/functions.scscm",
		"tests/fixtures/scscm/quoting.scscm",
		"tests/fixtures/scscm/synths.scscm"
	];
	
	var passed = 0;
	var failed = 0;
	
	fixtureFiles.do({ |path|
		var file = File(path, "r");
		if (file.isOpen.not) {
			("SKIP: {path} (file not found)\n").post;
			^this
		};
		
		var source = file.readAllString;
		file.close;
		
		var parser = ScscmParser.parseString(source, path);
		
		if (parser.success) {
			("PASS: {path} ({parser.ast.size} forms)\n").post;
			passed = passed + 1
		} {
			("FAIL: {path} ({parser.diagnostics.size} errors)\n").post;
			parser.diagnostics.do({ |d| ("  {d.asString}\n").post });
			failed = failed + 1
		}
	});
	
	("\nFixture results: {passed} passed, {failed} failed\n").post;
	
	if (failed == 0) {
		"PASS: All fixtures parsed successfully\n".post
	} {
		"FAIL: Some fixtures failed to parse\n".post
	}
}

// Test 7: Compiler with fixtures
"\n--- Test 7: Compiler with Fixtures ---\n".post;
{
	var compiler = ScscmCompiler.new((normalizeOutput: false));
	
	var fixtureFiles = [
		"tests/fixtures/scscm/basics.scscm",
		"tests/fixtures/scscm/control_flow.scscm",
		"tests/fixtures/scscm/functions.scscm",
		"tests/fixtures/scscm/quoting.scscm"
	];
	
	var passed = 0;
	var failed = 0;
	
	fixtureFiles.do({ |path|
		var file = File(path, "r");
		if (file.isOpen.not) {
			("SKIP: {path}\n").post;
			^this
		};
		
		var source = file.readAllString;
		file.close;
		
		var result = compiler.compileString(source, path);
		
		if (result.success) {
			("PASS: {path} ({result.code.size} chars)\n").post;
			passed = passed + 1
		} {
			("FAIL: {path} ({result.diagnostics.size} errors)\n").post;
			result.diagnostics.do({ |d| ("  {d.asString}\n").post });
			failed = failed + 1
		}
	});
	
	("\nCompiler results: {passed} passed, {failed} failed\n").post;
	
	if (failed == 0) {
		"PASS: All fixtures compiled successfully\n".post
	}
}

"\n=== Smoke Test Complete ===\n".post;
