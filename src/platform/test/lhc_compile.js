// SCSCM Compiler for Browser - Phase H2
// ES Module version of lhc_compile.js

import { Lexer } from './lhc_lexer.js';
import { Parser } from './lhc_parser.js';
import { CodeGenerator } from './lhc_codegen.js';

async function compileScscmText(source, filename) {
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const parser = new Parser(tokens);
    const ast = parser.parse();

    const codegen = new CodeGenerator();
    const sclangCode = await codegen.generate(ast);

    return sclangCode;
  } catch (err) {
    const context = filename ? ` in ${filename}` : '';
    throw new Error(`scscm compilation failed${context}: ${err.message}`, { cause: err });
  }
}

export { compileScscmText };
