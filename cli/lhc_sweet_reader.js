#!/usr/bin/env node
'use strict';

/**
 * lhc_sweet_reader.js
 * 
 * Sweet-expression reader for scscm.
 * Transforms sweet-exp syntax into canonical s-expression text.
 * 
 * Implementation follows the staged rollout model from fith/turmeric:
 *   - Phase M1: Curly/Neoteric subset (curly-infix + neoteric call sugar)
 *   - Phase M2: Full sweet-exp (indentation-based grouping)
 * 
 * API:
 *   normalizeSweetToSexpr(source, opts = {}) -> { source: string, map: SourceMap }
 */

// ============================================================================
// Source Map Implementation
// ============================================================================

class SourceMap {
  constructor() {
    this.mappings = [];
  }

  addMapping(generatedLine, generatedColumn, originalLine, originalColumn, length = 1) {
    this.mappings.push({
      generated: { line: generatedLine, column: generatedColumn },
      original: { line: originalLine, column: originalColumn, length },
    });
  }

  getOriginalPosition(line, column) {
    for (const m of this.mappings) {
      if (m.generated.line === line && m.generated.column <= column) {
        return { line: m.original.line, column: m.original.column };
      }
    }
    return { line, column };
  }

  getGeneratedPosition(line, column) {
    return { line, column };
  }
}

// ============================================================================
// Simple regex-based normalizer for M1 (Curly/Neoteric subset)
// ============================================================================

const INFIX_OPERATORS = ['+', '-', '*', '/', '=', '<', '>', '<=', '>='];

/**
 * Normalize sweet-expression source to canonical s-expression source.
 * 
 * For M1 phase, this handles:
 *   - Curly-infix: { a + b } -> (+ a b)
 *   - Neoteric: f(x) -> (f x), f[x] -> (f x), f{args} -> (f args)
 * 
 * The approach is regex-based for simplicity and reliability.
 */
function normalizeSweetToSexpr(source, opts = {}) {
  const phase = opts.phase || 'm1';
  const map = new SourceMap();
  let result = source;

  // Track line/column for source mapping
  // This is a simplified implementation - in practice we'd build the mapping
  // as we transform. For now, we return an empty map.

  if (phase === 'm1' || phase === 'full') {
    // Step 0: Strip comments (line comments only for M1)
    result = stripComments(result, map);

    // Step 1: Handle neoteric call sugar INSIDE all forms first
    result = replaceNeoteric(result, map);

    // Step 2: Handle curly-infix forms { expr OP expr }
    // We need to find balanced curly braces and check for homogeneous operators
    result = replaceCurlyInfix(result, map);
  }

  // Validate for common errors
  validateResult(result);

  return { source: result.trim(), map };
}

/**
 * Validate the normalized result for common errors.
 */
function validateResult(result) {
  // Check for unmatched parentheses
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inString = false;

  for (let i = 0; i < result.length; i++) {
    const char = result[i];

    if (char === '"' && (i === 0 || result[i - 1] !== '\\')) {
      inString = !inString;
    }

    if (!inString) {
      if (char === '(') parenDepth++;
      else if (char === ')') parenDepth--;
      else if (char === '[') bracketDepth++;
      else if (char === ']') bracketDepth--;
      else if (char === '{') braceDepth++;
      else if (char === '}') braceDepth--;

      if (parenDepth < 0 || bracketDepth < 0 || braceDepth < 0) {
        throw new Error(`Unmatched closing delimiter at position ${i}`);
      }
    }
  }

  if (inString) {
    throw new Error('Unterminated string');
  }
  if (parenDepth > 0) {
    throw new Error(`Unclosed ( at end of input`);
  }
  if (bracketDepth > 0) {
    throw new Error(`Unclosed [ at end of input`);
  }
  if (braceDepth > 0) {
    throw new Error(`Unclosed { at end of input`);
  }
}

/**
 * Strip line comments from source and build source mappings.
 */
function stripComments(source, map) {
  let result = '';
  let resultLine = 1;
  let resultColumn = 1;
  let i = 0;
  let line = 1;
  let column = 1;

  while (i < source.length) {
    const char = source[i];

    if (char === ';') {
      // Skip to end of line - don't add to result
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\n') {
          line++;
          column = 1;
        } else {
          column++;
        }
        i++;
      }
    } else {
      // Add to result with mapping
      map.addMapping(resultLine, resultColumn, line, column);
      result += char;

      if (char === '\n') {
        resultLine++;
        resultColumn = 1;
        line++;
        column = 1;
      } else {
        resultColumn++;
        column++;
      }
      i++;
    }
  }

  return result;
}

/**
 * Replace curly-infix forms with s-expressions.
 * { a + b } -> (+ a b)
 * { a + b + c } -> (+ a b c)
 */
function replaceCurlyInfix(source, map) {
  let result = source;
  let changed = true;

  // We need to handle nested braces carefully
  // Process from innermost to outermost
  while (changed) {
    changed = false;
    let newResult = '';
    let i = 0;

    while (i < result.length) {
      if (result[i] === '{') {
        // Find matching closing brace
        const braceContent = extractBalanced(result, i, '{', '}');
        if (braceContent === null) {
          // Unclosed brace - throw error
          throw new Error(
            `Unclosed curly brace at position ${i}`
          );
        }

        const fullMatch = `{${braceContent}}`;

        // First, recursively process neoteric forms inside the content
        const processedContent = replaceNeoteric(braceContent, map);

        // Parse the content for infix operators
        const infixResult = parseInfixContent(processedContent);

        if (infixResult.isInfix) {
          // Replace with s-expression
          newResult += infixResult.expr;
          i += fullMatch.length;
          changed = true;
        } else {
          // Not infix (no operators or mixed) - leave as-is
          newResult += fullMatch;
          i += fullMatch.length;
        }
      } else {
        newResult += result[i];
        i++;
      }
    }

    result = newResult;
  }

  return result;
}

/**
 * Extract balanced content between delimiters.
 * Returns the content (without delimiters) or null if unbalanced.
 */
function extractBalanced(source, startPos, openChar, closeChar) {
  if (source[startPos] !== openChar) return null;

  let depth = 1;
  let content = '';
  let i = startPos + 1;

  while (i < source.length && depth > 0) {
    const char = source[i];

    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
    }

    if (depth > 0) {
      content += char;
    }
    i++;
  }

  if (depth > 0) {
    // Unclosed
    return null;
  }

  return content;
}

/**
 * Parse content inside curly braces to check if it's homogeneous infix.
 * Returns { isInfix: boolean, expr: string }
 */
function parseInfixContent(content) {
  // Tokenize the content (simple whitespace-split for now)
  const tokens = tokenizeSimple(content);

  // Check for homogeneous operators
  const operators = tokens.filter((t) => INFIX_OPERATORS.includes(t));

  if (operators.length === 0) {
    // No operators - treat as regular list
    return { isInfix: false, expr: `(${content.trim()})` };
  }

  // Check if all operators are the same
  const firstOp = operators[0];
  const allSame = operators.every((op) => op === firstOp);

  if (!allSame) {
    throw new Error(
      `Mixed operators in curly form: found ${operators.join(', ')}`
    );
  }

  // Build the s-expression: (OP arg1 arg2 ...)
  const args = tokens.filter((t) => !INFIX_OPERATORS.includes(t));
  const expr = `(${firstOp} ${args.join(' ')})`;

  return { isInfix: true, expr };
}

/**
 * Simple tokenizer that splits on whitespace.
 * Handles quoted strings and nested parens as single tokens.
 */
function tokenizeSimple(content) {
  const tokens = [];
  let i = 0;

  while (i < content.length) {
    // Skip whitespace
    while (i < content.length && /[ \t]/.test(content[i])) {
      i++;
    }

    if (i >= content.length) break;

    const char = content[i];

    if (char === '"') {
      // String
      let j = i + 1;
      while (j < content.length && content[j] !== '"') {
        if (content[j] === '\\') j++;
        j++;
      }
      if (j < content.length) j++;
      tokens.push(content.slice(i, j));
      i = j;
    } else if (char === '(' || char === ')' || char === '[' || char === ']') {
      // Skip nested parens/brackets for now - treat as single token
      let depth = 1;
      let j = i + 1;
      const closeChar = char === '(' ? ')' : char === '[' ? ']' : null;
      if (!closeChar) {
        j++;
      } else {
        while (j < content.length && depth > 0) {
          if (content[j] === char) depth++;
          else if (content[j] === closeChar) depth--;
          j++;
        }
      }
      tokens.push(content.slice(i, j));
      i = j;
    } else if (char === '<' || char === '>' || char === '=') {
      // Handle <=, >=, = operators
      if (i + 1 < content.length) {
        const twoChar = content.slice(i, i + 2);
        if (['<=', '>=', '=='].includes(twoChar)) {
          tokens.push(twoChar);
          i += 2;
          continue;
        }
      }
      tokens.push(char);
      i++;
    } else if (INFIX_OPERATORS.includes(char)) {
      // Single-character operator
      tokens.push(char);
      i++;
    } else if (/[a-zA-Z0-9_%\-*+\/!?.]/.test(char)) {
      // Symbol or number
      let j = i;
      while (j < content.length && /[a-zA-Z0-9_%\-*+\/!?.]/.test(content[j])) {
        j++;
      }
      tokens.push(content.slice(i, j));
      i = j;
    } else {
      i++;
    }
  }

  return tokens;
}

/**
 * Replace neoteric call sugar with s-expressions.
 * f(x) -> (f x)
 * f(x y) -> (f x y)
 * f[x] -> (f x)
 * f{x} -> (f x)
 * f(g(x)) -> (f (g x))
 */
function replaceNeoteric(source, map) {
  let result = source;
  let changed = true;

  // Process from innermost to outermost
  while (changed) {
    changed = false;
    let newResult = '';
    let i = 0;

    while (i < result.length) {
      // Look for symbol followed immediately by (, [, or {
      // Symbol can include : for SuperCollider-style keywords like Synth:new
      // Also can start with \ for SuperCollider symbols like \kick
      if (/[a-zA-Z0-9_%\:*+\/<>=!?.]/.test(result[i]) || result[i] === '\\') {
        let symbolMatch;
        if (result[i] === '\\') {
          // SuperCollider symbol starting with \
          symbolMatch = result.slice(i).match(/^\\\\?[a-zA-Z0-9_%\-*+\/<>=!?.]+/);
        } else {
          symbolMatch = result.slice(i).match(/^[a-zA-Z0-9_%\:*+\/<>=!?.]+/);
        }
        if (symbolMatch) {
          const symbol = symbolMatch[0];
          const nextChar = result[i + symbol.length];

          if (nextChar === '(' || nextChar === '[' || nextChar === '{') {
            // Found neoteric pattern
            const openChar = nextChar;
            const closeChar = openChar === '(' ? ')' : openChar === '[' ? ']' : '}';

            // Extract the arguments
            const argsContent = extractBalanced(
              result,
              i + symbol.length,
              openChar,
              closeChar
            );

            if (argsContent !== null) {
              const fullMatch = symbol + openChar + argsContent + closeChar;

              // Recursively process nested forms in arguments
              let args = replaceNeoteric(argsContent, map);
              args = replaceCurlyInfix(args, map);

              // Convert to s-expression
              // If args are empty: (f)
              // Otherwise: (f args...)
              const expr = args.trim() === ''
                ? `(${symbol})`
                : `(${symbol} ${args})`;

              newResult += expr;
              i += fullMatch.length;
              changed = true;
              continue;
            } else {
              // Unclosed delimiter
              throw new Error(
                `Unclosed ${openChar} in neoteric form at position ${i + symbol.length}`
              );
            }
          }
        }
      }

      newResult += result[i];
      i++;
    }

    result = newResult;
  }

  return result;
}

module.exports = {
  normalizeSweetToSexpr,
  SourceMap,
  // Export helper functions for testing
  extractBalanced,
  parseInfixContent,
  tokenizeSimple,
};
