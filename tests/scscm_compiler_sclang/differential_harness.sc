// differential_harness.sc - Differential test harness for scscm compilers
// Phase P2: Full implementation with JS compiler comparison

ScscmDifferentialHarness : Object {
	var <>sclangCompiler, <>jsCompilerPath, <>loader, <>options, <>results, <>normalizer;

	// Constructor
	*new { |jsCompilerPath = "node", fixtureDirs = ["tests/fixtures/scscm"], options = nil|
		^super.new.init(jsCompilerPath, fixtureDirs, options)
	}

	init { |jsCompilerPath, fixtureDirs, options|
		this.jsCompilerPath = jsCompilerPath;
		this.loader = ScscmFixtureLoader.new(fixtureDirs);
		this.options = options ? (
			verbose: false,
			normalize: true,
			strict: false,
			maxDifferences: 10,
			target: "sclang",
			jsArgs: "--to-sc" // JS compiler argument for sclang output
		) ++ options;
		this.results = List.new;
		this.normalizer = ScscmNormalizer.new;
		this.sclangCompiler = ScscmCompiler.new((target: this.options[\target]));
		^this
	}

	// Run differential tests
	run { 
		this.results = List.new;
		
		// Load fixtures
		var fixtures = this.loader.loadAll;
		
		if (this.options[\verbose]) { 
			"Loaded {fixtures.size} fixtures\n".post 
		};
		
		// Run tests
		var count = 0;
		fixtures.do({ |fixture|
			var result = this.compareFixture(fixture);
			this.results = this.results.add(result);
			count = count + 1;
			
			if (this.options[\verbose]) {
				"[{count}/{fixtures.size}] {result.status}: {fixture.relPath}\n".post
			}
		});
		
		// Print summary
		this.printSummary
	}

	// Compare a single fixture
	compareFixture { |fixture|
		var start = Main.elapsedTime;
		
		// Compile with sclang compiler
		var sclangResult = this.sclangCompiler.compileString(fixture.source, fixture.fullPath);
		
		// Try to compile with JS compiler
		var jsResult = this.compileWithJs(fixture.source, fixture.fullPath);
		
		var status = "unknown";
		var sclangCode = sclangResult.code;
		var jsCode = jsResult[\code];
		var differences = List.new;
		
		// Check sclang compilation
		if (sclangResult.success.not) {
			status = "sclang_error";
			sclangResult.diagnostics.do({ |d|
				differences = differences.add("SCLANG: {d.asString}")
			});
			
			// If JS also failed, check if errors match
			if (jsResult[\success].not) {
				status = "both_error";
				if (jsResult[\error].includes("syntax") or: { sclangResult.diagnostics.any({ |d| d.message.includes("syntax") }) }) {
					// Both have syntax errors - this is a partial match
				}
			}
		} {
			// Sclang compilation succeeded
			if (jsResult[\success]) {
				// Compare outputs
				var normSclang = this.normalizer.normalizeSclang(sclangCode);
				var normJs = this.normalizer.normalizeSclang(jsCode);
				
				if (normSclang == normJs) {
					status = "match"
				} {
					status = "mismatch";
					differences = differences.add(this.getDiffInfo(fixture, normSclang, normJs))
				}
			} {
				// JS compilation failed but sclang succeeded
				status = "js_error";
				differences = differences.add("JS: {jsResult[\error]}")
			}
		};
		
		var elapsed = Main.elapsedTime - start;
		
		^ScscmDifferentialResult.new(
			fixture, 
			status, 
			sclangCode, 
			jsCode,
			differences,
			elapsed,
			sclangResult.diagnostics,
			jsResult[\error]
		)
	}

	// Compile with JS compiler via subprocess
	compileWithJs { |source, filePath|
		// Write source to temp file
		var tempFile = this.writeTempFile(source);
		
		if (tempFile.isNil) {
			^(success: false, code: nil, error: "Could not create temp file")
		};
		
		// Build command: node cli/lhc.js --to-sc <tempfile>
		var cmd = "{this.jsCompilerPath} cli/lhc.js --to-sc {tempFile}";
		
		if (this.options[\verbose]) {
			"JS command: {cmd}\n".post
		};
		
		// Execute command
		try {
			var process = Process.run(cmd, "/Users/rjungemann/Projects/hypercollider");
			var output = "";
			var errorOutput = "";
			
			// Read stdout
			while ({ process.poll.notNil }, { 
				var line = process.readLine;
				if (line.isNil) { break };
				output = output ++ line ++ "\n"
			});
			
			// Read stderr
			while ({ process.errPoll.notNil }, { 
				var line = process.errReadLine;
				if (line.isNil) { break };
				errorOutput = errorOutput ++ line ++ "\n"
			});
			
			process.wait;
			
			// Clean up temp file
			File(tempFile, "r").close;
			File.delete(tempFile);
			
			if (process.exitCode == 0) {
				^(success: true, code: output, error: nil)
			} {
				^(success: false, code: nil, error: errorOutput ? errorOutput)
			}
		} { |err|
			// Clean up temp file
			try { File.delete(tempFile) } { |e| };
			^(success: false, code: nil, error: err.asString)
		}
	}

	// Write source to temp file
	writeTempFile { |source|
		var tempName = "/tmp/scscm_test_{Main.elapsedTime.asInteger}_{1000000.rand.asInteger}.scscm";
		var file = File(tempName, "w");
		if (file.isOpen) {
			file.write(source);
			file.close;
			^tempName
		} {
			^nil
		}
	}

	// Get difference info
	getDiffInfo { |fixture, normSclang, normJs|
		var diff = this.normalizer.getDiff(normSclang, normJs, "sclang");
		if (diff.isNil) { ^"Outputs match after normalization" };
		
		^"Diff at position {diff[\position]}: expected '{diff[\expected]}', got '{diff[\actual]}' in {diff[\context]}"
	}

	// Load expected output from file (for fixtures with known output)
	loadExpectedOutput { |path|
		var file = File(path, "r");
		if (file.isOpen.not) { ^nil };
		var content = file.readAllString;
		file.close;
		^content
	}

	// Print summary of test run
	printSummary { 
		var total = this.results.size;
		var passed = this.results.select({ |r| r.status == "match" }).size;
		var sclangErrors = this.results.select({ |r| r.status == "sclang_error" }).size;
		var jsErrors = this.results.select({ |r| r.status == "js_error" }).size;
		var bothErrors = this.results.select({ |r| r.status == "both_error" }).size;
		var mismatches = this.results.select({ |r| r.status == "mismatch" }).size;
		var other = total - passed - sclangErrors - jsErrors - bothErrors - mismatches;
		
		"\n=== Differential Test Summary ===\n".post;
		"Total fixtures: {total}\n".post;
		"Passed (match): {passed}\n".post;
		"Sclang errors: {sclangErrors}\n".post;
		"JS errors: {jsErrors}\n".post;
		"Both errors: {bothErrors}\n".post;
		"Mismatches: {mismatches}\n".post;
		"Other: {other}\n".post;
		
		if (total > 0) {
			var pct = (passed / total) * 100;
			"Pass rate: {pct.round(0.1)}%\n".post
			
			// Phase P2 acceptance: >= 85% parity on MVP subset
			if (pct >= 85) {
				"✓ Phase P2 acceptance criteria MET: {pct.round(0.1)}% >= 85%\n".post
			} {
				"✗ Phase P2 acceptance criteria NOT MET: {pct.round(0.1)}% < 85%\n".post
			}
		};
		
		// Show some differences if verbose
		if (this.options[\verbose]) {
			var failed = this.results.select({ |r| r.status != "match" });
			if (failed.notEmpty) {
				"\n--- First few differences ---\n".post;
				failed.copyRange(0, failed.size.min(5) - 1).do({ |r|
					"{r.fixture.relPath}: {r.status}\n".post;
					r.differences.copyRange(0, r.differences.size.min(2) - 1).do({ |d|
						"  {d}\n".post
					})
				})
			}
		}
	}

	// Get results
	getResults { 
		^this.results
	}

	// Filter results by status
	getResultsByStatus { |status|
		^this.results.select({ |r| r.status == status })
	}

	// Get pass rate
	getPassRate { 
		var total = this.results.size;
		if (total == 0) { ^0 };
		var passed = this.results.select({ |r| r.status == "match" }).size;
		^(passed / total)
	}

	// Reset harness
	reset { 
		this.results = List.new;
		this.loader.reset;
		^this
	}
}

// Differential test result
ScscmDifferentialResult : Object {
	var <>fixture, <>status, <>sclangCode, <>jsCode, <>differences, <>elapsed, <>sclangDiagnostics, <>jsError;

	*new { |fixture, status, sclangCode = nil, jsCode = nil, differences = [], elapsed = 0, sclangDiagnostics = [], jsError = nil|
		^super.new.copy(
			fixture: fixture,
			status: status,
			sclangCode: sclangCode,
			jsCode: jsCode,
			differences: differences,
			elapsed: elapsed,
			sclangDiagnostics: sclangDiagnostics,
			jsError: jsError
		)
	}

	// Check if result represents a pass
	passed { 
		^this.status == "match"
	}

	// Check if there were any issues
	hasIssues { 
		^(this.status != "match" or: { this.differences.notEmpty })
	}

	asString { 
		^"DifferentialResult({this.fixture.relPath}: {this.status}, diffs: {this.differences.size})"
	}

	// Get full report
	getReport { 
		var sb = StringBuilder.new;
		sb.add("=== Result for {this.fixture.relPath} ===\n");
		sb.add("Status: {this.status}\n");
		sb.add("Time: {this.elapsed.round(0.001)}s\n");
		
		if (this.sclangDiagnostics.notEmpty) {
			sb.add("\nSclang diagnostics:\n");
			this.sclangDiagnostics.do({ |d| sb.add("  {d.asString}\n") })
		};
		
		if (this.jsError.notNil) {
			sb.add("\nJS error:\n");
			sb.add("  {this.jsError}\n")
		};
		
		if (this.differences.notEmpty) {
			sb.add("\nDifferences:\n");
			this.differences.do({ |d| sb.add("  {d}\n") })
		};
		
		if (this.sclangCode.notNil) {
			sb.add("\nSclang output:\n");
			sb.add("{this.sclangCode}\n")
		};
		
		if (this.jsCode.notNil) {
			sb.add("\nJS output:\n");
			sb.add("{this.jsCode}\n")
		}
		
		^sb.toString
	}
}

// Convenience function to run harness
ScscmDifferentialHarness.runTests { |jsCompilerPath = "node", fixtureDirs = ["tests/fixtures/scscm"], options = nil|
	^ScscmDifferentialHarness.new(jsCompilerPath, fixtureDirs, options).run
}

// Quick test function for a single source string
ScscmDifferentialHarness.testString { |source, jsCompilerPath = "node", options = nil|
	var harness = ScscmDifferentialHarness.new(jsCompilerPath, [], options);
	var fixture = ScscmFixture.new("<test>", "<test>", source);
	^harness.compareFixture(fixture)
}
