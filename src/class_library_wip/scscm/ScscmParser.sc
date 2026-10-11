// ScscmParser.sc - Parser for scscm-in-sclang compiler
// Phase P1: Full implementation

ScscmParser : Object {
	var <>lexer, <>tokens, <>tokenIndex, <>currentToken, <>diagnostics, <>file;

	// Constructor - takes a lexer
	*new { |lexer|
		^super.new.init(lexer)
	}

	init { |lexer|
		this.lexer = lexer;
		this.tokens = lexer.lex;
		this.tokenIndex = 0;
		this.currentToken = (this.tokens.size > 0 ? this.tokens[0] : nil);
		this.diagnostics = List.new;
		this.file = lexer.file;
		^this
	}

	// Static method to parse a string directly
	*parseString { |source, file = "<string>"|
		var lexer = ScscmLexer.new(source, file);
		^this.class.new(lexer).parse
	}

	// Main parse method
	parse { 
		var forms = this.parseFormsUntil(ScscmToken.const[\eof]);
		^ScscmParseResult.new(forms, this.diagnostics, this.file)
	}

	// Parse forms until a specific token type
	parseFormsUntil { |stopType|
		var forms = List.new;
		
		while ({ this.currentToken.notNil and: { this.currentToken.type != stopType } }, { 
			// Skip comments
			if (this.currentToken.type == ScscmToken.const[\comment]) {
				this.advance;
				continue
			};
			
			// Skip whitespace tokens if present
			if (this.currentToken.type == ScscmToken.const[\whitespace]) {
				this.advance;
				continue
			};
			
			if (this.currentToken.type == ScscmToken.const[\eof]) {
				break
			};
			
			var form = this.parseForm;
			if (form.notNil) {
				forms = forms.add(form)
			}
		});
		
		^forms
	}

	// Parse a single form
	parseForm { 
		var token = this.currentToken;
		
		if (token.isNil) {
			this.addDiagnostic(token, "Unexpected end of input");
			^nil
		};
		
		// Handle special prefix tokens
		token.type == ScscmToken.const[\quote] ? { ^this.parseQuoted };
		token.type == ScscmToken.const[\quasiquote] ? { ^this.parseQuasiquoted };
		token.type == ScscmToken.const[\unquote] ? { ^this.parseUnquoted(false) };
		token.type == ScscmToken.const[\unquoteSplicing] ? { ^this.parseUnquoted(true) };
		
		// Handle list
		token.type == ScscmToken.const[\leftParen] ? { ^this.parseList };
		
		// Handle square bracket (treat as list for now, or as array)
		token.type == ScscmToken.const[\leftBracket] ? { ^this.parseBracketList };
		
		// Handle atoms (everything else)
		^this.parseAtom
	}

	// Parse quoted form: 'form
	parseQuoted { 
		var token = this.currentToken;
		this.advance; // Skip quote token
		
		if (this.currentToken.isNil or: { this.currentToken.type == ScscmToken.const[\eof] }) {
			this.addDiagnostic(token, "Quoted form missing expression");
			^nil
		};
		
		var expr = this.parseForm;
		if (expr.isNil) {
			this.addDiagnostic(token, "Invalid quoted form");
			^nil
		};
		
		^ScscmAstQuoted.new(expr, token.line, token.col, token.file)
	}

	// Parse quasiquoted form: `form
	parseQuasiquoted { 
		var token = this.currentToken;
		this.advance; // Skip quasiquote token
		
		if (this.currentToken.isNil or: { this.currentToken.type == ScscmToken.const[\eof] }) {
			this.addDiagnostic(token, "Quasiquoted form missing expression");
			^nil
		};
		
		var expr = this.parseForm;
		if (expr.isNil) {
			this.addDiagnostic(token, "Invalid quasiquoted form");
			^nil
		};
		
		^ScscmAstQuasiquoted.new(expr, token.line, token.col, token.file)
	}

	// Parse unquoted form: ,expr or ,@expr
	parseUnquoted { |splicing|
		var token = this.currentToken;
		this.advance; // Skip unquote token
		
		if (this.currentToken.isNil or: { this.currentToken.type == ScscmToken.const[\eof] }) {
			this.addDiagnostic(token, "Unquoted form missing expression");
			^nil
		};
		
		var expr = this.parseForm;
		if (expr.isNil) {
			this.addDiagnostic(token, "Invalid unquoted form");
			^nil
		};
		
		^ScscmAstUnquoted.new(expr, splicing, token.line, token.col, token.file)
	}

	// Parse a parenthesized list: ( ... )
	parseList { 
		var startToken = this.currentToken;
		this.advance; // Skip left paren
		
		var elements = List.new;
		
		while ({ this.currentToken.notNil and: { this.currentToken.type != ScscmToken.const[\rightParen] } }, { 
			// Skip comments
			if (this.currentToken.type == ScscmToken.const[\comment]) {
				this.advance;
				continue
			};
			
			if (this.currentToken.type == ScscmToken.const[\eof]) {
				this.addDiagnostic(startToken, "Unterminated list starting at {startToken.positionString}");
				^nil
			};
			
			var form = this.parseForm;
			if (form.isNil) {
				break
			};
				elements = elements.add(form)
		});
		
		if (this.currentToken.isNil or: { this.currentToken.type != ScscmToken.const[\rightParen] }) {
			this.addDiagnostic(startToken, "Expected closing parenthesis");
			^nil
		};
		
		this.advance; // Skip right paren
		
		// Check if this is a special form
		if (elements.notEmpty) {
			var first = elements[0];
			if (first.isKindOf(ScscmAstSymbol)) {
				return this.parseSpecialForm(elements, startToken)
			}
		}
		
		^ScscmAstList.new(elements, startToken.line, startToken.col, startToken.file)
	}

	// Parse a bracket list: [ ... ]
	parseBracketList { 
		var startToken = this.currentToken;
		this.advance; // Skip left bracket
		
		var elements = List.new;
		
		while ({ this.currentToken.notNil and: { this.currentToken.type != ScscmToken.const[\rightBracket] } }, { 
			// Skip comments
			if (this.currentToken.type == ScscmToken.const[\comment]) {
				this.advance;
				continue
			};
			
			if (this.currentToken.type == ScscmToken.const[\eof]) {
				this.addDiagnostic(startToken, "Unterminated bracket list starting at {startToken.positionString}");
				^nil
			};
			
			var form = this.parseForm;
			if (form.isNil) {
				break
			};
				elements = elements.add(form)
		});
		
		if (this.currentToken.isNil or: { this.currentToken.type != ScscmToken.const[\rightBracket] }) {
			this.addDiagnostic(startToken, "Expected closing bracket");
			^nil
		};
		
		this.advance; // Skip right bracket
		
		// Bracket lists are typically used for arrays/vectors in scscm
		^ScscmAstList.new(elements, startToken.line, startToken.col, startToken.file)
	}

	// Parse special forms
	parseSpecialForm { |elements, token|
		var first = elements[0];
		var name = first.value.asString;
		
		// Must have at least the name
		if (elements.size < 1) {
			this.addDiagnostic(token, "Special form '{name}' requires arguments");
			^nil
		};
		
		// Dispatch to specific parsers
		name == "def" ? { ^this.parseDef(elements, token) };
		name == "let" ? { ^this.parseLet(elements, token) };
		name == "var" ? { ^this.parseVar(elements, token) };
		name == "set!" ? { ^this.parseSet(elements, token) };
		name == "fn" ? { ^this.parseFn(elements, token) };
		name == "if" ? { ^this.parseIf(elements, token) };
		name == "when" ? { ^this.parseWhen(elements, token) };
		name == "unless" ? { ^this.parseUnless(elements, token) };
		name == "cond" ? { ^this.parseCond(elements, token) };
		name == "defsynth" ? { ^this.parseDefsynth(elements, token) };
		name == "defn" ? { ^this.parseDefn(elements, token) };
		name == "defmacro" ? { ^this.parseDefmacro(elements, token) };
		name == "do" ? { ^this.parseDo(elements, token) };
		name == "loop" ? { ^this.parseLoop(elements, token) };
		name == "recur" ? { ^this.parseRecur(elements, token) };
		
		// If not a known special form, treat as function call
		^ScscmAstCall.new(first, elements.copyRange(1, elements.size - 1), 
			token.line, token.col, token.file)
	}

	// Parse def: (def name value)
	parseDef { |elements, token|
		if (elements.size < 3) {
			this.addDiagnostic(token, "def requires name and value");
			^nil
		};
		
		var name = elements[1];
		if (name.isKindOf(ScscmAstSymbol).not) {
			this.addDiagnostic(token, "def name must be a symbol, got {name.class.name}");
			^nil
		};
		
		var value = elements[2];
		
		^ScscmAstDef.new(name, value, token.line, token.col, token.file)
	}

	// Parse var: (var name value)
	parseVar { |elements, token|
		if (elements.size != 3) {
			this.addDiagnostic(token, "var requires name and initial value");
			^nil
		};
		
		var name = elements[1];
		if (name.isKindOf(ScscmAstSymbol).not) {
			this.addDiagnostic(token, "var name must be a symbol");
			^nil
		};
		
		^ScscmAstDef.new(name, elements[2], token.line, token.col, token.file)
	}

	// Parse set!: (set! name value)
	parseSet { |elements, token|
		if (elements.size != 3) {
			this.addDiagnostic(token, "set! requires name and value");
			^nil
		};
		
		// set! is a special form that mutates a binding
		^ScscmAstSet.new(elements[1], elements[2], token.line, token.col, token.file)
	}

	// Parse let: (let [name expr] ... body)
	parseLet { |elements, token|
		if (elements.size < 2) {
			this.addDiagnostic(token, "let requires at least one binding and body");
			^nil
		};
		
		// Last element is the body
		var body = elements[elements.size - 1];
		var bindings = List.new;
		
		// Elements 1 to size-2 are binding pairs
		// Syntax: (let ((x 10) (y 20)) body) or (let [x 10 y 20] body)
		var i = 1;
		
		// Check if element 1 is a list of bindings or a flat binding list
		if (elements.size >= 2) {
			var firstAfterLet = elements[1];
			
			if (firstAfterLet.isKindOf(ScscmAstList)) {
				// (let ((x 10) (y 20)) body) - bindings are in a list
				if (firstAfterLet.elements.notEmpty and: { firstAfterLet.elements[0].isKindOf(ScscmAstList) }) {
					// Each element of the first list is a binding pair
					firstAfterLet.elements.do({ |binding|
						if (binding.isKindOf(ScscmAstList) and: { binding.elements.size >= 2 }) {
							bindings = bindings.add([binding.elements[0], binding.elements[1]])
						} {
							this.addDiagnostic(token, "let binding must be (name expr) pair, got {binding.class.name}")
						}
					});
					body = elements[2];
					i = 2
				} {
					// (let [x 10 y 20] body) - flat binding list
					var bindingList = firstAfterLet.elements;
					var j = 0;
					while ({ j < bindingList.size - 1 }, { 
						bindings = bindings.add([bindingList[j], bindingList[j + 1]]);
						j = j + 2
					});
					body = elements[2];
					i = 2
				}
			} {
				this.addDiagnostic(token, "let bindings must be a list");
				^nil
			}
		} {
			// No bindings list
			this.addDiagnostic(token, "let requires bindings and body");
			^nil
		};
		
		// Collect remaining elements as body (for multi-expression let)
		if (i < elements.size - 1) {
			var remaining = elements.copyRange(i, elements.size - 2);
			if (remaining.notEmpty) {
				// Wrap in do for multiple body expressions
				body = ScscmAstDo.new([body] ++ remaining, token.line, token.col, token.file)
			}
		}
		
		^ScscmAstLet.new(bindings, body, token.line, token.col, token.file)
	}

	// Parse fn: (fn [arg1 arg2 ...] body)
	parseFn { |elements, token|
		if (elements.size < 2) {
			this.addDiagnostic(token, "fn requires argument list and body");
			^nil
		};
		
		// First element after 'fn' is the argument list
		// Can be either [x y] or (x y)
		var argList = elements[1];
		var args = List.new;
		
		if (argList.isKindOf(ScscmAstList)) {
			// [x y] or (x y) syntax
			args = argList.elements
		} {
			// If it's a symbol directly, treat as single arg
			if (argList.isKindOf(ScscmAstSymbol)) {
				args = [argList]
			} {
				this.addDiagnostic(token, "fn requires argument list as second element");
				^nil
			}
		};
		
		// Validate args are symbols
		args.do({ |arg, i|
			if (arg.isKindOf(ScscmAstSymbol).not) {
				this.addDiagnostic(token, "fn argument {i + 1} must be a symbol, got {arg.class.name}");
			}
		});
		
		// Rest of elements are body (for multi-expression fn bodies)
		var body = (elements.size > 2 ? elements[2] : ScscmAstNil.new(token.line, token.col, token.file));
		
		// If there are more than 3 elements, wrap body in do
		if (elements.size > 3) {
			var bodyForms = elements.copyRange(2, elements.size - 1);
			body = ScscmAstDo.new(bodyForms, token.line, token.col, token.file)
		};
		
		^ScscmAstFn.new(args, body, token.line, token.col, token.file)
	}

	// Parse if: (if test consequent alternate?)
	parseIf { |elements, token|
		if (elements.size < 3) {
			this.addDiagnostic(token, "if requires test and consequent");
			^nil
		};
		
		var test = elements[1];
		var consequent = elements[2];
		var alternate = (elements.size > 3 ? elements[3] : nil);
		
		^ScscmAstIf.new(test, consequent, alternate, token.line, token.col, token.file)
	}

	// Parse when: (when test body)
	parseWhen { |elements, token|
		if (elements.size < 2) {
			this.addDiagnostic(token, "when requires test");
			^nil
		};
		
		// when is (if test body nil)
		var test = elements[1];
		var body = (elements.size > 2 ? elements[2] : ScscmAstNil.new(token.line, token.col, token.file));
		
		^ScscmAstIf.new(test, body, nil, token.line, token.col, token.file)
	}

	// Parse unless: (unless test body)
	parseUnless { |elements, token|
		if (elements.size < 2) {
			this.addDiagnostic(token, "unless requires test");
			^nil
		};
		
		// unless is (if test nil body)
		var test = elements[1];
		var body = (elements.size > 2 ? elements[2] : ScscmAstNil.new(token.line, token.col, token.file));
		
		^ScscmAstIf.new(test, nil, body, token.line, token.col, token.file)
	}

	// Parse cond: (cond (test1 result1) (test2 result2) ... (else result))
	parseCond { |elements, token|
		if (elements.size < 2) {
			this.addDiagnostic(token, "cond requires at least one clause");
			^nil
		};
		
		var clauses = elements.copyRange(1, elements.size - 1);
		
		// Process clauses in order, last one is default
		// cond expands to nested ifs: (if test1 result1 (if test2 result2 ... default))
		var result = nil;
		
		clauses.reverse.do({ |clause|
			if (clause.isKindOf(ScscmAstList)) {
				var clauseElements = clause.elements;
				
				if (clauseElements.isEmpty) {
					this.addDiagnostic(token, "cond clause cannot be empty");
					^nil
				};
				
				// Check for 'else' keyword
				var isElse = (clauseElements[0].isKindOf(ScscmAstSymbol) 
					and: { clauseElements[0].value == "else" });
				
				if (isElse) {
					// else clause: (else result) -> result
					var elseResult = (clauseElements.size > 1 ? clauseElements[1] : ScscmAstNil.new());
					result = elseResult;
				} {
					// Regular clause: (test result) or (test)
					var test = clauseElements[0];
					var conseq = (clauseElements.size > 1 ? clauseElements[1] : test);
					
					if (result.isNil) {
						result = conseq; // Last clause with no test is default
					} {
						result = ScscmAstIf.new(test, conseq, result, token.line, token.col, token.file)
					}
				}
			} {
				this.addDiagnostic(token, "cond clause must be a list");
				^nil
			}
		});
		
		if (result.isNil) {
			// No valid clauses - return nil
			^ScscmAstNil.new(token.line, token.col, token.file)
		};
		
		^result
	}

	// Parse defsynth: (defsynth name [arg1 ...] body)
	parseDefsynth { |elements, token|
		if (elements.size < 3) {
			this.addDiagnostic(token, "defsynth requires name, argument list, and body");
			^nil
		};
		
		var name = elements[1];
		if (name.isKindOf(ScscmAstSymbol).not) {
			this.addDiagnostic(token, "defsynth name must be a symbol");
			^nil
		};
		
		var argsList = elements[2];
		var args = List.new;
		
		if (argsList.isKindOf(ScscmAstList)) {
			args = argsList.elements
		} {
			if (argsList.isKindOf(ScscmAstSymbol)) {
				args = [argsList]
			} {
				this.addDiagnostic(token, "defsynth requires argument list");
				^nil
			}
		};
		
		var body = elements[3];
		
		// If there are more elements, wrap body in do
		if (elements.size > 4) {
			var bodyForms = elements.copyRange(3, elements.size - 1);
			body = ScscmAstDo.new(bodyForms, token.line, token.col, token.file)
		};
		
		^ScscmAstDefsynth.new(name, args, body, token.line, token.col, token.file)
	}

	// Parse defn: (defn name [arg1 ...] body)
	parseDefn { |elements, token|
		if (elements.size < 3) {
			this.addDiagnostic(token, "defn requires name, argument list, and body");
			^nil
		};
		
		var name = elements[1];
		if (name.isKindOf(ScscmAstSymbol).not) {
			this.addDiagnostic(token, "defn name must be a symbol");
			^nil
		};
		
		var argsList = elements[2];
		var args = List.new;
		
		if (argsList.isKindOf(ScscmAstList)) {
			args = argsList.elements
		} {
			if (argsList.isKindOf(ScscmAstSymbol)) {
				args = [argsList]
			} {
				this.addDiagnostic(token, "defn requires argument list");
				^nil
			}
		};
		
		var body = elements[3];
		
		// If there are more elements, wrap body in do
		if (elements.size > 4) {
			var bodyForms = elements.copyRange(3, elements.size - 1);
			body = ScscmAstDo.new(bodyForms, token.line, token.col, token.file)
		};
		
		^ScscmAstDefn.new(name, args, body, token.line, token.col, token.file)
	}

	// Parse defmacro: (defmacro name [arg1 ...] body)
	parseDefmacro { |elements, token|
		if (elements.size < 3) {
			this.addDiagnostic(token, "defmacro requires name, argument list, and body");
			^nil
		};
		
		var name = elements[1];
		if (name.isKindOf(ScscmAstSymbol).not) {
			this.addDiagnostic(token, "defmacro name must be a symbol");
			^nil
		};
		
		var argsList = elements[2];
		if (argsList.isKindOf(ScscmAstList).not) {
			this.addDiagnostic(token, "defmacro requires argument list");
			^nil
		};
		
		var body = elements[3];
		
		// If there are more elements, wrap body in do
		if (elements.size > 4) {
			var bodyForms = elements.copyRange(3, elements.size - 1);
			body = ScscmAstDo.new(bodyForms, token.line, token.col, token.file)
		};
		
		^ScscmAstDefmacro.new(name, argsList.elements, body, token.line, token.col, token.file)
	}

	// Parse do: (do expr1 expr2 ...)
	parseDo { |elements, token|
		if (elements.size < 2) {
			this.addDiagnostic(token, "do requires at least one expression");
			^nil
		};
		
		var body = elements.copyRange(1, elements.size - 1);
		
		^ScscmAstDo.new(body, token.line, token.col, token.file)
	}

	// Parse loop: (loop [binding value] ... body)
	parseLoop { |elements, token|
		if (elements.size < 3) {
			this.addDiagnostic(token, "loop requires bindings and body");
			^nil
		};
		
		// For now, treat loop like let with recur support
		// Full loop/recur support comes later
		var bindings = List.new;
		var bodyStart = 2;
		
		// Parse bindings
		var i = 1;
		while ({ i < elements.size and: { elements[i].isKindOf(ScscmAstList) } }, { 
			var binding = elements[i];
			if (binding.elements.size == 2) {
				bindings = bindings.add([binding.elements[0], binding.elements[1]])
				bodyStart = bodyStart + 1
			} {
				break
			};
			i = i + 1
		});
		
		var body = elements.copyRange(bodyStart, elements.size - 1);
		
		^ScscmAstLoop.new(bindings, body, token.line, token.col, token.file)
	}

	// Parse recur: (recur expr1 expr2 ...)
	parseRecur { |elements, token|
		if (elements.size < 2) {
			this.addDiagnostic(token, "recur requires at least one expression");
			^nil
		};
		
		var args = elements.copyRange(1, elements.size - 1);
		
		^ScscmAstRecur.new(args, token.line, token.col, token.file)
	}

	// Parse an atom (non-list form)
	parseAtom { 
		var token = this.currentToken;
		
		if (token.isNil or: { token.type == ScscmToken.const[\eof] }) {
			^nil
		};
		
		this.advance;
		
		token.type == ScscmToken.const[\number] ? { ^this.parseNumber(token) };
		token.type == ScscmToken.const[\string] ? { ^ScscmAstString.new(token.value, token.line, token.col, token.file) };
		token.type == ScscmToken.const[\symbol] ? { ^ScscmAstSymbol.new(token.value, token.line, token.col, token.file) };
		token.type == ScscmToken.const[\boolean] ? { ^ScscmAstBoolean.new((token.value == "true"), token.line, token.col, token.file) };
		token.type == ScscmToken.const[\nil] ? { ^ScscmAstNil.new(token.line, token.col, token.file) };
		token.type == ScscmToken.const[\keyword] ? { ^ScscmAstSymbol.new(token.value, token.line, token.col, token.file) };
		
		// For any other token type, treat as symbol
		^ScscmAstSymbol.new(token.value, token.line, token.col, token.file)
	}

	// Parse number token into appropriate AST node
	parseNumber { |token|
		var value = token.value;
		
		// Try to parse as integer first
		try {
			var intVal = value.asInteger;
			^ScscmAstNumber.new(intVal, token.line, token.col, token.file)
		} { |err|
			// Try as float
			try {
				var floatVal = value.asFloat;
				^ScscmAstNumber.new(floatVal, token.line, token.col, token.file)
			} { |err2|
				// Fall back to string representation
				^ScscmAstNumber.new(value, token.line, token.col, token.file)
			}
		}
	}

	// Advance to next token
	advance { 
		if (this.tokenIndex < this.tokens.size - 1) {
			this.tokenIndex = this.tokenIndex + 1;
			this.currentToken = this.tokens[this.tokenIndex]
		} {
			this.currentToken = nil
		}
	}

	// Peek at next token without advancing
	peek { |n = 1|
		var index = this.tokenIndex + n;
		^(index < this.tokens.size ? this.tokens[index] : nil)
	}

	// Add diagnostic
	addDiagnostic { |token, message|
		this.diagnostics = this.diagnostics.add(
			ScscmDiagnostic.new("parse", token.line, token.col, message, token.file)
		)
	}

	// Reset parser state
	reset { 
		this.tokenIndex = 0;
		this.currentToken = (this.tokens.size > 0 ? this.tokens[0] : nil);
		this.diagnostics = List.new;
		^this
	}
}

// Parse result container
ScscmParseResult : Object {
	var <>ast, <>diagnostics, <>file;

	*new { |ast, diagnostics = [], file = ""|
		^super.new.copy(ast: ast, diagnostics: diagnostics, file: file)
	}

	success { 
		^this.diagnostics.isEmpty
	}

	asString { 
		^"ScscmParseResult({this.success}, diagnostics: {this.diagnostics.size})"
	}
}


