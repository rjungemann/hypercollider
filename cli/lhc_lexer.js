'use strict';

class Token {
  constructor(type, value, line, column) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
  }
}

class Lexer {
  constructor(input, opts = {}) {
    this.input = input;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];
    this.keepComments = opts.keepComments || false;
  }

  currentChar() {
    if (this.pos >= this.input.length) return null;
    return this.input[this.pos];
  }

  peekChar(offset = 1) {
    const nextPos = this.pos + offset;
    if (nextPos >= this.input.length) return null;
    return this.input[nextPos];
  }

  advance() {
    if (this.pos < this.input.length) {
      if (this.input[this.pos] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      this.pos++;
    }
  }

  skipWhitespace() {
    while (this.currentChar() && /\s/.test(this.currentChar())) {
      this.advance();
    }
  }

  skipComment() {
    if (this.currentChar() === ';') {
      const line = this.line;
      const column = this.column;
      let text = '';
      while (this.currentChar() && this.currentChar() !== '\n') {
        text += this.currentChar();
        this.advance();
      }
      if (this.currentChar() === '\n') {
        this.advance();
      }
      if (this.keepComments) {
        this.tokens.push(new Token('COMMENT', text, line, column));
      }
      return true;
    }
    return false;
  }

  readString(quote) {
    let result = '';
    this.advance();
    while (this.currentChar() && this.currentChar() !== quote) {
      if (this.currentChar() === '\\') {
        this.advance();
        const char = this.currentChar();
        switch (char) {
          case 'n':
            result += '\n';
            break;
          case 't':
            result += '\t';
            break;
          case 'r':
            result += '\r';
            break;
          case '\\':
            result += '\\';
            break;
          case '"':
            result += '"';
            break;
          default:
            result += char;
        }
        this.advance();
      } else {
        result += this.currentChar();
        this.advance();
      }
    }
    if (this.currentChar() === quote) {
      this.advance();
    } else {
      throw new Error(
        `Unterminated string at line ${this.line}, column ${this.column}`
      );
    }
    return result;
  }

  readNumber() {
    let result = '';
    let isFloat = false;

    while (this.currentChar() && /[0-9.]/.test(this.currentChar())) {
      if (this.currentChar() === '.') {
        if (isFloat) break;
        isFloat = true;
      }
      result += this.currentChar();
      this.advance();
    }

    return isFloat ? parseFloat(result) : parseInt(result, 10);
  }

  readAtom() {
    let result = '';
    // ꟛ (U+A7DB) is accepted as a valid atom character (alias for fn)
    // % is accepted so that %1, %2, %& (hash-fn arg refs) tokenise as SYMBOLs
    const startChars = /[a-zA-Z_%\-*+/<>=!?.ꟛ]/;
    const contChars = /[a-zA-Z0-9_%&\-*+/<>=!?.ꟛ]/;

    while (
      this.currentChar() &&
      (result.length === 0
        ? startChars.test(this.currentChar())
        : contChars.test(this.currentChar()))
    ) {
      result += this.currentChar();
      this.advance();
    }

    return result;
  }

  tokenize() {
    this.tokens = [];

    while (this.pos < this.input.length) {
      this.skipWhitespace();

      if (this.pos >= this.input.length) break;

      if (this.skipComment()) {
        continue;
      }

      const char = this.currentChar();
      const line = this.line;
      const column = this.column;

      if (char === '(') {
        this.tokens.push(new Token('LPAREN', '(', line, column));
        this.advance();
      } else if (char === ')') {
        this.tokens.push(new Token('RPAREN', ')', line, column));
        this.advance();
      } else if (char === '[') {
        this.tokens.push(new Token('LBRACKET', '[', line, column));
        this.advance();
      } else if (char === ']') {
        this.tokens.push(new Token('RBRACKET', ']', line, column));
        this.advance();
      } else if (char === '{') {
        this.tokens.push(new Token('LBRACE', '{', line, column));
        this.advance();
      } else if (char === '}') {
        this.tokens.push(new Token('RBRACE', '}', line, column));
        this.advance();
      } else if (char === "'") {
        this.tokens.push(new Token('QUOTE', "'", line, column));
        this.advance();
      } else if (char === '`') {
        this.tokens.push(new Token('QUASIQUOTE', '`', line, column));
        this.advance();
      } else if (char === '~') {
        if (this.peekChar() === '@') {
          this.tokens.push(new Token('UNQUOTE_SPLICING', '~@', line, column));
          this.advance();
          this.advance();
        } else {
          this.tokens.push(new Token('UNQUOTE', '~', line, column));
          this.advance();
        }
      } else if (char === ':') {
        this.tokens.push(new Token('COLON', ':', line, column));
        this.advance();
      } else if (char === '"') {
        const str = this.readString('"');
        this.tokens.push(new Token('STRING', str, line, column));
      } else if (/[0-9]/.test(char)) {
        const num = this.readNumber();
        this.tokens.push(new Token('NUMBER', num, line, column));
      } else if (char === '-' && /[0-9]/.test(this.peekChar())) {
        this.advance(); // consume '-'
        const num = this.readNumber();
        this.tokens.push(new Token('NUMBER', -num, line, column));
      } else if (char === '#' && this.peekChar() === '(') {
        // #( — Clojure-style anonymous function shorthand reader macro
        this.tokens.push(new Token('HASH_LPAREN', '#(', line, column));
        this.advance(); // skip '#'
        this.advance(); // skip '('
      } else {
        const atom = this.readAtom();
        if (atom) {
          this.tokens.push(new Token('SYMBOL', atom, line, column));
        } else {
          throw new Error(
            `Unexpected character '${char}' at line ${line}, column ${column}`
          );
        }
      }
    }

    this.tokens.push(new Token('EOF', null, this.line, this.column));
    return this.tokens;
  }
}

module.exports = { Lexer, Token };
