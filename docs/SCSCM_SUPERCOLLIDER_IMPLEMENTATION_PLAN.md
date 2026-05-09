# scscm-in-sclang Implementation Plan (Stress-Test Track)

**Date**: 2026-05-09  
**Status**: Planned  
**Goal**: Implement a reference-compatible subset of scscm directly in SuperCollider language code (sclang) to use as a compiler and runtime stress test.

---

## Why this exists

Today, scscm is implemented in JavaScript (`cli/lhc_lexer.js`, `cli/lhc_parser.js`, `cli/lhc_codegen.js`, `cli/lhc_macros.js`). This plan proposes a second implementation in sclang, not as a production replacement, but as a high-friction stress harness that can expose:

- parser and macro edge cases that are hidden by a single implementation,
- determinism bugs (different codegen for same input),
- scale and memory pressure issues in language tooling,
- behavioral drift between "spec" and "implementation".

The central strategy is differential testing: compile the same `.scscm` corpus with both implementations and compare normalized generated sclang and/or runtime output.

---

## Scope and non-goals

### In scope

1. A sclang library that can lex, parse, macro-expand, and codegen a meaningful scscm subset.
2. A command-line entrypoint in sclang for batch compilation of `.scscm` files.
3. Differential test harness against the existing JS compiler.
4. Stress-focused metrics (throughput, memory, deep nesting tolerance, macro expansion cost).

### Out of scope (phase 1)

1. Full feature parity with all future language proposals in `docs/scscm/SCSCM_LANGUAGE_FEATURES_FUTURE.md`.
2. Shipping this compiler as the default user path.
3. IDE/editor integration beyond simple harness hooks.
4. Native host embedding work (covered by other plans).

---

## Design decisions

### D1. Role of the sclang implementation

**Decision**: treat it as a "validator implementation" and stress harness first, not a replacement.

### D2. Parsing strategy

**Decision**: recursive-descent parser in sclang with explicit token stream state and iterative fallback for deeply nested forms to avoid stack blowups.

### D3. Output compatibility target

**Decision**: target semantic parity, not byte-for-byte text parity.  
Whitespace and harmless formatting differences are acceptable after normalization.

### D4. Macro system

**Decision**: implement a macro-expansion environment with deterministic expansion order and explicit recursion limits.

### D5. Failure behavior

**Decision**: all compiler stages return structured diagnostics (`stage`, `line`, `col`, `message`) and never hard-crash the host process on malformed input.

---

## Architecture

## 1. Components

1. **Lexer** (`ScscmLexer`)  
   Tokenizes source into parentheses, symbols, numbers, strings, keywords, comments, and reader sugar used by scscm.
2. **Parser** (`ScscmParser`)  
   Builds an AST (lists, atoms, special forms).
3. **Macro expander** (`ScscmMacroExpander`)  
   Resolves `defmacro` forms and performs expansion with recursion guards.
4. **Code generator** (`ScscmCodegen`)  
   Emits equivalent sclang text.
5. **Facade** (`ScscmCompiler`)  
   Public API: `compileString`, `compileFile`, and diagnostic reporting.

## 2. Proposed file layout

Under `src/class_library/HC/` (or another agreed SC classlib path):

- `ScscmToken.sc`
- `ScscmLexer.sc`
- `ScscmAst.sc`
- `ScscmParser.sc`
- `ScscmMacroExpander.sc`
- `ScscmCodegen.sc`
- `ScscmCompiler.sc`
- `ScscmCompileCli.sc` (batch entrypoint helpers)

Under `tests/` and fixtures:

- `tests/scscm_compiler_sclang/` (unit and differential tests)
- `tests/fixtures/scscm/` (golden corpus)

---

## Compatibility target (phase 1 subset)

Implement first the forms that unlock meaningful stress runs and match existing docs/examples:

1. literals: numbers, strings, symbols, arrays/lists,
2. bindings and vars: `let`, `var`, `set!`,
3. functions: `fn`, calls, lambdas,
4. control flow: `if`, `when`, `cond` (if currently in shipped subset),
5. top-level: `defsynth`, `defn`, `defmacro` (minimal viable macro support),
6. quasiquote/unquote basics,
7. pattern helpers used in quick start and technique examples.

Defer advanced/future features (`match`, destructuring, `loop`/`recur`) to later parity phases.

---

## Stress-test strategy

## 1. Differential compiler testing

For each fixture `.scscm` file:

1. compile with JS compiler (`cli/lhc.js`),
2. compile with sclang compiler,
3. normalize outputs (whitespace/comments/order-insensitive normalization where safe),
4. compare normalized outputs,
5. on mismatch, classify as formatting-only vs semantic divergence.

## 2. Runtime parity spot checks

For selected fixtures, run generated outputs through existing evaluation paths and compare:

- success/failure class,
- key diagnostic signatures,
- selected observable outputs (for deterministic snippets).

## 3. Fuzz and adversarial corpus

Generate synthetic forms to stress:

1. deep nesting,
2. long symbol names and string literals,
3. macro recursion and expansion fan-out,
4. mixed quoting patterns,
5. invalid forms (negative tests).

---

## Metrics and acceptance thresholds

Primary stress metrics:

1. **Correctness**: >= 95% fixture parity in phase 1 subset; 100% for core language docs fixtures.
2. **Robustness**: 0 host crashes on malformed corpus; diagnostics produced instead.
3. **Throughput**: compile 1,000 medium fixtures in batch without process restart.
4. **Memory**: no unbounded growth across repeated compile loops (track high-water and steady-state).
5. **Nesting tolerance**: handles agreed minimum nested depth target (for example 1,000 list levels) without fatal failure.

---

## Phased plan

### Phase P0 - Harness bootstrap (3-5 days)

- [ ] Choose classlib location and naming conventions.
- [ ] Add a minimal `ScscmCompiler` facade with `compileString` stub.
- [ ] Add CLI glue to invoke sclang compiler path in batch mode.
- [ ] Add fixture loader and baseline comparison script skeleton.

**Acceptance**: end-to-end harness runs, even with placeholder compiler behavior.

### Phase P1 - Lexer + parser MVP (1-2 weeks)

- [ ] Implement token model and lexer.
- [ ] Implement parser for lists/atoms and basic forms.
- [ ] Add syntax diagnostics with line/column.
- [ ] Unit tests for tokenization and parse trees.

**Acceptance**: parser handles all core fixtures without crashing; invalid fixtures yield diagnostics.

### Phase P2 - Codegen MVP (1 week)

- [ ] Emit sclang for non-macro subset (`let`, `fn`, simple calls, literals).
- [ ] Add normalization pass for deterministic output.
- [ ] Differential tests against JS compiler for MVP subset.

**Acceptance**: >= 85% parity on MVP fixture set.

### Phase P3 - Macro expansion MVP (1-2 weeks)

- [ ] Implement macro table, expansion order, and recursion guards.
- [ ] Add quasiquote/unquote behavior required by existing scscm macros.
- [ ] Add macro stress fixtures (expansion depth/fan-out).

**Acceptance**: macro-heavy fixtures compile with bounded expansion and no crashes.

### Phase P4 - Stress and profiling pass (1 week)

- [ ] Add long-run batch benchmark (thousands of compiles).
- [ ] Add memory tracking snapshots and compile-time histogram output.
- [ ] Add adversarial fuzz corpus runner.
- [ ] Document bottlenecks and top divergence classes.

**Acceptance**: thresholds met for robustness and throughput; top divergence causes identified.

### Phase P5 - Parity ratchet and CI integration (ongoing)

- [ ] Promote passing fixtures into required CI set.
- [ ] Track divergence budget (must trend downward).
- [ ] Add "new language feature must include both-compiler fixture" policy.

**Acceptance**: CI enforces parity floor and prevents regressions.

---

## Tooling and integration points

1. Existing JS compiler remains the oracle implementation during early phases.
2. Reuse current fixture sources from docs examples and `cli/examples` where possible.
3. Add one benchmark command to run both compilers and emit a machine-readable report (JSON).
4. Keep this work decoupled from user-facing `hclang` integration so stress infrastructure can evolve independently.

---

## Risks and mitigations

1. **Risk**: sclang performance is too slow for large macro expansions.  
   **Mitigation**: iterative expansion paths, memoization for pure expansions, profile-guided optimization.
2. **Risk**: semantic drift from JS implementation.  
   **Mitigation**: differential tests required before merge; normalized AST comparison for difficult cases.
3. **Risk**: parser recursion limits in sclang.  
   **Mitigation**: explicit depth counters and iterative parse stacks for deeply nested forms.
4. **Risk**: brittle parity due to formatting differences.  
   **Mitigation**: compare normalized output and selected semantic probes, not raw text only.

---

## Deliverables

1. New sclang compiler classes for lexer/parser/macro/codegen.
2. Batch compile entrypoint and stress runner scripts.
3. Fixture corpus and differential test suite.
4. Metrics report format and CI job for parity/stress.
5. Follow-up backlog for unsupported language features.

---

## Relationship to existing plans

1. Complements `docs/HCLANG_SCSCM_INTEGRATION_PLAN.md` by providing an independent implementation for validation and stress testing.
2. Uses docs/examples produced under `docs/SCSCM_DOCS_PLAN.md` as fixture inputs.
3. Can eventually feed native-host work by replacing temporary subprocess paths with an embeddable compiler artifact, if desired.

---

## Next immediate actions

1. Create P0 scaffolding classes and compile facade.
2. Build a tiny fixture set from quick-start and tutorial examples.
3. Stand up the differential harness with "expected mismatch" reporting.
4. Start P1 lexer implementation with line/column tracking first.
