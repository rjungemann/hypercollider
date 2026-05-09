# Quarks Support Plan — Browser

Browser-specific implementation for quarks support in the hosted web app
(Emscripten/WASM + browser runtime).

The browser has no `child_process`, no NODEFS, and no `git` binary. The unix bridge
(`hc_unix.js`) is Node.js-only and is not present in a browser bundle. The strategy is to
replace the unix bridge with an in-process isomorphic-git dispatcher and use IDBFS for
persistent storage.

`thisProcess.recompile` is not supported as a hot-reload path. The workflow is
install-then-reload: run `Quarks.install("QuarkName")` to clone the quark, then reload
the page — the quark is compiled in automatically on the next boot.

For the Node.js CLI and WAMR CLI implementations see `docs/QUARKS_CLI_PLAN.md`.

---

## Track C — Browser (hosted web app)

### Background

Two browser-native capabilities cover the same ground as the CLI unix bridge:

- **isomorphic-git** — a pure-JS git implementation that runs in browsers, using
  `fetch` for the transport layer. Supports clone, pull, checkout, fetch, tag listing,
  rev-parse, and remote listing — every operation `Git.sc` issues.
- **LightningFS** — an IndexedDB-backed filesystem companion to isomorphic-git. Files
  written here survive page reloads, providing the same persistence that NODEFS gives
  the Node.js track.
- **IDBFS** — Emscripten's built-in IndexedDB filesystem adapter. Can replace MEMFS at
  the quarks folder mount point so the WASM module itself reads/writes the persisted
  clone directly.

The hard external dependency is **CORS**. GitHub's git smart-HTTP endpoints do not send
`Access-Control-Allow-Origin` headers, so a bare `fetch` to
`https://github.com/supercollider-quarks/quarks.git` fails in a browser. A CORS proxy is
required for any network quark install. This is the principal difference from the CLI
tracks.

### Step C1 — Replace the unix bridge with an isomorphic-git dispatcher

In the browser bundle, the unix bridge object (currently Node.js `child_process`-backed)
is replaced with an in-process dispatcher. When `runCommandCapture` is called with a
command that starts with `git`, it parses the subcommand and dispatches to isomorphic-git
instead of spawning a process.

**Dependencies** (add to the browser bundle's package.json / bundler config):
```json
"isomorphic-git": "^1.x",
"@isomorphic-git/lightning-fs": "^4.x"
```

**Browser unix bridge** (`cli/hc_unix_browser.js` — new file, used instead of
`hc_unix.js` in the browser build):

```js
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS   from '@isomorphic-git/lightning-fs';

// Shared LightningFS instance — IndexedDB-backed, persistent across page reloads.
const lfs = new FS('hclang-quarks');
const pfs = lfs.promises;  // promise-based FS API

// CORS proxy URL — required for any network quark operation.
// Set window.__hclang_git_proxy before loading hclang, e.g.:
//   window.__hclang_git_proxy = 'https://your-cors-proxy.example.com/';
//
// If the proxy is not configured, quark operations will fail with a clear
// error rather than a cryptic CORS network error.
function corsProxy() {
  const proxy = (typeof window !== 'undefined' && window.__hclang_git_proxy) || null;
  if (!proxy) {
    const msg =
      '[hclang] Quarks require a CORS proxy. ' +
      'Set window.__hclang_git_proxy before loading hclang. ' +
      'See docs/QUARKS_BROWSER_PLAN.md.';
    console.error(msg);
    // Also emit to any registered UI error handler so the browser UI can
    // surface the message without requiring the user to open DevTools.
    if (typeof window !== 'undefined' && typeof window.__hclang_on_error === 'function') {
      window.__hclang_on_error(msg);
    }
    throw new Error(msg);
  }
  return proxy;
}

// Parse a shell-quoted git command string into an argv array.
// Only handles the simple unquoted forms that Git.sc produces.
function parseGitArgv(cmd) {
  // Strip a leading "cd <dir> && " prefix that Git.sc prepends when cd=true.
  const cdMatch = cmd.match(/^cd\s+(\S+)\s+&&\s+(.+)$/);
  let dir = null;
  let rest = cmd;
  if (cdMatch) {
    dir  = cdMatch[1];
    rest = cdMatch[2];
  }
  const argv = rest.trim().split(/\s+/);
  return { dir, argv };
}

async function dispatchGit({ dir, argv }) {
  // argv[0] is 'git', argv[1] is the subcommand.
  const sub = argv[1];
  const proxy = corsProxy();

  switch (sub) {
    case 'clone': {
      // git clone <url> <localPath>
      const url      = argv[2];
      const cloneDir = argv[3] || dir;
      await git.clone({ fs: lfs, http, url, dir: cloneDir, corsProxy: proxy });
      return { ok: true, stdout: '', exitCode: 0 };
    }
    case 'pull': {
      await git.pull({ fs: lfs, http, dir, corsProxy: proxy });
      return { ok: true, stdout: '', exitCode: 0 };
    }
    case 'fetch': {
      await git.fetch({ fs: lfs, http, dir, corsProxy: proxy });
      return { ok: true, stdout: '', exitCode: 0 };
    }
    case 'checkout': {
      const ref = argv[2];
      await git.checkout({ fs: lfs, dir, ref });
      return { ok: true, stdout: '', exitCode: 0 };
    }
    case 'rev-parse': {
      // Used by Git#sha and Git#defaultBranchName.
      const ref = argv.find(a => !a.startsWith('-') && a !== 'rev-parse') || 'HEAD';
      const sha = await git.resolveRef({ fs: lfs, dir, ref });
      return { ok: true, stdout: sha + '\n', exitCode: 0 };
    }
    case '--no-pager': {
      // git --no-pager log --pretty=format:'%d' ... (used by Git#tag)
      const logSub = argv[2];
      if (logSub === 'log') {
        const logs = await git.log({ fs: lfs, dir, depth: 1 });
        // Return a fake decorated log line with the tag if one exists.
        const entry = logs[0];
        const tags = await git.listTags({ fs: lfs, dir });
        const matchTag = tags.find(async t => {
          try {
            const sha = await git.resolveRef({ fs: lfs, dir, ref: 'refs/tags/' + t });
            return sha === entry.oid;
          } catch { return false; }
        });
        const decoration = matchTag ? ` (tag: ${matchTag})` : '';
        return { ok: true, stdout: decoration + '\n', exitCode: 0 };
      }
      return { ok: true, stdout: '', exitCode: 0 };
    }
    case 'for-each-ref': {
      // git for-each-ref --format='%(refname)' --sort=taggerdate refs/tags
      const tags = await git.listTags({ fs: lfs, dir });
      const stdout = tags.map(t => 'refs/tags/' + t).join('\n') + '\n';
      return { ok: true, stdout, exitCode: 0 };
    }
    case 'remote': {
      // git remote -v  — used by Git#remote to find origin URL.
      const remotes = await git.listRemotes({ fs: lfs, dir });
      const origin  = remotes.find(r => r.remote === 'origin');
      if (!origin) return { ok: true, stdout: '', exitCode: 0 };
      const stdout = `origin\t${origin.url} (fetch)\norigin\t${origin.url} (push)\n`;
      return { ok: true, stdout, exitCode: 0 };
    }
    case 'symbolic-ref': {
      // git symbolic-ref refs/remotes/origin/HEAD --short  → 'origin/main'
      try {
        const ref = await git.resolveRef({ fs: lfs, dir, ref: 'refs/remotes/origin/HEAD' });
        return { ok: true, stdout: 'origin/' + ref.split('/').pop() + '\n', exitCode: 0 };
      } catch {
        return { ok: true, stdout: 'origin/main\n', exitCode: 0 };
      }
    }
    default:
      return { ok: false, stdout: '', exitCode: 127 };
  }
}

// Check whether git is "installed" — always true in the browser dispatcher.
function checkForGit() { return true; }

export function createBrowserUnixBridge(moduleInstance) {
  return {
    errno() { return 0; },

    // system(cmd) — fire-and-forget, used by String#system.
    // Async in the browser; we return 0 optimistically.
    system(command) {
      if (command.trimStart().startsWith('git')) {
        const { dir, argv } = parseGitArgv(command);
        dispatchGit({ dir, argv }).catch(console.error);
      }
      return 0;
    },

    // runCommandCapture(cmd) — synchronous-seeming capture used by Pipe.callSync.
    // isomorphic-git is async; we bridge this by running the operation in a
    // SharedArrayBuffer + Atomics spin (Atomics.wait on the main thread requires
    // cross-origin isolation: COOP/COEP headers on the host).
    // See Step C2 for the Atomics bridge detail.
    runCommandCapture(command) {
      if (!command.trimStart().startsWith('git')) {
        return { ok: false, stdout: '', exitCode: 127, errno: 0 };
      }
      const { dir, argv } = parseGitArgv(command);
      return atomicsBridgeSync(() => dispatchGit({ dir, argv }));
    },

    // startCommand — used by _String_POpen (async pipe open).
    // Not supported in browser; return error pid.
    startCommand(command, postOutput) {
      return -1;
    },
  };
}
```

### Step C2 — Atomics bridge for synchronous dispatch

`Pipe.callSync` in SC is synchronous: `wasm_runtime_bridge.cpp` calls
`unix_bridge.runCommandCapture(cmd)` and expects a result object back before returning.
isomorphic-git operations are `async`. Bridging the gap requires one of:

**Option C2a — SharedArrayBuffer + Atomics (recommended for hosted apps)**

Requires the page to be served with cross-origin isolation headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The bridge spins up a Worker, posts the git command, and uses `Atomics.wait` on a shared
buffer to block the main thread until the Worker posts the result back:

```js
// atomics-git-worker.js (Worker)
self.onmessage = async ({ data: { id, op, sab, resultSab } }) => {
  try {
    const result = await dispatchGit(op);
    const encoded = new TextEncoder().encode(JSON.stringify(result));
    // Write result length + bytes into resultSab, then signal.
    const view = new Int32Array(sab);
    new Uint8Array(resultSab).set(encoded);
    Atomics.store(new Int32Array(resultSab, encoded.byteLength), 0, encoded.length);
    Atomics.store(view, 0, 1);
    Atomics.notify(view, 0);
  } catch (e) {
    // Signal error
    const view = new Int32Array(sab);
    Atomics.store(view, 0, -1);
    Atomics.notify(view, 0);
  }
};

// Main thread side of atomicsBridgeSync:
function atomicsBridgeSync(asyncFn) {
  const sab       = new SharedArrayBuffer(4);
  const resultSab = new SharedArrayBuffer(65536);
  const signal    = new Int32Array(sab);
  Atomics.store(signal, 0, 0);
  gitWorker.postMessage({ sab, resultSab, op: asyncFn });
  Atomics.wait(signal, 0, 0);  // blocks until worker signals
  const n = Atomics.load(new Int32Array(resultSab), 0);
  if (Atomics.load(signal, 0) < 0) return { ok: false, stdout: '', exitCode: -1, errno: 0 };
  const bytes = new Uint8Array(resultSab, 0, n);
  return JSON.parse(new TextDecoder().decode(bytes));
}
```

This is the only fully synchronous path available in a browser that doesn't require
changing SC's execution model.

**Option C2b — Async evaluation (future work)**

Restructure `Pipe.callSync` in SC to use a non-blocking callback pattern, exposing an
`_AsyncPipeOpen` primitive instead. Requires changes to `Git.sc` to use async callbacks.
Higher effort but removes the COOP/COEP header requirement.

### Step C3 — IDBFS mount for persistent quark storage

Mount Emscripten's IndexedDB filesystem at the quarks path so cloned quarks survive
page reloads. Call this after `instantiateEmscriptenModule` and before the boot sequence:

```js
function mountQuarksDirBrowser(module) {
  const guestParent = '/home/user/.local/share/SuperCollider';
  const guestLeaf   = guestParent + '/downloaded-quarks';

  module.FS.mkdirTree(guestParent);
  module.FS.mkdir(guestLeaf);
  module.FS.mount(module.IDBFS, {}, guestLeaf);

  // Sync from IndexedDB into MEMFS before boot so existing quarks are visible.
  return new Promise((resolve, reject) => {
    module.FS.syncfs(true /* populate */, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

// After any Quarks.install call completes, flush back to IndexedDB:
function flushQuarksDir(module) {
  return new Promise((resolve, reject) => {
    module.FS.syncfs(false /* persist */, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}
```

The LightningFS instance used by isomorphic-git and the IDBFS mount used by Emscripten
are separate IndexedDB databases. They must be kept in sync: after a successful git clone
via isomorphic-git, copy the resulting directory tree into the IDBFS mount and call
`FS.syncfs(false)` to persist it. Alternatively, wire isomorphic-git to use a custom FS
adapter that writes directly into Emscripten's IDBFS via `module.FS.*` calls — this keeps
a single source of truth.

### Step C4 — CORS proxy configuration (required for quark support)

A CORS proxy is **required** for any network quark operation (install, update, directory
refresh). Without it the browser blocks all requests to GitHub's git smart-HTTP endpoints.
Quark support is considered **disabled** in a browser deployment that does not supply a
proxy URL.

The proxy needs to forward requests to `https://github.com` (for cloning from the quarks
directory) and any other git host users install from.

Minimal self-hosted proxy using the isomorphic-git reference implementation:
```
npx isomorphic-git create-proxy-server --port 9999
```
Or deploy [`@isomorphic-git/cors-proxy`](https://github.com/isomorphic-git/cors-proxy)
to a server / serverless function alongside the hclang web app.

Configure hclang to use it **before** module load:
```html
<script>
  // Required — quarks are disabled if this is not set.
  window.__hclang_git_proxy = 'https://cors-proxy.your-domain.example.com';

  // Optional — receive human-readable error strings in the page UI
  // (DevTools console errors are emitted regardless).
  window.__hclang_on_error = (msg) => {
    document.getElementById('hclang-error-banner').textContent = msg;
    document.getElementById('hclang-error-banner').hidden = false;
  };
</script>
<script src="hclang-web.js"></script>
```

For local development, `cors-proxy` on `localhost:9999` works without COOP/COEP.

If `window.__hclang_git_proxy` is absent at the time `Quarks.install` is called, the
`corsProxy()` helper (Step C1) throws and the `__hclang_on_error` callback fires. The
page should register that callback and show a visible error banner or dialog rather than
silently dropping the operation.

### Step C5 — Build configuration

The browser bundle must not include Node.js modules. Webpack/esbuild/Rollup aliases:

```js
// vite.config.js / webpack resolve.alias
{
  './hc_unix.js': './hc_unix_browser.js',
  'node:child_process': false,
  'node:os': false,
  'node:fs': false,
  'node:path': false,
}
```

IDBFS is included automatically with Emscripten's standard FS — no extra `-l` flag needed,
unlike NODEFS.

### `String#include` WASM guard

`src/class_library/Common/Collections/String.sc` (line 457) calls `Quarks.install(this)`
from `String#include`. In a browser context where the CORS proxy is not configured, this
will throw a runtime error rather than a clean message. Add a platform guard that checks
both the platform and whether quark support is available:

```supercollider
include {
    if(thisProcess.platform.name == \wasm, {
        // In the browser, quarks require a CORS proxy (window.__hclang_git_proxy).
        // In the WAMR CLI, quarks require the --quarks-dir flag and a host git binary.
        // Neither is guaranteed, so we check explicitly before proceeding.
        if(Quarks.supported.not, {
            ("hclang: Quarks are not supported in this environment. " ++
             "Browser: set window.__hclang_git_proxy. " ++
             "WAMR CLI: pass --quarks-dir. " ++
             "See docs/QUARKS_BROWSER_PLAN.md").postln;
            ^this
        });
    });
    if(Quarks.isInstalled(this).not) {
        Quarks.install(this);
        "... the class library may have to be recompiled.".postln;
    }
}
```

The `Quarks.supported` method is added as part of Step C6 below.

### Step C6 — Surface quark availability in the browser UI

The browser UI should make it clear when quarks are not available rather than letting
operations fail silently deep inside the SC runtime.

#### `Quarks.supported` class method

Add a new `supported` class method to `Quarks.sc` that returns `true` only when the
current environment can actually perform network quark operations:

```supercollider
*supported {
    // On WASM/browser: requires the CORS proxy to be configured.
    // On WASM/WAMR CLI: always true when --quarks-dir was supplied and git is on PATH.
    // On desktop: always true.
    if(thisProcess.platform.name == \wasm) {
        ^hc_wasm_quarks_available()  // calls back to the host to check proxy/git status
    };
    ^true
}
```

In `engine/HC_Wasm_Eval.cpp` (and `wasm_runtime_bridge.cpp` for the WASI path), add a
primitive `hc_wasm_quarks_available()` that:
- In the browser path: calls a JS function `hclang_quarks_available()` that returns
  `true` iff `window.__hclang_git_proxy` is a non-empty string.
- In the WAMR path: returns `true` iff the quarks pre-open was registered (i.e.
  `--quarks-dir` was passed and `git` was found on `PATH` at startup).

The host-side JS helper:
```js
// Exported from the browser runtime setup; called by the SC primitive.
window.hclang_quarks_available = function() {
  return !!(window.__hclang_git_proxy && window.__hclang_git_proxy.length > 0);
};
```

#### UI banner for unsupported state

The host application should call `hclang_quarks_available()` after boot and display a
static informational banner if quarks are not available:

```js
after hc_wasm_eval_boot_sequence completes:

if (!window.hclang_quarks_available()) {
  showBanner(
    'Quarks are not available: no CORS proxy is configured. ' +
    'Set window.__hclang_git_proxy to enable Quarks.install(). ' +
    'See the documentation for details.'
  );
}
```

The banner should:
- Be visually distinct from normal output (e.g. an amber/yellow info bar).
- Include a link to the proxy documentation.
- Be dismissible but re-appear if the user calls `Quarks.install` without a proxy.

#### Quarks menu / command palette entries

If the browser UI exposes a Quarks menu or command palette, each entry that requires
network access (Install, Update, Refresh directory) should be:
- **Greyed out / disabled** when `hclang_quarks_available()` is `false`.
- Annotated with a tooltip: *"Requires a CORS proxy — set window.__hclang_git_proxy"*.

Entries that do not require network access (list installed quarks, uninstall) remain
enabled regardless.

---

### Known limitations (browser track)

- **CORS proxy required** for any network quark install. Fully self-contained static
  deployment without a proxy is not possible for quarks that live on GitHub. Quark
  support is **disabled by default** — it must be explicitly enabled by the host
  application by supplying a proxy URL.
- **COOP/COEP headers required** for the Atomics bridge (Option C2a). Without them,
  `Atomics.wait` throws on the main thread and the synchronous git dispatch is not
  available. Option C2b (async evaluation) removes this requirement but is higher effort.
- `thisProcess.recompile` is not supported; page reload required after quark install.
- Quarks with native extensions fail at the extension-load step.
- isomorphic-git does not support all git operations (e.g. `git diff`). Operations
  outside the dispatcher switch will return `exitCode: 127` and fail silently in SC.
- `FS.syncfs` must be called explicitly after each install to persist to IndexedDB;
  there is no automatic flush on page unload.
- The `Quarks.supported` primitive requires cooperation from the host runtime; a
  browser embedding that does not register `hclang_quarks_available` will get `false`
  by default (safe fail-closed behaviour).
