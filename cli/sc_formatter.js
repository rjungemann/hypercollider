'use strict';

// ---------------------------------------------------------------------------
// Token type constants
// ---------------------------------------------------------------------------

const TT = {
  COMMENT_LINE:  'COMMENT_LINE',
  COMMENT_BLOCK: 'COMMENT_BLOCK',
  STRING:        'STRING',
  CHAR:          'CHAR',
  SYMBOL:        'SYMBOL',
  IDENT:         'IDENT',
  NUMBER:        'NUMBER',
  LBRACE:        'LBRACE',
  RBRACE:        'RBRACE',
  LPAREN:        'LPAREN',
  RPAREN:        'RPAREN',
  LBRACKET:      'LBRACKET',
  RBRACKET:      'RBRACKET',
  SEMICOLON:     'SEMICOLON',
  COLON:         'COLON',
  COMMA:         'COMMA',
  DOT:           'DOT',
  PIPE:          'PIPE',
  CARET:         'CARET',
  AT:            'AT',
  HASH:          'HASH',
  OP:            'OP',
  WHITESPACE:    'WHITESPACE',
  NEWLINE:       'NEWLINE',
  UNKNOWN:       'UNKNOWN',
  EOF:           'EOF',
};

const TWO_CHAR_OPS   = new Set(['==', '!=', '<=', '>=', '<<', '>>', '++', '<>', '&&', '||', '**', '->', '??', '!~', '<-', '::', '..']);
const THREE_CHAR_OPS = new Set(['...', '>>>']);
const OP_CHARS       = new Set(['+', '-', '*', '/', '%', '&', '~', '!', '<', '>', '=', '?']);

const SINGLE_PUNCT = {
  '{': TT.LBRACE, '}': TT.RBRACE,
  '(': TT.LPAREN, ')': TT.RPAREN,
  '[': TT.LBRACKET, ']': TT.RBRACKET,
  ';': TT.SEMICOLON, ',': TT.COMMA,
  '^': TT.CARET, '|': TT.PIPE,
  '@': TT.AT, '#': TT.HASH,
};

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

class Lexer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
    this.line = 1;
    this.col  = 1;
  }

  _eof() { return this.pos >= this.src.length; }

  _ch(offset = 0) {
    const p = this.pos + offset;
    return p < this.src.length ? this.src[p] : '';
  }

  _adv(n = 1) {
    let s = '';
    for (let i = 0; i < n; i++) {
      if (this.pos < this.src.length) {
        const c = this.src[this.pos];
        s += c;
        if (c === '\n') { this.line++; this.col = 1; }
        else            { this.col++; }
        this.pos++;
      }
    }
    return s;
  }

  _tok(type, value, line, col) { return { type, value, line, col }; }

  tokenize() {
    const tokens = [];
    while (!this._eof()) {
      const t = this._next();
      if (t !== null) tokens.push(t);
    }
    tokens.push(this._tok(TT.EOF, '', this.line, this.col));
    return tokens;
  }

  _next() {
    const line = this.line, col = this.col;
    const c = this._ch();

    if (c === '\n') {
      this._adv();
      return this._tok(TT.NEWLINE, '\n', line, col);
    }

    if (c === ' ' || c === '\t' || c === '\r') {
      let val = '';
      while (!this._eof() && this._ch() !== '\n' &&
             (this._ch() === ' ' || this._ch() === '\t' || this._ch() === '\r')) {
        val += this._adv();
      }
      return this._tok(TT.WHITESPACE, val, line, col);
    }

    // // line comment
    if (c === '/' && this._ch(1) === '/') {
      let val = '';
      while (!this._eof() && this._ch() !== '\n') val += this._adv();
      return this._tok(TT.COMMENT_LINE, val, line, col);
    }

    // /* block comment (nestable) */
    if (c === '/' && this._ch(1) === '*') {
      let val = this._adv(2);
      let depth = 1;
      while (!this._eof() && depth > 0) {
        if      (this._ch() === '/' && this._ch(1) === '*') { val += this._adv(2); depth++; }
        else if (this._ch() === '*' && this._ch(1) === '/') { val += this._adv(2); depth--; }
        else                                                  { val += this._adv(); }
      }
      return this._tok(TT.COMMENT_BLOCK, val, line, col);
    }

    // String "..."
    if (c === '"') {
      let val = this._adv();
      while (!this._eof() && this._ch() !== '"') {
        if (this._ch() === '\\') val += this._adv(2);
        else                     val += this._adv();
      }
      if (this._ch() === '"') val += this._adv();
      return this._tok(TT.STRING, val, line, col);
    }

    // Char $x or $\n
    if (c === '$') {
      let val = this._adv();
      if (!this._eof()) {
        if (this._ch() === '\\') val += this._adv(2);
        else                     val += this._adv();
      }
      return this._tok(TT.CHAR, val, line, col);
    }

    // Symbol \ident or \\
    if (c === '\\') {
      let val = this._adv();
      while (/[a-zA-Z0-9_]/.test(this._ch())) val += this._adv();
      return this._tok(TT.SYMBOL, val, line, col);
    }

    // Number
    if (/[0-9]/.test(c)) {
      let val = '';
      if (c === '0' && (this._ch(1) === 'x' || this._ch(1) === 'X')) {
        val += this._adv(2);
        while (/[0-9a-fA-F_]/.test(this._ch())) val += this._adv();
      } else {
        while (/[0-9]/.test(this._ch())) val += this._adv();
        if (this._ch() === 'r' && /[a-zA-Z0-9]/.test(this._ch(1))) {
          val += this._adv();
          while (/[a-zA-Z0-9]/.test(this._ch())) val += this._adv();
        } else {
          if (this._ch() === '.' && /[0-9]/.test(this._ch(1))) {
            val += this._adv();
            while (/[0-9]/.test(this._ch())) val += this._adv();
          }
          if (this._ch() === 'e' || this._ch() === 'E') {
            val += this._adv();
            if (this._ch() === '+' || this._ch() === '-') val += this._adv();
            while (/[0-9]/.test(this._ch())) val += this._adv();
          }
        }
      }
      return this._tok(TT.NUMBER, val, line, col);
    }

    // Identifier
    if (/[a-zA-Z_]/.test(c)) {
      let val = '';
      while (/[a-zA-Z0-9_]/.test(this._ch())) val += this._adv();
      return this._tok(TT.IDENT, val, line, col);
    }

    // Single-char punctuation
    if (SINGLE_PUNCT[c] !== undefined) {
      this._adv();
      return this._tok(SINGLE_PUNCT[c], c, line, col);
    }

    // Dots: ... or .. or .
    if (c === '.') {
      if (this._ch(1) === '.' && this._ch(2) === '.') return this._tok(TT.OP,  this._adv(3), line, col);
      if (this._ch(1) === '.')                         return this._tok(TT.OP,  this._adv(2), line, col);
      this._adv();
      return this._tok(TT.DOT, '.', line, col);
    }

    // Colon :: or :
    if (c === ':') {
      if (this._ch(1) === ':') return this._tok(TT.OP,   this._adv(2), line, col);
      this._adv();
      return this._tok(TT.COLON, ':', line, col);
    }

    // Multi-char operators
    const three = c + this._ch(1) + this._ch(2);
    if (THREE_CHAR_OPS.has(three)) return this._tok(TT.OP, this._adv(3), line, col);
    const two = c + this._ch(1);
    if (TWO_CHAR_OPS.has(two))     return this._tok(TT.OP, this._adv(2), line, col);
    if (OP_CHARS.has(c))           return this._tok(TT.OP, this._adv(),  line, col);

    // Fallback
    return this._tok(TT.UNKNOWN, this._adv(), line, col);
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const DEFAULT_OPTS = {
  indentTabs:   true,
  indentSpaces: 4,
  columnLimit:  120,
  maxBlankTop:  2,
  maxBlankBody: 1,
};

function indentStr(depth, opts) {
  if (opts.indentTabs) return '\t'.repeat(depth);
  return ' '.repeat(depth * opts.indentSpaces);
}

function isOpener(tt) { return tt === TT.LBRACE || tt === TT.LPAREN || tt === TT.LBRACKET; }
function isCloser(tt) { return tt === TT.RBRACE || tt === TT.RPAREN || tt === TT.RBRACKET; }

class Formatter {
  constructor(opts = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  format(source) {
    let tokens;
    try {
      tokens = new Lexer(source).tokenize();
    } catch (e) {
      if (typeof process !== 'undefined') process.stderr.write(`sc-format: lex error: ${e.message}\n`);
      return source;
    }

    const lines = this._splitLines(tokens);
    let formatted = this._formatLines(lines);
    formatted = this._normalizeBlankLines(formatted);
    return formatted.join('\n') + '\n';
  }

  // -------------------------------------------------------------------------
  // Detect class declaration lines (ClassName : SuperClass)
  // -------------------------------------------------------------------------

  _isClassDecl(tokens, depth) {
    if (depth !== 0) return false;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type === TT.LPAREN) return false;
      if (tok.type === TT.COLON && i > 0 && i < tokens.length - 1) {
        if (tokens[i - 1].type === TT.IDENT && tokens[i + 1].type === TT.IDENT) return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Split flat token list into lines
  // -------------------------------------------------------------------------

  _splitLines(tokens) {
    const lines = [];
    let current = [];
    for (const tok of tokens) {
      if (tok.type === TT.EOF) break;
      if (tok.type === TT.NEWLINE) {
        lines.push(current);
        current = [];
      } else {
        current.push(tok);
      }
    }
    if (current.length > 0) lines.push(current);
    return lines;
  }

  // -------------------------------------------------------------------------
  // Format each line: re-indent + normalize inner spacing
  // -------------------------------------------------------------------------

  _formatLines(lines) {
    let depth = 0;
    const result = [];

    for (const lineTokens of lines) {
      const content = lineTokens.filter(t => t.type !== TT.WHITESPACE);

      if (content.length === 0) {
        result.push('');
        continue;
      }

      // If line starts with a closer, indent at depth-1
      const effectiveDepth = isCloser(content[0].type) ? Math.max(0, depth - 1) : depth;

      const isCdl = this._isClassDecl(content, depth);
      const inner = this._joinTokens(content, depth, isCdl);

      result.push(indentStr(effectiveDepth, this.opts) + inner);

      // Update depth from openers/closers on this line
      for (const tok of content) {
        if (tok.type === TT.COMMENT_LINE) break;
        if (tok.type === TT.COMMENT_BLOCK) continue;
        if (tok.type === TT.LBRACE)       depth++;
        else if (tok.type === TT.RBRACE)  depth = Math.max(0, depth - 1);
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Join tokens on a single logical line with correct spacing
  // -------------------------------------------------------------------------

  _joinTokens(tokens, depth, isClassDeclLine = false) {
    if (tokens.length === 0) return '';

    const isVarDeclLine = tokens.length > 0 &&
      tokens[0].type === TT.IDENT &&
      (tokens[0].value === 'var' || tokens[0].value === 'classvar');

    const parts = [];
    let prevType = null;
    let prevVal  = '';
    let prevIsFirst        = false;
    let prevIsAccessor     = false;
    let prevIsOpeningPipe  = false;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const val = tok.value;
      const tt  = tok.type;

      // Stop at line comment
      if (tt === TT.COMMENT_LINE) {
        if (parts.length > 0) parts.push('  ');
        parts.push(val);
        break;
      }

      const space = this._spaceBefore(tok, prevType, prevVal, i === 0, {
        prevIsFirst,
        isClassDeclLine,
        prevIsAccessor,
        prevIsOpeningPipe,
      });
      if (space && parts.length > 0) parts.push(' ');

      parts.push(val);

      prevIsFirst = (i === 0);
      prevIsAccessor = (
        isVarDeclLine &&
        tt === TT.OP &&
        (val === '<' || val === '>' || val === '<>') &&
        (prevVal === 'var' || prevVal === 'classvar' || prevType === TT.COMMA)
      );
      prevIsOpeningPipe = (tt === TT.PIPE && prevType === TT.LBRACE);
      prevType = tt;
      prevVal  = val;
    }

    return parts.join('');
  }

  _spaceBefore(tok, prevType, prevVal, isFirst, {
    prevIsFirst = false,
    isClassDeclLine = false,
    prevIsAccessor = false,
    prevIsOpeningPipe = false,
  } = {}) {
    const tt  = tok.type;
    const val = tok.value;

    if (isFirst || prevType === null) return false;

    // Never space before these
    if (tt === TT.DOT || tt === TT.COMMA || tt === TT.SEMICOLON ||
        tt === TT.RPAREN || tt === TT.RBRACKET) return false;

    // Space before `:` only in class declarations
    if (tt === TT.COLON) return isClassDeclLine;

    // Always space after `:`
    if (prevType === TT.COLON) return true;

    // Space after `{`; empty `{}` stays compact
    if (prevType === TT.LBRACE) return tt !== TT.RBRACE;

    // Space before `}`; empty `{}` stays compact
    if (tt === TT.RBRACE) return prevType !== TT.LBRACE;

    // No space after opening brackets
    if (prevType === TT.LPAREN || prevType === TT.LBRACKET) return false;

    // No space before `(` for method calls; keep space for `= (expr)`
    if (tt === TT.LPAREN) {
      return !(prevType === TT.IDENT || prevType === TT.RPAREN ||
               prevType === TT.RBRACKET || prevType === TT.RBRACE ||
               prevType === TT.CARET);
    }

    // Always space after comma
    if (prevType === TT.COMMA) return true;

    // Always space after semicolon
    if (prevType === TT.SEMICOLON) return true;

    // Pipe / argument-list: `{ |arg1, arg2| body }`
    if (tt === TT.PIPE) {
      if (prevType === TT.LBRACE) return true;  // space before opening |
      return false;                              // no space before closing |
    }
    if (prevType === TT.PIPE) {
      if (tt === TT.PIPE)        return false;  // `||` — no space
      if (prevIsOpeningPipe)     return false;  // no space after opening |
      return true;                              // space after closing |
    }

    // `*method`: no space between `*` and method name when `*` is first token
    if (prevType === TT.OP && prevVal === '*' && prevIsFirst) return false;

    // Var accessor: `var <foo, >bar, <>baz`
    if (prevIsAccessor && tt === TT.IDENT) return false;

    // Binary operators: space on both sides
    if (tt === TT.OP && val !== '..' && val !== '...') return true;
    if (prevType === TT.OP && prevVal !== '..' && prevVal !== '...') return true;

    // Space before `{` (block literal)
    if (tt === TT.LBRACE) {
      return prevType !== TT.LPAREN && prevType !== TT.LBRACKET && prevType !== TT.LBRACE;
    }

    // Default: space between most adjacent literal/identifier tokens
    // LBRACKET excluded: array subscript `arr[i]` has no space before `[`
    const literalTypes = new Set([TT.IDENT, TT.NUMBER, TT.STRING, TT.CHAR, TT.SYMBOL]);
    if (literalTypes.has(prevType) &&
        (literalTypes.has(tt) || tt === TT.LBRACE || tt === TT.CARET)) {
      return true;
    }

    // Space after closing brackets (when followed by a token)
    const closerTypes = new Set([TT.RPAREN, TT.RBRACKET, TT.RBRACE]);
    if (closerTypes.has(prevType)) {
      if (tt === TT.IDENT || tt === TT.NUMBER || tt === TT.STRING ||
          tt === TT.LBRACE || tt === TT.LPAREN || tt === TT.LBRACKET ||
          tt === TT.CARET || tt === TT.DOT || tt === TT.SEMICOLON) {
        return tt !== TT.DOT && tt !== TT.SEMICOLON;
      }
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Blank line normalization
  // -------------------------------------------------------------------------

  _normalizeBlankLines(lines) {
    const out = [];
    let blankRun = 0;
    let depth = 0;

    for (const ln of lines) {
      const stripped = ln.trim();
      if (stripped === '') {
        blankRun++;
      } else {
        const maxBlanks = depth === 0 ? this.opts.maxBlankTop : this.opts.maxBlankBody;
        const allowed = Math.min(blankRun, maxBlanks);
        for (let i = 0; i < allowed; i++) out.push('');
        blankRun = 0;
        out.push(ln);
        // Update depth (approximate — stop at strings and comments)
        for (let i = 0; i < stripped.length; i++) {
          const ch = stripped[i];
          if (ch === '"') break;
          if (ch === '/' && stripped[i + 1] === '/') break;
          if (ch === '{')      depth++;
          else if (ch === '}') depth = Math.max(0, depth - 1);
        }
      }
    }

    // Remove trailing blank lines
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();

    return out;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function format(source, opts = {}) {
  return new Formatter(opts).format(source);
}

if (typeof module !== 'undefined') {
  module.exports = { Lexer, Formatter, format, TT };
}
