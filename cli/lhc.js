#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileScscmText } = require('./lhc_compile');
const { getVersion } = require('./hc_utils');

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    toSc: false,
    verbose: false,
    help: false,
    syntax: 'auto',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      console.log(`scscm (scscm_compiler) ${getVersion()}`);
      process.exit(0);
    } else if (arg === '--input' || arg === '-i') {
      args.input = argv[++i];
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[++i];
    } else if (arg === '--to-sc') {
      args.toSc = true;
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--syntax') {
      args.syntax = argv[++i];
      // Validate syntax value
      if (!['auto', 'sexpr', 'sweet'].includes(args.syntax)) {
        console.error(`Error: Invalid syntax mode '${args.syntax}'. Must be 'auto', 'sexpr', or 'sweet'.`);
        process.exit(1);
      }
    } else if (!arg.startsWith('-') && !args.input) {
      args.input = arg;
    }
  }

  return args;
}

function printHelp() {
  console.log(`scscm - Scheme-like SuperCollider Compiler (v${getVersion()})

Usage:
  scscm [OPTIONS] [INPUT]

Required:
  INPUT or -i, --input FILE  Input .scscm file

Options:
  -o, --output FILE          Output .sc file (optional, prints to stdout if not set)
  --to-sc                    Only compile to .sc, don't run through sclang
  --syntax auto|sexpr|sweet  Syntax mode: auto (default), sexpr (s-expressions only), sweet (sweet-exp)
  --verbose                  Enable verbose output (legacy flag)

Examples:
  scscm sine.scscm -o sine.sc
  scscm fm.scscm --verbose
  scscm synth.scscm | sclang
  scscm sweet_file.scscm --syntax sweet -o sweet_file.sc

Info:
  -h, --help                 Show this help and exit
  -v, --version              Show version and exit
`);
}

function reportError(msg, line, column) {
  if (line !== undefined && column !== undefined) {
    console.error(`Error at line ${line}, column ${column}: ${msg}`);
  } else {
    console.error(`Error: ${msg}`);
  }
}

async function main() {
  const argv = process.argv;
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.input) {
    reportError('Input file required. Use -h for help.');
    process.exit(1);
  }

  let source;
  try {
    source = fs.readFileSync(args.input, 'utf-8');
    if (args.verbose) {
      console.log(`[lhc] Read ${source.length} bytes from ${args.input}`);
    }
  } catch (err) {
    reportError(`Cannot read input file: ${err.message}`);
    process.exit(1);
  }

  let sclangCode;
  try {
    if (args.verbose) console.log('[lhc] Compiling...');
    sclangCode = compileScscmText(source, args.input, { syntax: args.syntax });
    if (args.verbose) {
      console.log(`[lhc] Generated ${sclangCode.length} bytes of sclang code`);
    }
  } catch (err) {
    reportError(err.message, err.line, err.column);
    if (args.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }

  if (args.output) {
    try {
      fs.writeFileSync(args.output, sclangCode, 'utf-8');
      if (args.verbose) {
        console.log(`[lhc] Wrote output to ${args.output}`);
      }
      console.log(`scscm: compiled ${args.input} -> ${args.output}`);
    } catch (err) {
      reportError(`Cannot write output file: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(sclangCode);
  }
}

if (require.main === module) {
  main().catch((err) => {
    reportError(err.message || err);
    process.exit(1);
  });
}

module.exports = { parseArgs };
