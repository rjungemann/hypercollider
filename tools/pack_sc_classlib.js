#!/usr/bin/env node
// tools/pack_sc_classlib.js
// Build-time script: concatenates all included SC class library files into a
// single binary pack so the WASM build can preload one file instead of 200+.
//
// Pack format:
//   8 bytes  magic: "SCCLPK\x01\n"
//   4 bytes  LE uint32: file count
//   for each file:
//     4 bytes  LE uint32: MEMFS path length
//     N bytes  MEMFS path (UTF-8, no null terminator)
//     4 bytes  LE uint32: content byte length
//     N bytes  content bytes
//
// Usage:
//   node tools/pack_sc_classlib.js \
//     --src-dir src/SCClassLibrary \
//     --memfs-prefix /usr/share/SuperCollider/SCClassLibrary \
//     --exclude src/SCClassLibrary/SCDoc \
//     --exclude src/SCClassLibrary/Common/Control/HID_API.sc \
//     --exclude src/SCClassLibrary/Common/Control/HIDFunc.sc \
//     --exclude src/SCClassLibrary/Common/Control/HIDMatchers.sc \
//     --exclude src/SCClassLibrary/Common/Control/SerialPort.sc \
//     --exclude src/SCClassLibrary/Common/Collections/osx \
//     --exclude src/SCClassLibrary/Common/Collections/linux \
//     --exclude src/SCClassLibrary/Common/Audio/iphone \
//     --output build/wasm/lang/hclang/hclang_classlib.pack

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const out = { srcDir: null, memfsPrefix: null, excludes: [], output: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if      (a === '--src-dir')       out.srcDir       = next();
    else if (a === '--memfs-prefix')  out.memfsPrefix  = next();
    else if (a === '--exclude')       out.excludes.push(next());
    else if (a === '--output')        out.output       = next();
    else { process.stderr.write(`Unknown argument: ${a}\n`); process.exit(1); }
  }
  if (!out.srcDir || !out.memfsPrefix || !out.output) {
    process.stderr.write('Usage: pack_sc_classlib.js --src-dir <dir> --memfs-prefix <prefix> --output <file>\n');
    process.exit(1);
  }
  return out;
}

function isExcluded(absPath, excludeAbsPaths) {
  for (const ex of excludeAbsPaths) {
    if (absPath === ex || absPath.startsWith(ex + path.sep)) return true;
  }
  return false;
}

function collectScFiles(dir, excludes, results) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (isExcluded(abs, excludes)) continue;
    if (entry.isDirectory()) {
      collectScFiles(abs, excludes, results);
    } else if (entry.isFile() && entry.name.endsWith('.sc') && !entry.name.startsWith('.')) {
      results.push(abs);
    }
  }
}

function main() {
  const opts = parseArgs(process.argv);
  const srcAbs     = path.resolve(opts.srcDir);
  const excludeAbs = opts.excludes.map(e => path.resolve(e));

  const files = [];
  collectScFiles(srcAbs, excludeAbs, files);
  files.sort(); // deterministic order

  // Build pack in memory
  const MAGIC = Buffer.from('SCCLPK\x01\n');
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(files.length, 0);

  const parts = [MAGIC, countBuf];
  for (const abs of files) {
    const rel       = path.relative(srcAbs, abs).split(path.sep).join('/');
    const memfsPath = opts.memfsPrefix + '/' + rel;
    const content   = fs.readFileSync(abs);
    const pathBuf   = Buffer.from(memfsPath, 'utf8');
    const lenBuf    = Buffer.alloc(8); // path-len + content-len
    lenBuf.writeUInt32LE(pathBuf.length, 0);
    lenBuf.writeUInt32LE(content.length, 4);
    parts.push(lenBuf, pathBuf, content);
  }

  fs.mkdirSync(path.dirname(opts.output), { recursive: true });
  fs.writeFileSync(opts.output, Buffer.concat(parts));

  const totalBytes = parts.reduce((s, b) => s + b.length, 0);
  process.stderr.write(
    `pack_sc_classlib: packed ${files.length} files → ${opts.output} ` +
    `(${(totalBytes / 1024).toFixed(0)} KB)\n`
  );
}

main();
