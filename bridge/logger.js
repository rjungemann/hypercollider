/**
 * Logger utility for the OSC Bridge Server
 * Part of Phase 8 of the WASM port plan.
 */

/**
 * Simple logger with configurable level, colors, and timestamps
 */
export class Logger {
  constructor(config) {
    this.level = config.level || 'info';
    this.colors = config.colors !== false;
    this.timestamp = config.timestamp !== false;
  }

  log(level, message, data = {}) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] < levels[this.level]) return;

    const timestamp = this.timestamp ? new Date().toISOString() : '';
    const prefix = `[${timestamp ? timestamp + ' ' : ''}${level.toUpperCase()}]`;

    let output = `${prefix} ${message}`;
    if (Object.keys(data).length > 0) {
      output += ` ${JSON.stringify(data)}`;
    }

    const colors = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
    };

    if (this.colors && colors[level]) {
      console.log(`${colors[level]}${output}\x1b[0m`);
    } else {
      console.log(output);
    }
  }

  debug(message, data = {}) { this.log('debug', message, data); }
  info(message, data = {}) { this.log('info', message, data); }
  warn(message, data = {}) { this.log('warn', message, data); }
  error(message, data = {}) { this.log('error', message, data); }
}

export default Logger;
