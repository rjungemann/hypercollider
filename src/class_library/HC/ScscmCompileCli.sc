// ScscmCompileCli.sc - CLI batch entrypoint for scscm-in-sclang compiler
// Part of Phase P0: Harness bootstrap

ScscmCompileCli : Object {
	var <>compiler, <>options, <>stats;

	// Default CLI options
	*defaultOptions { 
		^(
			verbose: false,
			quiet: false,
			outputDir: ".",
			compare: false,
			jsCompilerPath: "node",
			normalize: true,
			metrics: false,
			help: false
		)
	}

	// Constructor
	*new { |options = nil|
		^super.new.init(options ? options ! this.class.defaultOptions)
	}

	init { |options|
		this.options = options;
		this.compiler = ScscmCompiler.new;
		this.stats = (
			filesProcessed: 0,
			filesSuccess: 0,
			filesFailed: 0,
			totalTime: 0,
			startTime: nil,
			endTime: nil
		);
		^this
	}

	// Main entry point
	run { |args|
		var result = this.parseArgs(args);
		if (result[\help] or: { result[\error].notNil }) {
			this.printHelp(result[\error]);
			^1
		};
		
		this.options = this.options.copy(verbose: result[\verbose], 
			quiet: result[\quiet], 
			outputDir: result[\outputDir],
			compare: result[\compare],
			jsCompilerPath: result[\jsCompilerPath],
			normalize: result[\normalize],
			metrics: result[\metrics]);
		
		var files = result[\files];
		
		if (files.isEmpty) {
			this.printHelp("No input files specified");
			^1
		};
		
		this.stats = this.stats.copy(
			startTime: Main.elapsedTime,
			filesProcessed: 0,
			filesSuccess: 0,
			filesFailed: 0,
			totalTime: 0
		);
		
		// Process each file
		files.do({ |file|
			this.processFile(file)
		});
		
		this.stats = this.stats.copy(endTime: Main.elapsedTime);
		
		// Print summary
		if (this.options[\metrics] or: { this.options[\verbose] }) {
			this.printSummary
		};
		
		^(this.stats[\filesFailed] > 0 ? 1 : 0)
	}

	// Parse command line arguments
	parseArgs { |args|
		var result = (
			verbose: this.options[\verbose],
			quiet: this.options[\quiet],
			outputDir: this.options[\outputDir],
			compare: this.options[\compare],
			jsCompilerPath: this.options[\jsCompilerPath],
			normalize: this.options[\normalize],
			metrics: this.options[\metrics],
			help: this.options[\help],
			files: List.new,
			error: nil
		);
		
		var i = 0;
		while ({ i < args.size }, { 
			var arg = args[i];
			
			arg == "-v" or: { arg == "--verbose" } ? { result = result.copy(verbose: true) };
			arg == "-q" or: { arg == "--quiet" } ? { result = result.copy(quiet: true) };
			arg == "-o" or: { arg == "--output" } ? { 
				i = i + 1;
				if (i >= args.size) { result = result.copy(error: "Missing output directory"); break };
				result = result.copy(outputDir: args[i])
			};
			arg == "-c" or: { arg == "--compare" } ? { result = result.copy(compare: true) };
			arg == "--js" ? { 
				i = i + 1;
				if (i >= args.size) { result = result.copy(error: "Missing JS compiler path"); break };
				result = result.copy(jsCompilerPath: args[i])
			};
			arg == "--no-normalize" ? { result = result.copy(normalize: false) };
			arg == "-m" or: { arg == "--metrics" } ? { result = result.copy(metrics: true) };
			arg == "-h" or: { arg == "--help" } ? { result = result.copy(help: true) };
			arg.beginsWith("-") ? { result = result.copy(error: "Unknown option: {arg}") };
			{ result = result.copy(files: result[\files].add(arg)) };
			
			i = i + 1
		});
		
		^result
	}

	// Process a single file
	processFile { |path|
		var start = Main.elapsedTime;
		
		if (this.options[\verbose] and: { this.options[\quiet].not }) {
			"Processing: {path}".postln
		};
		
		// Read file
		var file = File(path, "r");
		if (file.isOpen.not) {
			"Error: Could not open file {path}".postln;
			this.stats = this.stats.copy(filesFailed: this.stats[\filesFailed] + 1);
			^this
		};
		
		var source = file.readAllString;
		file.close;
		
		// Compile with sclang compiler
		var result = this.compiler.compileString(source, path);
		
		this.stats = this.stats.copy(
			filesProcessed: this.stats[\filesProcessed] + 1,
			totalTime: this.stats[\totalTime] + (Main.elapsedTime - start)
		);
		
		if (result.success) {
			this.stats = this.stats.copy(filesSuccess: this.stats[\filesSuccess] + 1);
			
			// Write output if requested
			if (this.options[\outputDir].notNil) {
				var outPath = PathName(this.options[\outputDir]).join(PathName(path).fileName ++ ".sclang");
				var outFile = File(outPath, "w");
				if (outFile.isOpen) {
					outFile.write(result.code);
					outFile.close;
					if (this.options[\verbose]) { "Wrote: {outPath}".postln }
				} {
					"Error: Could not write to {outPath}".postln
				}
			}
			
			// Compare with JS compiler if requested
			if (this.options[\compare]) {
				this.compareWithJsCompiler(path, source, result.code)
			}
			
			if (this.options[\quiet].not) {
				"OK: {path}".postln
			}
		} {
			this.stats = this.stats.copy(filesFailed: this.stats[\filesFailed] + 1);
			
			if (this.options[\quiet].not) {
				"FAIL: {path}".postln;
				if (result.diagnostics.notEmpty) {
					result.diagnostics.do({ |d| d.asString.postln })
				}
			}
		}
		
		^this
	}

	// Compare with JS compiler
	compareWithJsCompiler { |path, source, sclangOutput|
		// For now, this is a placeholder
		// In Phase P1/P2, this will invoke the JS compiler and compare
		"Comparing with JS compiler (not yet implemented)".postln;
		
		// TODO: Implement actual comparison logic
		// 1. Call JS compiler via subprocess
		// 2. Get JS output
		// 3. Normalize both outputs
		// 4. Compare and report differences
		
		^this
	}

	// Print help
	printHelp { |error = nil|
		if (error.notNil) { "Error: {error}\n\n".post };
		
		"scscm-in-sclang compiler - Phase P0\n".post;
		"\n".post;
		"Usage: sclang -i <this_file> [options] <files...>\n".post;
		"\n".post;
		"Options:\n".post;
		"  -v, --verbose       Show detailed output\n".post;
		"  -q, --quiet         Suppress non-error output\n".post;
		"  -o, --output DIR    Write output to directory DIR\n".post;
		"  -c, --compare       Compare output with JS compiler\n".post;
		"  --js PATH           Path to JS compiler (node)\n".post;
		"  --no-normalize      Don't normalize output for comparison\n".post;
		"  -m, --metrics       Show processing metrics\n".post;
		"  -h, --help          Show this help message\n".post;
		"\n".post;
		"Examples:\n".post;
		"  sclang -i ScscmCompileCli.sc -v myfile.scscm\n".post;
		"  sclang -i ScscmCompileCli.sc --compare --js node myfile.scscm\n".post
	}

	// Print summary statistics
	printSummary { 
		"\n=== Summary ===\n".post;
		"Files processed: {this.stats[\filesProcessed]}\n".post;
		"Files succeeded: {this.stats[\filesSuccess]}\n".post;
		"Files failed: {this.stats[\filesFailed]}\n".post;
		"Total time: {this.stats[\totalTime].round(0.001)} seconds\n".post;
		
		if (this.stats[\filesProcessed] > 0) {
			var avgTime = this.stats[\totalTime] / this.stats[\filesProcessed];
			"Average time: {avgTime.round(0.001)} seconds/file\n".post
		}
	}

	// Reset statistics
	resetStats { 
		this.stats = this.stats.copy(
			filesProcessed: 0,
			filesSuccess: 0,
			filesFailed: 0,
			totalTime: 0,
			startTime: nil,
			endTime: nil
		);
		^this
	}
}

// Entry point for CLI usage
// To use from sclang:
//   sclang -i src/class_library/HC/ScscmCompileCli.sc file1.scscm file2.scscm

// Check if we're being run as a script
if (Main.args.notNil and: { Main.args.size > 0 }) {
	var cli = ScscmCompileCli.new;
	var result = cli.run(Main.args);
	SystemExit.exit(result)
}
