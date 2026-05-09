'use strict';

const { MacroExpander } = require('./lhc_macros');

class CodeGenerator {
  constructor() {
    this.indent = 0;
    this.output = [];
  }

  emit(code) {
    this.output.push(code);
  }

  indent_() {
    return '  '.repeat(this.indent);
  }

  emitLine(code = '') {
    if (code) {
      this.output.push(this.indent_() + code);
    } else {
      this.output.push('');
    }
  }

  schemeNameToScName(name) {
    if (!name) return name;
    return name.replace(/-/g, '_').replace(/\?$/, '_q').replace(/!$/, '');
  }

  isSpecialForm(name) {
    const forms = [
      'fn',
      'ꟛ', // alias for fn
      'defn',
      'defmacro',
      'var',
      'set!',
      'let',
      'if',
      'cond',
      'do',
      '.',
      '.dot',
      'class',
      'list',
      'array',
      'dict',
      'quote',
      'quasiquote',
      'super',
      'this',
    ];
    return forms.includes(name);
  }

  isBinaryOp(name) {
    const ops = [
      '+',
      '-',
      '*',
      '/',
      '%',
      '**',
      '&',
      '|',
      '^',
      '<<',
      '>>',
      '==',
      '!=',
      '<',
      '>',
      '<=',
      '>=',
      'and',
      'or',
      '++',
      '<>',
      '!',
    ];
    return ops.includes(name);
  }

  generateExpr(expr) {
    if (!expr) return 'nil';

    switch (expr.type) {
      case 'atom':
        return this.generateAtom(expr);
      case 'symbol':
        return this.generateSymbol(expr);
      case 'number':
        return expr.value.toString();
      case 'string':
        return `"${expr.value.replace(/"/g, '\\"')}"`;
      case 'list':
        return this.generateList(expr);
      case 'vector':
        return this.generateVector(expr);
      case 'quote':
        return this.generateQuote(expr);
      case 'quasiquote':
        return this.generateQuasiquote(expr);
      case 'unquote':
        return this.generateUnquote(expr);
      default:
        throw new Error(`Unknown expression type: ${expr.type}`);
    }
  }

  generateAtom(expr) {
    if (expr.value === null) return 'nil';
    if (expr.value === true) return 'true';
    if (expr.value === false) return 'false';
    return expr.value;
  }

  generateSymbol(expr) {
    if (expr.name.startsWith(':')) {
      // Keyword/symbol literal: :freq → \freq (sclang Symbol syntax)
      return '\\' + this.schemeNameToScName(expr.name.substring(1));
    }
    return this.schemeNameToScName(expr.name);
  }

  generateList(expr) {
    if (expr.elements.length === 0) return '[]';

    const [head, ...rest] = expr.elements;

    if (head.type === 'symbol') {
      const name = head.name;

      if (name === 'fn' || name === 'ꟛ') return this.generateFn(rest);
      if (name === 'defn') return this.generateDefn(rest);
      if (name === 'defmacro') return ''; // consumed by MacroExpander before codegen
      if (name === 'var') return this.generateVar(rest);
      if (name === 'set!') return this.generateSet(rest);
      if (name === 'let') return this.generateLet(rest);
      if (name === 'if') return this.generateIf(rest);
      if (name === 'cond') return this.generateCond(rest);
      if (name === '.') return this.generateMethodCall(rest);
      if (name === '.dot') return this.generateDotCall(rest);
      if (name === 'class') return this.generateClass(rest);
      if (name === 'list') return this.generateListLiteral(rest);
      if (name === 'array') return this.generateArrayLiteral(rest);
      if (name === 'dict') return this.generateDict(rest);
      if (name === 'quote') return `'${this.generateExpr(rest[0])}`;
      if (name === 'quasiquote')
        return `#[${rest.map((e) => this.generateExpr(e)).join(', ')}]`;
      if (name === 'super') return 'super';

      if (name === 'do') return this.generateDo(rest);

      if (this.isBinaryOp(name) && rest.length === 2) {
        return this.generateBinaryOp(name, rest[0], rest[1]);
      }

      return this.generateFunctionCall(name, rest);
    }

    return this.generateFunctionCall(this.generateExpr(head), rest);
  }

  generateAtomLiteral(expr) {
    return this.generateExpr(expr);
  }

  // Parse fn/defn param list: supports symbols, alternating name/default pairs, and rest params.
  // (a b) → [{name:'a'}, {name:'b'}], restParam: null
  // (freq 440 amp 0.1) → [{name:'freq',defaultNode:440node}, {name:'amp',defaultNode:0.1node}], restParam: null
  // (. args) → [], restParam: 'args'
  // (a b . rest) → [{name:'a'},{name:'b'}], restParam: 'rest'
  _parseFnParams(elements) {
    const dotIdx = elements.findIndex(
      (e) => e.type === 'symbol' && e.name === '.'
    );
    let mainElements, restParam = null;
    if (dotIdx >= 0) {
      mainElements = elements.slice(0, dotIdx);
      if (dotIdx + 1 < elements.length) {
        restParam = this.schemeNameToScName(elements[dotIdx + 1].name);
      }
    } else {
      mainElements = elements;
    }

    const params = [];
    let i = 0;
    while (i < mainElements.length) {
      const cur = mainElements[i];
      if (cur.type !== 'symbol') {
        throw new Error(
          `fn: parameter name must be a symbol, got ${cur.type}`
        );
      }
      const next = mainElements[i + 1];
      if (next && next.type !== 'symbol') {
        params.push({
          name: this.schemeNameToScName(cur.name),
          defaultNode: next,
        });
        i += 2;
      } else {
        params.push({ name: this.schemeNameToScName(cur.name) });
        i += 1;
      }
    }
    return { params, restParam };
  }

  generateFn(args) {
    if (args.length < 1) throw new Error('fn requires at least a parameter list');

    const paramListNode = args[0];
    if (paramListNode.type !== 'list')
      throw new Error('fn parameters must be a list');

    const { params, restParam } = this._parseFnParams(paramListNode.elements);

    const parts = params.map((p) =>
      p.defaultNode !== undefined
        ? `${p.name}=${this.generateExpr(p.defaultNode)}`
        : p.name
    );
    if (restParam !== null) parts.push(`...${restParam}`);

    const body = args.slice(1).map((e) => this.generateExpr(e)).join('; ');

    if (parts.length === 0) {
      return body ? `{ ${body} }` : '{ }';
    }
    return `{ |${parts.join(', ')}| ${body} }`;
  }

  generateDo(args) {
    // (do e1 e2 e3) → { e1; e2; e3 }.value() — sequential block, returns last value
    const body = args.map((e) => this.generateExpr(e)).join('; ');
    return `{ ${body} }.value()`;
  }

  generateDefn(args) {
    if (args.length < 2) throw new Error('defn requires name, params, and body');

    const name = args[0];
    if (name.type !== 'symbol') throw new Error('defn name must be a symbol');

    const params = args[1];
    if (params.type !== 'list')
      throw new Error('defn parameters must be a list');

    const paramList = params.elements
      .map((p) => {
        if (p.type === 'symbol') {
          return this.schemeNameToScName(p.name);
        }
        throw new Error('defn parameters must be symbols');
      })
      .join(', ');

    const body = args
      .slice(2)
      .map((e) => this.generateExpr(e))
      .join('; ');

    return `${this.schemeNameToScName(name.name)} = { |${paramList}| ${body} }`;
  }

  generateVar(args) {
    if (args.length < 1) throw new Error('var requires at least a name');

    const decls = [];
    for (let i = 0; i < args.length; i += 2) {
      const name = args[i];
      if (name.type !== 'symbol') throw new Error('var names must be symbols');

      let decl = this.schemeNameToScName(name.name);

      if (i + 1 < args.length) {
        decl += ` = ${this.generateExpr(args[i + 1])}`;
      }

      decls.push(decl);
    }

    return `var ${decls.join(', ')}`;
  }

  generateSet(args) {
    if (args.length < 2) throw new Error('set! requires target and value');

    const target = args[0];
    const value = this.generateExpr(args[1]);

    if (target.type === 'symbol') {
      const name = this.schemeNameToScName(target.name);
      return `${name} = ${value}`;
    }

    if (target.type === 'list' && target.elements.length > 0) {
      const [head, ...rest] = target.elements;
      if (head.type === 'symbol' && head.name === '.') {
        const obj = this.generateExpr(rest[0]);
        const prop = rest[1].name;
        return `${obj}.${prop} = ${value}`;
      }
    }

    throw new Error('set! target must be a symbol or method call');
  }

  generateLet(args) {
    if (args.length < 2) throw new Error('let requires bindings and body');

    const bindings = args[0];
    if (bindings.type !== 'list')
      throw new Error('let bindings must be a list');

    const params = [];
    const values = [];

    for (const binding of bindings.elements) {
      if (binding.type !== 'list' || binding.elements.length !== 2) {
        throw new Error('let bindings must be [name value] pairs');
      }

      const [name, value] = binding.elements;
      if (name.type !== 'symbol')
        throw new Error('let binding names must be symbols');

      params.push(this.schemeNameToScName(name.name));
      values.push(this.generateExpr(value));
    }

    const body = args
      .slice(1)
      .map((e) => this.generateExpr(e))
      .join('; ');

    return `{ |${params.join(', ')}| ${body} }.value(${values.join(', ')})`;
  }

  generateIf(args) {
    if (args.length < 2) throw new Error('if requires condition and then branch');

    const cond = this.generateExpr(args[0]);
    const thenBranch = this.generateExpr(args[1]);
    const elseBranch =
      args.length > 2 ? this.generateExpr(args[2]) : 'nil';

    return `if (${cond}) { ${thenBranch} } { ${elseBranch} }`;
  }

  generateCond(args) {
    if (args.length === 0) throw new Error('cond requires at least one clause');

    const clauses = [];

    for (const clause of args) {
      if (clause.type !== 'list' || clause.elements.length !== 2) {
        throw new Error('cond clauses must be [test expr] pairs');
      }

      const [test, expr] = clause.elements;
      const testCode = this.generateExpr(test);
      const exprCode = this.generateExpr(expr);

      if (test.type === 'symbol' && test.name === 'else') {
        clauses.push(`{ true -> ${exprCode} }`);
      } else {
        clauses.push(`{ ${testCode} -> ${exprCode} }`);
      }
    }

    return `cond(${clauses.join('')})`;
  }

  generateMethodCall(args) {
    if (args.length < 1) throw new Error('. requires an object and method');

    const obj = this.generateExpr(args[0]);
    // Wrap compound expressions to preserve precedence: (1 + 1).postln not 1 + 1.postln
    // Only wrap list expressions that are binary ops (not method/dot calls)
    const needsParens =
      args[0].type === 'list' &&
      args[0].elements.length > 0 &&
      args[0].elements[0].type === 'symbol' &&
      this.isBinaryOp(args[0].elements[0].name);
    const receiver = needsParens ? `(${obj})` : obj;

    if (args.length === 1) {
      return receiver;
    }

    if (args[1].type === 'symbol') {
      const method = args[1].name;
      const methodArgs = args.slice(2);

      if (methodArgs.length === 0) {
        return `${receiver}.${method}`;
      }

      const argList = methodArgs.map((a) => this.generateExpr(a)).join(', ');
      return `${receiver}.${method}(${argList})`;
    }

    throw new Error('. requires a method name (symbol)');
  }

  generateDotCall(args) {
    if (args.length < 1) throw new Error('.dot requires a class');

    const klass = this.generateExpr(args[0]);

    if (args.length === 1) {
      return klass;
    }

    if (args[1].type === 'symbol') {
      const method = args[1].name;
      const methodArgs = args.slice(2);

      if (methodArgs.length === 0) {
        return `${klass}.${method}`;
      }

      const argList = methodArgs.map((a) => this.generateExpr(a)).join(', ');
      return `${klass}.${method}(${argList})`;
    }

    throw new Error('.dot requires a method name (symbol)');
  }

  generateClass(args) {
    if (args.length < 2) throw new Error('class requires name and superclass');

    const name = args[0];
    if (name.type !== 'symbol') throw new Error('class name must be a symbol');

    const superclass = args[1];
    if (superclass.type !== 'symbol')
      throw new Error('class superclass must be a symbol');

    const members = args.slice(2);

    this.emitLine(
      `${this.schemeNameToScName(name.name)} : ${superclass.name} {`
    );
    this.indent++;

    for (const member of members) {
      if (member.type !== 'list') continue;

      const [head, ...rest] = member.elements;
      if (head.type === 'symbol') {
        if (head.name === 'var') {
          this.emitLine(`var ${rest.map((m) => this.generateExpr(m)).join(', ')};`);
        } else if (head.name === 'classvar') {
          this.emitLine(
            `classvar ${rest.map((m) => this.generateExpr(m)).join(', ')};`
          );
        } else if (head.name === 'defn') {
          const methodName = rest[0];
          const params = rest[1];
          const body = rest.slice(2);

          const paramList = params.elements
            .map((p) => this.schemeNameToScName(p.name))
            .join(', ');
          const bodyCode = body
            .map((e) => this.generateExpr(e))
            .join('; ');

          this.emitLine(`${this.schemeNameToScName(methodName.name)} { |${paramList}|`);
          this.indent++;
          this.emitLine(`^${bodyCode}`);
          this.indent--;
          this.emitLine('}');
        }
      }
    }

    this.indent--;
    this.emitLine('}');
    return '';
  }

  generateListLiteral(args) {
    return `[${args.map((a) => this.generateExpr(a)).join(', ')}]`;
  }

  generateArrayLiteral(args) {
    return `[${args.map((a) => this.generateExpr(a)).join(', ')}]`;
  }

  generateDict(args) {
    if (args.length % 2 !== 0) {
      throw new Error('dict requires key-value pairs');
    }

    const pairs = [];
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      const value = args[i + 1];

      if (key.type !== 'symbol' || !key.name.startsWith(':')) {
        throw new Error('dict keys must be keywords (:key)');
      }

      const keyName = key.name.substring(1);
      pairs.push(
        `${this.schemeNameToScName(keyName)}: ${this.generateExpr(value)}`
      );
    }

    return `(${pairs.join(', ')})`;
  }

  generateBinaryOp(op, left, right) {
    const leftCode = this.generateExpr(left);
    const rightCode = this.generateExpr(right);

    const scOp = op === 'and' ? '&&' : op === 'or' ? '||' : op;

    return `${leftCode} ${scOp} ${rightCode}`;
  }

  generateFunctionCall(name, args) {
    const nameStr = typeof name === 'string' ? name : this.generateExpr(name);
    const argList = args.map((a) => this.generateExpr(a)).join(', ');

    if (args.length === 0) {
      return `${nameStr}()`;
    }

    return `${nameStr}(${argList})`;
  }

  generateQuote(expr) {
    return `'${this.generateExpr(expr.expr)}`;
  }

  generateQuasiquote(expr) {
    return `#[${this.generateExpr(expr.expr)}]`;
  }

  generateUnquote(expr) {
    return this.generateExpr(expr.expr);
  }

  generate(ast) {
    this.output = [];
    this.indent = 0;

    const expander = new MacroExpander();
    const expanded = expander.expand(ast);

    for (const expr of expanded) {
      const code = this.generateExpr(expr);
      if (code && code.length > 0) {
        this.emitLine(code + ';');
      }
    }

    return this.output.join('\n');
  }
}

module.exports = { CodeGenerator };
