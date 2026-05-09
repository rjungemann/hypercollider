'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Load version from package.json
function getVersion() {
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch (_) {
    return 'unknown';
  }
}

// Verbosity levels
const VERBOSITY_SILENT = -2;
const VERBOSITY_ERRORS_ONLY = -1;
const VERBOSITY_NORMAL = 0;
const VERBOSITY_VERBOSE = 1;
const VERBOSITY_DEBUG = 2;

class Logger {
  constructor(verbosity = VERBOSITY_NORMAL) {
    this.verbosity = verbosity;
  }

  debug(...args) {
    if (this.verbosity >= VERBOSITY_DEBUG) {
      console.log('[DEBUG]', ...args);
    }
  }

  info(...args) {
    if (this.verbosity >= VERBOSITY_VERBOSE) {
      console.log('[INFO]', ...args);
    }
  }

  log(...args) {
    if (this.verbosity >= VERBOSITY_NORMAL) {
      console.log(...args);
    }
  }

  warn(...args) {
    if (this.verbosity >= VERBOSITY_ERRORS_ONLY) {
      console.warn('[WARN]', ...args);
    }
  }

  error(...args) {
    if (this.verbosity >= VERBOSITY_SILENT) {
      console.error('[ERROR]', ...args);
    }
  }
}

module.exports = {
  getVersion,
  VERBOSITY_SILENT,
  VERBOSITY_ERRORS_ONLY,
  VERBOSITY_NORMAL,
  VERBOSITY_VERBOSE,
  VERBOSITY_DEBUG,
  Logger,
};
