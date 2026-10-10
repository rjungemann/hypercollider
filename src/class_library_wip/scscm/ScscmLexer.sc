// ScscmLexer.sc - Lexer for scscm-in-sclang compiler
// Phase P1: Full implementation

ScscmLexer : Object {
	var <>source, <>position, <>line, <>column, <>file, <>tokens, <>currentChar;

	// Special single-character tokens
	*const { 
		\leftParen = $(
		\rightParen = $)
		\leftBracket = $[ 
		\rightBracket = $]
		\leftBrace = ${ 
		\rightBrace = $}
		\singleQuote = $'
		\backQuote = $`
		\comma = $,
		\at = $@
		\semicolon = $;
		\doubleQuote = $"
		\backslash = $\
	};

	// Constructor
	*new { |source = "", file = ""|
		^super.new.init(source, file)
	}

	init { |source, file|
		this.source = source;
		this.file = file;
		this.position = 0;
		this.line = 1;
		this.column = 1;
		this.tokens = List.new;
		this.currentChar = (source.size > 0 ? source[0] : nil);
		^this
	}

	// Main lexing method - returns array of tokens
	lex { 
		this.tokens = List.new;
		this.position = 0;
		this.line = 1;
		this.column = 1;
		this.currentChar = (this.source.size > 0 ? this.source[0] : nil);
		
		this.advance; // Move to first char
		
		while ({ this.currentChar.notNil }, { 
			this.skipWhitespace;
			if (this.currentChar.isNil) { break };
			this.tokenizeCurrent
		});
		
		this.tokens = this.tokens.add(ScscmToken.new(ScscmToken.const[\eof], nil, this.line, this.column, this.file));
		^this.tokens
	}

	// Tokenize current character
	tokenizeCurrent { 
		var char = this.currentChar;
		
		// Structural tokens - single character
		char == this.class.const[\leftParen] ? { this.emitToken(ScscmToken.const[\leftParen]) };
		char == this.class.const[\rightParen] ? { this.emitToken(ScscmToken.const[\rightParen]) };
		char == this.class.const[\leftBracket] ? { this.emitToken(ScscmToken.const[\leftBracket]) };
		char == this.class.const[\rightBracket] ? { this.emitToken(ScscmToken.const[\rightBracket]) };
		
		// Quote and quasiquote
		char == this.class.const[\singleQuote] ? { this.emitToken(ScscmToken.const[\quote]) };
		char == this.class.const[\backQuote] ? { this.emitToken(ScscmToken.const[\quasiquote]) };
		
		// Unquote and unquote-splicing (multi-char: , and ,@)
		char == this.class.const[\comma] ? { this.lexComma };
		
		// String literals
		char == this.class.const[\doubleQuote] ? { this.lexString };
		
		// Comments (line comments starting with ;)
		char == this.class.const[\semicolon] ? { this.lexComment };
		
		// Numbers (integers and floats, with optional sign)
		(this.isDigit(char) or: { this.isSign(char) }) ? { this.lexNumber };
		
		// Symbols and keywords
		this.isSymbolStart(char) ? { this.lexSymbolOrKeyword };
		
		// Unknown character - emit error diagnostic
		{ 
			this.tokens = this.tokens.add(
				ScscmToken.new(ScscmToken.const[\symbol], char.asString, this.line, this.column, this.file)
			);
			this.advance
		}
	}

	// Handle comma (unquote) and ,@ (unquote-splicing)
	lexComma { 
		this.advance;
		if (this.currentChar == this.class.const[\at]) {
			this.emitToken(ScscmToken.const[\unquoteSplicing], ",@")
		} {
			this.emitToken(ScscmToken.const[\unquote], ",")
		}
	}

	// Lex a string literal
	lexString { 
		var sb = StringBuilder.new;
		this.advance; // Skip opening quote
		var startLine = this.line;
		var startCol = this.column;
		
		while ({ this.currentChar.notNil and: { this.currentChar != this.class.const[\doubleQuote] } }, { 
			if (this.currentChar == this.class.const[\backslash]) {
				// Handle escape sequences
				this.advance;
				if (this.currentChar.isNil) {
					// Unterminated escape - report and break
					break
				};
				// Handle common escape sequences
				var esc = this.currentChar;
				case
				{ esc == $n } { sb.add($\n) }
				{ esc == $t } { sb.add($\t) }
				{ esc == $r } { sb.add($\r) }
				{ esc == $\ } { sb.add($\\) }
				{ esc == $" } { sb.add($\") }
				{ true } { sb.add(esc) } // Pass through unknown escapes
				;
				this.advance
			} {
				sb.add(this.currentChar);
				this.advance
			}
		});
		
		if (this.currentChar.isNil) {
			// Unterminated string - emit error token
			this.tokens = this.tokens.add(
				ScscmToken.new(ScscmToken.const[\string], sb.toString, startLine, startCol, this.file)
			)
		} {
			this.emitToken(ScscmToken.const[\string], sb.toString);
		}
	}

	// Lex a comment (from ; to end of line)
	lexComment { 
		var sb = StringBuilder.new;
		this.advance; // Skip semicolon
		
		while ({ this.currentChar.notNil and: { this.currentChar != Char.nl and: { this.currentChar != Char.cr } } }, { 
			sb.add(this.currentChar);
			this.advance
		});
		
		// Emit comment token (can be filtered out later)
		this.tokens = this.tokens.add(
			ScscmToken.new(ScscmToken.const[\comment], sb.toString, this.line, this.column, this.file)
		);
		// Don't advance - the newline will be handled by skipWhitespace
	}

	// Lex a number (integer or float, with optional sign and exponent)
	lexNumber { 
		var sb = StringBuilder.new;
		var startLine = this.line;
		var startCol = this.column;
		var isFloat = false;
		
		// Optional sign
		if (this.isSign(this.currentChar)) {
			sb.add(this.currentChar);
			this.advance
		};
		
		// Integer part (must have at least one digit)
		if (this.isDigit(this.currentChar).not) {
			// Just a sign, not a number - treat as symbol
			this.tokens = this.tokens.add(
				ScscmToken.new(ScscmToken.const[\symbol], sb.toString, startLine, startCol, this.file)
			);
			^this
		};
		
		while ({ this.currentChar.notNil and: { this.isDigit(this.currentChar) } }, { 
			sb.add(this.currentChar);
			this.advance
		});
		
		// Float part
		if (this.currentChar == $.) {
			sb.add(this.currentChar);
			this.advance;
			isFloat = true;
			while ({ this.currentChar.notNil and: { this.isDigit(this.currentChar) } }, { 
				sb.add(this.currentChar);
				this.advance
			})
		};
		
		// Exponent part
		if (this.currentChar == $e or: { this.currentChar == $E }) {
			sb.add(this.currentChar);
			this.advance;
			isFloat = true;
			
			// Optional sign
			if (this.isSign(this.currentChar)) {
				sb.add(this.currentChar);
				this.advance
			};
			
			// Must have digits after exponent
			if (this.isDigit(this.currentChar).not) {
				// Invalid exponent - rollback
				this.tokens = this.tokens.add(
					ScscmToken.new(ScscmToken.const[\symbol], sb.toString, startLine, startCol, this.file)
				);
				^this
			};
			
			while ({ this.currentChar.notNil and: { this.isDigit(this.currentChar) } }, { 
				sb.add(this.currentChar);
				this.advance
			})
		};
		
		this.emitToken(ScscmToken.const[\number], sb.toString)
	}

	// Lex a symbol or keyword
	lexSymbolOrKeyword { 
		var sb = StringBuilder.new;
		var startLine = this.line;
		var startCol = this.column;
		
		while ({ this.currentChar.notNil and: { this.isSymbolChar(this.currentChar) } }, { 
			sb.add(this.currentChar);
			this.advance
		});
		
		var value = sb.toString;
		
		// Check for special literals
		value == "true" ? { this.emitToken(ScscmToken.const[\boolean], "true") };
		value == "false" ? { this.emitToken(ScscmToken.const[\boolean], "false") };
		value == "nil" ? { this.emitToken(ScscmToken.const[\nil], "nil") };
		
		// Keywords start with :
		value.beginsWith(":") ? { 
			this.emitToken(ScscmToken.const[\keyword], value)
		} {
			// Regular symbol
			this.emitToken(ScscmToken.const[\symbol], value)
		}
	}

	// Emit a token
	emitToken { |type, value = nil|
		value = value ? this.currentChar.asString;
		this.tokens = this.tokens.add(ScscmToken.new(type, value, this.line, this.column, this.file));
		this.advance
	}

	// Advance to next character
	advance { 
		if (this.position >= this.source.size) {
			this.currentChar = nil;
			^this
		};
		var char = this.source[this.position];
		this.position = this.position + 1;
		
		// Update line/column tracking
		if (char == Char.nl) {
			this.line = this.line + 1;
			this.column = 1;
		} {
			if (char == Char.cr) {
				// Handle CR (don't increment line if followed by LF)
				if (this.position < this.source.size and: { this.source[this.position] == Char.nl }) {
					// CRLF sequence - skip the LF
					this.position = this.position + 1
				} {
					this.line = this.line + 1;
					this.column = 1
				}
			} {
				this.column = this.column + 1
			}
		};
		
		this.currentChar = (this.position < this.source.size ? this.source[this.position] : nil);
		^this
	}

	// Skip whitespace characters
	skipWhitespace { 
		while ({ this.currentChar.notNil and: { this.isWhitespace(this.currentChar) } }, { 
			this.advance
		})
	}

	// Character classification
	isWhitespace { |char|
		^(char == Char.space or: { char == Char.tab or: { char == Char.nl or: { char == Char.cr } } })
	}

	isDigit { |char|
		^char >= $0 and: { char <= $9 }
	}

	isSign { |char|
		^(char == $+ or: { char == $- })
	}

	isSymbolStart { |char|
		// First character of a symbol: letter, underscore, or special chars
		^(this.isAlpha(char) or: { char == $_ or: { this.isSpecialSymbolStart(char) } })
	}

	isSymbolChar { |char|
		// Subsequent characters in a symbol
		^(this.isAlnum(char) or: { this.isSpecialSymbolChar(char) })
	}

	isAlpha { |char|
		^(char >= $a and: { char <= $z }) or: { char >= $A and: { char <= $Z } }
	}

	isAlnum { |char|
		^(this.isAlpha(char) or: { this.isDigit(char) })
	}

	isSpecialSymbolStart { |char|
		// Characters that can start a symbol
		var specials = "!#$%&*+-./:<=>?@^_~";
		^specials.includes(char)
	}

	isSpecialSymbolChar { |char|
		// Characters that can appear in a symbol (after first char)
		var specials = "!#$%&*+-./:<=>?@^_~";
		^(specials.includes(char) or: { char == $+ or: { char == $- } })
	}

	// Reset lexer for reuse
	reset { 
		this.source = "";
		this.position = 0;
		this.line = 1;
		this.column = 1;
		this.file = "";
		this.tokens = List.new;
		this.currentChar = nil;
		^this
	}

	// Set new source and reset
	setSource { |source, file = ""|
		this.source = source;
		this.file = file;
		this.reset;
		^this
	}

	// Get current position info
	getPosition { 
		^(this.line, this.column, this.position)
	}

	// Get tokens count
	tokenCount { 
		^this.tokens.size
	}
}
