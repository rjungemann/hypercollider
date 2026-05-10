// ScscmCodegen.sc - Code generator for scscm-in-sclang compiler
// Phase P2: Generates SuperCollider (sclang) code from scscm AST
// Target format matches the JS compiler output for differential testing

ScscmCodegen : Object {
	var <>options, <>diagnostics;

	// Code generation options
	*defaultOptions { 
		^(
			indent: "  ",
			newline: "\n",
			maxLineLength: 80,
			normalize: true,
			comments: false,
			target: "sclang" // "sclang" or "scscm"
		)
	}

	// Constructor
	*new { |options = nil|
		^super.new.init(options ? options ! this.class.defaultOptions)
	}

	init { |options|
		this.options = options;
		this.diagnostics = List.new;
		^this
	}

	// Generate code from AST
	generate { |ast|
		var result = StringBuilder.new;
		
		// If generating scscm (for comparison), use scscm generator
		if (this.options[\target] == "scscm") {
			this.generateScscm(ast, result, 0)
		} {
			// Default: generate sclang
			this.generateSclang(ast, result, 0)
		};
		
		^ScscmCodegenResult.new(result.toString, this.diagnostics)
	}

	// ============ SuperCollider (sclang) Code Generation ============
	// This matches the output format of the JS compiler for differential testing

	generateSclang { |ast, sb, indentLevel|
		if (ast.isKindOf(List)) {
			ast.do({ |form, i|
				if (i > 0) { sb.add(this.options[\newline]) };
				this.generateSclangForm(form, sb, indentLevel)
			})
		} {
			this.generateSclangForm(ast, sb, indentLevel)
		}
	}

	generateSclangForm { |form, sb, indentLevel|
		if (form.isNil) { ^this };
		
		form.isKindOf(ScscmAstList) ? { this.generateSclangList(form, sb, indentLevel) };
		form.isKindOf(ScscmAstSymbol) ? { this.generateSclangSymbol(form, sb) };
		form.isKindOf(ScscmAstNumber) ? { this.generateSclangNumber(form, sb) };
		form.isKindOf(ScscmAstString) ? { this.generateSclangString(form, sb) };
		form.isKindOf(ScscmAstBoolean) ? { this.generateSclangBoolean(form, sb) };
		form.isKindOf(ScscmAstNil) ? { this.generateSclangNil(form, sb) };
		form.isKindOf(ScscmAstQuoted) ? { this.generateSclangQuoted(form, sb) };
		form.isKindOf(ScscmAstQuasiquoted) ? { this.generateSclangQuasiquoted(form, sb, indentLevel) };
		form.isKindOf(ScscmAstUnquoted) ? { this.generateSclangUnquoted(form, sb) };
		form.isKindOf(ScscmAstCall) ? { this.generateSclangCall(form, sb) };
		form.isKindOf(ScscmAstDef) ? { this.generateSclangDef(form, sb) };
		form.isKindOf(ScscmAstSet) ? { this.generateSclangSet(form, sb) };
		form.isKindOf(ScscmAstLet) ? { this.generateSclangLet(form, sb) };
		form.isKindOf(ScscmAstFn) ? { this.generateSclangFn(form, sb) };
		form.isKindOf(ScscmAstIf) ? { this.generateSclangIf(form, sb, indentLevel) };
		form.isKindOf(ScscmAstDo) ? { this.generateSclangDo(form, sb) };
		form.isKindOf(ScscmAstLoop) ? { this.generateSclangLoop(form, sb) };
		form.isKindOf(ScscmAstRecur) ? { this.generateSclangRecur(form, sb) };
		form.isKindOf(ScscmAstDefsynth) ? { this.generateSclangDefsynth(form, sb, indentLevel) };
		form.isKindOf(ScscmAstDefn) ? { this.generateSclangDefn(form, sb) };
		form.isKindOf(ScscmAstDefmacro) ? { this.generateSclangDefmacro(form, sb) };
		form.isKindOf(ScscmAstCond) ? { this.generateSclangCond(form, sb) };
		
		// Default
		{ 
			this.addDiagnostic(form, "Unknown AST node type: {form.class.name}");
			sb.add("// Unknown: {form.class.name}")
		}
	}

	generateSclangList { |list, sb, indentLevel|
		// In scscm, (func arg1 arg2) could be:
		// - Function call: func(arg1, arg2)
		// - Special form: depends on func
		// - Data list: [arg1, arg2]
		
		if (list.elements.isEmpty) {
			sb.add("[]");
			^this
		};
		
		var first = list.elements[0];
		
		// Check if first element is a symbol (likely a function call or special form)
		if (first.isKindOf(ScscmAstSymbol)) {
			var funcName = first.value.asString;
			
			// Handle special forms
			funcName == "fn" ? { this.generateSclangFnFromList(list, sb) };
			funcName == "defn" ? { this.generateSclangDefnFromList(list, sb) };
			funcName == "defmacro" ? { this.generateSclangDefmacroFromList(list, sb) };
			funcName == "var" ? { this.generateSclangVarFromList(list, sb) };
			funcName == "set!" ? { this.generateSclangSetFromList(list, sb) };
			funcName == "let" ? { this.generateSclangLetFromList(list, sb) };
			funcName == "if" ? { this.generateSclangIfFromList(list, sb) };
			funcName == "cond" ? { this.generateSclangCondFromList(list, sb) };
			funcName == "do" ? { this.generateSclangDoFromList(list, sb) };
			funcName == "quote" ? { this.generateSclangQuoteFromList(list, sb) };
			funcName == "quasiquote" ? { this.generateSclangQuasiquoteFromList(list, sb) };
			funcName == "list" ? { this.generateSclangListLiteral(list, sb) };
			funcName == "array" ? { this.generateSclangListLiteral(list, sb) };
			
			// Check for binary operators
			(this.isBinaryOp(funcName) and: { list.elements.size == 3 }) ? { 
				this.generateSclangBinaryOp(list, sb)
			} {
				// Function call
				this.generateSclangFunctionCall(list, sb)
			}
		} {
			// Not a symbol first - treat as list literal
			this.generateSclangListLiteral(list, sb)
		}
	}

	// Generate binary operation: (+ a b) -> a + b
	isBinaryOp { |name|
		^(["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", "==", "!=", "<", ">", "<=", ">=", "and", "or", "++", "<>", "!"].includes(name))
	}

	generateSclangBinaryOp { |list, sb|
		var op = list.elements[0].value.asString;
		var left = list.elements[1];
		var right = list.elements[2];
		
		// Map scscm ops to sclang
		var scOp = this.mapOperator(op);
		
		// Wrap complex expressions in parens for precedence
		var leftNeedsParens = this.needsParens(left);
		var rightNeedsParens = this.needsParens(right);
		
		if (leftNeedsParens) { sb.add("(") };
		this.generateSclangForm(left, sb, 0);
		if (leftNeedsParens) { sb.add(")") };
		
		sb.add(" {scOp} ");
		
		if (rightNeedsParens) { sb.add("(") };
		this.generateSclangForm(right, sb, 0);
		if (rightNeedsParens) { sb.add(")") }
	}

	mapOperator { |op|
		// Direct mappings
		op == "!=" ? { ^"!=" };
		op == "<=" ? { ^"<=" };
		op == ">=" ? { ^">=" };
		op == "and" ? { ^"&&" };
		op == "or" ? { ^"||" };
		op == "<>" ? { ^"!=" };
		// Default: same operator
		^op
	}

	needsParens { |form|
		// Function calls and binary ops need parens in some contexts
		form.isKindOf(ScscmAstCall) ? { ^true };
		form.isKindOf(ScscmAstList) ? { 
			var first = form.elements[0];
			^(first.isKindOf(ScscmAstSymbol) and: { this.isBinaryOp(first.value.asString) })
		};
		^false
	}

	generateSclangFunctionCall { |list, sb|
		var func = list.elements[0];
		var args = list.elements.copyRange(1, list.elements.size - 1);
		
		this.generateSclangForm(func, sb, 0);
		sb.add("(");
		this.generateSclangArgs(args, sb);
		sb.add(")")
	}

	generateSclangArgs { |args, sb|
		args.do({ |arg, i|
			if (i > 0) { sb.add(", ") };
			this.generateSclangForm(arg, sb, 0)
		})
	}

	// Special form generators
	generateSclangFnFromList { |list, sb|
		// (fn [args...] body...) or (fn (args...) body...) -> { |args...| body... }
		if (list.elements.size < 2) {
			this.addDiagnostic(list, "fn requires parameter list and body");
			sb.add("{ }")
			^this
		};
		
		var paramList = list.elements[1];
		var body = list.elements.copyRange(2, list.elements.size - 1);
		
		// Extract args from parameter list (can be [x y] or (x y))
		var args = List.new;
		if (paramList.isKindOf(ScscmAstList)) {
			args = paramList.elements
		} {
			if (paramList.isKindOf(ScscmAstSymbol)) {
				args = [paramList]
			} {
				this.addDiagnostic(list, "fn parameter list must be a list or symbol");
				sb.add("{ }")
				^this
			}
		};
		
		var params = this.generateSclangFnParams(args);
		var bodyCode = body.collect({ |e| this.generateSclangExpr(e) }).join("; ");
		
		if (params.isEmpty) {
			sb.add("{ ");
			if (bodyCode.notEmpty) { sb.add(bodyCode) };
			sb.add(" }")
		} {
			sb.add("{ |{params}| ");
			if (bodyCode.notEmpty) { sb.add(bodyCode) };
			sb.add(" }")
		}
	}

	generateSclangDefnFromList { |list, sb|
		// (defn name [args...] body...) or (defn name (args...) body...) -> name = { |args...| body... }
		if (list.elements.size < 3) {
			this.addDiagnostic(list, "defn requires name, parameter list, and body");
			sb.add("nil")
			^this
		};
		
		var name = list.elements[1];
		var paramList = list.elements[2];
		var body = list.elements.copyRange(3, list.elements.size - 1);
		
		if (name.isKindOf(ScscmAstSymbol).not) {
			this.addDiagnostic(list, "defn name must be a symbol");
			sb.add("nil")
			^this
		};
		
		// Extract args from parameter list (can be [x y] or (x y))
		var args = List.new;
		if (paramList.isKindOf(ScscmAstList)) {
			args = paramList.elements
		} {
			if (paramList.isKindOf(ScscmAstSymbol)) {
				args = [paramList]
			} {
				this.addDiagnostic(list, "defn parameter list must be a list or symbol");
				sb.add("nil")
				^this
			}
		};
		
		var nameStr = this.schemeNameToScName(name.value.asString);
		var params = this.generateSclangFnParams(args);
		var bodyCode = body.collect({ |e| this.generateSclangExpr(e) }).join("; ");
		
		sb.add("{nameStr} = { |{params}| {bodyCode} };")
	}

	generateSclangVarFromList { |list, sb|
		// (var name value) -> var name = value
		// (var name1 val1 name2 val2) -> var name1 = val1, name2 = val2
		if (list.elements.size < 2) {
			this.addDiagnostic(list, "var requires at least a name");
			sb.add("nil")
			^this
		};
		
		var decls = List.new;
		var i = 1;
		while ({ i < list.elements.size }, { 
			var name = list.elements[i];
			var value = (i + 1 < list.elements.size ? list.elements[i + 1] : nil);
			
			if (name.isKindOf(ScscmAstSymbol).not) {
				this.addDiagnostic(list, "var name must be a symbol");
				^this
			};
			
			var decl = this.schemeNameToScName(name.value.asString);
			if (value.notNil) {
				decl = decl ++ " = " ++ this.generateSclangExpr(value)
				i = i + 2
			} {
				i = i + 1
			};
			
			decls = decls.add(decl)
		});
		
		sb.add("var {decls.join(", ")};")
	}

	generateSclangSetFromList { |list, sb|
		// (set! name value) -> name = value
		if (list.elements.size < 3) {
			this.addDiagnostic(list, "set! requires target and value");
			sb.add("nil")
			^this
		};
		
		var target = list.elements[1];
		var value = list.elements[2];
		
		if (target.isKindOf(ScscmAstSymbol)) {
			var name = this.schemeNameToScName(target.value.asString);
			sb.add("{name} = {this.generateSclangExpr(value)}")
		} {
			// Handle (set! (. obj method) value) -> obj.method = value
			if (target.isKindOf(ScscmAstList) and: { target.elements.notEmpty }) {
				var head = target.elements[0];
				if (head.isKindOf(ScscmAstSymbol) and: { head.value == "\." }) {
					// Method call: (. obj method)
					if (target.elements.size >= 3) {
						var obj = target.elements[1];
						var method = target.elements[2];
						if (method.isKindOf(ScscmAstSymbol)) {
							sb.add("({this.generateSclangExpr(obj)}).{method.value} = {this.generateSclangExpr(value)}")
							^this
						}
					}
				}
			};
			// Default
			this.addDiagnostic(list, "set! target must be a symbol or method call");
			sb.add("nil")
		}
	}

	generateSclangLetFromList { |list, sb|
		// (let [name value] ... body) -> { |name| body }.value(value)
		// (let ((x 10) (y 20)) body) -> { |x, y| body }.value(10, 20)
		// (let [x 10 y 20] body) -> { |x, y| body }.value(10, 20)
		
		if (list.elements.size < 2) {
			this.addDiagnostic(list, "let requires bindings and body");
			sb.add("nil")
			^this
		};
		
		var bindingsNode = list.elements[1];
		var body = list.elements.copyRange(2, list.elements.size - 1);
		
		if (bindingsNode.isKindOf(ScscmAstList).not) {
			this.addDiagnostic(list, "let bindings must be a list");
			sb.add("nil")
			^this
		};
		
		var params = List.new;
		var values = List.new;
		
		// Check if bindings are nested: ((x 10) (y 20)) or flat: [x 10 y 20]
		if (bindingsNode.elements.notEmpty and: { bindingsNode.elements[0].isKindOf(ScscmAstList) }) {
			// Nested: ((x 10) (y 20))
			bindingsNode.elements.do({ |binding|
				if (binding.isKindOf(ScscmAstList) and: { binding.elements.size >= 2 }) {
					var name = binding.elements[0];
					var value = binding.elements[1];
					
					if (name.isKindOf(ScscmAstSymbol)) {
						params = params.add(this.schemeNameToScName(name.value.asString));
						values = values.add(this.generateSclangExpr(value))
					} {
						this.addDiagnostic(list, "let binding name must be a symbol")
					}
				} {
					this.addDiagnostic(list, "let binding must be (name value) pair")
				}
			})
		} {
			// Flat: [x 10 y 20] - alternate pairs
			var i = 0;
			while ({ i < bindingsNode.elements.size - 1 }, { 
				var name = bindingsNode.elements[i];
				var value = bindingsNode.elements[i + 1];
				
				if (name.isKindOf(ScscmAstSymbol)) {
					params = params.add(this.schemeNameToScName(name.value.asString));
					values = values.add(this.generateSclangExpr(value))
				} {
					this.addDiagnostic(list, "let binding name must be a symbol")
				};
				i = i + 2
			})
		};
		
		var bodyCode = body.collect({ |e| this.generateSclangExpr(e) }).join("; ");
		var paramStr = params.join(", ");
		var valueStr = values.join(", ");
		
		if (params.isEmpty) {
			sb.add("{ |{paramStr}| {bodyCode} }.value()")
		} {
			sb.add("{ |{paramStr}| {bodyCode} }.value({valueStr})")
		}
	}

	generateSclangIfFromList { |list, sb|
		// (if test consequent alternate?) -> if (test) { consequent } { alternate }
		if (list.elements.size < 3) {
			this.addDiagnostic(list, "if requires condition and then branch");
			sb.add("nil")
			^this
		};
		
		var test = list.elements[1];
		var consequent = list.elements[2];
		var alternate = (list.elements.size > 3 ? list.elements[3] : nil);
		
		var testCode = this.generateSclangExpr(test);
		var conseqCode = this.generateSclangExpr(consequent);
		var altCode = (alternate.notNil ? this.generateSclangExpr(alternate) : "nil");
		
		sb.add("if ({testCode}) { {conseqCode} } { {altCode} };")
	}

	generateSclangCondFromList { |list, sb|
		// (cond [test1 expr1] [test2 expr2] ... [else expr]) -> cond({ test1 -> expr1 }{ test2 -> expr2 } ...)
		if (list.elements.size < 2) {
			this.addDiagnostic(list, "cond requires at least one clause");
			sb.add("nil")
			^this
		};
		
		var clauses = List.new;
		
		list.elements.copyRange(1, list.elements.size - 1).do({ |clause|
			if (clause.isKindOf(ScscmAstList) and: { clause.elements.size >= 1 }) {
				var test = clause.elements[0];
				var expr = (clause.elements.size > 1 ? clause.elements[1] : ScscmAstNil.new());
				
				if (test.isKindOf(ScscmAstSymbol) and: { test.value == "else" }) {
					clauses = clauses.add("{ true -> {this.generateSclangExpr(expr)} }");
				} {
					clauses = clauses.add("{ {this.generateSclangExpr(test)} -> {this.generateSclangExpr(expr)} }");
				}
			} {
				this.addDiagnostic(list, "cond clause must be a list")
			}
		});
		
		sb.add("cond(");
		sb.add(clauses.join(""));
		sb.add(")");
	}

	generateSclangDoFromList { |list, sb|
		// (do expr1 expr2 ...) -> { expr1; expr2; ... }.value()
		var body = list.elements.copyRange(1, list.elements.size - 1);
		var bodyCode = body.collect({ |e| this.generateSclangExpr(e) }).join("; ");
		
		if (bodyCode.isEmpty) {
			sb.add("{ }.value()")
		} {
			sb.add("{ {bodyCode} }.value()")
		}
	}

	generateSclangQuoteFromList { |list, sb|
		// (quote form) -> 'form (as symbol or list)
		if (list.elements.size < 2) {
			sb.add("'nil")
			^this
		};
		var expr = list.elements[1];
		
		if (expr.isKindOf(ScscmAstSymbol)) {
			sb.add("'");
			this.generateSclangForm(expr, sb, 0)
		} {
			sb.add("'");
			this.generateSclangForm(expr, sb, 0)
		}
	}

	generateSclangQuasiquoteFromList { |list, sb|
		// (quasiquote form) -> #[form]
		if (list.elements.size < 2) {
			sb.add("#[]")
			^this
		};
		var expr = list.elements[1];
		
		// For now, generate as list literal
		// Full quasiquote support requires template literals
		sb.add("#[");
		this.generateSclangForm(expr, sb, 0);
		sb.add("]")
	}

	generateSclangListLiteral { |list, sb|
		// [elem1 elem2 ...]
		var args = list.elements.copyRange(1, list.elements.size - 1);
		if (args.isEmpty) {
			sb.add("[]")
			^this
		};
		
		sb.add("[");
		args.do({ |arg, i|
			if (i > 0) { sb.add(", ") };
			this.generateSclangForm(arg, sb, 0)
		});
		sb.add("]")
	}

	generateSclangDefmacroFromList { |list, sb|
		// Macros are expanded before codegen, so this should be empty
		// For now, skip
		sb.add("")
	}

	// AST node generators (from parsed AST, not raw lists)
	generateSclangSymbol { |symbol, sb|
		var name = symbol.value.asString;
		
		// Keywords: :freq -> \freq
		if (name.beginsWith(":")) {
			sb.add("\\{this.schemeNameToScName(name.drop(1))}")
			^this
		};
		
		// Map special symbols
		name == "true" ? { sb.add("true") };
		name == "false" ? { sb.add("false") };
		name == "nil" ? { sb.add("nil") };
		
		// Default: map scheme-style names to SC names
		sb.add(this.schemeNameToScName(name))
	}

	// Name mapping: foo-bar -> foo_bar, foo? -> foo_q, foo! -> foo_
	schemeNameToScName { |name|
		^name.replace($-, $_).replace($?, $_q).replace($!, $_)
	}

	generateSclangNumber { |number, sb|
		sb.add(number.value.asString)
	}

	generateSclangString { |string, sb|
		var escaped = string.value;
		escaped = escaped.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
		sb.add("\"{escaped}\"")
	}

	generateSclangBoolean { |bool, sb|
		sb.add(bool.value ? "true" : "false")
	}

	generateSclangNil { |nilNode, sb|
		sb.add("nil")
	}

	generateSclangQuoted { |quoted, sb|
		// 'form
		sb.add("'");
		this.generateSclangForm(quoted.expr, sb, 0)
	}

	generateSclangQuasiquoted { |qq, sb, indentLevel|
		// `form -> #[form]
		sb.add("#[");
		this.generateSclangForm(qq.expr, sb, 0);
		sb.add("]")
	}

	generateSclangUnquoted { |unquoted, sb|
		// ,form or ,@form
		if (unquoted.splicing) {
			// ,@form - spliced unquote
			sb.add(", ");
			this.generateSclangForm(unquoted.expr, sb, 0)
		} {
			// ,form - regular unquote
			sb.add(", ");
			this.generateSclangForm(unquoted.expr, sb, 0)
		}
	}

	generateSclangCall { |call, sb|
		this.generateSclangForm(call.fn, sb, 0);
		sb.add("(");
		this.generateSclangArgs(call.args, sb);
		sb.add(")")
	}

	generateSclangDef { |defNode, sb|
		// (def name value) -> var name = value;
		var nameStr = this.schemeNameToScName(defNode.name.value.asString);
		var valueCode = this.generateSclangExpr(defNode.value);
		sb.add("var {nameStr} = {valueCode}")
	}

	generateSclangSet { |setNode, sb|
		var nameStr = this.schemeNameToScName(setNode.name.value.asString);
		var valueCode = this.generateSclangExpr(setNode.value);
		sb.add("{nameStr} = {valueCode}")
	}

	generateSclangLet { |letNode, sb|
		// let with bindings as separate forms: { |x| x * x }.value(5)
		var params = List.new;
		var values = List.new;
		
		letNode.bindings.do({ |binding|
			params = params.add(this.schemeNameToScName(binding[0].value.asString));
			values = values.add(this.generateSclangExpr(binding[1]))
		});
		
		var bodyCode = this.generateSclangExpr(letNode.body);
		var paramStr = params.join(", ");
		var valueStr = values.join(", ");
		
		sb.add("{ |{paramStr}| {bodyCode} }.value({valueStr})")
	}

	generateSclangFn { |fnNode, sb|
		var params = this.generateSclangFnParams(fnNode.args);
		var bodyCode = this.generateSclangExpr(fnNode.body);
		
		if (params.isEmpty) {
			sb.add("{ |{params}| {bodyCode} }")
		} {
			sb.add("{ |{params}| {bodyCode} }")
		}
	}

	generateSclangFnParams { |args|
		^args.collect({ |arg| 
			if (arg.isKindOf(ScscmAstSymbol)) {
				this.schemeNameToScName(arg.value.asString)
			} {
				"_"
			}
		}).join(", ")
	}

	generateSclangIf { |ifNode, sb, indentLevel|
		var testCode = this.generateSclangExpr(ifNode.test);
		var conseqCode = this.generateSclangExpr(ifNode.consequent);
		var altCode = (ifNode.alternate.notNil ? this.generateSclangExpr(ifNode.alternate) : "nil");
		
		sb.add("if ({testCode}) { {conseqCode} } { {altCode} }");
	}

	generateSclangDo { |doNode, sb|
		var bodyCode = doNode.expressions.collect({ |e| this.generateSclangExpr(e) }).join("; ");
		
		if (bodyCode.isEmpty) {
			sb.add("{ }.value()")
		} {
			sb.add("{ {bodyCode} }.value()")
		}
	}

	generateSclangLoop { |loopNode, sb|
		// For now, generate as infinite while loop
		sb.add("while ({ true }) { ");
		
		// Generate bindings
		loopNode.bindings.do({ |binding|
			sb.add("var {this.schemeNameToScName(binding[0].value.asString)} = {this.generateSclangExpr(binding[1])}; ")
		});
		
		// Generate body
		loopNode.body.do({ |expr|
			sb.add(this.generateSclangExpr(expr));
			sb.add("; ")
		});
		
		sb.add("}")
	}

	generateSclangRecur { |recurNode, sb|
		// recur is used within loop - in sclang this would be the loop condition
		// For now, generate as return with args
		sb.add("// recur ");
		recurNode.args.do({ |arg, i|
			if (i > 0) { sb.add(", ") };
			this.generateSclangForm(arg, sb, 0)
		})
	}

	generateSclangDefsynth { |defNode, sb, indentLevel|
		// (defsynth name [arg1 val1 ...] body) -> SynthDef("name", { |arg1=val1, ...| body })
		var nameStr = defNode.name.value.asString;
		
		// Build parameter string with defaults
		var params = List.new;
		defNode.args.do({ |arg|
			// For now, treat all as required params
			// TODO: handle default values
			params = params.add(this.schemeNameToScName(arg.value.asString))
		});
		
		var paramStr = params.join(", ");
		var bodyCode = this.generateSclangExpr(defNode.body);
		
		sb.add("SynthDef(\"{nameStr}\", { |{paramStr}| {bodyCode} }).add;");
	}

	generateSclangDefn { |defNode, sb|
		var nameStr = this.schemeNameToScName(defNode.name.value.asString);
		var params = this.generateSclangFnParams(defNode.args);
		var bodyCode = this.generateSclangExpr(defNode.body);
		
		sb.add("{nameStr} = { |{params}| {bodyCode} }");
	}

	generateSclangDefmacro { |defNode, sb|
		// Macros are expanded before codegen
		// This should not appear in output
		^this
	}

	// Generate a single expression (no wrapping)
	generateSclangExpr { |form|
		var sb = StringBuilder.new;
		this.generateSclangForm(form, sb, 0);
		^sb.toString
	}

	// ============ scscm Code Generation (for comparison) ============
	// Generates scscm source code for differential testing

	generateScscm { |ast, sb, indentLevel|
		if (ast.isKindOf(List)) {
			ast.do({ |form, i|
				if (i > 0) { sb.add(this.options[\newline]) };
				this.generateScscmForm(form, sb, indentLevel)
			})
		} {
			this.generateScscmForm(ast, sb, indentLevel)
		}
	}

	generateScscmForm { |form, sb, indentLevel|
		form.isKindOf(ScscmAstList) ? { this.generateScscmList(form, sb, indentLevel) };
		form.isKindOf(ScscmAstSymbol) ? { sb.add(form.value.asString) };
		form.isKindOf(ScscmAstNumber) ? { sb.add(form.value.asString) };
		form.isKindOf(ScscmAstString) ? { sb.add("\"{form.value}\"") };
		form.isKindOf(ScscmAstBoolean) ? { sb.add(form.value ? "true" : "false") };
		form.isKindOf(ScscmAstNil) ? { sb.add("nil") };
		form.isKindOf(ScscmAstQuoted) ? { 
			sb.add("'");
			this.generateScscmForm(form.expr, sb, indentLevel)
		};
		form.isKindOf(ScscmAstQuasiquoted) ? { 
			sb.add("`");
			this.generateScscmForm(form.expr, sb, indentLevel)
		};
		form.isKindOf(ScscmAstUnquoted) ? { 
			if (form.splicing) { sb.add(",@") } { sb.add(",") };
			this.generateScscmForm(form.expr, sb, indentLevel)
		};
		form.isKindOf(ScscmAstCall) ? { 
			sb.add("(");
			this.generateScscmForm(form.fn, sb, indentLevel);
			form.args.do({ |arg| sb.add(" "); this.generateScscmForm(arg, sb, indentLevel) });
			sb.add(")")
		};
		form.isKindOf(ScscmAstDef) ? { 
			sb.add("(def ");
			this.generateScscmForm(form.name, sb, indentLevel);
			sb.add(" ");
			this.generateScscmForm(form.value, sb, indentLevel);
			sb.add(")")
		};
		form.isKindOf(ScscmAstSet) ? { 
			sb.add("(set! ");
			this.generateScscmForm(form.name, sb, indentLevel);
			sb.add(" ");
			this.generateScscmForm(form.value, sb, indentLevel);
			sb.add(")")
		};
		form.isKindOf(ScscmAstLet) ? { 
			sb.add("(let ");
			form.bindings.do({ |b, i|
				if (i > 0) { sb.add(" ") };
				sb.add("[");
				this.generateScscmForm(b[0], sb, indentLevel);
				sb.add(" ");
				this.generateScscmForm(b[1], sb, indentLevel);
				sb.add("]")
			});
			sb.add(" ");
			this.generateScscmForm(form.body, sb, indentLevel);
			sb.add(")")
		};
		form.isKindOf(ScscmAstFn) ? { 
			sb.add("(fn [");
			form.args.do({ |arg, i|
				if (i > 0) { sb.add(" ") };
				this.generateScscmForm(arg, sb, indentLevel)
			});
			sb.add("] ");
			this.generateScscmForm(form.body, sb, indentLevel);
			sb.add(")")
		};
		form.isKindOf(ScscmAstIf) ? { 
			sb.add("(if ");
			this.generateScscmForm(form.test, sb, indentLevel);
			sb.add(" ");
			this.generateScscmForm(form.consequent, sb, indentLevel);
			if (form.alternate.notNil) {
				sb.add(" ");
				this.generateScscmForm(form.alternate, sb, indentLevel)
			};
			sb.add(")")
		};
		form.isKindOf(ScscmAstDo) ? { 
			sb.add("(do ");
			form.expressions.do({ |expr, i|
				if (i > 0) { sb.add(" ") };
				this.generateScscmForm(expr, sb, indentLevel)
			});
			sb.add(")")
		};
		form.isKindOf(ScscmAstLoop) ? { 
			sb.add("(loop ");
			form.bindings.do({ |b, i|
				if (i > 0) { sb.add(" ") };
				sb.add("[");
				this.generateScscmForm(b[0], sb, indentLevel);
				sb.add(" ");
				this.generateScscmForm(b[1], sb, indentLevel);
				sb.add("]")
			});
			form.body.do({ |expr| sb.add(" "); this.generateScscmForm(expr, sb, indentLevel) });
			sb.add(")")
		};
		form.isKindOf(ScscmAstRecur) ? { 
			sb.add("(recur ");
			form.args.do({ |arg, i|
				if (i > 0) { sb.add(" ") };
				this.generateScscmForm(arg, sb, indentLevel)
			});
			sb.add(")")
		};
		form.isKindOf(ScscmAstDefsynth) ? { 
			sb.add("(defsynth ");
			this.generateScscmForm(form.name, sb, indentLevel);
			sb.add(" [");
			form.args.do({ |arg, i|
				if (i > 0) { sb.add(" ") };
				this.generateScscmForm(arg, sb, indentLevel)
			});
			sb.add("] ");
			this.generateScscmForm(form.body, sb, indentLevel);
			sb.add(")")
		};
		form.isKindOf(ScscmAstDefn) ? { 
			sb.add("(defn ");
			this.generateScscmForm(form.name, sb, indentLevel);
			sb.add(" [");
			form.args.do({ |arg, i|
				if (i > 0) { sb.add(" ") };
				this.generateScscmForm(arg, sb, indentLevel)
			});
			sb.add("] ");
			this.generateScscmForm(form.body, sb, indentLevel);
			sb.add(")")
		};
		form.isKindOf(ScscmAstDefmacro) ? { 
			sb.add("(defmacro ");
			this.generateScscmForm(form.name, sb, indentLevel);
			sb.add(" [");
			form.args.do({ |arg, i|
				if (i > 0) { sb.add(" ") };
				this.generateScscmForm(arg, sb, indentLevel)
			});
			sb.add("] ");
			this.generateScscmForm(form.body, sb, indentLevel);
			sb.add(")")
		};
		{ sb.add("<???>") }
	}

	generateScscmList { |list, sb, indentLevel|
		sb.add("(");
		var needsMultiline = this.needsMultiline(list.elements);
		
		if (needsMultiline) {
			sb.add(this.options[\newline]);
			var indent = this.options[\indent].dup(indentLevel + 1);
			list.elements.do({ |elem, i|
				if (i > 0) { sb.add(" ") };
				sb.add(indent);
				this.generateScscmForm(elem, sb, indentLevel + 1);
				sb.add(this.options[\newline])
			});
			sb.add(this.options[\indent].dup(indentLevel));
		} {
			list.elements.do({ |elem, i|
				if (i > 0) { sb.add(" ") };
				this.generateScscmForm(elem, sb, indentLevel)
			})
		};
		
		sb.add(")")
	}

	// Check if list needs multiline formatting
	needsMultiline { |elements|
		if (elements.isEmpty) { ^false };
		
		var total = 0;
		elements.do({ |elem|
			total = total + this.estimateLength(elem)
		});
		
		total = total + (elements.size - 1) + 2;
		^(total > this.options[\maxLineLength])
	}

	// Estimate string length of a form
	estimateLength { |form|
		^form.asString.size
	}

	// Add diagnostic
	addDiagnostic { |node, message|
		var line = (node.notNil ? node.line : 0);
		var col = (node.notNil ? node.col : 0);
		var file = (node.notNil ? node.file : "");
		this.diagnostics = this.diagnostics.add(
			ScscmDiagnostic.new("codegen", line, col, message, file)
		)
	}

	// Reset codegen state
	reset { 
		this.diagnostics = List.new;
		^this
	}
}

// Code generation result
ScscmCodegenResult : Object {
	var <>code, <>diagnostics;

	*new { |code, diagnostics = []|
		^super.new.copy(code: code, diagnostics: diagnostics)
	}

	success { 
		^this.diagnostics.isEmpty
	}

	asString { 
		^"ScscmCodegenResult({this.success}, {this.code ? this.code.size : 0} chars, diagnostics: {this.diagnostics.size})"
	}
}
