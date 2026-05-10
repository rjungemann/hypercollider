// ScscmAst.sc - AST model for scscm-in-sclang compiler
// Part of Phase P0: Harness bootstrap

// AST Node base class
ScscmAstNode : Object {
	var <>type, <>line, <>col, <>file;

	// Node types
	*const { 
		\list = \list.asSymbol,
		\atom = \atom.asSymbol,
		\symbol = \symbol.asSymbol,
		\number = \number.asSymbol,
		\string = \string.asSymbol,
		\boolean = \boolean.asSymbol,
		\quoted = \quoted.asSymbol,
		\quasiquoted = \quasiquoted.asSymbol,
		\unquoted = \unquoted.asSymbol,
		\unquoteSplicing = \unquoteSplicing.asSymbol,
		\call = \call.asSymbol,
		\def = \def.asSymbol,
		\let = \let.asSymbol,
		\var = \var.asSymbol,
		\set = \set.asSymbol,
		\fn = \fn.asSymbol,
		\if = \if.asSymbol,
		\when = \when.asSymbol,
		\cond = \cond.asSymbol,
		\defsynth = \defsynth.asSymbol,
		\defn = \defn.asSymbol,
		\defmacro = \defmacro.asSymbol,
		\array = \array.asSymbol,
		\do = \do.asSymbol,
		\loop = \loop.asSymbol,
		\recur = \recur.asSymbol,
		\unless = \unless.asSymbol
	};

	// Constructor
	*new { |type, line = 0, col = 0, file = ""|
		^super.new.copy(type: type, line: line, col: col, file: file)
	}

	// String representation
	asString { 
		^"ScscmAstNode({type}, {line}:{col})"
	}

	// Position info
	positionString { 
		^"{this.file}:{this.line}:{this.col}"
	}
}

// List node - represents ( ... )
ScscmAstList : ScscmAstNode {
	var <>elements;

	*new { |elements, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\list], 
			elements: elements, line: line, col: col, file: file)
	}

	asString { 
		^"({elements.collect({|e| e.asString}).join(" ")})"
	}
}

// Atom node - base for simple values
ScscmAstAtom : ScscmAstNode {
	var <>value;

	*new { |type, value, line = 0, col = 0, file = ""|
		^super.new.copy(type: type, value: value, 
			line: line, col: col, file: file)
	}

	asString { 
		^value.asString
	}
}

// Symbol node
ScscmAstSymbol : ScscmAstAtom {
	*new { |value, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\symbol], 
			value: value, line: line, col: col, file: file)
	}
}

// Number node
ScscmAstNumber : ScscmAstAtom {
	*new { |value, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\number], 
			value: value, line: line, col: col, file: file)
	}
}

// String node
ScscmAstString : ScscmAstAtom {
	*new { |value, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\string], 
			value: value, line: line, col: col, file: file)
	}

	asString { 
		^"\"{value}\""
	}
}

// Boolean node
ScscmAstBoolean : ScscmAstAtom {
	*new { |value, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\boolean], 
			value: value, line: line, col: col, file: file)
	}
}

// Nil node
ScscmAstNil : ScscmAstNode {
	*new { |line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\nil], 
			line: line, col: col, file: file)
	}

	asString { 
		^"nil"
	}
}

// Quoted expression: '(...) or 'symbol
ScscmAstQuoted : ScscmAstNode {
	var <>expr;

	*new { |expr, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\quoted], 
			expr: expr, line: line, col: col, file: file)
	}

	asString { 
		^"'{expr.asString}"
	}
}

// Quasiquoted expression: `(...)
ScscmAstQuasiquoted : ScscmAstNode {
	var <>expr;

	*new { |expr, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\quasiquoted], 
			expr: expr, line: line, col: col, file: file)
	}

	asString { 
		^"`{expr.asString}"
	}
}

// Unquoted expression: ,expr or ,@expr
ScscmAstUnquoted : ScscmAstNode {
	var <>expr, <>splicing;

	*new { |expr, splicing = false, line = 0, col = 0, file = ""|
		^super.new.copy(type: (splicing ? ScscmAstNode.const[\unquoteSplicing] : ScscmAstNode.const[\unquoted]),
			expr: expr, splicing: splicing, line: line, col: col, file: file)
	}

	asString { 
		^(this.splicing ? ",@{expr.asString}" : ",{expr.asString}")
	}
}

// Function call: (fn arg1 arg2 ...)
ScscmAstCall : ScscmAstNode {
	var <>fn, <>args;

	*new { |fn, args, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\call], 
			fn: fn, args: args, line: line, col: col, file: file)
	}

	asString { 
		^"({fn.asString}{args.collect({|e| e.asString}).join(" ")})"
	}
}

// Definition: (def name value)
ScscmAstDef : ScscmAstNode {
	var <>name, <>value;

	*new { |name, value, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\def], 
			name: name, value: value, line: line, col: col, file: file)
	}

	asString { 
		^"(def {name.asString} {value.asString})"
	}
}

// let binding: (let [name expr] ... body)
ScscmAstLet : ScscmAstNode {
	var <>bindings, <>body;

	*new { |bindings, body, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\let], 
			bindings: bindings, body: body, line: line, col: col, file: file)
	}

	asString { 
		var bindingStr = bindings.collect({|b| "[{b[0].asString} {b[1].asString}]"}).join(" ");
		^"(let {bindingStr} {body.asString})"
	}
}

// fn definition: (fn [arg1 arg2 ...] body)
ScscmAstFn : ScscmAstNode {
	var <>args, <>body;

	*new { |args, body, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\fn], 
			args: args, body: body, line: line, col: col, file: file)
	}

	asString { 
		^"(fn [{args.collect({|e| e.asString}).join(" ")}] {body.asString})"
	}
}

// if expression: (if test consequent alternate?)
ScscmAstIf : ScscmAstNode {
	var <>test, <>consequent, <>alternate;

	*new { |test, consequent, alternate = nil, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\if], 
			test: test, consequent: consequent, alternate: alternate, 
			line: line, col: col, file: file)
	}

	asString { 
		^(alternate.isNil 
			? "(if {test.asString} {consequent.asString})"
			: "(if {test.asString} {consequent.asString} {alternate.asString})")
	}
}

// defsynth: (defsynth name [arg1 ...] body)
ScscmAstDefsynth : ScscmAstNode {
	var <>name, <>args, <>body;

	*new { |name, args, body, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\defsynth], 
			name: name, args: args, body: body, line: line, col: col, file: file)
	}

	asString { 
		^"(defsynth {name.asString} [{args.collect({|e| e.asString}).join(" ")}] {body.asString})"
	}
}

// defn: (defn name [arg1 ...] body)
ScscmAstDefn : ScscmAstNode {
	var <>name, <>args, <>body;

	*new { |name, args, body, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\defn], 
			name: name, args: args, body: body, line: line, col: col, file: file)
	}

	asString { 
		^"(defn {name.asString} [{args.collect({|e| e.asString}).join(" ")}] {body.asString})"
	}
}

// defmacro: (defmacro name [arg1 ...] body)
ScscmAstDefmacro : ScscmAstNode {
	var <>name, <>args, <>body;

	*new { |name, args, body, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\defmacro], 
			name: name, args: args, body: body, line: line, col: col, file: file)
	}

	asString { 
		^"(defmacro {name.asString} [{args.collect({|e| e.asString}).join(" ")}] {body.asString})"
	}
}

// Set expression: (set! name value)
ScscmAstSet : ScscmAstNode {
	var <>name, <>value;

	*new { |name, value, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\set], 
			name: name, value: value, line: line, col: col, file: file)
	}

	asString { 
		^"(set! {name.asString} {value.asString})"
	}
}

// Do expression: (do expr1 expr2 ...)
ScscmAstDo : ScscmAstNode {
	var <>expressions;

	*new { |expressions, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\do], 
			expressions: expressions, line: line, col: col, file: file)
	}

	asString { 
		^"(do {expressions.collect({|e| e.asString}).join(" ")})"
	}
}

// Loop expression: (loop [binding value] ... body)
ScscmAstLoop : ScscmAstNode {
	var <>bindings, <>body;

	*new { |bindings, body, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\loop], 
			bindings: bindings, body: body, line: line, col: col, file: file)
	}

	asString { 
		var bindingStr = bindings.collect({|b| "[{b[0].asString} {b[1].asString}]"}).join(" ");
		var bodyStr = body.collect({|e| e.asString}).join(" ");
		^"(loop {bindingStr} {bodyStr})"
	}
}

// Recur expression: (recur expr1 expr2 ...)
ScscmAstRecur : ScscmAstNode {
	var <>args;

	*new { |args, line = 0, col = 0, file = ""|
		^super.new.copy(type: ScscmAstNode.const[\recur], 
			args: args, line: line, col: col, file: file)
	}

	asString { 
		^"(recur {args.collect({|e| e.asString}).join(" ")})"
	}
}
