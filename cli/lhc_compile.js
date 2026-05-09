#!/usr/bin/env node
'use strict';

const { Lexer } = require('./lhc_lexer');
const { Parser } = require('./lhc_parser');
const { CodeGenerator } = require('./lhc_codegen');

function compileScscmText(source, filename) {
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const parser = new Parser(tokens);
    const ast = parser.parse();

    const codegen = new CodeGenerator();
    const sclangCode = codegen.generate(ast);

    return sclangCode;
  } catch (err) {
    const context = filename ? ` in ${filename}` : '';
    throw new Error(`scscm compilation failed${context}: ${err.message}`, { cause: err });
  }
}

// CommonJS export for Node.js
module.exports = { compileScscmText };

// Also export as named export for potential future ES module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports.compileScscmText = compileScscmText;
}
