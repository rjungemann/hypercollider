/**
 * Sclang Process Manager - Phase 8.2
 * 
 * Manages a native sclang child process for code evaluation.
 * This enables the "sclang evaluates, browser plays" workflow where:
 * 1. Browser sends SC code to bridge via WebSocket JSON {type: 'eval', code: '...'}
 * 2. Bridge forwards code to sclang stdin
 * 3. Sclang compiles SynthDefs and outputs OSC messages
 * 4. Bridge captures stdout/stderr and forwards to browser as JSON
 * 5. Browser receives SynthDef blobs and loads them into scsynth WASM
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import config from './config.js';

/**
 * HClangProcess - Manages a native sclang subprocess
 * 
 * Emits events:
 * - 'post': { text: string, level: 'info'|'warn'|'error' } - sclang post window output
 * - 'synthdef': { name: string, data: Uint8Array } - compiled SynthDef binary
 * - 'osc': { address: string, typetags: string, args: Array } - raw OSC message
 * - 'error': { message: string, details?: string }
 * - 'ready': () - sclang process started and ready
 * - 'exit': (code: number) - sclang process exited
 */
export class HClangProcess extends EventEmitter {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.path - Path to sclang binary
   * @param {Array<string>} options.args - Arguments for sclang
   */
  constructor(options = {}) {
    super();
    this.path = options.path || config.sclang.path;
    this.args = options.args || [...config.sclang.args];
    this.evalTimeout = options.evalTimeout || config.sclang.evalTimeout;
    this.maxConcurrentEvals = options.maxConcurrentEvals || config.sclang.maxConcurrentEvals;
    
    this.proc = null;
    this.queue = [];
    this.currentEvals = 0;
    this.buffer = Buffer.alloc(0);
    this.pendingCode = null;
    this.started = false;
    
    this._setupProcess();
  }

  /**
   * Set up the sclang child process
   */
  _setupProcess() {
    // Add -u flag to disable OSC input (we'll use stdin for code)
    // Remove any existing -u flags and add our own
    this.args = this.args.filter(a => !a.startsWith('-u'));
    this.args.push('-u', String(config.osc.sendPort));
    
    this.proc = spawn(this.path, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout (sclang post window output)
    this.proc.stdout.on('data', (data) => {
      this._handleOutput(data);
    });

    // Handle stderr (error output)
    this.proc.stderr.on('data', (data) => {
      this._handleErrorOutput(data);
    });

    // Handle process exit
    this.proc.on('exit', (code) => {
      this.emit('exit', code);
      this.started = false;
    });

    this.proc.on('error', (err) => {
      this.emit('error', { message: 'sclang process error', details: err.message });
    });

    // Wait for sclang to start (it prints a banner)
    this.proc.stdout.once('data', () => {
      this.started = true;
      this.emit('ready');
    });
  }

  /**
   * Handle stdout data from sclang
   * sclang outputs: post window messages, OSC messages, SynthDef blobs
   */
  _handleOutput(data) {
    // Append to buffer
    this.buffer = Buffer.concat([this.buffer, data]);
    
    // Process the buffer line by line
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) break;
      
      const line = this.buffer.subarray(0, newlineIndex);
      this.buffer = this.buffer.subarray(newlineIndex + 1);
      
      if (line.length === 0) continue;
      
      // Try to parse as JSON (some sclang output might be JSON)
      try {
        const msg = JSON.parse(line.toString());
        if (msg.type === 'synthdef') {
          this.emit('synthdef', msg);
        } else if (msg.type === 'post') {
          this.emit('post', msg);
        }
        continue;
      } catch (e) {
        // Not JSON, continue with text processing
      }
      
      const text = line.toString().trim();
      
      // Skip empty lines and sclang banner
      if (text === '' || text.includes('SuperCollider') || text.includes('For help')) {
        continue;
      }
      
      // Check if this is a SynthDef compilation message
      // sclang outputs: "Compiling SynthDef 'sine' ... done" 
      // Or it outputs the raw SCgf binary
      
      // For now, just emit as post message
      this.emit('post', { text, level: 'info' });
    }
  }

  /**
   * Handle stderr data from sclang
   */
  _handleErrorOutput(data) {
    const text = data.toString().trim();
    if (text) {
      this.emit('post', { text, level: 'error' });
    }
  }

  /**
   * Evaluate SuperCollider code
   * @param {string} code - SC code to evaluate
   * @param {Object} options - Options
   * @param {Function} callback - Callback with result
   */
  evaluate(code, options = {}, callback = null) {
    if (!this.started) {
      const error = { message: 'sclang not ready', details: 'Process still starting' };
      if (callback) callback(error);
      this.emit('error', error);
      return;
    }

    if (this.currentEvals >= this.maxConcurrentEvals) {
      this.queue.push({ code, options, callback });
      return;
    }

    this.currentEvals++;
    
    // Wrap code in parentheses and add newline for evaluation
    // sclang in -i none mode reads from stdin
    const wrappedCode = `(${code})\n`;
    
    try {
      this.proc.stdin.write(wrappedCode);
      
      if (callback) {
        // Set up a one-time listener for the response
        const response = { output: '', error: null };
        const timeout = setTimeout(() => {
          this._cleanupEval(callback, response, timeout, listener);
          callback({ error: 'Evaluation timeout' });
        }, this.evalTimeout);
        
        const listener = (msg) => {
          if (msg.level === 'error') {
            response.error = msg.text;
          } else {
            response.output += msg.text + '\n';
          }
          // For now, return after first message
          // In future, could collect all output until a sentinel
          clearTimeout(timeout);
          this._cleanupEval(callback, response, timeout, listener);
          callback(response);
        };
        
        this.once('post', listener);
      }
    } catch (err) {
      this.currentEvals--;
      if (callback) callback({ error: err.message });
      this.emit('error', { message: 'Failed to write to sclang stdin', details: err.message });
      this._processQueue();
    }
  }

  /**
   * Clean up after evaluation
   */
  _cleanupEval(callback, response, timeout, listener) {
    clearTimeout(timeout);
    this.currentEvals--;
    if (listener) {
      this.off('post', listener);
    }
    this._processQueue();
  }

  /**
   * Process queued evaluation requests
   */
  _processQueue() {
    if (this.queue.length === 0) return;
    if (this.currentEvals >= this.maxConcurrentEvals) return;
    
    const next = this.queue.shift();
    this.evaluate(next.code, next.options, next.callback);
  }

  /**
   * Boot the server (start sclang and ensure it's ready)
   */
  async boot() {
    return new Promise((resolve, reject) => {
      if (this.started) {
        resolve();
        return;
      }
      
      const onReady = () => {
        this.off('error', onError);
        resolve();
      };
      
      const onError = (err) => {
        this.off('ready', onReady);
        reject(err);
      };
      
      this.once('ready', onReady);
      this.once('error', onError);
    });
  }

  /**
   * Quit the sclang process
   */
  quit() {
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
      this.proc = null;
      this.started = false;
    }
  }

  /**
   * Check if sclang is running and ready
   */
  isReady() {
    return this.started && this.proc && !this.proc.killed;
  }
}

export default HClangProcess;
