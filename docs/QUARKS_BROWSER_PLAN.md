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

## Status & rollout

Coarse-grained checklist of the work below. Each item links to a step where the per-file
checkboxes live. Some pieces (`Quarks.supported`, `_HcWasmQuarksAvailable`, the
`String#include` guard) are shared with the CLI plan — land them once via
`docs/QUARKS_CLI_PLAN.md`'s "Shared follow-up" and reuse here.

### Critical path (lands first)

- [ ] **Browser unix bridge** — `cli/hc_unix_browser.js` covering every `git` subcommand `Git.sc` issues (Step C1).
- [ ] **Atomics bridge** — `Pipe.callSync` is synchronous; isomorphic-git is async. Pick C2a (SharedArrayBuffer + Atomics, requires COOP/COEP) or commit to C2b (async refactor) before C1 ships, because the bridge shape depends on it.
- [ ] **CORS proxy contract** — `window.__hclang_git_proxy` set by host page; `corsProxy()` throws otherwise (Step C4).

### Rollout phases

- [ ] **C1** Replace the unix bridge with an isomorphic-git dispatcher
- [ ] **C2** Atomics bridge for synchronous dispatch (C2a recommended; C2b future)
- [ ] **C3** IDBFS mount for persistent quark storage (decide single-FS strategy)
- [ ] **C4** CORS proxy configuration + `__hclang_on_error` UI hook
- [ ] **C5** Browser bundle build configuration (aliases, exclusions)
- [ ] **C6** UI surfacing (`Quarks.supported`, banner, menu greying) — shared with CLI plan

### Test matrix (browser-specific; see also CLI plan TS-1…TS-4)

- [ ] **TC-1** `dispatchGit({argv: ['git','clone',url,dir]})` clones a public repo through the proxy into LightningFS
- [ ] **TC-2** Cloned quark survives a page reload (IDBFS round-trip)
- [ ] **TC-3** Atomics bridge returns synchronously to `Pipe.callSync` from the wasm side
- [ ] **TC-4** `Quarks.supported` returns `false` when proxy unset; `true` when set
- [ ] **TC-5** `String#include` shows a banner when proxy unset (no crash)

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

**Tasks:**

- [ ] Add `isomorphic-git` and `@isomorphic-git/lightning-fs` to the browser bundle's `package.json` (or `cli/package.json`, wherever the browser entry pulls deps from).
- [ ] Create `cli/hc_unix_browser.js` exporting `createBrowserUnixBridge(moduleInstance)` with the same surface as `cli/hc_unix.js`'s `createUnixBridge` (methods at `cli/hc_unix.js:96-247`: `errno`, `system`, `startCommand`, `startArgvCommand`, `runCommandCapture`, `runArgvCommandCapture`, `pidRunning`, `getPid`).
- [ ] Implement `parseGitArgv(cmd)` — strip leading `cd <dir> && ` prefix that `Git.sc` prepends; split on whitespace.
- [ ] Implement `dispatchGit({dir, argv})` switch covering: `clone`, `pull`, `fetch`, `checkout`, `rev-parse`, `--no-pager log`, `for-each-ref`, `remote`, `symbolic-ref`. These are every subcommand `src/class_library/Common/Quarks/Git.sc` issues via `Pipe.callSync` (lines 133, 148).
- [ ] Implement `corsProxy()` — read `window.__hclang_git_proxy`, throw with a clear message if absent, also call `window.__hclang_on_error(msg)` if registered (so the host page can surface the error).
- [ ] Implement `runCommandCapture(command)` — recognise `git`-prefixed commands and route through `dispatchGit` via `atomicsBridgeSync` (Step C2). Non-git commands return `{ ok: false, stdout: '', exitCode: 127 }`.
- [ ] Implement `system(command)` — fire-and-forget; if `git`-prefixed, dispatch and `.catch(console.error)`; return 0 optimistically.
- [ ] Wire the browser bundle's bootstrap to call `createBrowserUnixBridge(module)` instead of `createUnixBridge` (alias-driven via Step C5).

**Acceptance:** TC-1 passes — a clone of a small public repo via the configured proxy succeeds and the resulting tree is visible in LightningFS.

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

**Tasks (Option C2a — recommended for v1):**

- [ ] Create `cli/atomics_git_worker.js` (or whatever the browser bundle's worker dir is). Worker accepts `{id, op, sab, resultSab}` messages, runs `dispatchGit(op)`, encodes the JSON result into `resultSab`, then `Atomics.store` + `Atomics.notify` on `sab[0]`.
- [ ] Implement `atomicsBridgeSync(asyncFn)` on the main-thread side — allocate a 4-byte `SharedArrayBuffer` for the signal and a 64 KB `SharedArrayBuffer` for the result; post the operation; `Atomics.wait` until signalled; decode and return.
- [ ] Stand up the worker once at module init — keep it alive for the page lifetime; reuse for every git op.
- [ ] Document the COOP/COEP header requirement in `docs/QUARKS_BROWSER_PLAN.md` and any host-page deployment guide. Without `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, `Atomics.wait` throws on the main thread.
- [ ] Detect missing `SharedArrayBuffer` / `Atomics.wait` on page load; if absent, set `__hclang_quarks_disabled_reason = 'no-cross-origin-isolation'` and have `hclang_quarks_available()` return `false` (folds into Step C6's UI surfacing).
- [ ] Result-buffer overflow: if a git op returns more than 64 KB JSON (e.g. very large `for-each-ref` output), grow the result SAB on retry rather than truncating.

**Tasks (Option C2b — deferred):**

- [ ] File a separate plan for an async `_AsyncPipeOpen` primitive + a `Git.sc` rewrite that awaits results via callbacks. Out of scope for v1.

**Acceptance:** TC-3 passes — a `Pipe.callSync("git ...", "r")` from the wasm side returns the captured stdout synchronously without leaking the worker / SAB plumbing into SC.

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

**Tasks:**

- [ ] **Decide single-FS strategy first** — pick (a) "two IndexedDB stores, copy after every clone, `FS.syncfs(false)`" or (b) "isomorphic-git uses a custom FS adapter writing through `module.FS`". (b) is more work upfront but eliminates an entire class of drift bugs; (a) ships sooner. Document the choice inline.
- [ ] Implement `mountQuarksDirBrowser(module)` — `mkdirTree(guestParent)`, `mkdir(guestLeaf)`, `module.FS.mount(IDBFS, {}, guestLeaf)`, then `FS.syncfs(true)` (populate from IndexedDB).
- [ ] Wire it into the browser bundle bootstrap — call after `instantiateEmscriptenModule(...)` and before `_hc_wasm_eval_boot_sequence()` (mirrors A2's location at `cli/hclang.js:344`, but for the browser entry point).
- [ ] Implement `flushQuarksDir(module)` calling `FS.syncfs(false)`. Wire it into the post-`Quarks.install` codepath — either via a JS callback hook from a new `_HcWasmFlushQuarks` primitive that `Quarks.install` calls on completion, or by hooking the bridge's `dispatchGit` `clone` case to flush after success.
- [ ] If strategy (a) is chosen: add a `copyTree(srcLfs, dstFsModule, srcDir, dstDir)` helper that walks LightningFS and writes into Emscripten FS via `module.FS.writeFile`.
- [ ] If strategy (b) is chosen: implement the custom FS adapter — isomorphic-git accepts an `fs` option with `promises.readFile`, `promises.writeFile`, etc. Adapter delegates to `module.FS.*`.
- [ ] No automatic `flush` on page unload exists — document that the user (or the host page) must accept that an uncommitted IDBFS state can be lost on tab close.

**Acceptance:** TC-2 passes — a quark cloned in one page-load is present in the next page-load without re-cloning.

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

**Tasks:**

- [ ] Document the `window.__hclang_git_proxy` contract in user-facing docs (browser deployment guide, README's "Browser bundle" section if one exists).
- [ ] Document the optional `window.__hclang_on_error(msg)` hook with a working example showing a banner div toggling visible.
- [ ] Provide a one-line dev-mode recipe: `npx isomorphic-git create-proxy-server --port 9999` plus instructions for setting `window.__hclang_git_proxy = 'http://localhost:9999'`.
- [ ] Provide a deployment recipe linking to `@isomorphic-git/cors-proxy` for production.
- [ ] Add a self-check in `corsProxy()` that distinguishes "proxy unset" vs "proxy unreachable" — first throws the configuration message; the second surfaces the underlying network error verbatim so the user can debug their proxy.

**Acceptance:** with no proxy set, attempting `Quarks.install("Foo")` produces (a) a thrown `Error` containing the documented message, (b) a `console.error` log, and (c) a call to `__hclang_on_error` if registered. Nothing crashes.

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

**Tasks:**

- [ ] Pick the bundler — vite / esbuild / rollup / webpack. None exists at the project root yet, so choose based on what the rest of the browser bundle does (or stand one up). Document the choice in this section once picked.
- [ ] Add aliases:
    - `cli/hc_unix.js` → `cli/hc_unix_browser.js`
    - `node:child_process` → empty stub
    - `node:os` / `node:fs` / `node:path` → empty stubs
- [ ] Verify the produced bundle does **not** contain the strings `child_process`, `node:fs`, etc. (a CI grep step is fine).
- [ ] Verify IDBFS is reachable as `module.IDBFS` after `instantiateEmscriptenModule` — Emscripten's standard FS includes it; no link flag should be needed.
- [ ] Add a build-time toggle (env var or bundler define) that ships the browser bundle **without** the isomorphic-git/lightning-fs deps for embedders that don't want quark support. With the toggle off, `hclang_quarks_available()` always returns `false` and Steps C1/C2/C3 are tree-shaken out.

**Acceptance:** the production browser bundle is byte-identical when built with quarks-off vs. quarks-on minus the iso-git/lightning-fs chunks; no Node API references reach the browser.

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

**Tasks:**

- [ ] This guard is the same patch landed by `docs/QUARKS_CLI_PLAN.md` "Shared follow-up". Don't duplicate — link to that section in the commit message and confirm both plans reference the single source of truth.
- [ ] Verify on the browser path that the guard prints the documented banner and returns `^this` without invoking `Quarks.install`, when `Quarks.supported` is `false`.

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

**Tasks (`Quarks.supported` class method):**

- [ ] Add `*supported` to `src/class_library/Common/Quarks/Quarks.sc`. Branch on `thisProcess.platform.name == \wasm`; on wasm, dispatch to `_HcWasmQuarksAvailable`; otherwise return `true`.
- [ ] Land once — same patch is consumed by `docs/QUARKS_CLI_PLAN.md`'s "Shared follow-up" and by the `String#include` guard.

**Tasks (`_HcWasmQuarksAvailable` primitive):**

- [ ] Declare in `engine/HC_Wasm_Eval.h` and implement in `engine/HC_Wasm_Eval.cpp`.
- [ ] Browser path: call out to `window.hclang_quarks_available()` (export the JS helper from the browser bundle bootstrap). Return `1` iff `window.__hclang_git_proxy` is non-empty AND cross-origin isolation is active (see Step C2 detection).
- [ ] WAMR path: return `1` iff `--quarks-dir` was registered at startup. Set a static flag from `native/hclang_host/main.cpp` at the pre-open call site (Step B4) and read it from the primitive.
- [ ] Register in `wasm_runtime_bridge.cpp::initUnixPrimitives()` next to the new pipe primitives (line 879+).

**Tasks (UI banner + menu greying):**

- [ ] After `_hc_wasm_eval_boot_sequence()` resolves in the browser bootstrap, call `window.hclang_quarks_available()` and, if false, render a dismissible banner with: a clear message, the underlying reason (no proxy / no isolation / etc.), and a link to the docs.
- [ ] In any Quarks-related menu / command-palette wiring in the browser UI, grey out network-requiring entries (Install, Update, Refresh) when unavailable; tooltip them with `Requires a CORS proxy — set window.__hclang_git_proxy`.
- [ ] Keep network-free entries (List, Uninstall) enabled regardless.
- [ ] Re-render the banner if the user calls `Quarks.install` while unsupported (i.e. don't suppress repeats forever after first dismiss).

**Acceptance:** TC-4 passes (proxy unset → `false`; proxy set → `true`); TC-5 passes (banner shown without crash when calling `String#include` unsupported).

---

## Testing (browser track)

CLI tests TS-1…TS-4 (`docs/QUARKS_CLI_PLAN.md`) cover the engine-level shared pieces.
The five tests below cover the browser-only surface: the iso-git dispatcher, the
Atomics bridge, IDBFS persistence, and the `Quarks.supported` UI hooks. They run in a
headless browser harness (Playwright / Puppeteer); add a `just test-quarks-browser`
recipe and wire it into CI on `ubuntu-latest`.

#### TC-1 — `dispatchGit` clones into LightningFS through the proxy

**Setup:** start the dev cors-proxy (`npx isomorphic-git create-proxy-server --port 9999`)
and serve a small public test repo (or a local-only fixture proxied through it). Set
`window.__hclang_git_proxy = 'http://localhost:9999'` before module load.

**Steps:** call `dispatchGit({dir: '/q/TestQuark', argv: ['git', 'clone', '<url>', '/q/TestQuark']})`
directly from the harness. Assert the resulting LightningFS contains `quark.yaml` (or
whatever the fixture has).

**What it covers:** Step C1 dispatcher, Step C4 proxy configuration, isomorphic-git +
LightningFS plumbing.

#### TC-2 — Cloned quark survives a page reload (IDBFS round-trip)

**Setup:** complete TC-1, then reload the page.

**Assert:** after reload + `Quarks.supported` true, `Quarks.isInstalled("TestQuark")`
returns `true` without re-cloning.

**What it covers:** Step C3 IDBFS mount, the LightningFS↔IDBFS sync strategy chosen
in C3, `FS.syncfs(false)` flush after install.

#### TC-3 — Atomics bridge returns synchronously to `Pipe.callSync`

**Setup:** page served with COOP/COEP headers; bridge initialised; proxy configured.

**Steps:** evaluate SC code that calls `Pipe.callSync("git rev-parse HEAD", "r")` against
a previously cloned quark. Assert the returned array contains a 40-char SHA without
the SC scheduler having to drain microtasks.

**What it covers:** Step C2a SAB+Atomics machinery; the synchronous return contract
that `Pipe.callSync` relies on.

#### TC-4 — `Quarks.supported` matrix

**Steps:** with proxy unset: assert `Quarks.supported.postln` prints `false`. Set
`window.__hclang_git_proxy` to a non-empty URL; reboot or call `_HcWasmQuarksAvailable`
again; assert `true`.

**What it covers:** Step C6 `*supported` class method + `_HcWasmQuarksAvailable`
primitive; the `window.hclang_quarks_available` JS helper.

#### TC-5 — `String#include` shows banner without crashing when unsupported

**Steps:** with proxy unset, evaluate `"NonexistentQuark".include`. Assert (a) the
post window shows the documented "Quarks are not supported" message, (b) the
`__hclang_on_error` callback was invoked, (c) the banner DOM element is visible, (d)
the SC interpreter is still alive afterwards.

**What it covers:** the `String#include` guard, the `corsProxy()` helper's `__hclang_on_error`
hook, the banner UI from C6, and graceful failure overall.

---

### Running the tests

Add a `just test-quarks-browser` recipe that builds the browser bundle, starts the dev
cors-proxy, launches a headless browser via Playwright/Puppeteer, and runs the five
tests above. CI runs the recipe on `ubuntu-latest` (Chromium); skip on `macos-14`
unless WebKit-specific issues appear.

---

## Known limitations (browser track)

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
