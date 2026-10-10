// ScscmToken.sc - Token model for scscm-in-sclang compiler
// Part of Phase P0: Harness bootstrap

ScscmToken : Object {
	var <>type, <>value, <>line, <>col, <>file;

	// Token types
	*const { 
		// Structural
		\leftParen = \leftParen.asSymbol,
		\rightParen = \rightParen.asSymbol,
		\leftBracket = \leftBracket.asSymbol,
		\rightBracket = \rightBracket.asSymbol,
		
		// Atoms
		\symbol = \symbol.asSymbol,
		\number = \number.asSymbol,
		\string = \string.asSymbol,
		\boolean = \boolean.asSymbol,
		\nil = \nil.asSymbol,
		
		// Keywords/identifiers
		\keyword = \keyword.asSymbol,
		\identifier = \identifier.asSymbol,
		
		// Special
		\quote = \quote.asSymbol,
		\quasiquote = \quasiquote.asSymbol,
		\unquote = \unquote.asSymbol,
		\unquoteSplicing = \unquoteSplicing.asSymbol,
		
		// Whitespace/comments (can be skipped or preserved)
		\whitespace = \whitespace.asSymbol,
		\comment = \comment.asSymbol,
		
		// End of file
		\eof = \eof.asSymbol
	};

	// Constructor
	*new { |type, value, line = 0, col = 0, file = ""|
		^super.new.copy(type: type, value: value, line: line, col: col, file: file)
	}

	// String representation
	asString { 
		^"ScscmToken({type}, {value}, {line}:{col})"
	}

	// Equality check
	== { |that|
		^(that.isKindOf(ScscmToken) 
			and: { this.type == that.type }
			and: { this.value == that.value })
	}

	// Hash for use in sets/dictionaries
	hash { 
		^this.type.hash + (this.value.hash * 31)
	}

	// Check if token is a specific type
	isType { |tokenType|
		^this.type == tokenType
	}

	// Position info
	positionString { 
		^"{this.file}:{this.line}:{this.col}"
	}
}
