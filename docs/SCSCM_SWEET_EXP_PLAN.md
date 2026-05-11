# scscm Sweet-Exp Syntax Plan

**Date**: 2026-05-10  
**Status**: Draft plan (implementation not started)  
**Goal**: Add an optional sweet-expression surface syntax to scscm while preserving full backward compatibility with existing s-expression `.scscm` code.

---

## 1. Problem Statement

scscm currently requires explicit parentheses for all forms. This is precise, but harder to read/write quickly for users coming from indentation-driven Lisps and languages with expression-oriented line structure.

Sweet-exp style input should allow users to write indentation-structured code that compiles to the same internal representation as classic s-expressions.

Primary constraints:

1. Existing `.scscm` files must continue to compile with no behavior change.
2. `hclang` one-step scscm support must continue to work.
3. Error messages should remain actionable (line/column fidelity where practical).
4. Keep implementation maintainable: avoid duplicating codegen/parser logic.

---

## 2. Source Inputs and References

1. Official sweet-exp reference: https://docs.racket-lang.org/sweet/index.html
2. Existing scscm compiler pipeline:
   - `cli/lhc_compile.js`
   - `cli/lhc_lexer.js`
   - `cli/lhc_parser.js`
   - `cli/lhc_codegen.js`
3. Existing tests:
   - `cli/tests/test_lhc.js`
   - `cli/tests/test_hclang_scscm.js`
4. Reference implementation details observed in `../fith`:
   - `src/reader.c`
   - `src/diag.h`
   - `src/main.c`
   - `docs/turmeric-plan.md`

Key findings from `../fith` relevant to scscm:

1. Reader dispatch model is already staged via `ReaderType` (`READER_TURMERIC`, `READER_CURLY_INFIX`, `READER_NEOTERIC`, `READER_SWEET`).
2. `#lang sweet-exp` is recognized but intentionally reported as not yet implemented.
3. Two sweet-adjacent tiers are implemented and testable now:
   - Curly-infix: `{a + b}` forms lowered as SRFI-105 style rewrites.
   - Neoteric: `f(x)`, `f{x}`, `f[x]` no-whitespace sugar.
4. File-level language selection is explicit (`#lang ...`) with extension-based fallback (`.tursweet`).

Implication for scscm: mirror the staged rollout (sugar tiers first, full indentation sweet last) to de-risk implementation and preserve compatibility.

---

## 3. Proposed Architecture

## 3.1 Add a Reader Layer (Recommended)

Do **not** fork `lhc_parser`/`lhc_codegen` for sweet-exp.

Instead, introduce a front-end reader that transforms sweet-exp text into canonical s-expression text, then feed that output into the existing compiler pipeline:

`sweet source -> sweet reader -> canonical s-expression source -> Lexer -> Parser -> CodeGenerator -> sclang`

Why this approach:

1. Minimum disruption to proven compiler stages.
2. Easy fallback to existing s-expression path.
3. Better testability (reader can be validated independently).

## 3.2 New Modules

1. `cli/lhc_sweet_reader.js`
   - Tokenize lines with indentation metadata.
   - Build indentation blocks.
   - Emit canonical s-expression text.
2. `cli/lhc_sweet_detect.js` (optional helper)
   - `detectSweetSyntax(source, fileName, explicitMode)`.
3. `cli/tests/test_lhc_sweet_reader.js`
   - Unit tests for syntax transformation and error cases.

## 3.3 Minimal Pipeline Touch Points

1. `cli/lhc_compile.js`
   - Add `compileScscmText(source, filename, opts = {})` options:
     - `syntax: 'sexpr' | 'sweet' | 'auto'` (default `auto`).
   - In `sweet`/`auto`, pre-normalize via reader before lexer.
2. `cli/lhc.js`
   - Add CLI flag `--syntax <auto|sexpr|sweet>`.
3. `cli/hclang.js` and related callers (already scscm-aware)
   - Thread syntax option through where relevant.

---

## 4. Syntax Scope (MVP vs Later)

## 4.1 MVP Scope

Support the same staged path used in `../fith`, but adapted to scscm:

1. Phase M1 (curly/neoteric subset):
   - Curly-infix forms for homogeneous operators.
   - Neoteric call sugar with no-whitespace trigger.
2. Phase M2 (full sweet-exp):
   - Indentation-based list nesting.
3. Function-call sugar such as:
   - `foo(bar)` -> `(foo bar)`
   - `printf("x")` -> `(printf "x")`
4. Multiple top-level forms separated by newlines.
5. Existing atoms/strings/numbers/keywords remain unchanged.
6. Existing explicit parentheses remain legal and can be mixed.

## 4.2 Deferred Features (Post-MVP)

1. Advanced sweet group forms and edge-case reader macros.
2. Quasiquote interactions with grouping (known tricky area in sweet ecosystems).
3. Optional sugar beyond official sweet-exp behavior.
4. Any behavior that diverges from the `../fith` reader contract without a clear scscm-specific reason.

---

## 5. Implementation Phases

## Phase 0: Spec + Parity Definition

Deliverables:

1. `docs/scscm/SCSCM_SWEET_EXP_SPEC.md` (new) defining supported grammar.
2. Parity table:
   - Feature
   - Racket sweet-exp behavior
   - turmeric behavior
   - scscm target behavior

Acceptance criteria:

1. Every MVP syntax rule has at least one positive and one negative example.
2. All deferred items are listed explicitly.

## Phase 1: Reader Prototype

Deliverables:

1. `cli/lhc_sweet_reader.js` with API:
   - `normalizeSweetToSexpr(source, opts = {}) -> { source, map }`
2. Internal line/column mapping for diagnostics.

Acceptance criteria:

1. Round-trip golden tests convert sweet input into expected s-expression output.
2. Syntax errors include sweet source position.

## Phase 2: Compiler Integration

Deliverables:

1. `cli/lhc_compile.js` option plumbing.
2. `cli/lhc.js` `--syntax` flag.
3. `cli/hclang.js` (and wrappers) plumbing if needed for one-step runs.

Acceptance criteria:

1. Existing s-expression fixtures remain unchanged in output.
2. Sweet fixtures compile to equivalent sclang as s-expression equivalents.

## Phase 3: Test Expansion

Deliverables:

1. New tests:
   - `cli/tests/test_lhc_sweet_reader.js`
   - Extensions to `cli/tests/test_lhc.js`
   - Extensions to `cli/tests/test_hclang_scscm.js`
2. Fixture pairs:
   - `foo.scscm` (sexpr)
   - `foo.sweet.scscm` (sweet)

Acceptance criteria:

1. `npm run test:scscm` passes.
2. `node cli/tests/test_hclang_scscm.js` parity checks pass (including one-step path).

## Phase 4: Documentation + UX

Deliverables:

1. Update `cli/README_SCSCM.md` with syntax mode docs.
2. Add `docs/scscm/SCSCM_SWEET_EXP_QUICK_START.md`.
3. Add clear troubleshooting section for indentation/line-join errors.

Acceptance criteria:

1. Users can discover and use `--syntax` from help text and docs only.
2. At least 3 canonical examples show both sexpr and sweet versions.

## Phase 5: Fith/Turmeric Parity Validation

Deliverables:

1. Import representative reader fixtures from `../fith` (curly-infix + neoteric first, then sweet-exp when available).
2. Parity report in `docs/scscm/SCSCM_SWEET_EXP_PARITY_REPORT.md`.

Acceptance criteria:

1. Every imported fixture is marked:
   - match
   - intentional divergence
   - unsupported (deferred)
2. All intentional divergences are documented with rationale.
3. scscm tracks `../fith` staged reader behavior for phases that are already implemented there.

---

## 6. CLI and API Design

## 6.1 CLI

`scscm [--syntax auto|sexpr|sweet] input.scscm`

Rules:

1. Default `auto` preserves existing behavior.
2. `sexpr` bypasses sweet reader entirely.
3. `sweet` enforces sweet parse path (useful for strict CI/authoring).

## 6.2 Programmatic API

`compileScscmText(source, filename, { syntax: 'auto' | 'sexpr' | 'sweet' })`

Error model:

1. Prefix errors with `scscm compilation failed` (existing convention).
2. Include sweet source position where applicable.

---

## 7. Testing Strategy

## 7.1 Unit Tests (Reader)

1. Flat one-line forms.
2. Nested indentation blocks.
3. Mixed explicit parens + indentation.
4. Strings/comments with parentheses-like characters.
5. Invalid dedent/indent mismatch.

## 7.2 Integration Tests (Compiler)

1. Compare sclang output between sexpr and sweet fixtures.
2. Ensure existing fixtures remain byte-for-byte stable where expected.

## 7.3 End-to-End Tests (hclang)

1. One-step `.scscm` execution using sweet fixtures.
2. Packet parity comparison with two-step compile+run flow.
3. `--syntax` override behavior checks.

---

## 8. Risks and Mitigations

1. Ambiguous newline/indent parsing:
   - Mitigation: strict MVP grammar, explicit error messages, defer exotic forms.
2. Diagnostic drift after normalization:
   - Mitigation: maintain source map from sweet text to canonical sexpr offsets.
3. Compatibility regressions in existing sexpr path:
   - Mitigation: keep parser/codegen unchanged; run full existing scscm tests.
4. Divergence from turmeric or official sweet-exp:
   - Mitigation: explicit parity matrix + documented intentional differences.

---

## 9. Rollout Plan

1. Ship behind explicit `--syntax sweet` first.
2. Keep default `auto`, but initially only detect sweet for clearly sweet-only constructs.
3. After parity confidence and docs maturity, broaden auto-detection heuristics.

---

## 10. Definition of Done

1. MVP sweet syntax compiles through existing backend without regressions.
2. Added tests cover reader, compiler parity, and one-step hclang execution.
3. CLI and docs clearly describe syntax modes and limitations.
4. Turmeric parity report completed (or explicitly blocked with tracked gaps).

---

## 11. Implementation Checklist and First PR Boundaries

This section turns the roadmap into a concrete execution sequence with small, reviewable pull requests.

## 11.1 Branching and Scope Rules

1. One phase per PR. Do not mix reader implementation and docs-only cleanup in the same PR.
2. No backend codegen behavior changes in early sweet-exp PRs unless required by failing parity tests.
3. Each PR must include at least one failing test added first, then fixed by the implementation.
4. Keep each PR reviewable in under 500 lines changed where possible.

## 11.2 PR-1: Reader Skeleton + Curly/Neoteric Subset (M1)

Objective:

Deliver the minimal reader infrastructure and first sweet-adjacent syntax tier, following the staged model observed in fith.

Files to add:

1. `cli/lhc_sweet_reader.js`
2. `cli/tests/test_lhc_sweet_reader.js`
3. `cli/tests/fixtures/sweet/curly_neoteric/` (new fixture folder)

Files to modify:

1. `cli/lhc_compile.js` (optional hook only if needed for tests, no default behavior change)

In-scope behavior:

1. Curly-infix normalization for homogeneous operators.
2. Neoteric no-whitespace sugar:
   - `f(x y)` -> `(f x y)`
   - `f[x]` -> bracketapply form (exact target form documented in fixture expectations)
3. Mixed operators in curly forms are explicitly rejected in PR-1 with a clear error message.

Out-of-scope behavior:

1. Full indentation sweet-exp grammar.
2. Automatic syntax detection.
3. CLI flags and user-facing docs.

Merge gates:

1. New reader unit tests pass.
2. Existing `cli/tests/test_lhc.js` passes unchanged.
3. No regressions in classic s-expression fixtures.

## 11.3 PR-2: Compile Integration + Syntax Modes

Objective:

Integrate reader output into the existing compile path while preserving default behavior.

Files to modify:

1. `cli/lhc_compile.js`
2. `cli/lhc.js`
3. `cli/tests/test_lhc.js`
4. `cli/package.json` (if test script aliases are expanded)

In-scope behavior:

1. Add compile option: `syntax = auto | sexpr | sweet`.
2. Add CLI flag: `--syntax auto|sexpr|sweet`.
3. Preserve default compatibility: existing usage continues to parse as current s-expression unless `sweet` is explicitly requested.
4. Add explicit error when `--syntax sweet` is selected and input hits unsupported full-sweet constructs.

Out-of-scope behavior:

1. hclang one-step integration.
2. Full indentation engine.

Merge gates:

1. Existing scscm tests pass.
2. New mode tests cover `sexpr`, `sweet`, and `auto`.
3. Error messages preserve existing prefix contract: `scscm compilation failed`.

## 11.4 PR-3: hclang One-Step Wiring + End-to-End Parity

Objective:

Ensure sweet-enabled scscm files work in one-step hclang flows and maintain packet-level parity with two-step compile+run.

Files to modify:

1. `cli/hclang.js` (and only related wrappers if required)
2. `cli/tests/test_hclang_scscm.js`
3. `cli/tests/fixtures/sweet/e2e/` (new)

In-scope behavior:

1. Thread syntax mode through one-step path.
2. Add end-to-end parity cases for sweet fixtures.
3. Ensure wrong-extension plus explicit syntax override works in one-step path.

Out-of-scope behavior:

1. New language features outside sweet parsing.
2. REPL mode UX enhancements.

Merge gates:

1. `cli/tests/test_hclang_scscm.js` passes for sweet and classic fixtures.
2. One-step and two-step packet parity checks pass for sweet fixtures.
3. Existing non-sweet one-step behavior remains unchanged.

## 11.5 PR-4: Full Sweet-Exp Indentation Core (M2)

Objective:

Implement indentation-significant sweet-expression grouping while keeping explicit s-expressions fully valid.

Files to modify:

1. `cli/lhc_sweet_reader.js`
2. `cli/tests/test_lhc_sweet_reader.js`
3. `cli/tests/fixtures/sweet/full/`

In-scope behavior:

1. Indentation stack and block grouping.
2. Newline-driven top-level form splitting.
3. Error diagnostics for invalid indent/dedent transitions.

Deferred inside PR-4 if needed:

1. Exotic full-sweet operators (GROUP/SPLIT and collecting-list forms) can be gated behind TODO markers if clearly documented in fixtures.

Merge gates:

1. Full-sweet fixture suite passes.
2. No regressions in M1 subset tests.
3. Compile and hclang end-to-end tests remain green.

## 11.6 PR-5: Docs + Parity Report

Objective:

Finalize user-facing guidance and lock parity expectations against fith/turmeric behavior.

Files to modify/add:

1. `cli/README_SCSCM.md`
2. `docs/scscm/SCSCM_SWEET_EXP_QUICK_START.md`
3. `docs/scscm/SCSCM_SWEET_EXP_SPEC.md`
4. `docs/scscm/SCSCM_SWEET_EXP_PARITY_REPORT.md`

Merge gates:

1. Docs describe syntax mode selection and troubleshooting clearly.
2. Parity report includes fixture-by-fixture status against fith references.
3. All intentional divergences are explicitly justified.

## 11.7 CI and Verification Checklist (Run Per PR)

1. `npm --prefix cli run test:scscm`
2. `node cli/tests/test_hclang_scscm.js` (or CI equivalent when wasm artifact is available)
3. Targeted new test file(s) added in that PR.
4. At least one manual compile smoke check from `cli/examples`.

## 11.8 Suggested Ownership Split (If Parallelized)

1. Engineer A: reader and fixtures (PR-1, PR-4).
2. Engineer B: compile/CLI and hclang wiring (PR-2, PR-3).
3. Engineer C or tech writer: docs and parity report (PR-5).

This split allows parallel progress after PR-1 establishes the reader contract.
