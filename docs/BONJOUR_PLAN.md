# Bonjour / mDNS Service Discovery Plan

**Date**: May 7, 2026  
**Last Updated**: 2026-05-09  
**Status**: Planned (not yet started) — awaiting WAMR perf parity completion  
**Prerequisite**: mDNS advertisement working for OSCQuery (`hc_oscquery.js`)

---

## Status Summary (2026-05-09)

This plan is comprehensive and ready for implementation. All phases (B1–B4) are marked
**TODO** as of 2026-05-09. Current priority: **deferred** until WAMR performance parity
is fully shipped and stable. This allows team focus on the core ~10× cold-start gap closure
(via heap snapshots, P7 synth optimizations).

**Recommended next steps**:
1. Once Phase P7 (synth-side perf) ships, schedule Phase B1 (hcsynth advertisement).
2. Phases B2–B4 are stretch goals; implement after B1 is validated on macOS/Linux.
3. Phase B5 (native host mDNS, C-level) depends on HCLANG_NATIVE_PLAN completion.

---

## Background

Native SuperCollider uses Bonjour (Apple's Rendezvous / Zeroconf) in two ways:

1. **scsynth server advertisement** — when started with `-R 1` (controlled by
   `ServerOptions.zeroConf = true` in sclang), scsynth registers two DNS-SD
   services so any client on the LAN can discover it without knowing the IP address:
   - `_osc._udp` for UDP OSC connections
   - `_osc._tcp` for TCP OSC connections
   - Service name: `"SuperCollider"` (constant `kSCRendezvousServiceName`)

2. **sclang browsing** — `initRendezvousPrimitives()` registers primitives that
   let sclang code browse for `_osc._udp` services and automatically connect to
   discovered servers. This underpins `NetAddr.findServiceNamed("SuperCollider")`
   and the class `NetAddr` auto-discovery API.

In the WASM/CLI builds both mechanisms are currently disabled:
- `HC_Wasm_Api.cpp` hard-codes `opts.mRendezvous = false` for the embedded scsynth
- The CLI networking plan explicitly deferred Rendezvous as out of scope
- `hc_oscquery.js` does not advertise `_oscjson._tcp` on mDNS (comment: "no
  `mdns-js` in `cli/package.json`")

Now that OSCQuery has mDNS support, the infrastructure is in place to restore
both the advertisement side (hcsynth) and the browsing side (hclang / sclang
class library).

---

## Scope

| Feature | Direction | Service type |
|---------|-----------|-------------|
| hcsynth UDP server advertisement | hcsynth → network | `_osc._udp` |
| hcsynth TCP server advertisement | hcsynth → network | `_osc._tcp` |
| OSCQuery advertisement | hcsynth → network | `_oscjson._tcp` |
| sclang service browsing | sclang → hcsynth | browse `_osc._udp` / `_osc._tcp` |
| `ServerOptions.zeroConf` in class lib | sclang → hcsynth | flag passes `-R 1` |
| hclang auto-connect to discovered server | hclang → hcsynth | browse `_osc._udp` |
| Browser IDE service discovery panel | browser → network | browse `_oscjson._tcp` |

---

## npm Package Choice

The existing OSCQuery mDNS support sets the precedent for which npm package to
use. Two candidates:

| Package | Type | Platforms | Notes |
|---------|------|-----------|-------|
| `bonjour-service` | Pure JS | All | No native deps; works on macOS, Linux, Windows; actively maintained fork of `bonjour` |
| `mdns` | Native binding | macOS/Linux | Uses system mDNS stack (Bonjour.framework / Avahi); best fidelity with native SC behavior; requires native build |

**Recommendation**: use `bonjour-service` as the primary implementation. It is
a pure-JS port of Node.js `bonjour` with no native dependencies, so it works in
Docker containers and CI without an Avahi daemon. Add `mdns` as an optional
`optionalDependency` for production deployments where native stack fidelity
matters.

If the existing OSCQuery mDNS support already chose a package, use the same
one throughout. Check what is in `cli/package.json` and align.

```json
// cli/package.json additions
"dependencies": {
  "bonjour-service": "^1.3.0"
},
"optionalDependencies": {
  "mdns": "^2.7.2"
}
```

---

## Part 1: hcsynth Server Advertisement

### Goal

`hcsynth --server` advertises itself on the LAN so any native sclang client
can call `Server.default = Server.remote(...)` without manually specifying the
IP address.

### CLI flag

```
--no-zeroconf          Disable mDNS service advertisement (default: enabled in server mode)
--zeroconf-name <name> Service name (default: "SuperCollider")
```

### Implementation: `cli/hc_net.js` (new or extend existing)

Create `cli/hc_zeroconf.js` — a thin wrapper around `bonjour-service` that
publishes and unpublishes DNS-SD services:

```javascript
'use strict';
const Bonjour = require('bonjour-service');

/**
 * Advertise an hcsynth server instance over mDNS/Bonjour.
 *
 * @param {object} opts
 * @param {string}  opts.name      - Service name (default: "SuperCollider")
 * @param {number}  opts.udpPort   - UDP OSC port (omit to skip _osc._udp)
 * @param {number}  opts.tcpPort   - TCP OSC port (omit to skip _osc._tcp)
 * @param {number}  opts.oscQueryPort - OSCQuery HTTP port (omit to skip _oscjson._tcp)
 * @param {object}  opts.logger
 * @returns {{ unpublish(): Promise<void> }}
 */
function advertiseServer({ name = 'SuperCollider', udpPort, tcpPort, oscQueryPort, logger } = {}) {
  const bonjour = new Bonjour();
  const services = [];

  if (udpPort) {
    services.push(bonjour.publish({ name, type: 'osc', protocol: 'udp', port: udpPort }));
    logger?.info(`mDNS: advertising _osc._udp "${name}" on port ${udpPort}`);
  }
  if (tcpPort) {
    services.push(bonjour.publish({ name, type: 'osc', protocol: 'tcp', port: tcpPort }));
    logger?.info(`mDNS: advertising _osc._tcp "${name}" on port ${tcpPort}`);
  }
  if (oscQueryPort) {
    services.push(bonjour.publish({ name, type: 'oscjson', protocol: 'tcp', port: oscQueryPort }));
    logger?.info(`mDNS: advertising _oscjson._tcp "${name}" on port ${oscQueryPort}`);
  }

  return {
    async unpublish() {
      await Promise.all(services.map(s => new Promise(resolve => s.stop(resolve))));
      bonjour.destroy();
    },
  };
}

module.exports = { advertiseServer };
```

### Integration in `cli/hcsynth.js`

```javascript
const { advertiseServer } = require('./hc_zeroconf');

// In runServer(), after OSCQuery server start:
let zeroconf = null;
if (!opts.noZeroconf) {
  try {
    zeroconf = advertiseServer({
      name: opts.zeroconfName || 'SuperCollider',
      udpPort:      opts.udpPort  || undefined,
      tcpPort:      opts.tcpPort  || undefined,
      oscQueryPort: oscQueryServer ? oqPort : undefined,
      logger,
    });
  } catch (e) {
    logger.warn(`mDNS advertisement failed: ${e.message || e}`);
  }
}

// In teardown:
if (zeroconf) { try { await zeroconf.unpublish(); } catch (_) {} }
```

### Argument parsing additions

```javascript
// Defaults
noZeroconf: false,
zeroconfName: 'SuperCollider',

// Parsing
else if (a === '--no-zeroconf')       out.noZeroconf = true;
else if (a === '--zeroconf-name')     out.zeroconfName = next();
```

---

## Part 2: sclang-side Browsing

### Background

`src/class_library/Common/Control/Server.sc` already has the `zeroConf` flag
that generates `-R 1` / `-R 0` in the scsynth command line. Since hcsynth is
not started as a subprocess in WASM mode, that flag has no effect today.

The sclang-side browsing primitives (`initRendezvousPrimitives`) are registered
in `src/lang/primitives/primitive.cpp` but the actual implementation files
(`Rendezvous.cpp`, `SC_Rendezvous.h`) are C++ files that use platform APIs not
available in WASM. The strategy is a **JS bridge**: implement the Rendezvous
primitives as no-ops in WASM sclang but provide a sidecar API in the CLI/browser
host that makes discovered services available to the SC program via a synthetic
OSC callback.

### Design

The key sclang behavior to restore is:

```supercollider
// Native sclang: auto-discover and connect to first SuperCollider scsynth on LAN
Server.default.options.zeroConf = false;  // hcsynth advertises; sclang browses separately
NetAddr.findServiceNamed("SuperCollider", { |addr| Server.default.addr = addr });
```

There are two sub-approaches, from simplest to most faithful:

#### Sub-approach A — SC code using OSCQuery browsing (simplest, recommended)

Since hcsynth now advertises `_oscjson._tcp`, sclang code can already discover
it via standard `NetAddr` and an explicit call:

```supercollider
// hcsynth is discovered because the user knows the address, or via OSCQuery panel
s = Server.remote(\hcsynth, NetAddr("192.168.1.5", 57110));
```

This sub-approach requires no new sclang primitives. It is what native SC users
do once they have the IP. mDNS just automates the IP lookup.

#### Sub-approach B — `hc_zeroconf.js` bridge feeding a SC callback (recommended)

Add a `browseLan()` function to `hc_zeroconf.js` that watches for `_osc._udp`
and `_osc._tcp` services, and injects the results into the running sclang
instance via the `hc_wasm_eval_execute` API:

```javascript
/**
 * Browse for SuperCollider scsynth instances on the LAN.
 * When a service is found, evaluates SC code in hclang that calls the registered handler.
 *
 * @param {object} opts
 * @param {Function} opts.onFound  - callback(name, host, port, protocol)
 * @param {Function} opts.onLost   - callback(name)
 * @param {string}  [opts.type='osc']
 * @param {object}  opts.logger
 * @returns {{ stop(): void }}
 */
function browseLan({ onFound, onLost, type = 'osc', logger } = {}) {
  const Bonjour = require('bonjour-service');
  const bonjour = new Bonjour();

  const browser = bonjour.find({ type });
  browser.on('up', service => {
    const { host, port, protocol, name } = service;
    logger?.info(`mDNS: found _${type}._${protocol} "${name}" at ${host}:${port}`);
    onFound?.(name, host, port, protocol);
  });
  browser.on('down', service => {
    logger?.info(`mDNS: lost _${type}._${protocol} "${service.name}"`);
    onLost?.(service.name);
  });

  return { stop() { browser.stop(); bonjour.destroy(); } };
}

module.exports = { advertiseServer, browseLan };
```

In `hclang.js` / `hclang_repl.js`, when `--zeroconf` (or `--no-scsynth-host`)
is active, start a browser and feed results into a SC-side handler:

```javascript
const { browseLan } = require('./hc_zeroconf');

// After sclang boots:
if (!opts.scSynthHost && !opts.noZeroconf) {
  const browser = browseLan({
    onFound(name, host, port, protocol) {
      // Notify sclang: call NetAddr._zeroconfFound(name, host, port)
      const code = `NetAddr._zeroconfFound(${JSON.stringify(name)}, ${JSON.stringify(host)}, ${port});`;
      hclangEval(code);  // hc_wasm_eval_execute
    },
    onLost(name) {
      const code = `NetAddr._zeroconfLost(${JSON.stringify(name)});`;
      hclangEval(code);
    },
    logger,
  });
  cleanup.push(() => browser.stop());
}
```

### SC class library additions

Add `NetAddr._zeroconfFound` / `NetAddr._zeroconfLost` class methods to the
`src/class_library` (or to an HC-specific extension in `src/class_library/HC/`):

```supercollider
// src/class_library/HC/HCNetAddrZeroconf.sc
+ NetAddr {
    classvar <zeroconfServices;

    *initClass {
        zeroconfServices = Dictionary.new;
    }

    *_zeroconfFound { |name, host, port|
        var addr = NetAddr(host, port);
        zeroconfServices.put(name.asSymbol, addr);
        this.changed(\serviceFound, name, addr);
        // If a server is registered with this name, update its address automatically
        Server.all.do { |srv|
            if (srv.name.asString == name) { srv.addr = addr }
        };
        ("mDNS: found " ++ name ++ " at " ++ host ++ ":" ++ port).postln;
    }

    *_zeroconfLost { |name|
        zeroconfServices.removeAt(name.asSymbol);
        this.changed(\serviceLost, name);
        ("mDNS: lost " ++ name).postln;
    }

    *findServiceNamed { |name, action|
        // Synchronous: return current address if already known
        var existing = zeroconfServices.at(name.asSymbol);
        if (existing.notNil) { action.value(existing); ^existing };
        // Async: wait for the next serviceFound notification
        this.addDependant({ |changer, what, svcName, addr|
            if (what == \serviceFound and: { svcName == name }) {
                action.value(addr);
                this.removeDependant(thisFunction);
            }
        });
        ^nil
    }
}
```

This gives SC code the familiar:

```supercollider
NetAddr.findServiceNamed("SuperCollider") { |addr|
    s = Server.remote(\hcsynth, addr);
    s.waitForBoot { ... };
};
```

---

## Part 3: `ServerOptions.zeroConf` Integration

`ServerOptions.zeroConf = true` currently sets `-R 1` in the scsynth command
line, which has no effect in WASM mode (the WASM scsynth has no mDNS stack).
Instead, the flag should propagate to the JS host layer:

### Approach

1. Export a new WASM API function that reads the `zeroConf` option from the
   instantiated scsynth world:

   ```c
   // engine/HC_Wasm_Api.h
   EXPORT int hc_wasm_get_zeroconf(int world_id);
   ```

   This just returns `opts.mRendezvous` from the world state.

2. Alternatively, pass `zeroConf` as a flag from the CLI:
   - hclang evaluates `Server.default.options.zeroConf` after boot and sends
     a special message to hcsynth via OSC (e.g., `/hcsynth/zeroconf 1`)
   - hcsynth JS layer starts/stops mDNS advertisement on receipt

3. **Simplest approach** (recommended): treat `--no-zeroconf` on the hcsynth
   command line as the canonical setting. Document that
   `ServerOptions.zeroConf = false` in SC code should be paired with
   `--no-zeroconf` on the hcsynth invocation. The WASM scsynth has no
   native mDNS stack anyway, so the sclang flag only matters for the CLI host.

---

## Part 4: OSCQuery mDNS Advertisement (Extend Existing)

If the existing OSCQuery mDNS integration does not already advertise
`_oscjson._tcp`, extend `hc_oscquery.js`:

```javascript
// In createOscQueryServer():
let bonjour, bonjourService;
try {
  const Bonjour = require('bonjour-service');
  bonjour = new Bonjour();
  bonjourService = bonjour.publish({
    name: opts.serviceName || 'hcsynth',
    type: 'oscjson',
    protocol: 'tcp',
    port: port,
    txt: { osc_port: String(oscPort), osc_transport: 'UDP' },
  });
  logger?.info(`mDNS: advertising _oscjson._tcp on port ${port}`);
} catch (e) {
  logger?.warn(`mDNS advertisement for OSCQuery failed: ${e.message || e}`);
}

// In close():
await new Promise(resolve => bonjourService?.stop(resolve));
bonjour?.destroy();
```

The TXT record (`osc_port`, `osc_transport`) follows the OSCQuery spec so
clients know which OSC port to send to after discovering the HTTP server.

---

## Part 5: Browser IDE Service Discovery

### OSCQuery browser panel extension

The existing OSCQuery panel (`#oscquery-panel`) has a manual URL input. Add an
auto-discovery section that browses for `_oscjson._tcp` services via the
[DNS-SD HTTP API](https://github.com/myfreeweb/dnssd-http) or via a small
WebSocket relay from the CLI bridge server.

**Practical approach**: the browser cannot perform mDNS browsing natively (no
browser API exists). Route discovery through the CLI bridge:

1. `bridge/server.js` (or `cli/hclang.js` when running with `--bridge`) exposes
   a WebSocket endpoint at `ws://localhost:PORT/zeroconf`.
2. The server-side uses `browseLan()` and emits JSON events over the WebSocket:
   ```json
   { "event": "found", "name": "SuperCollider", "host": "192.168.1.5", "port": 57111 }
   { "event": "lost",  "name": "SuperCollider" }
   ```
3. The browser IDE connects to this WebSocket and populates a service list in
   the OSCQuery panel:
   ```
   ┌─────────────────────────────────────────────┐
   │ OSCQuery Services (auto-discovered)          │
   │ ○ SuperCollider  192.168.1.5:57111  [Connect]│
   │ ○ hcsynth-mac    127.0.0.1:57111   [Connect]│
   └─────────────────────────────────────────────┘
   ```

This is a stretch goal — the manual URL input is already functional. Prioritise
after the CLI advertisement and sclang browsing are working.

---

## Part 6: hclang Auto-Connect

When `hclang` or `hclang_repl` is started without `--scsynth-host`:

1. Browse for `_osc._udp` services.
2. If a `"SuperCollider"` service is found within a configurable timeout (default
   2 s), automatically set it as the default scsynth address.
3. Log: `mDNS: auto-connected to SuperCollider at 192.168.1.5:57110`.
4. If multiple services are found, pick the first or let the user select via
   `--zeroconf-pick` flag.

```bash
# Manual address (existing behaviour unchanged)
hclang --scsynth-host 127.0.0.1 --scsynth-port 57110

# Auto-discover (new default when no --scsynth-host given)
hclang                                        # waits up to 2s, connects first found
hclang --zeroconf-timeout 5                   # wait longer
hclang --zeroconf-name "My hcsynth"           # look for specific name
hclang --no-zeroconf                          # disable browse; use localhost default
```

---

## Files to Create / Modify

### New files

| File | Purpose |
|------|---------|
| `cli/hc_zeroconf.js` | `advertiseServer()` + `browseLan()` using `bonjour-service` |
| `src/class_library/HC/HCNetAddrZeroconf.sc` | SC class extension adding `NetAddr._zeroconfFound`, `_zeroconfLost`, `findServiceNamed` |

### Modified files

| File | Change |
|------|--------|
| `cli/package.json` | Add `bonjour-service` to `dependencies`; optionally add `mdns` to `optionalDependencies` |
| `cli/hcsynth.js` | Import `hc_zeroconf`; add `--no-zeroconf` / `--zeroconf-name` flags; call `advertiseServer` in server mode; call `unpublish` on teardown |
| `cli/hc_oscquery.js` | Add `_oscjson._tcp` mDNS advertisement inside `createOscQueryServer()` |
| `cli/hclang.js` | Add `--no-zeroconf` / `--zeroconf-timeout` / `--zeroconf-name` flags; call `browseLan` when no `--scsynth-host`; inject discovered address into sclang via `NetAddr._zeroconfFound` |
| `cli/hclang_repl.js` | Same as `hclang.js`; start browse in REPL mode |
| `bridge/server.js` | Optionally: expose WebSocket relay for browser IDE service discovery |
| `docs/CLI_REFERENCE.md` | Document new flags |
| `docs/WASM_POST_LAUNCH_ENHANCEMENTS.md` | Mark Bonjour as completed when done |

---

## Phased Implementation

### Phase B1 — Advertise hcsynth (1–2 days)

- [x] `npm install bonjour-service` in `cli/`; add to `package.json`.
- [x] Create `cli/hc_zeroconf.js` with `advertiseServer()`.
- [x] Add `--no-zeroconf` / `--zeroconf-name` args to `hcsynth.js`.
- [x] Start advertisement after server bind; stop on teardown.
- [x] Extend `hc_oscquery.js` to call `advertiseServer({ oscQueryPort })` when
      `bonjour-service` is available (fail-silent if not installed).
- [ ] **Acceptance**: `dns-sd -B _osc._udp local` (macOS) or
      `avahi-browse _osc._udp` (Linux) shows `"SuperCollider"` while
      `hcsynth --server --udp-port 57110` is running.
- [ ] **Acceptance**: a native SC IDE (`Server.default.addr = ...`) can auto-
      discover hcsynth using `Server.remote(\remote, NetAddr.findServiceNamed("SuperCollider"))`.

### Phase B2 — sclang browsing (2–3 days)

- [x] Add `browseLan()` to `hc_zeroconf.js`.
- [x] Add `--no-zeroconf` / `--zeroconf-timeout` / `--zeroconf-name` flags to
      `hclang.js` and `hclang_repl.js`.
- [x] After hclang boots, start browse; inject `NetAddr._zeroconfFound` calls.
- [x] Create `src/class_library/HC/HCNetAddrZeroconf.sc`.
- [x] Add `HCNetAddrZeroconf.sc` to the class library pack / include path.
- [ ] **Acceptance**: running `hclang` with no `--scsynth-host` while hcsynth
      is advertising auto-connects and
      `NetAddr.zeroconfServices.postln` shows the discovered address.
- [ ] **Acceptance**: `NetAddr.findServiceNamed("SuperCollider") { |a| a.postln }` works.

### Phase B3 — `ServerOptions.zeroConf` wiring (1 day)

- [x] Document that `ServerOptions.zeroConf` on the sclang side has no effect
      on advertisement in WASM mode; advertisement is controlled by the hcsynth
      CLI flag `--no-zeroconf`.
- [ ] Optionally: after hclang boots, read
      `Server.default.options.zeroConf.postln` from the WASM interpreter and if
      false, send a synthetic OSC message to hcsynth to stop advertising. (Low
      priority — most users will just use the CLI flag.)

### Phase B4 — Browser IDE (3–5 days, stretch goal) (DEFERRED)

- [ ] Add WebSocket relay in `bridge/server.js` that pipes `browseLan()` events
  to connected browsers.
- [ ] Extend `sc_ide.html` OSCQuery panel with a "Discovered Services" list.
- [ ] Auto-populate the URL input when a `_oscjson._tcp` service is found.
- [ ] **Acceptance**: open the browser IDE; start hcsynth; the service appears
  in the panel within 3 seconds without any manual URL entry.

---

## Known Pitfalls

### 1. `bonjour-service` multicast on Linux requires `CAP_NET_ADMIN` or Avahi

On some Linux setups, raw multicast socket access is restricted. If `bonjour-service`
fails to bind, log a warning and continue — the server is still fully functional
without mDNS. Users on affected systems can run `avahi-daemon` separately.

### 2. Name collisions

If multiple hcsynth instances run on the same machine, `bonjour-service` will
append ` (2)`, ` (3)`, etc. to the service name. The browse side should match
by prefix or list all instances. Use `--zeroconf-name` to differentiate.

### 3. macOS firewall / system extension prompts

The first time a new Node.js binary registers a Bonjour service, macOS may
show a firewall dialog. Document this in the CLI README.

### 4. Docker / container environments

mDNS multicast does not cross Docker network boundaries by default. Add a note
in `CLI_REFERENCE.md` that `--no-zeroconf` is recommended in containerised
deployments; use explicit `--scsynth-host` instead.

### 5. `bonjour-service` vs native `mdns` package

`bonjour-service` uses its own pure-JS multicast implementation. On macOS this
means it runs alongside (not through) the system Bonjour daemon. Both can
advertise the same service without conflict, but querying with `dns-sd` may show
the entry only once. The `mdns` native binding routes through `mDNSResponder`
(macOS) or `avahi-daemon` (Linux) for full OS-level integration — use it as an
`optionalDependency` for production.

### 6. hclang browsing race condition

hclang boots and calls `NetAddr._zeroconfFound` asynchronously. SC code that
runs immediately in the REPL may execute before the discovery callback fires.
The `findServiceNamed` implementation above handles this by deferring via a
dependent, but code that accesses `Server.default` synchronously at boot
(e.g., `s.waitForBoot { ... }`) needs to be written inside the callback.

---

## Testing

```bash
# B1: verify advertisement
dns-sd -B _osc._udp local.                   # macOS
avahi-browse _osc._udp                        # Linux
node cli/hcsynth.js --server --udp-port 57110

# B2: verify sclang browsing
node cli/hclang.js --script - <<'SC'
NetAddr.findServiceNamed("SuperCollider") { |a|
    ("found: " ++ a).postln;
    thisProcess.stop;
};
SC

# OSCQuery advertisement
curl http://localhost:57111/host_info         # should return JSON
dns-sd -B _oscjson._tcp local.
```

Add test cases to `cli/tests/test_hcsynth_udp.js`:
- Start hcsynth server, wait 500 ms, browse for `_osc._udp`, assert service found.
- Stop hcsynth, assert service disappears within 5 s.

---

## Actionable Checklist$$

Flat task list, ordered by file. All tasks are independent within a phase
unless a dependency is noted.

### Infrastructure

- [x] **`cli/package.json`** — run `npm install bonjour-service` inside `cli/`;
      confirm it appears under `"dependencies"` at `^1.3.0` or later.
- [x] **`cli/package.json`** — add `"mdns": "^2.7.2"` to `"optionalDependencies"`
      so native-binding users get full OS-stack integration without blocking the
      pure-JS path.
- [ ] **`cli/package.json`** — add `"hc_zeroconf.js"` to the `"files"` array if
      present, so it is included in any future npm publish.

### `cli/hc_zeroconf.js` (new file)

- [x] Create `cli/hc_zeroconf.js` with a `try/require('bonjour-service')` guard
      at the top; export `null`-safe stubs if the package is absent so callers
      never need to check.
- [x] Implement `advertiseServer({ name, udpPort, tcpPort, oscQueryPort, logger })`
      — publishes one service per provided port; returns `{ unpublish() }`.
- [x] Implement `browseLan({ onFound, onLost, type, logger })` — returns
      `{ stop() }`; emits `onFound(name, host, port, protocol)` and `onLost(name)`.
- [x] Add a `noop` export (`advertiseServer: () => ({ unpublish: async () => {} })`,
      `browseLan: () => ({ stop: () => {} })`) as the fallback when
      `bonjour-service` is not installed, so all callers are always safe.
- [ ] Verify on macOS: `dns-sd -B _osc._udp local.` lists the published service
      while the module is active.
- [ ] Verify on macOS: `dns-sd -B _osc._tcp local.` lists the published service.
- [ ] Verify on macOS: `dns-sd -B _oscjson._tcp local.` lists the published service.

### `cli/hcsynth.js`

- [x] Add `--no-zeroconf` boolean flag (default: `false` in `--server` mode,
      `true` in all other modes). Document in the arg-parsing comment block.
- [x] Add `--zeroconf-name <string>` flag (default: `"SuperCollider"`).
- [x] In `runServer()`, after the UDP/TCP sockets bind successfully, call
      `advertiseServer({ name, udpPort, tcpPort, oscQueryPort, logger })`.
      Wrap in `try/catch`; log a warning and continue on failure — never let
      mDNS failure crash the server.
- [x] Store the returned handle in a variable accessible to the teardown path.
- [x] In the existing `SIGINT` / `SIGTERM` / `uncaughtException` teardown block,
      call `await zeroconf.unpublish()` before `process.exit()`.
- [ ] Smoke-test: `node cli/hcsynth.js --server --udp-port 57110` → `dns-sd -B
      _osc._udp local.` shows `SuperCollider`.
- [ ] Smoke-test: `node cli/hcsynth.js --server --udp-port 57110 --no-zeroconf`
      → service does **not** appear.
- [ ] Smoke-test: send `SIGINT`; confirm `dns-sd` stops listing the service
      within ~5 s (or immediately on macOS).

### `cli/hc_oscquery.js`

- [x] Inside `createOscQueryServer()`, after the HTTP server is listening,
      require `hc_zeroconf` and call `advertiseServer({ name: opts.serviceName ||
      'hcsynth', oscQueryPort: port, logger })`.
- [x] Pass `osc_port` and `osc_transport` as a TXT record on the
      `_oscjson._tcp` service per the OSCQuery spec.
- [x] Store the returned handle; call `unpublish()` inside the `close()` method
      (or wherever the HTTP server is stopped).
- [x] Remove or update the existing comment on line 71 that says mDNS is not
      implemented.
- [ ] Smoke-test: `dns-sd -B _oscjson._tcp local.` shows `hcsynth` while the
      OSCQuery server is running.
- [ ] Smoke-test: `dns-sd -L hcsynth _oscjson._tcp local.` shows the TXT record
      with `osc_port` and `osc_transport`.

### `cli/hclang.js`

- [x] Add `--no-zeroconf` flag (default `false`).
- [x] Add `--zeroconf-timeout <seconds>` flag (default `2`).
- [x] Add `--zeroconf-name <string>` flag (default `"SuperCollider"`).
- [x] After hclang has completed the boot sequence (post `interpretPrintCmdLine`
      or equivalent ready signal), call `browseLan({ type: 'osc', onFound,
      onLost, logger })` unless `--scsynth-host` was explicitly provided or
      `--no-zeroconf` is set.
- [x] In the `onFound` callback, build and call
      `hc_wasm_eval_execute("NetAddr._zeroconfFound(\"<name>\", \"<host>\",
      <port>);")` using the existing eval channel.
- [x] In the `onLost` callback, call
      `hc_wasm_eval_execute("NetAddr._zeroconfLost(\"<name>\");")`.
- [x] Push the browser's `stop()` into the cleanup array so it is torn down on
      process exit.
- [ ] Smoke-test: with hcsynth advertising, run `hclang` with no
      `--scsynth-host`; confirm `NetAddr.zeroconfServices.postln` in the SC
      post window shows the discovered address.

### `cli/hclang_repl.js`

- [x] Mirror all three new flags (`--no-zeroconf`, `--zeroconf-timeout`,
      `--zeroconf-name`) from `hclang.js`.
- [x] Apply the same `browseLan()` call and SC eval injection after the REPL
      interpreter is ready.
- [ ] Smoke-test: start `hclang_repl`; type
      `NetAddr.zeroconfServices.postln` → shows discovered hcsynth address.

### `src/class_library/HC/HCNetAddrZeroconf.sc` (new file)

- [x] Create the file with the `+ NetAddr { ... }` extension class shown in Part 2.
- [x] Implement `*initClass` — initialise `zeroconfServices` as an empty
      `Dictionary`.
- [x] Implement `*_zeroconfFound { |name, host, port|` — store in dictionary,
      call `this.changed(\serviceFound, ...)`, auto-update matching `Server`
      instances by name.
- [x] Implement `*_zeroconfLost { |name|` — remove from dictionary, call
      `this.changed(\serviceLost, ...)`.
- [x] Implement `*findServiceNamed { |name, action|` — synchronous fast-path
      if already known; async dependant path otherwise.
- [x] Verify the file is included by the class library pack:
      - Check `tools/pack_sc_classlib.js` for the HC extension directory glob;
        add `src/class_library/HC/` if absent.
      - Or add an explicit entry for `HCNetAddrZeroconf.sc`.
- [ ] SC unit test: `NetAddr._zeroconfFound("foo", "127.0.0.1", 57110);
      NetAddr.zeroconfServices[\foo].postln` → prints `NetAddr("127.0.0.1",
      57110)`.
- [ ] SC unit test: `NetAddr.findServiceNamed("foo") { |a| a.postln }` with
      the service already in the dictionary → prints immediately.
- [ ] SC unit test: `NetAddr._zeroconfLost("foo");
      NetAddr.zeroconfServices[\foo].postln` → prints `nil`.

### `docs/CLI_REFERENCE.md`

- [x] Add a **Zeroconf / mDNS** section documenting:
  - `--no-zeroconf` on `hcsynth` and `hclang` / `hclang_repl`
  - `--zeroconf-name` on `hcsynth` (advertisement name)
  - `--zeroconf-name` on `hclang` (service name to look for)
  - `--zeroconf-timeout` on `hclang` / `hclang_repl`
  - Note about Docker / container environments where mDNS is unreachable.
  - Note about first-run macOS firewall prompt.

### `docs/WASM_POST_LAUNCH_ENHANCEMENTS.md`

- [x] Find the Phase 2.3 OSCQuery row that says "mDNS advertisement deferred"
      and update it to reference `BONJOUR_PLAN.md`.
- [x] After B1 is complete, mark `_oscjson._tcp` advertisement as done in that
      table.
- [x] After B2 is complete, add a row for sclang browsing / `NetAddr.zeroconfServices`.

### Tests (`cli/tests/`)

- [x] In `test_hcsynth_udp.js` (or a new `test_hcsynth_mdns.js`): start hcsynth
      with `--server --udp-port 57110`, wait 500 ms, use `bonjour-service` in
      the test to browse for `_osc._udp`; assert service is found within 3 s.
- [x] Assert service disappears within 5 s after hcsynth is stopped.
- [x] Assert `--no-zeroconf` suppresses the service (nothing found within 2 s).
- [ ] In `test_hclang.js` (or new file): start hcsynth advertising, start
      hclang, send `NetAddr.zeroconfServices.size.postln` via eval, assert
      output is `> 0`.

---

## Relationship to HCLANG_NATIVE_PLAN.md

The native WAMR host (`native/hcsynth_host`) will need the same Bonjour
functionality but via the C API. On macOS, use `CFNetServiceCreate` /
`CFNetServiceRegisterWithOptions` (the same CoreServices path as the existing
`Rendezvous.cpp`). On Linux, use Avahi via `CPMAddPackage avahi`. Add the
native host's mDNS work as Phase B5 in that plan once the WASI target is
validated. (See `docs/HCLANG_NATIVE_PLAN.md`, which absorbed the old
`WASM_NATIVE_HOST_PLAN.md`.)
