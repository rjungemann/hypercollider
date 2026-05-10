// ScscmMacroExpander.sc - Macro expander for scscm-in-sclang compiler
// Part of Phase P0: Harness bootstrap
// Stub implementation - full implementation in Phase P3

ScscmMacroExpander : Object {
	var <>macros, <>maxDepth, <>currentDepth, <>diagnostics;

	// Constructor
	*new { |maxDepth = 100|
		^super.new.init(maxDepth)
	}

	init { |maxDepth|
		this.macros = Dictionary.new;
		this.maxDepth = maxDepth;
		this.currentDepth = 0;
		this.diagnostics = List.new;
		^this
	}

	// Register a macro
	registerMacro { |name, macroFn|
		this.macros[name.asString] = macroFn;
		^this
	}

	// Register macros from a list of defmacro AST nodes
	registerMacrosFromAst { |astNodes|
		astNodes.do({ |node|
			if (node.isKindOf(ScscmAstDefmacro)) {
				this.registerMacro(node.name.value, node)
			}
		});
		^this
	}

	// Expand all forms in AST
	expand { |ast|
		this.currentDepth = 0;
		var result = this.expandForm(ast);
		^ScscmMacroExpandResult.new(result, this.diagnostics)
	}

	// Expand a single form
	expandForm { |form|
		if (this.currentDepth > this.maxDepth) {
			this.addDiagnostic(nil, "Macro expansion depth exceeded {this.maxDepth}");
			^form
		};

		if (form.isKindOf(ScscmAstList)) {
			^this.expandList(form)
		};
		
		if (form.isKindOf(ScscmAstSymbol)) {
			^this.expandSymbol(form)
		};
		
		// For quoted forms, don't expand the contents
		if (form.isKindOf(ScscmAstQuoted)) {
			form.expr = this.expandForm(form.expr);
			^form
		};
		
		// For quasiquoted forms, need special handling
		if (form.isKindOf(ScscmAstQuasiquoted)) {
			^this.expandQuasiquote(form)
		};
		
		// For other AST nodes, recursively expand children
		^this.expandChildren(form)
	}

	// Expand a list (check if it's a macro call)
	expandList { |list|
		if (list.elements.size == 0) { ^list };
		
		var first = list.elements[0];
		if (first.isKindOf(ScscmAstSymbol)) {
			var macroName = first.value.asString;
			if (this.macros.includesKey(macroName)) {
				return this.expandMacroCall(list, macroName)
			}
		}
		
		// Not a macro call - expand children
		^this.expandChildren(list)
	}

	// Expand a symbol (could be a macro that expands to something)
	// In scscm, symbols themselves don't expand, but this is a hook for future features
	expandSymbol { |symbol|
		^symbol
	}

	// Expand macro call
	expandMacroCall { |list, macroName|
		var macro = this.macros[macroName];
		
		// Build arguments from the rest of the list
		var args = list.elements.copyRange(1, list.elements.size - 1);
		
		// Expand arguments first
		var expandedArgs = args.collect({ |arg| this.expandForm(arg) });
		
		this.currentDepth = this.currentDepth + 1;
		
		// Apply the macro
		var result = this.applyMacro(macro, expandedArgs, list.line, list.col, list.file);
		
		this.currentDepth = this.currentDepth - 1;
		
		// Recursively expand the result
		^this.expandForm(result)
	}

	// Apply a macro function
	applyMacro { |macro, args, line, col, file|
		// If macro is an AST defmacro node, we need to evaluate it
		// For now, return the macro body as-is (stub)
		// In Phase P3, this will actually expand the macro
		
		if (macro.isKindOf(ScscmAstDefmacro)) {
			// Create a macro call node that represents the expansion
			// This is a placeholder - actual expansion logic goes here
			^ScscmAstList.new(
				args.add(ScscmAstSymbol.new("macro-expanded", line, col, file)),
				line, col, file
			)
		};
		
		// If macro is a function, call it
		if (macro.isKindOf(Function)) {
			^macro.value(*args)
		};
		
		// Default: return as-is
		^macro
	}

	// Expand quasiquote with unquote handling
	expandQuasiquote { |qq|
		qq.expr = this.expandQuasiquoteExpr(qq.expr);
		^qq
	}

	// Expand expression within quasiquote
	expandQuasiquoteExpr { |expr|
		if (expr.isKindOf(ScscmAstUnquoted)) {
			// Unquoted expression - expand and return as-is (no quoting)
			return this.expandForm(expr.expr)
		};
		
		if (expr.isKindOf(ScscmAstList)) {
			// List in quasiquote - need to handle unquote-splicing
			var newElements = List.new;
			expr.elements.do({ |elem|
				if (elem.isKindOf(ScscmAstUnquoted) and: { elem.splicing }) {
					// Unquote-splicing: expand and flatten
					var expanded = this.expandForm(elem.expr);
					if (expanded.isKindOf(ScscmAstList)) {
						newElements = newElements ++ expanded.elements
					} {
						newElements = newElements.add(expanded)
					}
				} {
					// Regular unquote or other
					newElements = newElements.add(this.expandQuasiquoteExpr(elem))
				}
			});
			return ScscmAstList.new(newElements, expr.line, expr.col, expr.file)
		};
		
		// For other nodes, recursively process
		^this.expandChildren(expr)
	}

	// Expand children of a node
	expandChildren { |node|
		// Use reflection to find all instance variables that are AST nodes or collections
		node.class.instanceVariables.do({ |varName|
			var value = node.perform(varName.asSymbol);
			if (value.isKindOf(ScscmAstNode)) {
				node.perform((varName ++ "_").asSymbol, this.expandForm(value))
			};
			if (value.isKindOf(Array) or: { value.isKindOf(List) }) {
				var newValue = value.collect({ |item|
					if (item.isKindOf(ScscmAstNode)) {
						this.expandForm(item)
					} { item }
				});
				node.perform((varName ++ "_").asSymbol, newValue)
			}
		});
		^node
	}

	// Add diagnostic
	addDiagnostic { |token, message|
		var line = (token.notNil ? token.line : 0);
		var col = (token.notNil ? token.col : 0);
		var file = (token.notNil ? token.file : "");
		this.diagnostics = this.diagnostics.add(
			ScscmDiagnostic.new("macro", line, col, message, file)
		)
	}

	// Reset expander state
	reset { 
		this.currentDepth = 0;
		this.diagnostics = List.new;
		^this
	}
}

// Macro expansion result
ScscmMacroExpandResult : Object {
	var <>ast, <>diagnostics;

	*new { |ast, diagnostics = []|
		^super.new.copy(ast: ast, diagnostics: diagnostics)
	}

	success { 
		^this.diagnostics.isEmpty
	}

	asString { 
		^"ScscmMacroExpandResult({this.success}, diagnostics: {this.diagnostics.size})"
	}
}
