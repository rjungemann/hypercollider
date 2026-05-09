#!/usr/bin/env node
// bench/summarize.js — HyperCollider benchmark result summariser
//
// Usage:
//   node bench/summarize.js [options] <result.json> [<result2.json> ...]
//
// Options:
//   --phase  <name>   Filter to a specific phase (cold|startup|warm). Default: all.
//   --patch  <name>   Filter to a specific patch.  Default: all.
//   --md              Print Markdown table instead of plain text.
//
// When multiple files are given, results from all files are merged.

'use strict';

const fs   = require('fs');
const path = require('path');

// ── CLI ─────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const files  = [];
let phaseFilter = null;
let patchFilter = null;
let mdOutput    = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--phase': phaseFilter = args[++i]; break;
    case '--patch': patchFilter = args[++i]; break;
    case '--md':    mdOutput    = true;      break;
    default:        files.push(args[i]);     break;
  }
}

if (files.length === 0) {
  console.error('Usage: node bench/summarize.js [--phase <phase>] [--patch <patch>] [--md] <result.json> ...');
  console.error('');
  console.error('  If no file is given, the most recent file in bench/results/ is used.');
  // Auto-detect most recent result
  const resultsDir = path.join(__dirname, 'results');
  if (fs.existsSync(resultsDir)) {
    const jsonFiles = fs.readdirSync(resultsDir)
      .filter(f => f.endsWith('.json'))
      .sort();
    if (jsonFiles.length > 0) {
      files.push(path.join(resultsDir, jsonFiles[jsonFiles.length - 1]));
      console.error(`  Using: ${files[0]}`);
    }
  }
  if (files.length === 0) {
    process.exit(1);
  }
}

// ── Load results ─────────────────────────────────────────────────────────────

let allResults = [];
let systems = [];

for (const file of files) {
  const raw  = JSON.parse(fs.readFileSync(file, 'utf8'));
  allResults = allResults.concat(raw.results || []);
  if (raw.system) systems.push({ file: path.basename(file), ...raw.system });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function fmt(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

// RSS values come in as kB from `gtime -f %M`. Render as MB with one
// decimal — keeps the column narrow and the precision honest (1 MB
// granularity is well within run-to-run jitter).
function fmtMB(kb) {
  if (kb == null) return '—';
  return (kb / 1024).toFixed(1);
}

function ratio(wasm, native, dp = 2) {
  if (wasm == null || native == null || native === 0) return '—';
  return (wasm / native).toFixed(dp) + 'x';
}

// ── Filter ───────────────────────────────────────────────────────────────────

const measured = allResults.filter(r => {
  if (r.warmup === true || r.warmup === 'true') return false;
  if (phaseFilter && r.phase !== phaseFilter) return false;
  if (patchFilter && r.patch !== patchFilter) return false;
  return true;
});

// ── Grouping helper ──────────────────────────────────────────────────────────
// Returns { phase → patch → toolchain → [row, ...] }

function groupBy(rows) {
  const g = {};
  for (const r of rows) {
    const ph  = r.phase;
    const pat = r.patch   || '(none)';
    const tc  = r.toolchain;
    ((g[ph]  = g[ph]  || {})[pat] = (g[ph][pat] || {}))[tc] =
      ((g[ph][pat][tc] = g[ph][pat][tc] || []), g[ph][pat][tc].push(r), g[ph][pat][tc]);
  }
  return g;
}

const grouped = groupBy(measured);

// ── Markdown helpers ─────────────────────────────────────────────────────────

function mdHeader() {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `# Benchmark Summary — ${ts}\n`;
}

function mdRow(cols) {
  return '| ' + cols.join(' | ') + ' |';
}

function mdSep(n) {
  return '|' + Array(n).fill('---').join('|') + '|';
}

// ── Startup summary ──────────────────────────────────────────────────────────

function summariseStartup(groups) {
  const wasm     = groups['startup']?.['(none)']?.['wasm']      || [];
  const native   = groups['startup']?.['(none)']?.['native']    || [];
  const wamrFull = groups['startup']?.['(none)']?.['wamr-full'] || [];
  const wamrAot  = groups['startup']?.['(none)']?.['wamr-aot']  || [];

  const wMs    = median(wasm.map(r => r.wall_lang_startup_ms));
  const nMs    = median(native.map(r => r.wall_lang_startup_ms));
  const fMs    = median(wamrFull.map(r => r.wall_lang_startup_ms));
  const aotMs  = median(wamrAot.map(r => r.wall_lang_startup_ms));

  if (wMs == null && nMs == null && fMs == null && aotMs == null) {
    return null;
  }

  if (mdOutput) {
    return [
      '## Startup',
      '',
      mdRow(['Toolchain', 'Median (ms)', 'vs native']),
      mdSep(3),
      nMs   != null ? mdRow(['native',    fmt(nMs),   '1.00x'])             : null,
      wMs   != null ? mdRow(['wasm',      fmt(wMs),   ratio(wMs, nMs)])     : null,
      fMs   != null ? mdRow(['wamr-full', fmt(fMs),   ratio(fMs, nMs)])     : null,
      aotMs != null ? mdRow(['wamr-aot',  fmt(aotMs), ratio(aotMs, nMs)])   : null,
    ].filter(l => l != null).join('\n');
  } else {
    const lines = ['Startup:'];
    if (nMs   != null) lines.push(`  native    : ${fmt(nMs)} ms`);
    if (wMs   != null) lines.push(`  wasm      : ${fmt(wMs)} ms  (${ratio(wMs, nMs)} native)`);
    if (fMs   != null) lines.push(`  wamr-full : ${fmt(fMs)} ms  (${ratio(fMs, nMs)} native)`);
    if (aotMs != null) lines.push(`  wamr-aot  : ${fmt(aotMs)} ms  (${ratio(aotMs, nMs)} native${fMs != null ? `, ${ratio(aotMs, fMs)} wamr-full` : ''})`);
    return lines.join('\n');
  }
}

// ── Cold / warm summary ──────────────────────────────────────────────────────

function summarisePhase(phase, groups) {
  const phaseGroups = groups[phase];
  if (!phaseGroups) return null;

  const patches = Object.keys(phaseGroups).sort();
  if (patches.length === 0) return null;

  const rows = [];

  for (const patch of patches) {
    const wasm     = phaseGroups[patch]?.['wasm']      || [];
    const native   = phaseGroups[patch]?.['native']    || [];
    const wamrFull = phaseGroups[patch]?.['wamr-full'] || [];

    const nTotal   = median(native.map(r => r.wall_total_ms));
    const nCompile = median(native.map(r => r.wall_compile_ms));
    const nSynth   = median(native.map(r => r.wall_synth_ms));

    const wTotal    = median(wasm.map(r => r.wall_total_ms));
    const wCompile  = median(wasm.map(r => r.wall_compile_ms));
    const wSynth    = median(wasm.map(r => r.wall_synth_ms));
    const wModule   = median(wasm.map(r => r.wall_module_ms).filter(v => v != null));
    const wBoot     = median(wasm.map(r => r.wall_boot_ms).filter(v => v != null));
    const wEval     = median(wasm.map(r => r.wall_eval_ms).filter(v => v != null));
    const wSucceeded   = median(wasm.map(r => r.wall_succeeded_ms).filter(v => v != null));
    const wPassone     = median(wasm.map(r => r.wall_passone_ms).filter(v => v != null));
    const wDeptree     = median(wasm.map(r => r.wall_deptree_ms).filter(v => v != null));
    const wInitruntime = median(wasm.map(r => r.wall_initruntime_ms).filter(v => v != null && v > 0));
    const wStartup     = median(wasm.map(r => r.wall_startup_ms).filter(v => v != null && v > 0));

    const fTotal     = median(wamrFull.map(r => r.wall_total_ms));
    const fCompile   = median(wamrFull.map(r => r.wall_compile_ms));
    const fSynth     = median(wamrFull.map(r => r.wall_synth_ms));
    const fRssLang   = median(wamrFull.map(r => r.peak_rss_lang_kb).filter(v => v != null && v > 0));
    const fRssSynth  = median(wamrFull.map(r => r.peak_rss_synth_kb).filter(v => v != null && v > 0));

    const wamrAot      = phaseGroups[patch]?.['wamr-aot'] || [];
    const aotTotal     = median(wamrAot.map(r => r.wall_total_ms));
    const aotCompile   = median(wamrAot.map(r => r.wall_compile_ms));
    const aotSynth     = median(wamrAot.map(r => r.wall_synth_ms));
    const aotRssLang   = median(wamrAot.map(r => r.peak_rss_lang_kb).filter(v => v != null && v > 0));
    const aotRssSynth  = median(wamrAot.map(r => r.peak_rss_synth_kb).filter(v => v != null && v > 0));

    rows.push({
      patch, nTotal, nCompile, nSynth,
      wTotal, wCompile, wSynth, wModule, wBoot, wEval,
      wSucceeded, wPassone, wDeptree, wInitruntime, wStartup,
      fTotal, fCompile, fSynth, fRssLang, fRssSynth,
      aotTotal, aotCompile, aotSynth, aotRssLang, aotRssSynth,
    });
  }

  if (mdOutput) {
    const hasSubPhase = rows.some(r => r.wBoot != null);
    const hasWasm     = rows.some(r => r.wTotal != null);
    const hasWamrFull = rows.some(r => r.fTotal != null);
    const hasWamrAot  = rows.some(r => r.aotTotal != null);
    const hasWamrFullRss = rows.some(r => r.fRssLang != null || r.fRssSynth != null);
    const hasWamrAotRss  = rows.some(r => r.aotRssLang != null || r.aotRssSynth != null);

    // One row per patch, one column per toolchain that has data. Native
    // is the baseline; other cells show "<value> (<ratio>)" so the prior
    // wide table's ratio columns are folded into the value cells.
    const toolchains = [['native', 'n']];
    if (hasWasm)     toolchains.push(['wasm',      'w']);
    if (hasWamrFull) toolchains.push(['wamr-full', 'f']);
    if (hasWamrAot)  toolchains.push(['wamr-aot',  'aot']);

    function metricTable(title, suffix) {
      const cols = ['patch', ...toolchains.map(([n]) => n)];
      const out = [`### ${title}`, '', mdRow(cols), mdSep(cols.length)];
      for (const r of rows) {
        const baseline = r[`n${suffix}`];
        const cells = [r.patch, fmt(baseline)];
        for (const [, prefix] of toolchains.slice(1)) {
          const v = r[`${prefix}${suffix}`];
          if (v == null)            cells.push('—');
          else if (baseline == null) cells.push(fmt(v));
          else                       cells.push(`${fmt(v)} (${ratio(v, baseline)})`);
        }
        out.push(mdRow(cells));
      }
      return out.join('\n');
    }

    const tables = [
      `## ${phase.charAt(0).toUpperCase() + phase.slice(1)} phase`,
      metricTable('Total wall time (ms)', 'Total'),
      metricTable('Compile / lang (ms)',  'Compile'),
      metricTable('Synth (ms)',           'Synth'),
    ];

    // WASM lifecycle: module load → boot → eval. Always alongside the
    // boot breakdown below (both gated on hasSubPhase).
    if (hasSubPhase) {
      const lines = ['### WASM lifecycle (median ms)', '',
        mdRow(['patch', 'module', 'boot', 'eval']), mdSep(4)];
      for (const r of rows) {
        if (r.wBoot == null) continue;
        lines.push(mdRow([r.patch, fmt(r.wModule), fmt(r.wBoot), fmt(r.wEval)]));
      }
      tables.push(lines.join('\n'));
    }

    if (hasSubPhase && rows.some(r => r.wSucceeded != null)) {
      const hasInitSplit = rows.some(r => r.wInitruntime != null);
      const subCols = ['patch', 'passone', 'deptree', 'succeeded', '% succ'];
      if (hasInitSplit) subCols.push('initruntime', 'startup', '% startup');
      const lines = ['### WASM boot breakdown (median ms)', '',
        mdRow(subCols), mdSep(subCols.length)];
      for (const r of rows) {
        if (r.wBoot == null) continue;
        const total = (r.wPassone || 0) + (r.wDeptree || 0) + (r.wSucceeded || 0);
        const pct = total > 0 && r.wSucceeded != null
          ? Math.round(100 * r.wSucceeded / total) + '%'
          : '—';
        const row = [r.patch, fmt(r.wPassone), fmt(r.wDeptree), fmt(r.wSucceeded), pct];
        if (hasInitSplit) {
          const startupPct = r.wSucceeded > 0 && r.wStartup != null
            ? Math.round(100 * r.wStartup / r.wSucceeded) + '%'
            : '—';
          row.push(fmt(r.wInitruntime), fmt(r.wStartup), startupPct);
        }
        lines.push(mdRow(row));
      }
      tables.push(lines.join('\n'));
    }

    // Peak RSS — only the WAMR toolchains capture this; wasm/native rows
    // have no RSS data so they'd just be a column of zeroes.
    if (hasWamrFullRss || hasWamrAotRss) {
      const rssCols = ['patch'];
      if (hasWamrFullRss) rssCols.push('wamr-full lang', 'wamr-full synth');
      if (hasWamrAotRss)  rssCols.push('wamr-aot lang',  'wamr-aot synth');
      const lines = ['### Peak RSS (MB)', '', mdRow(rssCols), mdSep(rssCols.length)];
      for (const r of rows) {
        const row = [r.patch];
        if (hasWamrFullRss) row.push(fmtMB(r.fRssLang), fmtMB(r.fRssSynth));
        if (hasWamrAotRss)  row.push(fmtMB(r.aotRssLang), fmtMB(r.aotRssSynth));
        lines.push(mdRow(row));
      }
      tables.push(lines.join('\n'));
    }

    return tables.join('\n\n');
  } else {
    const lines = [`${phase.charAt(0).toUpperCase() + phase.slice(1)} phase:`];
    for (const r of rows) {
      lines.push(`  ${r.patch.padEnd(14)}`
        + ` native=${fmt(r.nTotal).padStart(6)}ms`
        + ` wasm=${fmt(r.wTotal).padStart(6)}ms`
        + ` (${ratio(r.wTotal, r.nTotal).padStart(6)} total,`
        + ` compile=${ratio(r.wCompile, r.nCompile).padStart(6)},`
        + ` synth=${ratio(r.wSynth, r.nSynth).padStart(6)})`
      );
      if (r.wBoot != null) {
        lines.push(`  ${''.padEnd(14)}`
          + ` module=${fmt(r.wModule)}ms`
          + ` boot=${fmt(r.wBoot)}ms`
          + ` eval=${fmt(r.wEval)}ms`
        );
      }
      if (r.wSucceeded != null) {
        const total = (r.wPassone || 0) + (r.wDeptree || 0) + (r.wSucceeded || 0);
        const pct = total > 0 ? Math.round(100 * r.wSucceeded / total) : 0;
        lines.push(`  ${''.padEnd(14)}`
          + ` passone=${fmt(r.wPassone)}ms`
          + ` deptree=${fmt(r.wDeptree)}ms`
          + ` succeeded=${fmt(r.wSucceeded)}ms (${pct}%)`
        );
        if (r.wInitruntime != null) {
          const startupPct = r.wSucceeded > 0
            ? Math.round(100 * r.wStartup / r.wSucceeded)
            : 0;
          lines.push(`  ${''.padEnd(14)}`
            + ` └ initruntime=${fmt(r.wInitruntime)}ms`
            + ` startup=${fmt(r.wStartup)}ms (${startupPct}% of succeeded)`
          );
        }
      }
      if (r.fTotal != null) {
        let line = `  ${''.padEnd(14)}`
          + ` wamr-full=${fmt(r.fTotal).padStart(6)}ms`
          + ` (compile=${fmt(r.fCompile)}ms, synth=${fmt(r.fSynth)}ms)`;
        if (r.fRssLang != null || r.fRssSynth != null) {
          line += ` RSS lang=${fmtMB(r.fRssLang)}MB synth=${fmtMB(r.fRssSynth)}MB`;
        }
        lines.push(line);
      }
      if (r.aotTotal != null) {
        let line = `  ${''.padEnd(14)}`
          + ` wamr-aot =${fmt(r.aotTotal).padStart(6)}ms`
          + ` (compile=${fmt(r.aotCompile)}ms, synth=${fmt(r.aotSynth)}ms)`;
        if (r.aotRssLang != null || r.aotRssSynth != null) {
          line += ` RSS lang=${fmtMB(r.aotRssLang)}MB synth=${fmtMB(r.aotRssSynth)}MB`;
        }
        lines.push(line);
      }
    }
    return lines.join('\n');
  }
}

// ── Print ────────────────────────────────────────────────────────────────────

if (mdOutput) {
  const sections = [mdHeader()];
  // System info
  if (systems.length > 0) {
    sections.push('**System:** ' + systems.map(s =>
      `${s.platform} | node ${s.node} | sclang ${s.sclang}`
    ).join('; '));
    sections.push('');
  }

  const startup = summariseStartup(grouped);
  if (startup) sections.push(startup, '');

  for (const phase of ['cold', 'warm']) {
    const s = summarisePhase(phase, grouped);
    if (s) sections.push(s, '');
  }

  console.log(sections.join('\n'));
} else {
  // Plain text
  if (systems.length > 0) {
    console.log('System:', systems.map(s =>
      `${s.platform} | node ${s.node}`
    ).join('; '));
    console.log('');
  }

  const startup = summariseStartup(grouped);
  if (startup) { console.log(startup); console.log(''); }

  for (const phase of ['cold', 'warm']) {
    const s = summarisePhase(phase, grouped);
    if (s) { console.log(s); console.log(''); }
  }
}
