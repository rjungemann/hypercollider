#!/usr/bin/env node
'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { format } = require('./lhc_formatter');
const { getVersion } = require('./hc_utils');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    files: [],
    check: false,
    diff: false,
    stdin: false,
    lineLength: 80,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      console.log(`scscm-format ${getVersion()}`);
      process.exit(0);
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--diff') {
      args.diff = true;
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--line-length') {
      args.lineLength = parseInt(argv[++i], 10) || 80;
    } else if (!arg.startsWith('-')) {
      // Could be a file glob or explicit path; expand later
      args.files.push(arg);
    }
  }

  return args;
}

function printHelp() {
  console.log(`scscm-format — formatter for .scscm (Scheme-like SuperCollider) files

Usage:
  scscm-format [OPTIONS] [file ...]

Options:
  --check         Exit 1 if any file would be reformatted; print filenames.
  --diff          Print a unified diff instead of rewriting files.
  --stdin         Read from stdin, write formatted output to stdout.
  --line-length N Soft column limit (default: 80).
  -v, --version   Print version and exit.
  -h, --help      Show this help and exit.

Examples:
  scscm-format --check examples/
  scscm-format sine.scscm
  echo '(var x 1)' | scscm-format --stdin
`);
}

// ---------------------------------------------------------------------------
// Diff helper (unified diff, no external deps)
// ---------------------------------------------------------------------------

function unifiedDiff(original, formatted, filePath) {
  const aLines = original.split('\n');
  const bLines = formatted.split('\n');
  const header = `--- ${filePath}\n+++ ${filePath} (formatted)\n`;

  // Simple line-by-line diff output
  const diffs = [];
  const maxLen = Math.max(aLines.length, bLines.length);
  let hunkStart = -1;
  const hunkLines = [];

  const flushHunk = () => {
    if (hunkLines.length > 0) {
      diffs.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
      for (const l of hunkLines) diffs.push(l);
      hunkLines.length = 0;
      hunkStart = -1;
    }
  };

  for (let i = 0; i < maxLen; i++) {
    const a = aLines[i];
    const b = bLines[i];
    if (a !== b) {
      if (hunkStart < 0) hunkStart = i;
      if (a !== undefined) hunkLines.push(`-${a}`);
      if (b !== undefined) hunkLines.push(`+${b}`);
    } else {
      if (hunkLines.length > 0) {
        hunkLines.push(` ${a}`); // context line
        if (hunkLines.filter(l => l.startsWith('-') || l.startsWith('+')).length === 0) {
          flushHunk();
        }
      }
    }
  }
  flushHunk();

  if (diffs.length === 0) return null;
  return header + diffs.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

function collectFiles(inputs) {
  const results = [];
  for (const input of inputs) {
    try {
      const stat = fs.statSync(input);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(input, { recursive: true })) {
          if (entry.endsWith('.scscm')) {
            results.push(path.join(input, entry));
          }
        }
      } else {
        results.push(input);
      }
    } catch (err) {
      process.stderr.write(`scscm-format: cannot access '${input}': ${err.message}\n`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // --stdin mode
  if (args.stdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const source = Buffer.concat(chunks).toString('utf-8');
    process.stdout.write(format(source, { lineLength: args.lineLength }));
    return;
  }

  if (args.files.length === 0) {
    printHelp();
    process.exit(1);
  }

  const files = collectFiles(args.files);
  if (files.length === 0) {
    process.stderr.write('scscm-format: no .scscm files found\n');
    process.exit(1);
  }

  let needsChange = false;

  for (const filePath of files) {
    let source;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      process.stderr.write(`scscm-format: cannot read '${filePath}': ${err.message}\n`);
      process.exitCode = 1;
      continue;
    }

    const formatted = format(source, { lineLength: args.lineLength });

    if (source === formatted) continue; // already canonical

    if (args.check) {
      console.log(filePath);
      needsChange = true;
      continue;
    }

    if (args.diff) {
      const d = unifiedDiff(source, formatted, filePath);
      if (d) process.stdout.write(d);
      continue;
    }

    // Rewrite file in-place
    try {
      fs.writeFileSync(filePath, formatted, 'utf-8');
      console.log(`scscm-format: reformatted ${filePath}`);
    } catch (err) {
      process.stderr.write(`scscm-format: cannot write '${filePath}': ${err.message}\n`);
      process.exitCode = 1;
    }
  }

  if (needsChange) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`scscm-format: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { format };
