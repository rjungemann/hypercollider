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
 * 
 * Options:
 *   phase: 'm1' (curly/neoteric only) or 'm2'/'full' (includes indentation)
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
// Sweet Reader Implementation
// ============================================================================

const INFIX_OPERATORS = new Set(['+', '-', '*', '/', '=', '<', '>', '<=', '>=']);

/**
 * Normalize sweet-expression source to canonical s-expression source.
 * 
 * For M1 phase, handles curly-infix and neoteric sugar.
 * For M2 phase, also handles indentation-based grouping.
 */
function normalizeSweetToSexpr(source, opts = {}) {
  const phase = opts.phase || 'm1';
  const map = new SourceMap();

  // Step 0: Handle line continuation (backslash at end of line)
  let result = handleLineContinuation(source);

  // Step 1: Strip comments
  result = stripComments(result, map);

  if (phase === 'm2' || phase === 'full') {
    // M2: Handle indentation-based grouping
    result = handleIndentationGrouping(result, map);
  }

  // Step 2: Handle neoteric call sugar
  result = replaceNeoteric(result, map);

  // Step 3: Handle curly-infix forms
  result = replaceCurlyInfix(result, map);

  // Step 4: Validate result
  validateResult(result);

  return { source: result.trim(), map };
}

/**
 * Handle line continuation with backslash.
 * Lines ending with \ are joined with the next line.
 */
function handleLineContinuation(source) {
  const lines = source.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    if (trimmed.endsWith('\\') && i + 1 < lines.length) {
      // Join with next line
      result.push(line.slice(0, -1) + lines[i + 1]);
      i += 2;
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Strip line comments from source.
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
      // Skip to end of line
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
 * Handle indentation-based grouping for M2.
 * 
 * For now, this is a simplified implementation that handles the common case
 * of a function call with indented arguments.
 * 
 * Example:
 *   play            → (play (Synth:new \kick))
 *     Synth:new \kick
 * 
 *   defn add        → (defn add (x y) (+ x y))
 *     x y
 *     + x y
 * 
 * Each indented line becomes a wrapped form.
 */
function handleIndentationGrouping(source, map) {
  const lines = source.split('\n').filter(l => l.trim() !== '');
  
  if (lines.length <= 1) {
    return source;
  }

  // Parse indentation for each line
  const parsed = lines.map(line => {
    const match = line.match(/^([ \t]*)(.*?)[ \t]*$/);
    return {
      indent: match ? match[1].length : 0,
      content: match ? match[2] : line,
    };
  });

  // Simple algorithm: if line 2+ are indented relative to line 1,
  // wrap each indented line as a form and append to line 1
  const firstIndent = parsed[0].indent;
  const indentedLines = [];
  let i = 1;

  // Collect all lines at the same indent as the first indented line
  while (i < parsed.length && parsed[i].indent > firstIndent) {
    // Each indented line becomes a wrapped form
    const lineContent = parsed[i].content;
    // If the line has multiple tokens, wrap it
    const wrappedLine = lineContent.includes(' ') 
      ? `(${lineContent})` 
      : lineContent;
    indentedLines.push(wrappedLine);
    i++;
  }

  if (indentedLines.length > 0) {
    // Wrap the first line and indented lines together
    const wrapped = `(${parsed[0].content} ${indentedLines.join(' ')})`;
    
    // If there are more lines, process them too
    if (i < parsed.length) {
      const restResult = handleIndentationGrouping(
        parsed.slice(i).map(l => '  '.repeat(l.indent - firstIndent) + l.content).join('\n'),
        map
      );
      return wrapped + ' ' + restResult;
    }
    
    return wrapped;
  }

  // No indentation - just join all lines
  return parsed.map(l => l.content).join(' ');
}

/**
 * Extract balanced content between delimiters.
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
    return null; // Unclosed
  }

  return content;
}

/**
 * Simple tokenizer for infix content parsing.
 */
function tokenizeSimple(content) {
  const tokens = [];
  let i = 0;

  while (i < content.length) {
    while (i < content.length && /[ \t]/.test(content[i])) {
      i++;
    }

    if (i >= content.length) break;

    const char = content[i];

    if (char === '"') {
      let j = i + 1;
      while (j < content.length && content[j] !== '"') {
        if (content[j] === '\\') j++;
        j++;
      }
      if (j < content.length) j++;
      tokens.push(content.slice(i, j));
      i = j;
    } else if (char === '(' || char === ')' || char === '[' || char === ']') {
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
    } else if (INFIX_OPERATORS.has(char)) {
      tokens.push(char);
      i++;
    } else if (/[a-zA-Z0-9_%\:*+\/<>=!?.]/.test(char) || char === '\\') {
      let j = i;
      if (char === '\\') {
        j++;
        while (j < content.length && /[a-zA-Z0-9_%\-*+\/<>=!?.]/.test(content[j])) {
          j++;
        }
      } else {
        while (j < content.length && /[a-zA-Z0-9_%\:*+\/<>=!?.]/.test(content[j])) {
          j++;
        }
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
 * Parse infix content and return s-expression if homogeneous.
 */
function parseInfixContent(content) {
  const tokens = tokenizeSimple(content);
  const operators = tokens.filter((t) => INFIX_OPERATORS.has(t));

  if (operators.length === 0) {
    return { isInfix: false, expr: `(${content.trim()})` };
  }

  const firstOp = operators[0];
  const allSame = operators.every((op) => op === firstOp);

  if (!allSame) {
    throw new Error(
      `Mixed operators in curly form: found ${operators.join(', ')}`
    );
  }

  const args = tokens.filter((t) => !INFIX_OPERATORS.has(t));
  const expr = `(${firstOp} ${args.join(' ')})`;

  return { isInfix: true, expr };
}

/**
 * Replace curly-infix forms with s-expressions.
 */
function replaceCurlyInfix(source, map) {
  let result = source;
  let changed = true;

  while (changed) {
    changed = false;
    let newResult = '';
    let i = 0;

    while (i < result.length) {
      if (result[i] === '{') {
        const braceContent = extractBalanced(result, i, '{', '}');
        if (braceContent === null) {
          throw new Error(
            `Unclosed curly brace at position ${i}`
          );
        }

        const fullMatch = `{${braceContent}}`;
        const processedContent = replaceNeoteric(braceContent, map);
        const infixResult = parseInfixContent(processedContent);

        if (infixResult.isInfix) {
          newResult += infixResult.expr;
          i += fullMatch.length;
          changed = true;
        } else {
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
 * Replace neoteric call sugar with s-expressions.
 */
function replaceNeoteric(source, map) {
  let result = source;
  let changed = true;

  while (changed) {
    changed = false;
    let newResult = '';
    let i = 0;

    while (i < result.length) {
      if (/[a-zA-Z0-9_%\:*+\/<>=!?.]/.test(result[i]) || result[i] === '\\') {
        let symbolMatch;
        if (result[i] === '\\') {
          symbolMatch = result.slice(i).match(/^\\\\?[a-zA-Z0-9_%\-*+\/<>=!?.]+/);
        } else {
          symbolMatch = result.slice(i).match(/^[a-zA-Z0-9_%\:*+\/<>=!?.]+/);
        }
        if (symbolMatch) {
          const symbol = symbolMatch[0];
          const nextChar = result[i + symbol.length];

          if (nextChar === '(' || nextChar === '[' || nextChar === '{') {
            const openChar = nextChar;
            const closeChar = openChar === '(' ? ')' : openChar === '[' ? ']' : '}';
            const argsContent = extractBalanced(
              result,
              i + symbol.length,
              openChar,
              closeChar
            );

            if (argsContent !== null) {
              const fullMatch = symbol + openChar + argsContent + closeChar;
              let args = replaceNeoteric(argsContent, map);
              args = replaceCurlyInfix(args, map);

              const expr = args.trim() === ''
                ? `(${symbol})`
                : `(${symbol} ${args})`;

              newResult += expr;
              i += fullMatch.length;
              changed = true;
              continue;
            } else {
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

/**
 * Validate the normalized result for common errors.
 */
function validateResult(result) {
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

module.exports = {
  normalizeSweetToSexpr,
  SourceMap,
  // Export helper functions for testing
  extractBalanced,
  parseInfixContent,
  tokenizeSimple,
  handleLineContinuation,
  handleIndentationGrouping,
  stripComments,
};
