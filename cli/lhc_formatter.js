'use strict';

const { Lexer } = require('./lhc_lexer');
const { Parser } = require('./lhc_parser');
const { MacroExpander } = require('./lhc_macros');

const DEFAULT_LINE_LENGTH = 80;

// Special forms that control their own indentation
const BODY_FORMS = new Set(['fn', 'ꟛ', 'defn', 'defmacro', 'class', 'let', 'if', 'cond']);
const SPECIAL_FORMS = new Set([
  'fn', 'ꟛ', 'defn', 'defmacro', 'var', 'set!', 'let', 'if', 'cond',
  '.', '.dot', 'class', 'dict', 'list', 'array', 'quote',
  'quasiquote', 'super', 'this',
]);

// ---------------------------------------------------------------------------
// Comment collection
// ---------------------------------------------------------------------------

/**
 * Scan the source for comment positions without running the full parser.
 * Returns:
 *   leadingMap  – Map<nodeLine: number, lines: string[]>
 *                 Standalone comment-line groups, keyed by the source line
 *                 number of the first non-comment/non-blank line following
 *                 the group (i.e. the line where the next form starts).
 *   trailingMap – Map<sourceLine: number, commentText: string>
 *                 Inline comments (appear after code on the same line).
 */
function collectComments(source) {
  const leadingMap = new Map();
  const trailingMap = new Map();
  const srcLines = source.split('\n');

  const lineInfo = srcLines.map((raw) => {
    const stripped = raw.trimStart();
    if (stripped === '' || stripped === undefined) return { kind: 'blank' };
    if (stripped.startsWith(';')) return { kind: 'comment', raw };
    const semiPos = findInlineCommentPos(raw);
    if (semiPos >= 0) {
      return { kind: 'mixed', commentText: raw.slice(semiPos) };
    }
    return { kind: 'code' };
  });

  // Collect inline comments
  lineInfo.forEach((info, idx) => {
    if (info.kind === 'mixed') trailingMap.set(idx + 1, info.commentText); // 1-based
  });

  // Group standalone comment blocks and associate each with the 1-based line
  // number of the next code/mixed line after the block.
  let i = 0;
  while (i < lineInfo.length) {
    if (lineInfo[i].kind === 'comment') {
      const block = [];
      while (i < lineInfo.length && (lineInfo[i].kind === 'comment' || lineInfo[i].kind === 'blank')) {
        if (lineInfo[i].kind === 'comment') block.push(lineInfo[i].raw);
        i++;
      }
      if (block.length > 0) {
        // Key = 1-based line number of next non-comment/non-blank line
        leadingMap.set(i + 1, block);
      }
    } else {
      i++;
    }
  }

  return { leadingMap, trailingMap };
}

function findInlineCommentPos(line) {
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inStr) { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (ch === ';' && !inStr) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Formatter class
// ---------------------------------------------------------------------------

class Formatter {
  constructor(opts = {}) {
    this.lineLength = opts.lineLength || DEFAULT_LINE_LENGTH;
  }

  // -------------------------------------------------------------------------
  // Inline (single-line) rendering
  // -------------------------------------------------------------------------

  formatInline(node) {
    switch (node.type) {
      case 'symbol':     return node.name;
      case 'number':     return String(node.value);
      case 'string':     return `"${escapeStr(node.value)}"`;
      case 'atom':       return String(node.value);
      case 'quote':      return `'${this.formatInline(node.expr)}`;
      case 'quasiquote': return `\`${this.formatInline(node.expr)}`;
      case 'unquote':    return `~${this.formatInline(node.expr)}`;
      case 'list':
        return `(${node.elements.map(e => this.formatInline(e)).join(' ')})`;
      case 'vector':
        return `[${node.elements.map(e => this.formatInline(e)).join(' ')}]`;
      default:           return '';
    }
  }

  // -------------------------------------------------------------------------
  // Width measurement (for short-form test)
  // -------------------------------------------------------------------------

  measureWidth(node) {
    switch (node.type) {
      case 'symbol':     return node.name.length;
      case 'number':     return String(node.value).length;
      case 'string':     return escapeStr(node.value).length + 2;
      case 'atom':       return String(node.value).length;
      case 'quote':      return 1 + this.measureWidth(node.expr);
      case 'quasiquote': return 1 + this.measureWidth(node.expr);
      case 'unquote':    return 1 + this.measureWidth(node.expr);
      case 'list': {
        if (node.elements.length === 0) return 2;
        const w = node.elements.reduce((s, e) => s + this.measureWidth(e), 0);
        return 2 + w + (node.elements.length - 1); // ( + widths + spaces + )
      }
      case 'vector': {
        if (node.elements.length === 0) return 2;
        const w = node.elements.reduce((s, e) => s + this.measureWidth(e), 0);
        return 2 + w + (node.elements.length - 1);
      }
      default: return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Pretty-print entry point
  //
  // indent  = string of spaces representing the indentation of continuation
  //           lines that belong to THIS expression (NOT of the first line –
  //           the caller is responsible for prepending any leading indent to
  //           the first line).
  //
  // Returns a possibly-multi-line string.  The first line has NO leading
  // whitespace.  Subsequent lines have absolute indentation embedded.
  // -------------------------------------------------------------------------

  printExpr(node, indent) {
    const inlineStr = this.formatInline(node);
    if (indent.length + inlineStr.length <= this.lineLength) return inlineStr;
    if (node.type !== 'list' && node.type !== 'vector') return inlineStr;
    return this.printLong(node, indent);
  }

  printLong(node, indent) {
    if (node.type === 'vector') return this._printVector(node, indent);
    if (node.type === 'list')   return this._printList(node, indent);
    return this.formatInline(node);
  }

  _printVector(node, indent) {
    if (node.elements.length === 0) return '[]';
    const ci = indent + '  ';
    const rendered = node.elements.map(e => `${ci}${this.printExpr(e, ci)}`);
    rendered[rendered.length - 1] += ']';
    return `[\n${rendered.join('\n')}`;
  }

  _printList(node, indent) {
    const { elements } = node;
    if (elements.length === 0) return '()';

    const head = elements[0];
    const headName = head.type === 'symbol' ? head.name : null;
    const ci = indent + '  '; // child indent

    // Dispatch to special-form handlers
    if (headName) {
      switch (headName) {
        case 'fn':       // fall through
        case 'ꟛ':       return this._printFn(node, indent, ci);
        case 'defn':     return this._printDefn(node, indent, ci);
        case 'defmacro': return this._printDefmacro(node, indent, ci);
        case 'if':       return this._printIf(node, indent, ci);
        case 'let':      return this._printLet(node, indent, ci);
        case 'cond':     return this._printCond(node, ci);
        case 'dict':     return this._printDict(node, indent, ci);
        case 'var':      return this._printVar(node, indent, ci);
        case 'class':    return this._printClass(node, ci);
        default:         break;
      }
    }

    return this._printDefault(node, indent, ci);
  }

  // Default: (head first-arg\n  second-arg\n  third-arg)
  _printDefault(node, indent, ci) {
    const { elements } = node;
    const headStr = this.formatInline(elements[0]);

    if (elements.length === 1) return `(${headStr})`;

    const firstArg = elements[1];
    const firstArgInline = this.formatInline(firstArg);
    const firstLineWidth = indent.length + 1 + headStr.length + 1 + firstArgInline.length;

    let lines;
    if (firstLineWidth <= this.lineLength) {
      // First arg on same line as head; rest at ci
      const firstRendered = this.printExpr(firstArg, ci);
      lines = [`(${headStr} ${firstRendered}`];
      for (let i = 2; i < elements.length; i++) {
        lines.push(`${ci}${this.printExpr(elements[i], ci)}`);
      }
    } else {
      // All args at ci
      lines = [`(${headStr}`];
      for (let i = 1; i < elements.length; i++) {
        lines.push(`${ci}${this.printExpr(elements[i], ci)}`);
      }
    }

    lines[lines.length - 1] += ')';
    return lines.join('\n');
  }

  // (fn (params...) body...)
  _printFn(node, indent, ci) {
    const { elements } = node;
    const params = elements[1];
    const body   = elements.slice(2);

    // Continuation indent for parameters: aligns with first param inside `(fn (`
    // '(fn (' = 5 chars from the `(fn`; add to indent for absolute column.
    const paramCi = ' '.repeat(indent.length + 5);
    const paramsStr = this._printParams(params, paramCi);

    const bodyLines = body.map(e => `${ci}${this.printExpr(e, ci)}`);
    const header = `(fn ${paramsStr}`;
    return [header, ...bodyLines].join('\n') + ')';
  }

  // (defn name (params...) body...)
  _printDefn(node, indent, ci) {
    const { elements } = node;
    const nameStr = this.formatInline(elements[1]);
    const params  = elements[2];
    const body    = elements.slice(3);

    // '(defn name (' = 7 + name.length chars
    const paramCi = ' '.repeat(indent.length + 7 + nameStr.length);
    const paramsStr = this._printParams(params, paramCi);

    const bodyLines = body.map(e => `${ci}${this.printExpr(e, ci)}`);
    const header = `(defn ${nameStr} ${paramsStr}`;
    return [header, ...bodyLines].join('\n') + ')';
  }

  // Format a parameter list (name default name default ...) with visual indent
  _printParams(params, contIndent) {
    if (!params || params.type !== 'list') return this.formatInline(params || '');
    const inline = this.formatInline(params);
    if (contIndent.length + inline.length <= this.lineLength) return inline;

    const { elements } = params;
    if (elements.length === 0) return '()';

    const firstStr = this.formatInline(elements[0]);
    const rest = elements.slice(1).map(e => `${contIndent}${this.formatInline(e)}`);
    return [`(${firstStr}`, ...rest].join('\n') + ')';
  }

  // (if cond then else?)
  _printIf(node, indent, ci) {
    const { elements } = node;
    const cond  = elements[1];
    const then  = elements[2];
    const else_ = elements[3];

    const condInline = this.formatInline(cond);
    const thenInline = then  ? this.formatInline(then)  : null;
    const elseInline = else_ ? this.formatInline(else_) : null;

    // Try short form
    const short = `(if ${condInline}${thenInline ? ' ' + thenInline : ''}${elseInline ? ' ' + elseInline : ''})`;
    if (indent.length + short.length <= this.lineLength) return short;

    // Condition on same line; then/else at ci
    const condRendered = this.printExpr(cond, ' '.repeat(indent.length + 4));
    const parts = [`(if ${condRendered}`];
    if (then)  parts.push(`${ci}${this.printExpr(then, ci)}`);
    if (else_) parts.push(`${ci}${this.printExpr(else_, ci)}`);
    parts[parts.length - 1] += ')';
    return parts.join('\n');
  }

  // (let ((name val) ...) body...)
  _printLet(node, indent, ci) {
    const { elements } = node;
    const bindings = elements[1];
    const body = elements.slice(2);

    // '(let (' = 6 chars; binding list aligns with first binding
    const bindCi = ' '.repeat(indent.length + 6);
    let bindStr;
    if (!bindings || bindings.type !== 'list') {
      bindStr = this.formatInline(bindings);
    } else {
      const bindElems = bindings.elements.map(b => this.formatInline(b));
      const inline = `(${bindElems.join(' ')})`;
      if (indent.length + 5 + inline.length <= this.lineLength) {
        bindStr = inline;
      } else {
        const rest = bindElems.slice(1).map(b => `${bindCi}${b}`);
        bindStr = [`(${bindElems[0] || ''}`, ...rest].join('\n') + ')';
      }
    }

    const bodyLines = body.map(e => `${ci}${this.printExpr(e, ci)}`);
    return [`(let ${bindStr}`, ...bodyLines].join('\n') + ')';
  }

  // (cond (test expr) ...)
  _printCond(node, ci) {
    const clauses = node.elements.slice(1).map(c => {
      const inline = this.formatInline(c);
      if (ci.length + inline.length <= this.lineLength) return `${ci}${inline}`;
      return `${ci}${this.printLong(c, ci)}`;
    });
    return [`(cond`, ...clauses].join('\n') + ')';
  }

  // (dict :key val :key val ...)
  _printDict(node, indent, ci) {
    const { elements } = node;
    const inline = this.formatInline(node);
    if (indent.length + inline.length <= this.lineLength) return inline;

    // Each :key val pair on its own line at ci; align values
    const pairs = [];
    let maxKeyLen = 0;
    for (let i = 1; i < elements.length; i += 2) {
      const key = this.formatInline(elements[i]);
      if (key.length > maxKeyLen) maxKeyLen = key.length;
    }
    for (let i = 1; i < elements.length; i += 2) {
      const key = this.formatInline(elements[i]);
      const val = elements[i + 1] ? this.printExpr(elements[i + 1], ci + '  ') : '';
      pairs.push(`${ci}${key.padEnd(maxKeyLen)} ${val}`);
    }
    return [`(dict`, ...pairs].join('\n') + ')';
  }

  // (var name val name val ...)
  _printVar(node, indent, ci) {
    const inline = this.formatInline(node);
    if (indent.length + inline.length <= this.lineLength) return inline;

    const { elements } = node;
    const varCi = indent + '     '; // align with first var name
    const parts = [this.formatInline(elements[1])];
    for (let i = 2; i < elements.length; i++) {
      parts.push(`${varCi}${this.formatInline(elements[i])}`);
    }
    return `(var ${parts.join('\n')})`;
  }

  // (class name body...)
  _printClass(node, ci) {
    const { elements } = node;
    const nameStr = this.formatInline(elements[1]);
    const body    = elements.slice(2);
    const bodyLines = body.map(e => `${ci}${this.printExpr(e, ci)}`);
    return [`(class ${nameStr}`, ...bodyLines].join('\n') + ')';
  }

  // (defmacro name params body...)
  _printDefmacro(node, indent, ci) {
    const { elements } = node;
    const nameStr  = this.formatInline(elements[1]);
    const params   = elements[2];
    const body     = elements.slice(3);
    const paramCi  = ' '.repeat(indent.length + 10 + nameStr.length);
    const paramsStr = this._printParams(params, paramCi);
    const bodyLines = body.map(e => `${ci}${this.printExpr(e, ci)}`);
    const header = `(defmacro ${nameStr} ${paramsStr}`;
    return [header, ...bodyLines].join('\n') + ')';
  }

  // -------------------------------------------------------------------------
  // Top-level program formatting
  // -------------------------------------------------------------------------

  format(source) {
    const { leadingMap, trailingMap } = collectComments(source);

    let tokens;
    try {
      tokens = new Lexer(source).tokenize();
    } catch (err) {
      process.stderr.write(`scscm-format: lex error: ${err.message}\n`);
      return source;
    }

    let ast;
    try {
      ast = new Parser(tokens).parse();
    } catch (err) {
      process.stderr.write(`scscm-format: parse error: ${err.message}\n`);
      return source;
    }

    // Run macro expansion so defmacro definitions are preserved in output
    // but user-defined macro call-sites are expanded before formatting.
    // (We format the source as-written, so we skip expanding call sites here
    //  and only strip nothing — the formatter just needs to not crash on
    //  defmacro forms, which _printDefmacro handles.)

    const out = [];

    for (let i = 0; i < ast.length; i++) {
      const node = ast[i];
      const nodeLine = node.line;

      // Emit leading standalone comments for this node
      const leading = leadingMap.get(nodeLine);
      if (leading) {
        for (const cline of leading) out.push(cline.trimEnd());
      }

      // Render the expression
      const rendered = this.printExpr(node, '');

      // Append inline (trailing) comment if the expression is single-line
      const trailing = trailingMap.get(nodeLine);
      if (trailing && !rendered.includes('\n')) {
        out.push(`${rendered} ${trailing.trimEnd()}`);
      } else {
        out.push(rendered);
      }

      // One blank line between top-level forms
      if (i < ast.length - 1) out.push('');
    }

    return out.join('\n') + '\n';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeStr(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function format(source, opts = {}) {
  return new Formatter(opts).format(source);
}

module.exports = { Formatter, format };
