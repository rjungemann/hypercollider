'use strict';

const childProcess = require('node:child_process');
const os = require('node:os');

function createUnixBridge(moduleInstance, logger) {
  let nextPid = 1000;
  let lastErrno = 0;
  const running = new Map();

  const log = logger || {
    debug: () => {},
    warn: () => {},
  };

  function mapErrno(err) {
    if (!err) return 1;
    if (typeof err.errno === 'number') return Math.abs(err.errno);
    if (typeof err.code === 'string') {
      const n = os.constants && os.constants.errno && os.constants.errno[err.code];
      if (typeof n === 'number') return Math.abs(n);
    }
    return 1;
  }

  function setErrno(errLike) {
    lastErrno = mapErrno(errLike);
  }

  function clearErrno() {
    lastErrno = 0;
  }

  function completeCommand(pid, exitCode, postOutput, stdoutText) {
    if (!moduleInstance || typeof moduleInstance._hc_wasm_unix_command_complete !== 'function') {
      return;
    }

    const text = stdoutText || '';
    const ptr = moduleInstance.allocateUTF8(text);
    try {
      moduleInstance._hc_wasm_unix_command_complete(
        pid | 0,
        (typeof exitCode === 'number' ? exitCode : 1) | 0,
        postOutput ? 1 : 0,
        ptr,
        Buffer.byteLength(text, 'utf8')
      );
    } finally {
      moduleInstance._free(ptr);
    }
  }

  function startWithSpawn(spawnFn, postOutput) {
    const localPid = nextPid++;
    let proc;

    try {
      proc = spawnFn();
    } catch (e) {
      setErrno(e);
      return -1;
    }

    if (!proc || typeof proc.on !== 'function') {
      setErrno({ code: 'EINVAL' });
      return -1;
    }

    running.set(localPid, true);
    clearErrno();

    let stdout = '';
    if (proc.stdout && typeof proc.stdout.on === 'function') {
      proc.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
    }

    proc.on('error', (e) => {
      setErrno(e);
      running.delete(localPid);
      completeCommand(localPid, 1, postOutput, stdout);
    });

    proc.on('close', (code) => {
      running.delete(localPid);
      clearErrno();
      completeCommand(localPid, typeof code === 'number' ? code : 1, postOutput, stdout);
    });

    return localPid;
  }

  return {
    errno() {
      return lastErrno;
    },

    system(command) {
      try {
        const result = childProcess.spawnSync(command, {
          shell: true,
          stdio: 'inherit',
        });

        if (result.error) {
          setErrno(result.error);
          return -1;
        }

        clearErrno();
        if (typeof result.status === 'number') return result.status;
        return 1;
      } catch (e) {
        setErrno(e);
        return -1;
      }
    },

    startCommand(command, postOutput) {
      log.debug('unix bridge startCommand', { command, postOutput });
      return startWithSpawn(
        () => childProcess.spawn(command, {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
        !!postOutput
      );
    },

    startArgvCommand(args, postOutput) {
      if (!Array.isArray(args) || args.length < 1) {
        setErrno({ code: 'EINVAL' });
        return -1;
      }

      const exe = String(args[0]);
      const argv = args.slice(1).map((x) => String(x));
      log.debug('unix bridge startArgvCommand', { exe, argv, postOutput });

      return startWithSpawn(
        () => childProcess.spawn(exe, argv, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
        !!postOutput
      );
    },

    runCommandCapture(command) {
      try {
        const result = childProcess.spawnSync(command, {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
        });

        if (result.error) {
          setErrno(result.error);
          return {
            ok: false,
            stdout: '',
            exitCode: -1,
            errno: lastErrno,
          };
        }

        clearErrno();
        return {
          ok: true,
          stdout: typeof result.stdout === 'string' ? result.stdout : String(result.stdout || ''),
          exitCode: typeof result.status === 'number' ? result.status : 1,
          errno: 0,
        };
      } catch (e) {
        setErrno(e);
        return {
          ok: false,
          stdout: '',
          exitCode: -1,
          errno: lastErrno,
        };
      }
    },

    runArgvCommandCapture(args) {
      if (!Array.isArray(args) || args.length < 1) {
        setErrno({ code: 'EINVAL' });
        return {
          ok: false,
          stdout: '',
          exitCode: -1,
          errno: lastErrno,
        };
      }

      const exe = String(args[0]);
      const argv = args.slice(1).map((x) => String(x));
      try {
        const result = childProcess.spawnSync(exe, argv, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
        });

        if (result.error) {
          setErrno(result.error);
          return {
            ok: false,
            stdout: '',
            exitCode: -1,
            errno: lastErrno,
          };
        }

        clearErrno();
        return {
          ok: true,
          stdout: typeof result.stdout === 'string' ? result.stdout : String(result.stdout || ''),
          exitCode: typeof result.status === 'number' ? result.status : 1,
          errno: 0,
        };
      } catch (e) {
        setErrno(e);
        return {
          ok: false,
          stdout: '',
          exitCode: -1,
          errno: lastErrno,
        };
      }
    },

    pidRunning(pid) {
      const n = Number(pid) | 0;
      if (running.has(n)) return true;
      try {
        process.kill(n, 0);
        clearErrno();
        return true;
      } catch (_) {
        return false;
      }
    },

    getPid() {
      clearErrno();
      return process.pid | 0;
    },
  };
}

module.exports = {
  createUnixBridge,
};
