# `mise` integration via a native asdf-style plugin

## Goal

Let users on [`mise`](https://mise.jdx.dev) manage HyperCollider versions
with the same ergonomics as any other tool (`mise install hypercollider@0.1.0`,
`.mise.toml`, `.tool-versions`, shims, project-local pins) **without
requiring an Emscripten SDK, CMake toolchain, or any source build on the
host**. `mise` users should be able to install and use HyperCollider
with mise alone.

The plugin is a self-contained asdf-style plugin: a small set of shell
scripts that talk directly to GitHub releases, download the
release artifact, and lay it out where `mise` expects. The existing
Homebrew formula stays the recommended path for Mac/Linux users who
already use brew; the mise plugin is purely additive.

## Why native, not a Homebrew passthrough

A Homebrew-passthrough plugin (4 scripts that shell out to `brew install
rjungemann/hypercollider/hypercollider`) would technically work but has
real drawbacks:

- **Hard dependency on Homebrew.** Users on bare Linux without brew (or
  who deliberately avoid it) would still need it to bootstrap. That's
  exactly the friction the plugin is supposed to remove.
- **Coupling to the formula's build-from-source path.** The current
  formula builds from `:head` (Emscripten + CMake + Ninja + Python),
  which takes ~10 minutes. mise users expect `mise install` to be a
  fast tarball extract, not an emcc build.
- **Confusing uninstall semantics.** Symlinking from `$HOMEBREW_PREFIX`
  into `$ASDF_INSTALL_PATH` shares disk but means `brew uninstall`
  silently breaks mise's view of installed versions.
- **Two install paths to debug.** A user hitting a bad download sees
  brew's error surface filtered through mise's shim layer — harder to
  triage than a single native path.

The native route is what most language version managers effectively
converged on: `rbenv` delegates to `ruby-build`, `nodenv` to `node-build`,
`asdf-python` to `python-build` — each is a self-contained installer
that knows how to fetch and lay out a release without depending on a
separate "system" package manager. We follow that pattern.

The Homebrew formula stays the recommended CLI for users on brew; the
plugin and the formula are independent installers that happen to consume
the same GitHub release artifacts.

## How `mise` plugins work (the minimum we need)

`mise` natively supports asdf-style plugins. A plugin is a git repo with a
`bin/` directory containing standardized scripts. `mise` calls them with
predictable env vars (`ASDF_INSTALL_VERSION`, `ASDF_INSTALL_PATH`, ...) and
expects each to read stdin / write stdout in a documented format.

Required scripts for a minimal install-only plugin:

| Script | Contract |
|---|---|
| `bin/list-all` | Print all installable versions, newline-separated, oldest→newest. |
| `bin/install` | Install `$ASDF_INSTALL_VERSION` into `$ASDF_INSTALL_PATH`. Exit 0 on success. |
| `bin/list-bin-paths` | Print space- or newline-separated subpaths (relative to `$ASDF_INSTALL_PATH`) that should land on `PATH` — for us, just `bin`. |
| `bin/latest-stable` | Print the single newest non-pre-release tag. |

Optional but cheap wins: `bin/exec-env` (export `HC_CLASSLIB_DIR` and
the AOT module search path), `bin/help.overview`, `bin/help.deps`.

## Repo layout

A separate repo, **`asdf-hypercollider`** (name follows the asdf-plugin
convention that `mise` recognizes by default):

```
asdf-hypercollider/
  bin/
    list-all
    install
    list-bin-paths
    latest-stable
    exec-env          # optional: exports HC_CLASSLIB_DIR + AOT search path
    help.overview     # optional
    help.deps         # optional
  lib/
    utils.bash        # shared helpers: target detection, download, verify, extract
  README.md
  LICENSE
  .github/workflows/ci.yml   # smoke-install a known tag on linux+macos
```

Hosting under `rjungemann/asdf-hypercollider` keeps it out of the main
`hypercollider` repo so plugin iterations don't churn the engine tree,
and so the mise registry can point at a stable URL.

## What the plugin needs from the release workflow

These are the only contracts the plugin depends on. HyperCollider does
not yet cut tagged releases with prebuilt asset bundles — this plan
assumes a release workflow is added (or extended) alongside the plugin
work. The contract the plugin depends on:

1. **Tags** are `vMAJOR.MINOR.PATCH` on the `hypercollider` repo, listed
   by `GET /repos/rjungemann/hypercollider/releases`.
2. **Per-target prebuilt tarballs** are attached as release assets with
   a stable naming convention:
   `hypercollider-vX.Y.Z-<arch>-<os>.tar.gz`.
   - `<os>` is `linux` or `macos`.
   - `<arch>` is `x86_64` or `arm64`.
   - A `wasm` tarball (`hypercollider-vX.Y.Z-wasm.tar.gz`) ships the
     toolchain-independent JS+WASM bundles (`hclang.js`/`.wasm`,
     `hcsynth.js`/`.wasm`) — these are reused by the native targets.
3. **A SHA-256 checksum file** is published alongside each asset, e.g.
   `hypercollider-vX.Y.Z-<arch>-<os>.tar.gz.sha256` (and a combined
   `SHA256SUMS` per release for human verification).
4. **Extracted layout** matches the Homebrew install:
   ```
   bin/
     hclang-wasm        # Node wrapper around hclang.js
     hcsynth-wasm       # Node wrapper around hcsynth.js
     hclang-wamr-full   # WAMR-host wrapper around hclang.wasm
     hcsynth-wamr-full  # WAMR-host wrapper around hcsynth.wasm
     hclang-wamr-aot    # AOT-compiled hclang (when AOT module present)
     hcsynth-wamr-aot   # AOT-compiled hcsynth (when AOT module present)
   libexec/
     hclang.js / hclang.wasm
     hcsynth.js / hcsynth.wasm
     hclang.aot / hcsynth.aot   # optional; only on targets we AOT-compile for
     wamr-host                  # native WAMR host binary
   share/hypercollider/
     classlib/         # SCClassLibrary used by hclang
     plugins/          # bundled UGen plugin index
   include/, lib/      # optional, for downstream native linkers
   ```
5. **Source tarball** (the GitHub-generated `v<X.Y.Z>.tar.gz`) is
   available as a fallback for hosts with no prebuilt asset, but the
   source build pulls in Emscripten and CMake and is **opt-in only**
   (gated by `HYPERCOLLIDER_BUILD_FROM_SOURCE=1`); the default install
   on an unsupported target errors out with a clear message rather than
   silently kicking off a 10-minute emcc build.

Any naming gap between what the workflow publishes today and what the
plugin needs to assume gets closed in `hypercollider` first, in one PR,
so the plugin never has to special-case missing assets.

### Node runtime dependency

`hclang-wasm` / `hcsynth-wasm` are Node scripts. The plugin does **not**
bundle Node; instead, `bin/help.deps` documents the requirement and
`bin/exec-env` errors clearly if `node` is missing from `PATH`. The
intended mise idiom is to declare both tools in `.mise.toml`:

```toml
[tools]
node = "20"
hypercollider = "latest"
```

The WAMR-host binaries (`hclang-wamr-full`, `hclang-wamr-aot`) have no
Node dependency and work standalone — useful for embedded / CI use
cases where pulling in Node is undesirable.

## Script designs

The scripts are deliberately small and share helpers via `lib/utils.bash`.

### `lib/utils.bash` (shared helpers)

```sh
# Resolve <arch>-<os> the same way the release workflow does.
hypercollider_target() {
  local os arch
  case "$(uname -s)" in
    Linux)  os=linux ;;
    Darwin) os=macos ;;
    *) echo "unsupported OS: $(uname -s)" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x86_64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; return 1 ;;
  esac
  echo "${arch}-${os}"
}

hypercollider_release_url() {
  local version="$1" target="$2"
  echo "https://github.com/rjungemann/hypercollider/releases/download/v${version}/hypercollider-v${version}-${target}.tar.gz"
}

hypercollider_download() {  # url, dest
  curl --fail --location --silent --show-error -o "$2" "$1"
}

hypercollider_verify_sha256() {  # file, expected
  local got
  if command -v sha256sum >/dev/null; then
    got="$(sha256sum "$1" | awk '{print $1}')"
  else
    got="$(shasum -a 256 "$1" | awk '{print $1}')"
  fi
  [ "$got" = "$2" ] || { echo "sha256 mismatch: $1" >&2; return 1; }
}
```

### `bin/list-all`

```sh
#!/usr/bin/env bash
set -euo pipefail
curl --fail --silent --show-error \
  "https://api.github.com/repos/rjungemann/hypercollider/releases?per_page=100" \
  | grep -E '"tag_name":' \
  | sed -E 's/.*"v?([0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.+-]+)?)".*/\1/' \
  | awk 'NF' \
  | sort -V
```

No `jq` dependency — a `grep | sed` pass over `tag_name` lines is enough
for the asdf contract and keeps the install footprint zero. (If the
release list grows past one page, switch to `Link:` header pagination;
that's a 5-line addition.)

### `bin/install`

```sh
#!/usr/bin/env bash
set -euo pipefail
: "${ASDF_INSTALL_TYPE:?}"   # "version" or "ref"
: "${ASDF_INSTALL_VERSION:?}"
: "${ASDF_INSTALL_PATH:?}"
: "${ASDF_DOWNLOAD_PATH:=$(mktemp -d)}"

plugin_dir="$(cd "$(dirname "$0")/.." && pwd)"
. "$plugin_dir/lib/utils.bash"

v="$ASDF_INSTALL_VERSION"
target="$(hypercollider_target)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url="$(hypercollider_release_url "$v" "$target")"
tarball="$tmp/hypercollider.tar.gz"

if hypercollider_download "$url" "$tarball"; then
  # Verify checksum if the .sha256 sidecar is published.
  if hypercollider_download "${url}.sha256" "$tarball.sha256" 2>/dev/null; then
    expected="$(awk '{print $1}' < "$tarball.sha256")"
    hypercollider_verify_sha256 "$tarball" "$expected"
  fi
  mkdir -p "$ASDF_INSTALL_PATH"
  tar -xzf "$tarball" -C "$ASDF_INSTALL_PATH" --strip-components=1
else
  if [ "${HYPERCOLLIDER_BUILD_FROM_SOURCE:-0}" != "1" ]; then
    cat >&2 <<EOF
No prebuilt asset for $target at v$v.

Source builds require Emscripten + CMake + Ninja + Python and take
~10 minutes. To opt in, re-run with:

  HYPERCOLLIDER_BUILD_FROM_SOURCE=1 mise install hypercollider@$v

Or use the Homebrew formula:
  brew install rjungemann/hypercollider/hypercollider
EOF
    exit 1
  fi

  echo "building v$v from source (Emscripten required)" >&2
  src_url="https://github.com/rjungemann/hypercollider/archive/refs/tags/v${v}.tar.gz"
  hypercollider_download "$src_url" "$tarball"
  mkdir -p "$tmp/src"
  tar -xzf "$tarball" -C "$tmp/src" --strip-components=1
  (
    cd "$tmp/src"
    # Mirrors the Justfile / Homebrew formula's WASM target.
    emcmake cmake -S . -B build -DSC_WASM=ON -DAUDIOAPI=wasm \
      -DCMAKE_BUILD_TYPE=Release >/dev/null
    cmake --build build --target hclang hcsynth -j >/dev/null
    # Lay out the install root.
    mkdir -p "$ASDF_INSTALL_PATH/bin" \
             "$ASDF_INSTALL_PATH/libexec" \
             "$ASDF_INSTALL_PATH/share/hypercollider/classlib"
    cp build/lang/hclang.{js,wasm} "$ASDF_INSTALL_PATH/libexec/"
    cp build/server/scsynth/hcsynth.{js,wasm} "$ASDF_INSTALL_PATH/libexec/"
    cp -R SCClassLibrary/. "$ASDF_INSTALL_PATH/share/hypercollider/classlib/"
    # Install the Node wrapper shims from cli/.
    install -m 0755 cli/hclang.js  "$ASDF_INSTALL_PATH/bin/hclang-wasm"
    install -m 0755 cli/hcsynth.js "$ASDF_INSTALL_PATH/bin/hcsynth-wasm"
  )
fi

# Sanity check.
"$ASDF_INSTALL_PATH/bin/hclang-wasm" --version >/dev/null
```

The install path is fully self-contained: download, verify, extract,
done. The source-build fallback handles niche targets but is gated by
an env var so users on `mise install` don't accidentally trigger a
10-minute emcc build. No symlink games — `ASDF_INSTALL_PATH` owns its
contents.

### `bin/list-bin-paths`

```sh
#!/usr/bin/env bash
echo "bin"
```

### `bin/latest-stable`

```sh
#!/usr/bin/env bash
set -euo pipefail
plugin_dir="$(cd "$(dirname "$0")/.." && pwd)"
"$plugin_dir/bin/list-all" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | tail -n1
```

Strict `MAJOR.MINOR.PATCH` filter drops pre-releases (`-rc.1`, `-beta`).

### `bin/exec-env` (optional)

```sh
#!/usr/bin/env bash
# So `hclang-wasm` invoked through a mise shim finds its bundled
# classlib and WASM modules even if the user has no env set.
export HC_CLASSLIB_DIR="$ASDF_INSTALL_PATH/share/hypercollider/classlib"
export HC_LIBEXEC_DIR="$ASDF_INSTALL_PATH/libexec"

# Warn (don't fail) if Node is missing — the WAMR-host binaries still work.
if ! command -v node >/dev/null 2>&1; then
  echo "warning: 'node' not found on PATH; hclang-wasm/hcsynth-wasm require Node." >&2
  echo "         The WAMR-host variants (hclang-wamr-full, hclang-wamr-aot) still work." >&2
fi
```

The `HC_CLASSLIB_DIR` / `HC_LIBEXEC_DIR` exports require the Node wrapper
scripts in `cli/` to honor those env vars when locating their bundled
assets (today they resolve relative to the script path, which already
works for an asdf-style install — the exports are belt-and-suspenders
for the case where a user invokes the underlying `.js` files directly).

## Build dependencies

The prebuilt path has no host build deps — just `curl`, `tar`, and a
SHA-256 tool (`sha256sum` or `shasum`), all standard on Linux/macOS.
**Runtime** needs `node` ≥ 18 on `PATH` for the `*-wasm` binaries; the
`*-wamr-full` and `*-wamr-aot` binaries have no runtime deps.

The opt-in source-build fallback needs Emscripten (`emsdk`), CMake
(≥ 3.18), Ninja, and Python 3. Document this in `bin/help.deps` so mise
can surface it:

```sh
#!/usr/bin/env bash
cat <<'EOF'
Prebuilt install (default): curl, tar, sha256sum/shasum.
Runtime (for *-wasm binaries): node >= 18 on PATH.
Runtime (for *-wamr-full / *-wamr-aot): none — fully self-contained.

Source-build fallback (opt-in via HYPERCOLLIDER_BUILD_FROM_SOURCE=1):
  - Emscripten SDK (emsdk) with emcc on PATH
  - cmake >= 3.18
  - ninja
  - python3
EOF
```

## Plan of work

1. **(hypercollider)** Stand up the release-asset contract.
   - Add a `release.yml` GitHub Actions workflow that, on tag push, builds
     the WASM bundle (once) and the WAMR host binaries (matrix:
     ubuntu-latest × x86_64, macos-latest × arm64) and uploads them
     under the naming convention above.
   - Publish `.sha256` sidecars per asset plus a combined `SHA256SUMS`.
   - Document these as "supported public artifacts" in the release docs
     so the plugin can rely on them.
2. **(hypercollider)** Teach the Node CLI wrappers (`cli/hclang.js`,
   `cli/hcsynth.js`) to honor `HC_CLASSLIB_DIR` / `HC_LIBEXEC_DIR` when
   set, falling back to the current script-relative resolution otherwise.
3. **(asdf-hypercollider)** Spin up the new repo with the scripts above.
4. **CI for the plugin**: GitHub Actions matrix (`ubuntu-latest`,
   `macos-latest`) that installs `mise`, installs the plugin from the
   checkout (`mise plugin install hypercollider .`), then runs
   `mise install hypercollider@<known-good-tag>` and
   `mise exec -- hclang-wasm --version`. A second job exercises the
   source-build fallback by forcing the prebuilt URL to 404 and setting
   `HYPERCOLLIDER_BUILD_FROM_SOURCE=1` (this job depends on emsdk being
   cached — expect a ~10-minute runtime).
5. **Docs**: a short "Using HyperCollider with mise" section in
   `docs/CLI_QUICKSTART.md` linking to the plugin repo; one paragraph in
   the Homebrew formula header ("If you already use mise, see
   `asdf-hypercollider` — you don't need brew").
6. **Optional, later**: submit the plugin to the
   [mise registry](https://mise.jdx.dev/registry.html) so users can run
   `mise install hypercollider@latest` without the explicit
   `plugin install` step.

## Out of scope

- A native Rust mise plugin (the `mise plugin new` Rust target). The shell
  plugin is enough; Rust adds a build step to a piece of code that is
  mostly `curl | tar` glue.
- Replacing the Homebrew formula. The formula stays the recommended path
  for users on brew; the plugin is purely additive and the two are
  independent.
- Auto-publishing the plugin from the main HyperCollider release
  workflow. Plugin churn is decoupled from engine releases.
- Sharing an on-disk cache between Homebrew and the plugin. Each owns
  its own install root. Users who run both pay the disk twice for any
  version they install twice — acceptable, and avoids the uninstall
  coupling a shared layout would introduce.
- Shipping AOT-compiled modules for every (arch × OS) combination in v1.
  AOT artifacts are an optimization: ship `*-wamr-full` (interpreter +
  WASM) everywhere, add AOT (`*-wamr-aot`) on a per-target basis as
  demand justifies it. The plugin handles a missing `.aot` file by
  omitting the `*-wamr-aot` shim rather than failing install.

## Open questions

- **`SHA256SUMS` file vs. per-asset `.sha256`.** Per-asset is simpler
  for `bin/install` (one fetch per artifact); a combined `SHA256SUMS`
  is friendlier for humans verifying by hand. Recommend per-asset
  sidecars, plus a combined file if cheap.
- **GitHub API rate limits in `list-all`.** Unauthenticated calls are
  60/hr per IP; on a CI runner that's typically fine. If it becomes a
  problem, allow `GITHUB_TOKEN` via env (asdf plugins commonly do).
- **Node version pinning.** Should the plugin's `exec-env` hard-require
  a specific Node major (e.g. 20+)? Recommend: warn-only at install
  time, document the supported range, and let users pin Node themselves
  via `.mise.toml`. Hard-failing on Node version inside `exec-env` is
  fragile (it runs on every shim invocation).
- **Universal macOS binary vs. per-arch.** The WAMR host binary could
  ship as a single `universal` macOS asset to halve release-asset count.
  Cost: a `lipo` step in CI. Recommend: per-arch in v1, revisit if the
  asset count becomes painful.

## Effort estimate

- Release workflow + asset contract (naming + checksum sidecars + docs):
  ~1 day. Larger than turmeric's equivalent because HyperCollider has
  multiple build flavors (WASM, WAMR-full, WAMR-AOT) and no current
  release pipeline to extend.
- Plugin scripts (`list-all`, `install` with prebuilt + gated source-build
  fallback, helpers, optional scripts) + README: ~1 day.
- Plugin CI (matrix + source-build fallback job with cached emsdk):
  ~0.5 day.
- Node CLI wrapper changes to honor `HC_CLASSLIB_DIR` / `HC_LIBEXEC_DIR`:
  ~0.5 day.

Total: ~3 days of focused work, off any critical path. The bulk of the
extra effort over turmeric's plan is on the HyperCollider side (release
workflow), not the plugin side — the plugin itself is the same shape.
