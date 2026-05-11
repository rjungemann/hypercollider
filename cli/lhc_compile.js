#!/usr/bin/env node
'use strict';

const { Lexer } = require('./lhc_lexer');
const { Parser } = require('./lhc_parser');
const { CodeGenerator } = require('./lhc_codegen');
const { normalizeSweetToSexpr } = require('./lhc_sweet_reader');

/**
 * Compile scscm source to sclang code.
 * 
 * @param {string} source - The scscm source code
 * @param {string} filename - Optional filename for error reporting
 * @param {object} opts - Options
 * @param {string} opts.syntax - Syntax mode: 'auto', 'sexpr', or 'sweet' (default: 'auto')
 * @returns {string} Compiled sclang code
 */
function compileScscmText(source, filename, opts = {}) {
  const { syntax = 'auto' } = opts;

  try {
    let processedSource = source;

    // Handle syntax modes
    if (syntax === 'sweet') {
      // Explicitly use sweet reader
      const normalized = normalizeSweetToSexpr(processedSource, { phase: 'm1' });
      processedSource = normalized.source;
    } else if (syntax === 'auto') {
      // Auto-detect: check if source contains sweet syntax
      // For now, just pass through (no auto-detection in M1)
      // In future, we could detect { } and f( patterns
    }
    // 'sexpr' mode: pass through as-is (default behavior)

    const lexer = new Lexer(processedSource);
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
