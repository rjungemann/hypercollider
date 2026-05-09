#!/usr/bin/env node
/**
 * Run SC Browser IDE smoke tests using Puppeteer
 * Usage: node run_smoke_tests.js [phase]
 *   - No args: run all tests
 *   - With phase number (1-7): run tests for that phase
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

// Test configuration
const TEST_PAGE = 'sc_ide_smoke_test.html';
const HEADLESS = 'new';
const TIMEOUT = 120000; // 2 minutes total timeout
const PHASE_TIMEOUT = 30000; // 30 seconds per phase

// Test phases
const PHASES = {
  1: 'Editor Core',
  2: 'Documents',
  3: 'Language',
  4: 'Server',
  5: 'Editing',
  6: 'Help',
  7: 'Deploy and Validation'
};

// Known test IDs for each phase
const PHASE_TESTS = {
  1: ['p1_ide_loads', 'p1_cm_init', 'p1_syntax', 'p1_eval_line', 'p1_eval_region', 'p1_eval_doc', 'p1_stop_main'],
  2: ['p2_new_buffer', 'p2_close_buffer', 'p2_switch_buffer', 'p2_session_save', 'p2_session_load', 'p2_session_delete'],
  3: ['p3_autocomplete', 'p3_introspection', 'p3_hint', 'p3_method_lookup', 'p3_definition_lookup', 'p3_arg_hint'],
  4: ['p4_boot', 'p4_status', 'p4_meters', 'p4_scope', 'p4_volume', 'p4_synth_count', 'p4_eval_audio'],
  5: ['p5_find', 'p5_replace', 'p5_goto_line', 'p5_comment', 'p5_indent', 'p5_outdent'],
  6: ['p6_help_panel', 'p6_docs_panel', 'p6_docs_lookup', 'p6_history_back', 'p6_history_forward', 'p6_tweets_dropdown', 'p6_patch_load', 'p6_icons_load'],
  7: ['p7_local_load', 'p7_wasm_load', 'p7_post_window', 'p7_clear_post', 'p7_save_buffer', 'p7_localstorage', 'p7_idbfs_sync', 'p7_midi_bridge', 'p7_midi_sysex_ui']
};

function detectChromeForTestingPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const platform = os.platform();
  if (platform === 'darwin') {
    // On some macOS setups, Chrome-for-Testing may crash at launch while
    // the installed Google Chrome channel remains stable under Puppeteer.
    return null;
  }

  const home = os.homedir();
  let chromeRoot = null;
  let binarySuffix = null;

  if (platform === 'linux') {
    chromeRoot = path.join(home, '.cache', 'puppeteer', 'chrome');
    binarySuffix = path.join('chrome-linux64', 'chrome');
  } else if (platform === 'win32') {
    chromeRoot = path.join(home, '.cache', 'puppeteer', 'chrome');
    binarySuffix = path.join('chrome-win64', 'chrome.exe');
  }

  if (!chromeRoot || !binarySuffix || !fs.existsSync(chromeRoot)) {
    return null;
  }

  const candidates = fs.readdirSync(chromeRoot)
    .filter((d) => d.startsWith('linux-') || d.startsWith('win64-'))
    .sort((a, b) => b.localeCompare(a));

  for (const dir of candidates) {
    const p = path.join(chromeRoot, dir, binarySuffix);
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.data')) return 'application/octet-stream';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function startStaticServer(rootDir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const relPath = urlPath === '/' ? `/${TEST_PAGE}` : urlPath;
    const fsPath = path.normalize(path.join(rootDir, relPath));

    if (!fsPath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(fsPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypeFor(fsPath) });
      res.end(data);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl };
}

async function runTests(phase) {
  let browser;
  let server;
  try {
    console.log('\n=== SuperCollider Browser IDE Smoke Tests ===\n');

    const served = await startStaticServer(__dirname);
    server = served.server;
    const testUrl = `${served.baseUrl}/${TEST_PAGE}`;
    
    // Launch browser
    console.log('Launching browser...');
    const executablePath = detectChromeForTestingPath();
    const platform = os.platform();
    if (executablePath) {
      console.log(`Using Chrome executable: ${executablePath}`);
    } else if (platform === 'darwin') {
      console.log('Using system Chrome channel on macOS');
    }

    browser = await puppeteer.launch({
      ...(executablePath ? { executablePath } : {}),
      ...(!executablePath && platform === 'darwin' ? { channel: 'chrome' } : {}),
      headless: HEADLESS,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    browser.on('disconnected', () => {
      console.error('Browser disconnected unexpectedly');
    });
    page.on('pageerror', (err) => {
      console.error('Page error:', err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Browser console error:', msg.text());
      }
    });
    page.setDefaultTimeout(PHASE_TIMEOUT);
    
    // Navigate to test page
    console.log('Loading test suite...');
    await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for test suite to initialize
    await page.waitForSelector('#log', { timeout: 10000 });
    await page.waitForFunction(() => typeof tests !== 'undefined', { timeout: 10000 });
    
    // Determine which tests to run
    const testIds = phase 
      ? PHASE_TESTS[phase] || []
      : Object.values(PHASE_TESTS).flat();
    
    if (testIds.length === 0) {
      console.log(`\nNo tests found for phase ${phase}`);
      console.log('Available phases: 1-7');
      return { passed: 0, failed: 0, skipped: 0 };
    }
    
    const phaseName = phase ? PHASES[phase] || `Phase ${phase}` : 'All Phases';
    console.log(`\nRunning ${phaseName} tests (${testIds.length} tests)...\n`);
    
    let passed = 0, failed = 0, skipped = 0;
    
    for (const testId of testIds) {
      try {
        // Clear previous results for this test
        await page.evaluate((tid) => {
          if (typeof results !== 'undefined' && results[tid]) {
            results[tid] = { status: 'skip', msg: 'Pending' };
          }
        }, testId);
        
        // Run the test
        const result = await page.evaluate((tid) => {
          if (typeof tests === 'undefined') {
            return { status: 'skip', msg: 'Test registry unavailable' };
          }
          const test = tests[tid];
          if (!test) return { status: 'skip', msg: 'Test not found' };
          return test.run().then(() => ({ status: 'pass', msg: 'Passed' })).catch(e => ({ status: 'fail', msg: e.message }));
        }, testId);
        
        if (result.status === 'pass') {
          console.log(`✓ ${testId}`);
          passed++;
        } else if (result.status === 'fail') {
          console.log(`✗ ${testId}: ${result.msg}`);
          failed++;
        } else {
          console.log(`○ ${testId}: ${result.msg}`);
          skipped++;
        }
      } catch (error) {
        console.log(`✗ ${testId}: ${error.message}`);
        failed++;
      }
    }
    
    // Print summary
    console.log(`\n=== ${phaseName} Summary ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total: ${passed + failed + skipped}\n`);
    
    return { passed, failed, skipped };
  } catch (error) {
    console.error('\nError running tests:', error.message);
    if (error && error.stack) {
      console.error(error.stack);
    }
    return { passed: 0, failed: 1, skipped: 0 };
  } finally {
    if (browser) {
      await browser.close();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

// Main
(async () => {
  const args = process.argv.slice(2);
  const phase = args[0] ? parseInt(args[0]) : null;
  
  if (phase && (phase < 1 || phase > 7)) {
    console.log('Usage: node run_smoke_tests.js [phase]');
    console.log('  - No args: run all tests');
    console.log('  - With phase number (1-7): run tests for that phase');
    console.log('\nAvailable phases:');
    for (const [p, name] of Object.entries(PHASES)) {
      console.log(`  ${p}: ${name}`);
    }
    process.exit(1);
  }
  
  const result = await runTests(phase);
  process.exit(result.failed > 0 ? 1 : 0);
})();
