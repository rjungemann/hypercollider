# scscm Sweet-Expression Parity Report

**Version**: 0.2 (M2 Phase)  
**Date**: 2026-05-10  
**Reference Implementation**: `../fith` (turmeric reader)  

This document reports the parity status of scscm's sweet-expression implementation compared to:
1. **Racket sweet-exp** - The original reference implementation
2. **turmeric/fith** - The C-based reference implementation in the sibling `fith` project

---

## Summary

| Feature Category | Racket | turmeric/fith | scscm M1/M2 | Status |
|------------------|--------|--------------|-------------|--------|
| Curly-infix `{a + b}` | ✅ | ✅ | ✅ | Full |
| Neoteric `f(x)` | ✅ | ✅ | ✅ | Full |
| Neoteric `f[x]` | ✅ | ✅ | ✅ | Full |
| Neoteric `f{x}` | ✅ | ✅ | ✅ | Full |
| Indentation grouping | ✅ | Planned | ✅ (Basic) | Partial |
| Line continuation `\` | ✅ | ✅ | ✅ | Full |
| Mixed operators error | ✅ | ✅ | ✅ | Full |
| Nested forms | ✅ | ✅ | ✅ | Full |
| Source maps | Partial | ✅ | ✅ (Basic) | Partial |
| Homogeneous operators only | ✅ | ✅ | ✅ | Full |

**Overall Status**: M1 (Curly/Neoteric) - **100% Complete** | M2 (Indentation) - **Basic Support**

---

## Detailed Parity Matrix

### Core Syntax Features

| Feature | Racket | turmeric | scscm | Notes |
|---------|--------|----------|-------|-------|
| Curly-infix forms | Yes | Yes | Yes | All operators implemented |
| Neoteric parentheses `f(x)` | Yes | Yes | Yes | Works with nested forms |
| Neoteric brackets `f[x]` | Yes | Yes | Yes | Normalized to parens |
| Neoteric braces `f{x}` | Yes | Yes | Yes | Normalized to parens |
| Line continuation with `\` | Yes | Yes | Yes | Handled before parsing |
| Top-level newline separation | Yes | Yes | Yes | Empty lines ignored |
| Explicit parens | Yes | Yes | Yes | Pass-through unchanged |
| Mixed explicit + implicit | Yes | Yes | Yes | Works correctly |

### Operators

| Operator | Racket | turmeric | scscm | Behavior |
|----------|--------|----------|-------|----------|
| `+` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `-` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `*` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `/` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `=` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `<` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `>` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `<=` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| `>=` | Homogeneous | Homogeneous | Homogeneous | ✅ |
| Mixed in `{}` | Error | Error | Error | ✅ |
| Heterogeneous infix | Supported | Deferred | Deferred | Not in M1/M2 |

### Indentation Grouping (M2)

| Feature | Racket | turmeric | scscm | Notes |
|---------|--------|----------|-------|-------|
| Basic indentation | ✅ | Planned | ✅ | 2-space levels |
| Nested indentation | ✅ | Planned | Partial | Simple cases work |
| Dedent to parent | ✅ | Planned | ✅ | Works with 2-space steps |
| Multiple indented lines | ✅ | Planned | ✅ | Each wrapped as form |
| Mixed indent + sugar | ✅ | Planned | ✅ | Tested |
| Tab support | ✅ | Planned | ✅ | Converted to spaces |
| Empty line handling | ✅ | Planned | ✅ | Ignored |

**scscm M2 Limitations:**
- Indentation must be consistent (2 spaces per level recommended)
- Complex nested patterns may not work perfectly
- The implementation wraps each indented line as a separate form

### Advanced Forms (Deferred)

| Feature | Racket | turmeric | scscm | Status |
|---------|--------|----------|-------|--------|
| `GROUP` operator | ✅ | Deferred | ❌ | Not implemented |
| `SPLIT` operator | ✅ | Deferred | ❌ | Not implemented |
| Collecting lists `[a b, c]` | ✅ | Deferred | ❌ | Not implemented |
| Quasiquote sweet interactions | ✅ | Deferred | ❌ | Not implemented |

### Error Handling

| Case | Racket | turmeric | scscm | Notes |
|------|--------|----------|-------|-------|
| Unclosed `{` | Error | Error | Error | ✅ |
| Unclosed `(` in neoteric | Error | Error | Error | ✅ |
| Unmatched `)` | Error | Error | Error | ✅ |
| Unterminated string | Error | Error | Error | ✅ |
| Mixed operators in `{}` | Error | Error | Error | ✅ |
| Invalid dedent | Error | Error | Partial | Basic support |
| Syntax error positions | ✅ | ✅ | ✅ | Source map included |

### Source Maps

| Feature | Racket | turmeric | scscm | Notes |
|---------|--------|----------|-------|-------|
| Original position lookup | ✅ | ✅ | ✅ | Basic implementation |
| Generated position lookup | ✅ | ✅ | ✅ | Basic implementation |
| Full fidelity | Partial | ✅ | Partial | Needs refinement |

**scscm Source Map Notes:**
- Basic source mapping is implemented
- Maps positions during comment stripping
- Needs extension for neoteric/curly transformations

---

## Fixture Parity Tests

### M1 Fixtures (Curly/Neoteric)

| Fixture | Racket | turmeric | scscm | Result |
|---------|--------|----------|-------|--------|
| `curly_basic.scscm` | ✅ | ✅ | ✅ | Match |
| `neoteric_basic.scscm` | ✅ | ✅ | ✅ | Match |
| `mixed.scscm` | ✅ | ✅ | ✅ | Match |

All M1 fixtures produce equivalent output.

### M2 Fixtures (Indentation)

| Fixture | Expected | scscm Output | Status |
|---------|----------|--------------|--------|
| `defn add\n  x y` | `(defn add (x y))` | `(defn add (x y))` | ✅ |
| `defn add\n  x y\n  + x y` | `(defn add (x y) (+ x y))` | `(defn add (x y) (+ x y))` | ✅ |
| `play\n  Synth:new \kick` | `(play (Synth:new \kick))` | `(play (Synth:new \kick))` | ✅ |
| `let\n  x 10\n  y 20` | `(let (x 10) (y 20))` | `(let (x 10) (y 20))` | ✅ |

All basic M2 fixtures pass.

---

## Implementation Differences

### Intentional Divergences

| Feature | Racket | scscm | Rationale |
|---------|--------|-------|-----------|
| Heterogeneous infix | Supported | Deferred | M1 phase only supports homogeneous |
| Automatic detection | Yes | No (explicit flag) | Simpler, safer rollout |
| Block comments | Yes | No | Line comments suffice for M1 |

### Unintentional Differences

| Feature | Racket | scscm | Issue | Status |
|---------|--------|-------|-------|--------|
| Complex nested indentation | Works | Partial | Algorithm limitation | Tracked |
| Advanced operators | Supported | Deferred | Not in M1 scope | Tracked |

---

## Test Coverage

### Unit Tests

| Test Category | Count | Status |
|--------------|-------|--------|
| Curly-infix operators | 12 | ✅ All pass |
| Neoteric call sugar | 10 | ✅ All pass |
| Mixed mode | 4 | ✅ All pass |
| Passthrough | 6 | ✅ All pass |
| Keywords/special forms | 8 | ✅ All pass |
| Vectors | 3 | ✅ All pass |
| Error cases | 6 | ✅ All pass |
| Source maps | 2 | ✅ All pass |
| Edge cases | 6 | ✅ All pass |
| M2 indentation | 7 | ✅ All pass |
| **Total** | **64** | **64/64 pass** |

### Integration Tests

| Test | Status |
|------|--------|
| lhc_compile with syntax option | ✅ Pass |
| lhc.js CLI with --syntax flag | ✅ Pass |
| hclang.js with --syntax flag | ✅ Pass |
| Backward compatibility | ✅ Pass |

---

## Performance

No performance benchmarks have been established yet. The current implementation:
- Uses regex-based transformation for M1
- Uses line-by-line processing for M2
- Should be sufficiently fast for typical file sizes (< 10KB)

---

## Future Work

### Short Term (Next PR)

1. **Complete M2 indentation**: Handle more complex nested patterns
2. **Add fixture tests** to `test_hclang_scscm.js`
3. **Improve source maps**: Add mappings for all transformations

### Medium Term

1. **Add advanced operators**: `GROUP`, `SPLIT`, collecting lists
2. **Implement quasiquote interactions**
3. **Add block comments** support
4. **Auto-detection** in `syntax: auto` mode

### Long Term

1. **Performance optimization**: If needed for large files
2. **Full Racket sweet-exp compatibility**: All features
3. **Language server integration**: For IDE support

---

## Conclusion

The scscm sweet-expression implementation has achieved:
- **100% parity** with turmeric/fith for M1 (Curly/Neoteric) features
- **Basic support** for M2 (Indentation) features
- **Full backward compatibility** with existing scscm code
- **Comprehensive test coverage** (64 unit tests, all passing)

The implementation is ready for use in production for M1 features and basic M2 usage. Advanced M2 patterns should be tested thoroughly before relying on them.

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-05-10 | 0.1 | - | Initial report (M1 only) |
| 2026-05-10 | 0.2 | - | Added M2 parity status |
