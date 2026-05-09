#!/usr/bin/env node
//
// Baseline regression check for the wamr-full (and friends) bench rows.
//
// Reads bench/baselines/<name>.json + the most-recent (or specified)
// bench/results/<ts>.json, computes the median of each baseline-defined
// metric across non-warmup runs, and compares against the recorded
// baseline median. Exits 1 if any cell exceeds its `threshold_pct`.
//
// Usage:
//   node bench/check_baselines.js                       # most-recent results vs default baseline
//   node bench/check_baselines.js --baseline <path>     # custom baseline file
//   node bench/check_baselines.js --results <path>      # custom results file
//   node bench/check_baselines.js --update              # overwrite baseline with current medians
//   node bench/check_baselines.js --help

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT       = path.resolve(__dirname, '..');
const DEFAULT_BASE    = path.join(REPO_ROOT, 'bench/baselines/wamr-full.json');
const RESULTS_DIR     = path.join(REPO_ROOT, 'bench/results');

function parseArgs(argv) {
  const out = { baseline: DEFAULT_BASE, results: null, update: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline')     out.baseline = argv[++i];
    else if (a === '--results') out.results  = argv[++i];
    else if (a === '--update')  out.update   = true;
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 16).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function findMostRecentResults() {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  return files.length ? path.join(RESULTS_DIR, files[files.length - 1]) : null;
}

function matchRows(results, key) {
  return results.filter(r =>
    r.toolchain === key.toolchain
    && r.phase === key.phase
    && (key.patch === null || key.patch === undefined ? r.patch == null : r.patch === key.patch)
    && r.warmup === false
  );
}

function computeCurrent(results, key, metric) {
  const matches = matchRows(results, key);
  const values = matches.map(r => r[metric]).filter(v => v != null && v > 0);
  return values.length ? median(values) : null;
}

function pad(s, n, right = false) {
  s = String(s);
  if (s.length >= n) return s;
  return right ? s + ' '.repeat(n - s.length) : ' '.repeat(n - s.length) + s;
}

function main() {
  const opts = parseArgs(process.argv);

  if (!fs.existsSync(opts.baseline)) {
    console.error(`Baseline file not found: ${opts.baseline}`);
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(opts.baseline, 'utf8'));

  if (!opts.results) opts.results = findMostRecentResults();
  if (!opts.results || !fs.existsSync(opts.results)) {
    console.error(`No results file found. Run a bench first (e.g. 'just bench-wamr-full') or pass --results <path>.`);
    process.exit(2);
  }
  const resultsRaw = JSON.parse(fs.readFileSync(opts.results, 'utf8'));
  const results = resultsRaw.results || [];

  // Platform sanity check: if the baseline was captured on a different
  // OS/arch, perf comparisons are unreliable. Warn (don't fail).
  const currentSystem = resultsRaw.system?.platform || 'unknown';
  if (baseline.captured_on && baseline.captured_on !== currentSystem) {
    console.warn(`WARNING: baseline was captured on '${baseline.captured_on}', current run is '${currentSystem}'.`);
    console.warn(`         Cross-platform comparisons are noisy; thresholds may not transfer cleanly.\n`);
  }

  // Show repo-relative paths when the file is inside the repo, absolute
  // otherwise. Avoids the awful "../../../tmp/..." form for /tmp files.
  const showPath = p => {
    const rel = path.relative(REPO_ROOT, p);
    return rel.startsWith('..') ? p : rel;
  };
  console.log(`Baseline check: ${showPath(opts.baseline)} vs ${showPath(opts.results)}`);
  console.log('');

  const COL_TC      = 12;
  const COL_PHASE   = 7;
  const COL_PATCH   = 13;
  const COL_METRIC  = 22;
  const COL_NUM     = 10;
  const COL_DELTA   = 8;
  const COL_STATUS  = 22;

  // Header
  console.log(
    pad('toolchain', COL_TC, true) +
    pad('phase',     COL_PHASE, true) +
    pad('patch',     COL_PATCH, true) +
    pad('metric',    COL_METRIC, true) +
    pad('baseline',  COL_NUM) +
    pad('current',   COL_NUM) +
    pad('delta',     COL_DELTA) +
    '  ' + pad('status', COL_STATUS, true)
  );
  console.log('-'.repeat(COL_TC + COL_PHASE + COL_PATCH + COL_METRIC + COL_NUM*2 + COL_DELTA + 2 + COL_STATUS));

  let regressions = 0;
  let improvements = 0;
  let missing = 0;
  const updatedRows = [];

  for (const b of baseline.rows) {
    const key = { toolchain: b.toolchain, phase: b.phase, patch: b.patch ?? null };
    const current = computeCurrent(results, key, b.metric);
    const threshold = b.threshold_pct ?? baseline.default_threshold_pct ?? 20;

    let delta = null;
    let status;
    if (current == null) {
      status = 'MISSING';
      missing++;
    } else {
      delta = ((current - b.median) / b.median) * 100;
      if (delta > threshold) {
        status = `REGRESSION (>${threshold}%)`;
        regressions++;
      } else if (delta < -threshold) {
        // Improvements aren't failures, but flag them so users know
        // to refresh the baseline.
        status = `improved (${delta.toFixed(1)}%)`;
        improvements++;
      } else {
        status = 'ok';
      }
    }

    const fmtNum = n => n == null ? '—' : Math.round(n).toLocaleString();
    const fmtDelta = d => d == null ? '—' : `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;

    console.log(
      pad(b.toolchain,     COL_TC, true) +
      pad(b.phase,         COL_PHASE, true) +
      pad(b.patch ?? '—',  COL_PATCH, true) +
      pad(b.metric,        COL_METRIC, true) +
      pad(fmtNum(b.median), COL_NUM) +
      pad(fmtNum(current), COL_NUM) +
      pad(fmtDelta(delta), COL_DELTA) +
      '  ' + pad(status, COL_STATUS, true)
    );

    // For --update: if we have a current value, use it; else keep the old.
    updatedRows.push({
      ...b,
      median: current != null ? Math.round(current) : b.median,
    });
  }

  console.log('');
  if (regressions > 0) {
    console.log(`REGRESSION: ${regressions} cell(s) exceeded their threshold.`);
  } else if (improvements > 0) {
    console.log(`OK with ${improvements} improvement(s) — consider running 'just bench-update-baselines' to refresh.`);
  } else if (missing > 0) {
    console.log(`OK, but ${missing} baseline row(s) had no matching results.`);
  } else {
    console.log('OK — all metrics within their thresholds.');
  }

  if (opts.update) {
    const updated = {
      ...baseline,
      captured_at:  new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      captured_on:  currentSystem,
      rows:         updatedRows,
    };
    // Preserve the leading _comment if it was there
    if (baseline._comment) updated._comment = baseline._comment;
    fs.writeFileSync(opts.baseline, JSON.stringify(updated, null, 2) + '\n');
    console.log(`\nBaseline updated: ${path.relative(REPO_ROOT, opts.baseline)}`);
    process.exit(0);
  }

  process.exit(regressions > 0 ? 1 : 0);
}

main();
