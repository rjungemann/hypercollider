// ScscmCompiler.sc - Main compiler facade for scscm-in-sclang
// Part of Phase P0: Harness bootstrap

ScscmCompiler : Object {
	var <>lexer, <>parser, <>expander, <>codegen, <>diagnostics, <>options;

	// Default options
	*defaultOptions { 
		^(
			maxMacroDepth: 100,
			maxLineLength: 80,
			normalizeOutput: true,
			preserveComments: false,
			trackMetrics: false,
			target: "sclang" // or "scscm" for comparison testing
		)
	}

	// Constructor
	*new { |options = nil|
		^super.new.init(options ? options ! this.class.defaultOptions)
	}

	init { |options|
		this.options = options;
		this.lexer = nil;
		this.parser = nil;
		this.expander = nil;
		this.codegen = nil;
		this.diagnostics = List.new;
		^this
	}

	// Main compile method from string
	compileString { |source, file = "<string>"|
		this.reset;
		this.diagnostics = List.new;
		
		// Phase 1: Lexing
		var lexer = ScscmLexer.new(source, file);
		this.lexer = lexer;
		var tokens = lexer.lex;
		
		// Phase 2: Parsing
		var parser = ScscmParser.new(lexer);
		this.parser = parser;
		var parseResult = parser.parse;
		this.diagnostics = this.diagnostics ++ parseResult.diagnostics;
		
		if (parseResult.success.not) {
			^ScscmCompileResult.new(
				nil, 
				this.diagnostics,
				file,
				lexer: lexer,
				parser: parser
			)
		};
		
		// Phase 3: Macro expansion
		var expander = ScscmMacroExpander.new(this.options[\maxMacroDepth]);
		this.expander = expander;
		
		// First pass: collect defmacro definitions
		var macros = parseResult.ast.select({ |form|
			form.isKindOf(ScscmAstDefmacro)
		});
		
		// Register macros
		expander.registerMacrosFromAst(macros);
		
		// Expand all forms
		var expandResult = expander.expand(parseResult.ast);
		this.diagnostics = this.diagnostics ++ expandResult.diagnostics;
		
		// Phase 4: Code generation
		// Use target from options (defaults to sclang)
		var target = this.options[\target] ? "sclang";
		var codegen = ScscmCodegen.new((target: target));
		this.codegen = codegen;
		var codegenResult = codegen.generate(expandResult.ast);
		this.diagnostics = this.diagnostics ++ codegenResult.diagnostics;
		
		// Normalize output if requested
		var code = codegenResult.code;
		if (this.options[\normalizeOutput]) {
			code = this.normalizeOutput(code)
		};
		
		^ScscmCompileResult.new(
			code,
			this.diagnostics,
			file,
			lexer: lexer,
			parser: parser,
			expander: expander,
			codegen: codegen,
			ast: parseResult.ast,
			expandedAst: expandResult.ast
		)
	}

	// Compile from file
	compileFile { |path|
		var file = File(path, "r");
		if (file.isOpen.not) {
			^ScscmCompileResult.new(
				nil,
				[ScscmDiagnostic.new("compile", 0, 0, "Could not open file: {path}", path)],
				path
			)
		};
		
		var source = file.readAllString;
		file.close;
		^this.compileString(source, path)
	}

	// Compile multiple files
	compileFiles { |paths|
		^paths.collect({ |path| this.compileFile(path) })
	}

	// Normalize output (whitespace, etc.)
	normalizeOutput { |code|
		// Simple normalization: collapse multiple spaces, trim lines
		var lines = code.split($\n);
		var normalized = lines.collect({ |line|
			line.trim.replace("  +", " ")
		});
		^normalized.join("\n")
	}

	// Reset compiler state
	reset { 
		this.lexer = nil;
		this.parser = nil;
		this.expander = nil;
		this.codegen = nil;
		this.diagnostics = List.new
	}

	// Get all diagnostics as string
	getDiagnosticsString { 
		^this.diagnostics.collect({ |d| d.asString }).join("\n")
	}

	// Check if compilation was successful
	success { 
		^this.diagnostics.isEmpty
	}
}

// Compile result container
ScscmCompileResult : Object {
	var <>code, <>diagnostics, <>file, <>lexer, <>parser, <>expander, <>codegen, <>ast, <>expandedAst, <>metrics;

	*new { |code, diagnostics, file, lexer = nil, parser = nil, expander = nil, codegen = nil, ast = nil, expandedAst = nil, metrics = nil|
		^super.new.copy(
			code: code,
			diagnostics: diagnostics,
			file: file,
			lexer: lexer,
			parser: parser,
			expander: expander,
			codegen: codegen,
			ast: ast,
			expandedAst: expandedAst,
			metrics: metrics
		)
	}

	success { 
		^this.diagnostics.isEmpty
	}

	asString { 
		^"ScscmCompileResult({this.success}, {this.code ? this.code.size : 0} chars, diagnostics: {this.diagnostics.size})"
	}

	// Get full report
	getReport { 
		var sb = StringBuilder.new;
		sb.add("=== Compilation Report ===\n");
		sb.add("File: {this.file}\n");
		sb.add("Success: {this.success}\n");
		sb.add("Code length: {this.code ? this.code.size : 0}\n");
		sb.add("Diagnostics: {this.diagnostics.size}\n");
		
		if (this.diagnostics.notEmpty) {
			sb.add("\n--- Errors ---\n");
			this.diagnostics.do({ |d| sb.add("{d.asString}\n") })
		};
		
		^sb.toString
	}
}

// Convenience methods for the ScscmCompiler class

// Static compile method
ScscmCompiler.compile { |source, file = "<string>", options = nil|
	^ScscmCompiler.new(options).compileString(source, file)
}

// Static compile file method
ScscmCompiler.compileFile { |path, options = nil|
	^ScscmCompiler.new(options).compileFile(path)
}
