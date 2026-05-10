// normalizer.sc - Output normalization for differential testing
// Phase P2: Normalization pass for deterministic output comparison

ScscmNormalizer : Object {
	// Normalization options
	*defaultOptions { 
		^(
			trimWhitespace: true,
			collapseSpaces: true,
			removeComments: true,
			normalizeNumbers: true,
			reorderForms: false
		)
	}

	*new { |options = nil|
		^super.new.copy(options: options ? options ! this.class.defaultOptions)
	}

	// Normalize scscm code
	normalizeScscm { |code|
		if (code.isNil) { ^"" };
		
		// Step 1: Remove comments
		var noComments = this.removeScscmComments(code);
		
		// Step 2: Collapse whitespace
		var collapsed = this.collapseWhitespace(noComments);
		
		// Step 3: Normalize specific patterns
		var normalized = this.normalizeScscmPatterns(collapsed);
		
		^normalized
	}

	// Normalize sclang code
	normalizeSclang { |code|
		if (code.isNil) { ^"" };
		
		// Step 1: Remove C-style comments (/* ... */)
		var noComments = this.removeSclangComments(code);
		
		// Step 2: Collapse whitespace
		var collapsed = this.collapseWhitespace(noComments);
		
		// Step 3: Normalize specific patterns
		var normalized = this.normalizeSclangPatterns(collapsed);
		
		^normalized
	}

	// Remove scscm line comments (; ...)
	removeScscmComments { |code|
		var lines = code.split($\n);
		^lines.collect({ |line|
			var commentIdx = line.find($;);
			if (commentIdx.notNil) {
				line.copyRange(0, commentIdx - 1).trim
			} {
				line.trim
			}
		}).join(" ")
	}

	// Remove sclang comments (// and /* ... */)
	removeSclangComments { |code|
		// Remove // comments
		var noLineComments = code.split($\n).collect({ |line|
			var commentIdx = line.find("//");
			if (commentIdx.notNil) {
				line.copyRange(0, commentIdx - 1)
			} { line }
		}).join("\n");
		
		// Remove /* ... */ comments
		var noBlockComments = this.removeBlockComments(noLineComments);
		
		^noBlockComments
	}

	removeBlockComments { |code|
		var result = StringBuilder.new;
		var i = 0;
		
		while ({ i < code.size }, { 
			var idx = code.find("/*", i);
			if (idx.isNil) {
				result.add(code.drop(i));
				break
			};
			
			result.add(code.copyRange(i, idx - 1));
			
			var endIdx = code.find("*/", idx + 2);
			if (endIdx.isNil) {
				// Unterminated comment - skip it
				result.add(code.drop(idx + 2));
				break
			};
			
			i = endIdx + 2
		});
		
		^result.toString
	}

	// Collapse whitespace
	collapseWhitespace { |code|
		// Replace newlines and multiple spaces with single space
		^code.replace("\s+", " ").trim
	}

	// Normalize scscm-specific patterns
	normalizeScscmPatterns { |code|
		var result = code;
		
		// Normalize parentheses spacing: (a b) -> (a b) (already collapsed)
		// Normalize list formatting
		
		// Remove extra spaces in specific contexts
		result = result.replace("(", "(").replace(") ", ")");
		
		// Normalize numbers (remove leading zeros, standardize floats)
		if (this.options[\normalizeNumbers]) {
			result = this.normalizeNumbers(result)
		};
		
		^result
	}

	// Normalize sclang-specific patterns
	normalizeSclangPatterns { |code|
		var result = code;
		
		// Normalize braces: { |x| x } -> {|x| x}
		result = result.replace("\{ \|", "{| ").replace("\| ", "|");
		
		// Remove spaces around certain operators in some contexts
		// This is tricky - we want to preserve meaning while normalizing
		
		// Normalize numbers
		if (this.options[\normalizeNumbers]) {
			result = this.normalizeNumbers(result)
		};
		
		^result
	}

	// Normalize number representations
	normalizeNumbers { |code|
		// Find and normalize number literals
		// This is a simple approach - for more robust handling, use a proper tokenizer
		
		// Replace patterns like +5 with 5
		var result = code;
		result = result.replace("+([0-9])", "\1");
		
		// Standardize float representations (remove trailing .0)
		// This is risky without proper parsing, so skip for now
		
		^result
	}

	// More sophisticated normalization: tokenize, normalize, re-serialize
	normalizeByTokens { |code, target = "scscm"|
		// Tokenize the code
		var lexer = ScscmLexer.new(code);
		var tokens = lexer.lex;
		
		// Normalize tokens
		var normalizedTokens = tokens.collect({ |t|
			// Skip comments and whitespace
			if (t.type == ScscmToken.const[\comment] or: { t.type == ScscmToken.const[\whitespace] }) {
				^nil
			};
			
			// Normalize numbers
			if (t.type == ScscmToken.const[\number]) {
				^ScscmToken.new(t.type, this.normalizeNumberString(t.value), t.line, t.col, t.file)
			};
			
			// Normalize symbols (lowercase, etc.)
			if (t.type == ScscmToken.const[\symbol]) {
				^ScscmToken.new(t.type, t.value.asString, t.line, t.col, t.file)
			};
			
			^t
		}).select({ |t| t.notNil });
		
		// Reconstruct code from tokens
		var sb = StringBuilder.new;
		var prevType = nil;
		
		normalizedTokens.do({ |t, i|
			// Add space between certain token types
			if (prevType.notNil) {
				if (this.needsSpace(prevType, t.type, target)) {
					sb.add(" ")
				}
			};
			
			sb.add(t.value ? t.value.asString);
			prevType = t.type
		});
		
		^sb.toString
	}

	normalizeNumberString { |numStr|
		// Try to parse and re-serialize
		try {
			var num = numStr.asFloat;
			// If it's a whole number, serialize as integer
			if (num == num.asInteger) {
				^num.asInteger.asString
			} {
				// Standard float format
				^num.asString
			}
		} { |err|
			^numStr // Return as-is if parsing fails
		}
	}

	needsSpace { |prevType, currType, target|
		// In scscm: space between most tokens except parentheses
		if (target == "scscm") {
			^(prevType != ScscmToken.const[\leftParen] 
				and: { prevType != ScscmToken.const[\rightParen] }
				and: { currType != ScscmToken.const[\rightParen] }
				and: { currType != ScscmToken.const[\leftParen] })
		};
		
		// In sclang: more complex rules
		^true
	}

	// Compare two normalized strings
	compare { |a, b, target = "scscm"|
		var normA = (target == "scscm" ? this.normalizeScscm(a) : this.normalizeSclang(a));
		var normB = (target == "scscm" ? this.normalizeScscm(b) : this.normalizeSclang(b));
		
		^(normA == normB)
	}

	// Get difference between two normalized strings
	getDiff { |a, b, target = "scscm"|
		var normA = (target == "scscm" ? this.normalizeScscm(a) : this.normalizeSclang(a));
		var normB = (target == "scscm" ? this.normalizeScscm(b) : this.normalizeSclang(b));
		
		if (normA == normB) { ^nil };
		
		// Find first difference
		var minLen = normA.size.min(normB.size);
		var i = 0;
		while ({ i < minLen and: { normA[i] == normB[i] } }, { i = i + 1 });
		
		^(
			position: i,
			expected: (i < normB.size ? normB[i].asString : "<end>"),
			actual: (i < normA.size ? normA[i].asString : "<end>"),
			context: "...{normA.copyRange(i.max(0) - 20, i + 20)}..."
		)
	}
}

// Convenience functions

// Normalize scscm code
ScscmNormalizer.normalizeScscm { |code|
	^ScscmNormalizer.new.normalizeScscm(code)
}

// Normalize sclang code
ScscmNormalizer.normalizeSclang { |code|
	^ScscmNormalizer.new.normalizeSclang(code)
}

// Compare two code strings
ScscmNormalizer.compare { |a, b, target = "scscm"|
	^ScscmNormalizer.new.compare(a, b, target)
}
