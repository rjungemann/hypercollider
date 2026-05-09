# WASM Post-Launch Enhancements — Open Work

The post-MVP roadmap that ran through 2026-05. Most phases shipped; this doc
now tracks only what's left.

For the full feature surface area, see
[WASM_FEATURE_MATRIX.md](WASM_FEATURE_MATRIX.md).

---

## Shipped (one-line summaries)

- **CLI TCP/UDP networking parity** (N1–N6, 2026-05-06). hcsynth UDP + TCP
  server, external scsynth routing in hc/hclang/hclang_repl, real-time audio
  via `node-speaker`, short-form flag aliases.
- **Phase 1 — Real-time rendering** (1.1–1.4). Browser real-time audio
  documented end-to-end; structured error/diagnostic callbacks; CLI
  real-time output via `node-speaker`; performance optimisations to
  AudioWorklet round-trip latency (<3 ms golden path).
- **Phase 2.1 — Multi-device audio routing** (2026-05-07). CLI
  `--device-route` and browser `DeviceRouter` for splitting channels across
  outputs.
- **Phase 2.2 — MIDI & OSC input** (2026-05-07). Browser MIDI Learn panel +
  CLI `.midi-map` commands.
- **Phase 2.3 — OSCQuery** (2026-05-07). `hcsynth --oscquery-port` HTTP
  namespace server.
- **Phase 2.4 — Preset management** (2026-05-07). CLI `.preset` commands +
  browser preset panel.
- **Phase 2.5 — Plugin Tier 2 & 3** (sc3-plugins integrated; see
  [PLUGIN_INVENTORY_WASM.md](PLUGIN_INVENTORY_WASM.md)).
- **Phase 3.2 — Profiling tools**. CPU timeline, render-time histogram,
  WASM heap display, `hcsynth --profile N` flag.
- **Phase 3.3 — Debugging support** (except breakpoints). Synth tree
  inspector, structured `onError` with editor scroll, `setDebugLevel(n)`.

---

## Phase 3.1 — Language Server Protocol — [ ] NOT STARTED

Full IDE integration for VS Code, Neovim (nvim-lspconfig), Helix, and other
LSP clients.

**Approach.** A Node.js LSP server (`sclang_lsp.js`) wrapping a warm WASM
sclang instance, communicating over stdio:

- **Completion**: on trigger, evaluate `Class.allClasses.collect(_.name)` and
  `SomeClass.methods.collect { |m| [m.name, m.argNames] }` via
  `sc_wasm_eval` to get the live class/method database. Cache with a short
  TTL; invalidate on class library recompile.
- **Diagnostics**: on document change (debounced), evaluate the buffer and
  capture sclang's error string + line/char offset; map to LSP `Diagnostic`
  objects shown inline.
- **Definition lookup**: evaluate
  `SomeClass.findMethod(\methodName).filenameSymbol` and `charPos` — sclang
  returns these; the LSP server resolves the file path and returns a
  `Location`.
- **Transport**: stdio LSP (the VS Code extension sets
  `languageServerCommand: ["node", "sclang_lsp.js"]`).

**Tasks**:
- [ ] `sclang_lsp.js` — LSP server skeleton with stdio transport
- [ ] Completion provider (class + method database via `sc_wasm_eval`)
- [ ] Diagnostic provider (eval-on-change with debounce)
- [ ] Definition lookup provider
- [ ] VS Code extension manifest + language contribution
- [ ] nvim-lspconfig config snippet in docs

**Effort**: 10–14 days.

---

## Phase 3.3 — Breakpoint support — [ ] DEFERRED

Requires modifying the sclang bytecode interpreter to check a breakpoint
table before each opcode dispatch — feasible but several weeks of work;
deferred. Existing debug support (synth tree, structured stacktraces, debug
level) covers the common cases.
