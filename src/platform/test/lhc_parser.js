'use strict';

// AST node types
class SchemeExpr {
  constructor() {}
}

class Atom extends SchemeExpr {
  constructor(value, line, column) {
    super();
    this.type = 'atom';
    this.value = value;
    this.line = line;
    this.column = column;
  }
}

class Symbol extends SchemeExpr {
  constructor(name, line, column) {
    super();
    this.type = 'symbol';
    this.name = name;
    this.line = line;
    this.column = column;
  }
}

class StringLiteral extends SchemeExpr {
  constructor(value, line, column) {
    super();
    this.type = 'string';
    this.value = value;
    this.line = line;
    this.column = column;
  }
}

class NumberLiteral extends SchemeExpr {
  constructor(value, line, column) {
    super();
    this.type = 'number';
    this.value = value;
    this.line = line;
    this.column = column;
  }
}

class List extends SchemeExpr {
  constructor(elements, line, column) {
    super();
    this.type = 'list';
    this.elements = elements;
    this.line = line;
    this.column = column;
  }
}

class Vector extends SchemeExpr {
  constructor(elements, line, column) {
    super();
    this.type = 'vector';
    this.elements = elements;
    this.line = line;
    this.column = column;
  }
}

class Quote extends SchemeExpr {
  constructor(expr, line, column) {
    super();
    this.type = 'quote';
    this.expr = expr;
    this.line = line;
    this.column = column;
  }
}

class Quasiquote extends SchemeExpr {
  constructor(expr, line, column) {
    super();
    this.type = 'quasiquote';
    this.expr = expr;
    this.line = line;
    this.column = column;
  }
}

class Unquote extends SchemeExpr {
  constructor(expr, line, column) {
    super();
    this.type = 'unquote';
    this.expr = expr;
    this.line = line;
    this.column = column;
  }
}

class UnquoteSplicing extends SchemeExpr {
  constructor(expr, line, column) {
    super();
    this.type = 'unquote-splicing';
    this.expr = expr;
    this.line = line;
    this.column = column;
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  currentToken() {
    if (this.pos >= this.tokens.length) return null;
    return this.tokens[this.pos];
  }

  peekToken(offset = 1) {
    const nextPos = this.pos + offset;
    if (nextPos >= this.tokens.length) return null;
    return this.tokens[nextPos];
  }

  advance() {
    this.pos++;
  }

  consume(expectedType) {
    const token = this.currentToken();
    if (!token || token.type !== expectedType) {
      throw new Error(
        `Expected ${expectedType} but got ${token ? token.type : 'EOF'} at line ${
          token ? token.line : 'unknown'
        }, column ${token ? token.column : 'unknown'}`
      );
    }
    this.advance();
    return token;
  }

  parseList() {
    const lparen = this.consume('LPAREN');
    const elements = [];

    while (this.currentToken() && this.currentToken().type !== 'RPAREN') {
      elements.push(this.parseExpr());
    }

    this.consume('RPAREN');
    return new List(elements, lparen.line, lparen.column);
  }

  parseVector() {
    const lbracket = this.consume('LBRACKET');
    const elements = [];

    while (this.currentToken() && this.currentToken().type !== 'RBRACKET') {
      elements.push(this.parseExpr());
    }

    this.consume('RBRACKET');
    return new Vector(elements, lbracket.line, lbracket.column);
  }

  parseQuote() {
    const quote = this.consume('QUOTE');
    const expr = this.parseExpr();
    return new Quote(expr, quote.line, quote.column);
  }

  parseQuasiquote() {
    const quasiquote = this.consume('QUASIQUOTE');
    const expr = this.parseExpr();
    return new Quasiquote(expr, quasiquote.line, quasiquote.column);
  }

  parseUnquote() {
    const unquote = this.consume('UNQUOTE');
    const expr = this.parseExpr();
    return new Unquote(expr, unquote.line, unquote.column);
  }

  parseUnquoteSplicing() {
    const token = this.consume('UNQUOTE_SPLICING');
    const expr = this.parseExpr();
    return new UnquoteSplicing(expr, token.line, token.column);
  }

  parseKeyword() {
    const colon = this.consume('COLON');
    const nextToken = this.currentToken();
    if (!nextToken || nextToken.type !== 'SYMBOL') {
      throw new Error(
        `Expected symbol after ':' at line ${colon.line}, column ${colon.column}`
      );
    }
    const symbol = this.consume('SYMBOL');
    return new Symbol(`:${symbol.value}`, colon.line, colon.column);
  }

  // -------------------------------------------------------------------------
  // Hash-fn shorthand: #(body) → (fn (__p1 __p2 … [. __rest]) body)
  //
  // Inside the body:
  //   %  or %1  → first positional arg  (__p1)
  //   %2 … %N   → Nth positional arg    (__pN)
  //   %&         → rest arg              (__rest)
  // -------------------------------------------------------------------------

  // Recursively collect all %N / %& references from an AST subtree.
  _collectArgRefs(node, refs, restRef) {
    if (!node) return;
    if (node.type === 'symbol') {
      const n = node.name;
      if (n === '%' || n === '%1') refs.add(1);
      else if (/^%[0-9]+$/.test(n)) refs.add(parseInt(n.slice(1), 10));
      else if (n === '%&') restRef.flag = true;
    }
    if (node.elements) node.elements.forEach((e) => this._collectArgRefs(e, refs, restRef));
    if (node.expr)     this._collectArgRefs(node.expr, refs, restRef);
  }

  // Recursively substitute %N / %& with generated param names.
  _substArgRefs(node) {
    if (!node) return node;
    if (node.type === 'symbol') {
      const n = node.name;
      if (n === '%' || n === '%1') return new Symbol('__p1', node.line, node.column);
      if (/^%[0-9]+$/.test(n))    return new Symbol(`__p${n.slice(1)}`, node.line, node.column);
      if (n === '%&')              return new Symbol('__rest', node.line, node.column);
      return node;
    }
    // Recurse into compound nodes
    if (node.elements !== undefined) {
      const mapped = node.elements.map((e) => this._substArgRefs(e));
      return new node.constructor(mapped, node.line, node.column);
    }
    if (node.expr !== undefined) {
      return new node.constructor(this._substArgRefs(node.expr), node.line, node.column);
    }
    return node;
  }

  parseHashFn() {
    const token = this.consume('HASH_LPAREN');
    const elements = [];

    while (this.currentToken() && this.currentToken().type !== 'RPAREN') {
      if (this.currentToken().type === 'EOF') {
        throw new Error(
          `Unexpected end of file inside #() at line ${token.line}, column ${token.column}`
        );
      }
      elements.push(this.parseExpr());
    }
    this.consume('RPAREN');

    // The entire content is ONE implicit list body — matching Clojure semantics:
    //   #(+ % 1)  →  (fn (__p1) (+ __p1 1))
    const bodyList = new List(elements, token.line, token.column);

    // Collect arg refs from the body
    const refs    = new Set();
    const restRef = { flag: false };
    this._collectArgRefs(bodyList, refs, restRef);

    // Build param list: __p1 … __pN [. __rest]
    const maxRef = refs.size > 0 ? Math.max(...refs) : 0;
    const params = [];
    for (let i = 1; i <= maxRef; i++) {
      params.push(new Symbol(`__p${i}`, token.line, token.column));
    }
    if (restRef.flag) {
      params.push(new Symbol('.', token.line, token.column));
      params.push(new Symbol('__rest', token.line, token.column));
    }

    // Substitute % refs in body
    const substBody = this._substArgRefs(bodyList);

    // Return (fn (params…) substBody)
    return new List(
      [
        new Symbol('fn', token.line, token.column),
        new List(params, token.line, token.column),
        substBody,
      ],
      token.line,
      token.column
    );
  }

  parseExpr() {
    const token = this.currentToken();

    if (!token) {
      throw new Error('Unexpected end of input');
    }

    switch (token.type) {
      case 'NUMBER':
        this.advance();
        return new NumberLiteral(token.value, token.line, token.column);

      case 'STRING':
        this.advance();
        return new StringLiteral(token.value, token.line, token.column);

      case 'SYMBOL':
        this.advance();
        return new Symbol(token.value, token.line, token.column);

      case 'LPAREN':
        return this.parseList();

      case 'LBRACKET':
        return this.parseVector();

      case 'QUOTE':
        return this.parseQuote();

      case 'QUASIQUOTE':
        return this.parseQuasiquote();

      case 'UNQUOTE':
        return this.parseUnquote();

      case 'UNQUOTE_SPLICING':
        return this.parseUnquoteSplicing();

      case 'COLON':
        return this.parseKeyword();

      case 'HASH_LPAREN':
        return this.parseHashFn();

      case 'EOF':
        throw new Error('Unexpected end of file');

      default:
        throw new Error(
          `Unexpected token type '${token.type}' at line ${token.line}, column ${token.column}`
        );
    }
  }

  parse() {
    const expressions = [];

    while (this.currentToken() && this.currentToken().type !== 'EOF') {
      expressions.push(this.parseExpr());
    }

    return expressions;
  }
}

export {
  Parser,
  SchemeExpr,
  Atom,
  Symbol,
  StringLiteral,
  NumberLiteral,
  List,
  Vector,
  Quote,
  Quasiquote,
  Unquote,
  UnquoteSplicing,
};
