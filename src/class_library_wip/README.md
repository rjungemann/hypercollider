# class_library_wip

Sources that are **not** compiled into the class library.

`src/class_library/` is globbed recursively (`CMakeLists.txt`) and baked into
`hclang`'s class-library pack, and one file that fails to parse makes the whole
library fail to compile -- `hclang` then cannot boot at all
(`sclang WASM: class library compilation FAILED`).

## `scscm/`

The in-progress scscm compiler written in sclang (`ScscmLexer`, `ScscmParser`,
`ScscmMacroExpander`, `ScscmCodegen`, `ScscmCompiler`, `ScscmCompileCli`,
`ScscmToken`, `ScscmAst`), from commit `0bc0e14` ("scscm in sc"). As committed
they do not parse. Known classes of error:

- `var` declared after other statements in a block (sclang requires `var` first);
- `const` used as an identifier (it is a reserved word);
- `arg = []` defaults (`unexpected '['`);
- top-level statements in a class file (`ScscmCompiler.compile { ... }` outside
  the class body, and a file-level `if (Main.args ...)` in `ScscmCompileCli.sc`).

The scscm that `hclang` actually runs today is the JS compiler (`cli/lhc_*.js`).
To resume this work, fix these files, move them back under
`src/class_library/HC/`, and check that `hclang` still boots
(`hclang --script <any .scd>`). The harness in `tests/scscm_compiler_sclang/`
expects them on the class path.
