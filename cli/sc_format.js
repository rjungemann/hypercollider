#!/usr/bin/env node
'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { format } = require('./sc_formatter');
const { getVersion } = require('./hc_utils');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    files:        [],
    check:        false,
    diff:         false,
    stdin:        false,
    quiet:        false,
    indentTabs:   true,
    indentSpaces: null,
    columnLimit:  120,
    help:         false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      console.log(`sc-format ${getVersion()}`);
      process.exit(0);
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--diff') {
      args.diff = true;
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--quiet' || arg === '-q') {
      args.quiet = true;
    } else if (arg === '--indent-tabs') {
      args.indentTabs = true;
      args.indentSpaces = null;
    } else if (arg === '--indent-spaces') {
      args.indentSpaces = parseInt(argv[++i], 10) || 4;
      args.indentTabs = false;
    } else if (arg === '--column-limit') {
      args.columnLimit = parseInt(argv[++i], 10) || 120;
    } else if (!arg.startsWith('-')) {
      args.files.push(arg);
    }
  }

  return args;
}

function printHelp() {
  console.log(`sc-format — formatter for sclang (.sc / .scd / .schelp) source files

Usage:
  sc-format [OPTIONS] [file ...]

Options:
  --check              Exit 1 if any file would be reformatted; print filenames.
  --diff               Print a unified diff instead of rewriting files.
  --stdin              Read from stdin, write formatted output to stdout.
  --indent-tabs        Use hard tabs (default, matches .editorconfig).
  --indent-spaces N    Use N spaces instead of tabs.
  --column-limit N     Soft column limit (default: 120).
  -q, --quiet          Suppress per-file messages.
  -v, --version        Print version and exit.
  -h, --help           Show this help and exit.

Examples:
  sc-format --check SCClassLibrary/ HelpSource/
  sc-format --diff SequenceableCollection.sc
  sc-format SCClassLibrary/Common/
  echo 'Foo { bar { ^1 } }' | sc-format --stdin
`);
}

// ---------------------------------------------------------------------------
// Diff helper (unified diff, no external deps)
// ---------------------------------------------------------------------------

function unifiedDiff(original, formatted, filePath) {
  const aLines = original.split('\n');
  const bLines = formatted.split('\n');
  const header = `--- ${filePath}\n+++ ${filePath} (formatted)\n`;

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
        hunkLines.push(` ${a}`);
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

const SC_EXTS = new Set(['.sc', '.scd', '.schelp']);

function collectFiles(inputs) {
  const results = [];
  for (const input of inputs) {
    try {
      const stat = fs.statSync(input);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(input, { recursive: true })) {
          if (SC_EXTS.has(path.extname(entry))) {
            results.push(path.join(input, entry));
          }
        }
      } else {
        results.push(input);
      }
    } catch (err) {
      process.stderr.write(`sc-format: cannot access '${input}': ${err.message}\n`);
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

  const opts = {
    indentTabs:   args.indentSpaces === null,
    indentSpaces: args.indentSpaces || 4,
    columnLimit:  args.columnLimit,
  };

  // --stdin mode
  if (args.stdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const source = Buffer.concat(chunks).toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    process.stdout.write(format(source, opts));
    return;
  }

  if (args.files.length === 0) {
    printHelp();
    process.exit(1);
  }

  const files = collectFiles(args.files);
  if (files.length === 0) {
    process.stderr.write('sc-format: no .sc / .scd / .schelp files found\n');
    process.exit(1);
  }

  let needsChange = false;

  for (const filePath of files) {
    let source;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      process.stderr.write(`sc-format: cannot read '${filePath}': ${err.message}\n`);
      process.exitCode = 1;
      continue;
    }

    source = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const formatted = format(source, opts);

    if (source === formatted) continue;

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

    try {
      fs.writeFileSync(filePath, formatted, 'utf-8');
      if (!args.quiet) console.log(`sc-format: reformatted ${filePath}`);
    } catch (err) {
      process.stderr.write(`sc-format: cannot write '${filePath}': ${err.message}\n`);
      process.exitCode = 1;
    }
  }

  if (needsChange) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`sc-format: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { format };
