#!/usr/bin/env bash
# bench/run_bench.sh — HyperCollider perf benchmark
# Measures wall time and peak RSS for native sclang/scsynth vs. WASM hclang/hcsynth.
#
# Usage:
#   bash bench/run_bench.sh [options]
#
# Options:
#   --phases  <list>   Comma-separated subset of: cold,startup,warm  (default: all)
#   --patches <list>   Comma-separated subset of patch IDs            (default: all)
#   --runs    <n>      Number of measured runs per cell               (default: 10)
#   --warmups <n>      Number of warmup runs discarded before timing  (default: 3)
#   --out-dir <dir>    Directory for results JSON/Markdown            (default: bench/results)
#   --toolchains <l>   Comma-separated: native,wasm,wamr,wamr-full,wamr-aot
#                      (default: auto-detected based on what's built)

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

# ── Defaults ──────────────────────────────────────────────────────────────────
PHASES="cold,startup,warm"
PATCHES="sine,fm,reverb,poly,granular,plugin_heavy"
RUNS=5
WARMUPS=1
OUT_DIR="bench/results"
TOOLCHAINS=""   # auto-detect
LIST_TOOLCHAINS=false

# Port range used to pick a free UDP port for wamr-full hcsynth listener.
WAMR_FULL_BASE_PORT=57140

# ── Arg parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phases)    PHASES="$2";    shift 2 ;;
    --patches)   PATCHES="$2";   shift 2 ;;
    --runs)      RUNS="$2";      shift 2 ;;
    --warmups)   WARMUPS="$2";   shift 2 ;;
    --out-dir)   OUT_DIR="$2";   shift 2 ;;
    --toolchains) TOOLCHAINS="$2"; shift 2 ;;
    --list-toolchains) LIST_TOOLCHAINS=true; shift ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$OUT_DIR"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
JSON_OUT="$OUT_DIR/${TIMESTAMP}.json"
MD_OUT="$OUT_DIR/${TIMESTAMP}.md"

# ── Toolchain detection ────────────────────────────────────────────────────────
HAVE_NATIVE=false
HAVE_WASM=false
HAVE_WAMR_FULL=false
HAVE_WAMR_AOT=false
HAVE_SC3_PLUGINS=false
# Whether the WAMR host binaries + WASI .wasm artefacts exist on disk.
# Used as a prerequisite for both wamr-full and wamr-aot (the synth
# binary, lang binary, and both .wasm files are needed for either row).
WAMR_ARTEFACTS_PRESENT=false

WAMR_SYNTH_BIN="$(pwd)/build/native/hcsynth_host/hcsynth_native"
# Prefer the WASI build of hcsynth.wasm (loadable by WAMR). Fall back to the
# JS-target build under build/wasm so existing benchmarking on stale builds
# still emits rows; WAMR will fail to load that variant cleanly but
# hcsynth_native swallows the warnings.
if [[ -f "$(pwd)/build/wasi/server/hcsynth/hcsynth.wasm" ]]; then
    WAMR_WASM_DIR="$(pwd)/build/wasi/server/hcsynth"
else
    WAMR_WASM_DIR="$(pwd)/build/wasm/server/hcsynth"
fi
WAMR_LANG_BIN="$(pwd)/build/native/hclang_host/hclang_native"
WAMR_LANG_WASM_DIR="$(pwd)/build/wasi/lang/hclang"
WAMR_CLASSLIB_DIR="$(pwd)/src/class_library"

# Always auto-detect what's available on disk. The --toolchains flag is a
# selection filter applied later in the dispatch loop; it must not silence
# the banner's view of what's actually installed.
command -v sclang  &>/dev/null && command -v scsynth &>/dev/null && HAVE_NATIVE=true
[[ -f "build/wasm/lang/hclang/hclang.js" && -f "build/wasm/server/hcsynth/hcsynth.js" ]] && HAVE_WASM=true
# Both wamr-full and wamr-aot need the host binaries + WASI .wasm files.
[[ -f "$WAMR_SYNTH_BIN" && -f "$WAMR_WASM_DIR/hcsynth.wasm" \
   && -f "$WAMR_LANG_BIN" && -f "$WAMR_LANG_WASM_DIR/hclang.wasm" \
   && -d "$WAMR_CLASSLIB_DIR" ]] && WAMR_ARTEFACTS_PRESENT=true
$WAMR_ARTEFACTS_PRESENT && HAVE_WAMR_FULL=true
# wamr-aot needs the AOT-compiled artifacts alongside the .wasm files.
[[ -f "$WAMR_LANG_WASM_DIR/hclang.wasm.aot" \
   && -f "$WAMR_WASM_DIR/hcsynth.wasm.aot" \
   && $WAMR_ARTEFACTS_PRESENT == true ]] && HAVE_WAMR_AOT=true

# Validate --toolchains tokens against the canonical set. A typo (e.g.
# `--toolchains wamr_full`) used to silently run nothing.
if [[ -n "$TOOLCHAINS" ]]; then
  for _tc in ${TOOLCHAINS//,/ }; do
    case "$_tc" in
      native|wasm|wamr-full|wamr-aot) ;;
      *) echo "Unknown toolchain in --toolchains: '$_tc'" >&2
         echo "  Valid: native, wasm, wamr-full, wamr-aot" >&2
         exit 1 ;;
    esac
  done
  unset _tc
fi

# Detect sc3-plugins by checking for plugin files in known extension directories.
# (sclang has no -e flag, so we cannot probe at the language level portably.)
SC3_PLUGIN_DIRS=(
  "$HOME/Library/Application Support/SuperCollider/Extensions/SC3plugins"
  "/usr/local/share/SuperCollider/Extensions/SC3plugins"
  "/usr/share/SuperCollider/Extensions/SC3plugins"
)
for _dir in "${SC3_PLUGIN_DIRS[@]}"; do
  if [[ -d "$_dir" ]]; then
    HAVE_SC3_PLUGINS=true
    break
  fi
done
unset _dir

# Per-toolchain "what's missing and how to fix it" hint. Printed in the
# detection block when a toolchain is absent so users see the actionable
# next step inline rather than digging through plan docs.
toolchain_hint() {
  case "$1" in
    native)    echo "install SuperCollider (e.g. 'brew install supercollider' on macOS)" ;;
    wasm)      echo "run 'just build' to produce build/wasm/.../{hclang,hcsynth}.{js,wasm}" ;;
    wamr-full) echo "run 'just build-wamr-host' (builds WASI .wasm + native hosts)" ;;
    wamr-aot)  echo "run 'just build-wamr-aot' (requires wamrc; see docs/HCLANG_NATIVE_PLAN.md §Phase 8)" ;;
    *)         echo "unknown toolchain: $1" ;;
  esac
}

# Returns 0 if $1 is in the comma-separated $TOOLCHAINS allow-list (or
# TOOLCHAINS is empty, meaning "all selected").
toolchain_is_selected() {
  [[ -z "$TOOLCHAINS" ]] && return 0
  case ",$TOOLCHAINS," in
    *",$1,"*) return 0 ;;
    *)        return 1 ;;
  esac
}

# Render the detection grid with status + hint for missing rows. Used by
# both the normal banner and --list-toolchains. When --toolchains is set,
# annotates which available toolchains are selected for this run.
print_toolchain_grid() {
  local fmt="  %-10s : %-9s%s\n"
  local status hint suffix
  for tc in native wasm wamr-full wamr-aot; do
    case "$tc" in
      native)    $HAVE_NATIVE    && status=ok || status=missing ;;
      wasm)      $HAVE_WASM      && status=ok || status=missing ;;
      wamr-full) $HAVE_WAMR_FULL && status=ok || status=missing ;;
      wamr-aot)  $HAVE_WAMR_AOT  && status=ok || status=missing ;;
    esac
    suffix=""
    if [[ "$status" == "missing" ]]; then
      suffix=" — $(toolchain_hint "$tc")"
    elif [[ -n "$TOOLCHAINS" ]]; then
      if toolchain_is_selected "$tc"; then
        suffix=" — selected"
      else
        suffix=" — skipped (not in --toolchains)"
      fi
    fi
    printf "$fmt" "$tc" "$status" "$suffix"
  done
  printf "$fmt" "sc3plugins" "$($HAVE_SC3_PLUGINS && echo ok || echo missing)" ""
}

if $LIST_TOOLCHAINS; then
  echo "=== HyperCollider Benchmark — toolchain detection ==="
  print_toolchain_grid
  exit 0
fi

echo "=== HyperCollider Benchmark ==="
echo "  Timestamp : $TIMESTAMP"
echo "  Phases    : $PHASES"
echo "  Patches   : $PATCHES"
echo "  Runs      : $RUNS (+ $WARMUPS warmup)"
print_toolchain_grid
echo ""
echo "  Tip: scope to one toolchain with --toolchains <t> (or 'just bench-wamr-full',"
echo "       'just bench-quick'); pass --list-toolchains to print this grid and exit."
echo ""

if ! $HAVE_NATIVE && ! $HAVE_WASM && ! $HAVE_WAMR_FULL && ! $HAVE_WAMR_AOT; then
  echo "ERROR: no toolchain found (sclang/scsynth, WASM artifacts, or WAMR host)." >&2
  echo "  Build WASM+WAMR: just build-all" >&2
  echo "  Install SC: brew install supercollider  (macOS)" >&2
  exit 1
fi

# ── Portable millisecond clock ────────────────────────────────────────────────
# `date +%s%3N` is Linux/GNU-only; macOS BSD date emits a literal "N", breaking
# arithmetic. Use Node.js (already required) for a portable ms timestamp.
ms_now() { node -e 'process.stdout.write(String(Date.now()))'; }

# ── Time/RSS helper ────────────────────────────────────────────────────────────
# Returns "<wall_ms> <rss_kb>" on stdout.
# Uses GNU time (gtime on macOS, /usr/bin/time on Linux) for RSS.
if command -v gtime &>/dev/null; then
  TIME_CMD="gtime"
elif /usr/bin/time --version 2>&1 | grep -q GNU; then
  TIME_CMD="/usr/bin/time"
else
  # BSD time — no RSS support; fallback to wall-only with RSS=0
  TIME_CMD=""
fi

measure_cmd() {
  # $@ = command to run
  # Prints "<wall_ms> <peak_rss_kb>" to stdout; command stdout/stderr goes to /dev/null
  local t0 t1 wall_ms rss_kb tmp
  tmp=$(mktemp)
  t0=$(ms_now)
  if [[ -n "$TIME_CMD" ]]; then
    "$TIME_CMD" -f "%M" -o "$tmp" -- "$@" &>/dev/null
    t1=$(ms_now)
    rss_kb=$(cat "$tmp" 2>/dev/null || echo 0)
  else
    "$@" &>/dev/null
    t1=$(ms_now)
    rss_kb=0
  fi
  wall_ms=$(( t1 - t0 ))
  rm -f "$tmp"
  echo "$wall_ms $rss_kb"
}

# measure_cmd_with_stderr: like measure_cmd but captures stderr for parsing
measure_cmd_stderr() {
  local tmp_time tmp_stderr t0 t1 wall_ms rss_kb
  tmp_time=$(mktemp)
  tmp_stderr=$(mktemp)
  t0=$(ms_now)
  if [[ -n "$TIME_CMD" ]]; then
    "$TIME_CMD" -f "%M" -o "$tmp_time" -- "$@" 2>"$tmp_stderr" >/dev/null
    t1=$(ms_now)
    rss_kb=$(cat "$tmp_time" 2>/dev/null || echo 0)
  else
    "$@" 2>"$tmp_stderr" >/dev/null
    t1=$(ms_now)
    rss_kb=0
  fi
  wall_ms=$(( t1 - t0 ))
  rm -f "$tmp_time"
  # Print wall_ms rss_kb, then the captured stderr on subsequent lines
  echo "$wall_ms $rss_kb"
  cat "$tmp_stderr"
  rm -f "$tmp_stderr"
}

# ── JSON builder (pure bash — no jq dependency) ───────────────────────────────
RESULTS_JSON=""

append_result() {
  # Appends a JSON object fragment to RESULTS_JSON.
  # Call with key=value pairs; string values should be pre-quoted.
  local kv obj="{" sep=""
  for kv in "$@"; do
    obj="${obj}${sep}${kv}"
    sep=","
  done
  obj="${obj}}"
  if [[ -z "$RESULTS_JSON" ]]; then
    RESULTS_JSON="$obj"
  else
    RESULTS_JSON="${RESULTS_JSON},${obj}"
  fi
}

jstr() { echo "\"$1\""; }   # wrap in JSON double-quotes (no escaping needed for our values)

# ── Validation helpers ─────────────────────────────────────────────────────────
# Validate that a patch produced its expected output marker (Phase 12.4a).
# Each bench patch ends with "BENCH_PATCH_<name>: OK".postln; for sanity
# verification. plugin_heavy is skipped on WAMR (no sc3-plugins in WASI),
# so validation is not required for it.
_validate_patch_execution() {
  local patch="$1" log="$2"
  # plugin_heavy is skipped on WAMR builds — no validation needed
  [[ "$patch" == "plugin_heavy" ]] && return 0

  local expected_marker="BENCH_PATCH_${patch}: OK"
  if grep -q "$expected_marker" <<<"$log"; then
    return 0  # Validation passed
  else
    echo "WARNING: Patch '$patch' did not produce expected output marker: $expected_marker" >&2
    return 1
  fi
}

# ── Phase helpers ──────────────────────────────────────────────────────────────

run_cold_wasm() {
  local patch="$1" run="$2" warmup="$3"
  local tmp_wav tmp_stderr tmp_time
  tmp_wav=$(mktemp /tmp/bench_wasm_XXXXXX)
  tmp_time=$(mktemp)
  tmp_stderr=$(mktemp)

  local t0 t1 wall_ms rss_kb compile_ms
  t0=$(ms_now)
  if [[ -n "$TIME_CMD" ]]; then
    "$TIME_CMD" -f "%M" -o "$tmp_time" -- \
      node cli/hc.js \
        --script "bench/patches/${patch}.scd" \
        --output "$tmp_wav" \
        --duration 5 \
        --sample-rate 48000 \
        --channels 2 \
        --bit-depth 16 \
        --print-timing \
        2>"$tmp_stderr" >/dev/null
    rss_kb=$(cat "$tmp_time" 2>/dev/null || echo 0)
  else
    node cli/hc.js \
      --script "bench/patches/${patch}.scd" \
      --output "$tmp_wav" \
      --duration 5 \
      --sample-rate 48000 \
      --channels 2 \
      --bit-depth 16 \
      --print-timing \
      2>"$tmp_stderr" >/dev/null
    rss_kb=0
  fi
  t1=$(ms_now)
  wall_ms=$(( t1 - t0 ))

  compile_ms=$(grep 'compile_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  local synth_ms module_ms boot_ms eval_ms
  synth_ms=$(grep 'synth_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  module_ms=$(grep 'hclang_module_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  boot_ms=$(grep 'hclang_boot_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  eval_ms=$(grep 'hclang_eval_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  local shutdown_ms passone_ms deptree_ms succeeded_ms initruntime_ms startup_ms
  shutdown_ms=$(grep 'hclang_shutdown_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  passone_ms=$(grep 'hclang_passone_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  deptree_ms=$(grep 'hclang_deptree_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  succeeded_ms=$(grep 'hclang_succeeded_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  initruntime_ms=$(grep 'hclang_initruntime_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  startup_ms=$(grep 'hclang_startup_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  local output_bytes=0
  [[ -f "$tmp_wav" ]] && output_bytes=$(wc -c < "$tmp_wav")
  rm -f "$tmp_time" "$tmp_stderr" "$tmp_wav"

  append_result \
    "\"phase\":\"cold\""                        \
    "\"patch\":$(jstr "$patch")"                \
    "\"toolchain\":\"wasm\""                    \
    "\"run\":$run"                              \
    "\"warmup\":$warmup"                        \
    "\"wall_total_ms\":$wall_ms"                \
    "\"wall_compile_ms\":$compile_ms"           \
    "\"wall_synth_ms\":$synth_ms"               \
    "\"wall_module_ms\":$module_ms"             \
    "\"wall_boot_ms\":$boot_ms"                 \
    "\"wall_eval_ms\":$eval_ms"                 \
    "\"wall_shutdown_ms\":$shutdown_ms"         \
    "\"wall_passone_ms\":$passone_ms"           \
    "\"wall_deptree_ms\":$deptree_ms"           \
    "\"wall_succeeded_ms\":$succeeded_ms"       \
    "\"wall_initruntime_ms\":$initruntime_ms"   \
    "\"wall_startup_ms\":$startup_ms"           \
    "\"peak_rss_kb\":$rss_kb"                   \
    "\"output_bytes\":$output_bytes"
}

run_cold_native() {
  local patch="$1" run="$2" warmup="$3"
  local tmp_osc tmp_wav
  tmp_osc=$(mktemp /tmp/bench_native_XXXXXX)
  tmp_wav=$(mktemp /tmp/bench_native_XXXXXX)

  local t0 t1 wall_ms rss_kb compile_ms synth_ms
  t0=$(ms_now)
  sclang -i sc_ide -l /dev/null bench/harness_native.scd \
    "bench/patches/${patch}.scd" "$tmp_osc" "$tmp_wav" \
    </dev/null &>/dev/null || true
  local t_mid
  t_mid=$(ms_now)
  compile_ms=$(( t_mid - t0 ))

  scsynth -N "$tmp_osc" _ "$tmp_wav" 48000 WAVE int16 2 </dev/null &>/dev/null || true
  t1=$(ms_now)
  wall_ms=$(( t1 - t0 ))
  synth_ms=$(( t1 - t_mid ))
  rss_kb=0  # TODO: capture with TIME_CMD if needed

  local output_bytes=0
  [[ -f "$tmp_wav" ]] && output_bytes=$(wc -c < "$tmp_wav")
  rm -f "$tmp_osc" "$tmp_wav"

  append_result \
    "\"phase\":\"cold\""              \
    "\"patch\":$(jstr "$patch")"      \
    "\"toolchain\":\"native\""        \
    "\"run\":$run"                    \
    "\"warmup\":$warmup"              \
    "\"wall_total_ms\":$wall_ms"      \
    "\"wall_compile_ms\":$compile_ms" \
    "\"wall_synth_ms\":$synth_ms"     \
    "\"peak_rss_kb\":$rss_kb"         \
    "\"output_bytes\":$output_bytes"
}

run_startup_wasm() {
  local run="$1" warmup="$2"
  local tmp_stdout
  tmp_stdout=$(mktemp)

  local t0 t1 wall_ms
  t0=$(ms_now)
  node cli/hclang.js --print-ready >"$tmp_stdout" 2>/dev/null || true
  t1=$(ms_now)
  wall_ms=$(( t1 - t0 ))
  rm -f "$tmp_stdout"

  append_result \
    "\"phase\":\"startup\""               \
    "\"patch\":null"                      \
    "\"toolchain\":\"wasm\""              \
    "\"run\":$run"                        \
    "\"warmup\":$warmup"                  \
    "\"wall_lang_startup_ms\":$wall_ms"   \
    "\"peak_rss_kb\":0"
}

run_startup_native() {
  local run="$1" warmup="$2"
  local t0 t1 wall_ms
  t0=$(ms_now)
  sclang -e "nil.postln; 0.exit" </dev/null &>/dev/null || true
  t1=$(ms_now)
  wall_ms=$(( t1 - t0 ))

  append_result \
    "\"phase\":\"startup\""               \
    "\"patch\":null"                      \
    "\"toolchain\":\"native\""            \
    "\"run\":$run"                        \
    "\"warmup\":$warmup"                  \
    "\"wall_lang_startup_ms\":$wall_ms"   \
    "\"peak_rss_kb\":0"
}

run_warm_wasm() {
  local patch="$1" run="$2" warmup="$3"
  local tmp_wav tmp_stderr tmp_time
  tmp_wav=$(mktemp /tmp/bench_wasm_warm_XXXXXX)
  tmp_time=$(mktemp)
  tmp_stderr=$(mktemp)

  local t0 t1 wall_ms rss_kb compile_ms
  t0=$(ms_now)
  if [[ -n "$TIME_CMD" ]]; then
    "$TIME_CMD" -f "%M" -o "$tmp_time" -- \
      node cli/hc.js \
        --script "bench/patches/${patch}.scd" \
        --output "$tmp_wav" \
        --duration 5 \
        --sample-rate 48000 \
        --channels 2 \
        --bit-depth 16 \
        --print-timing \
        2>"$tmp_stderr" >/dev/null
    rss_kb=$(cat "$tmp_time" 2>/dev/null || echo 0)
  else
    node cli/hc.js \
      --script "bench/patches/${patch}.scd" \
      --output "$tmp_wav" \
      --duration 5 \
      --sample-rate 48000 \
      --channels 2 \
      --bit-depth 16 \
      --print-timing \
      2>"$tmp_stderr" >/dev/null
    rss_kb=0
  fi
  t1=$(ms_now)
  wall_ms=$(( t1 - t0 ))

  compile_ms=$(grep 'compile_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  local synth_ms module_ms boot_ms eval_ms
  synth_ms=$(grep 'synth_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  [[ "$synth_ms" -eq 0 ]] && synth_ms=$(( wall_ms - compile_ms ))
  module_ms=$(grep 'hclang_module_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  boot_ms=$(grep 'hclang_boot_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  eval_ms=$(grep 'hclang_eval_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  local shutdown_ms passone_ms deptree_ms succeeded_ms initruntime_ms startup_ms
  shutdown_ms=$(grep 'hclang_shutdown_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  passone_ms=$(grep 'hclang_passone_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  deptree_ms=$(grep 'hclang_deptree_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  succeeded_ms=$(grep 'hclang_succeeded_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  initruntime_ms=$(grep 'hclang_initruntime_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  startup_ms=$(grep 'hclang_startup_ms:' "$tmp_stderr" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)
  rm -f "$tmp_time" "$tmp_stderr" "$tmp_wav"

  append_result \
    "\"phase\":\"warm\""                        \
    "\"patch\":$(jstr "$patch")"                \
    "\"toolchain\":\"wasm\""                    \
    "\"run\":$run"                              \
    "\"warmup\":$warmup"                        \
    "\"wall_total_ms\":$wall_ms"                \
    "\"wall_compile_ms\":$compile_ms"           \
    "\"wall_synth_ms\":$synth_ms"               \
    "\"wall_module_ms\":$module_ms"             \
    "\"wall_boot_ms\":$boot_ms"                 \
    "\"wall_eval_ms\":$eval_ms"                 \
    "\"wall_shutdown_ms\":$shutdown_ms"         \
    "\"wall_passone_ms\":$passone_ms"           \
    "\"wall_deptree_ms\":$deptree_ms"           \
    "\"wall_succeeded_ms\":$succeeded_ms"       \
    "\"wall_initruntime_ms\":$initruntime_ms"   \
    "\"wall_startup_ms\":$startup_ms"           \
    "\"peak_rss_kb\":$rss_kb"
}

run_warm_native() {
  local patch="$1" run="$2" warmup="$3"
  local tmp_osc tmp_wav
  tmp_osc=$(mktemp /tmp/bench_native_warm_XXXXXX)
  tmp_wav=$(mktemp /tmp/bench_native_warm_XXXXXX)

  local t0 t_mid t1 wall_ms compile_ms synth_ms
  t0=$(ms_now)
  sclang -i sc_ide -l /dev/null bench/harness_native.scd \
    "bench/patches/${patch}.scd" "$tmp_osc" "$tmp_wav" \
    </dev/null &>/dev/null || true
  t_mid=$(ms_now)
  compile_ms=$(( t_mid - t0 ))

  scsynth -N "$tmp_osc" _ "$tmp_wav" 48000 WAVE int16 2 </dev/null &>/dev/null || true
  t1=$(ms_now)
  synth_ms=$(( t1 - t_mid ))
  wall_ms=$(( t1 - t0 ))
  rm -f "$tmp_osc" "$tmp_wav"

  append_result \
    "\"phase\":\"warm\""              \
    "\"patch\":$(jstr "$patch")"      \
    "\"toolchain\":\"native\""        \
    "\"run\":$run"                    \
    "\"warmup\":$warmup"              \
    "\"wall_total_ms\":$wall_ms"      \
    "\"wall_compile_ms\":$compile_ms" \
    "\"wall_synth_ms\":$synth_ms"     \
    "\"peak_rss_kb\":0"
}

# Note: a synth-only `wamr` toolchain previously rendered hcsynth_native
# without any synthdef loaded — it produced silence by design and was
# removed (Phase 12.2c). The synth-side wall time is still reported as
# `wall_synth_ms` inside each `wamr-full` row, where it has a real
# synthdef + /s_new in flight.

# ── wamr-full helpers ─────────────────────────────────────────────────────────
# Two-process pipeline: hcsynth_native runs in the background listening for
# OSC on a temp UDP port; hclang_native runs the patch and forwards OSC to
# that port. hcsynth's offline render is faster than realtime (~50ms wall
# clock for 5s of audio), so the synth uses --wait-for-osc-ms to delay
# rendering until after the language host has finished booting (~4 s).
# wall_compile_ms = lang side wall time, wall_synth_ms = synth side wall
# time, wall_total_ms = max of the two (they overlap).

_wamr_full_pick_port() {
  # Increment WAMR_FULL_BASE_PORT each call so successive runs don't collide
  # with sockets stuck in TIME_WAIT.
  WAMR_FULL_BASE_PORT=$(( WAMR_FULL_BASE_PORT + 1 ))
  echo $WAMR_FULL_BASE_PORT
}

# Internal: one cold-or-warm wamr-full run. Sets RES_WALL/RES_COMPILE/RES_SYNTH.
# Uses bench/patches/wamr_full/<patch>.scd if it exists (those send raw
# /d_recv + /s_new bundles, bypassing Server.default boot which isn't
# wired in the wamr-full pipeline). Falls back to bench/patches/<patch>.scd
# otherwise — the patch will run but won't generate audio.
_wamr_full_run_pipeline() {
  local patch="$1" tmp_wav="$2"
  # Phase 12.4b: --no-server-boot fakes Server.default into a booted state
  # so the stock bench/patches/<patch>.scd files (which use `{...}.play`)
  # work directly. The earlier bench/patches/wamr_full/<patch>.scd
  # parallel directory of raw /d_recv + /s_new patches is no longer
  # needed but kept in the repo as a fallback for the no-shim path.
  local patch_path="$(pwd)/bench/patches/${patch}.scd"
  if [[ ! -f "$patch_path" ]]; then
    patch_path="$(pwd)/bench/patches/wamr_full/${patch}.scd"
  fi
  local port
  port=$(_wamr_full_pick_port)
  local synth_log lang_log synth_rss_tmp lang_rss_tmp
  synth_log=$(mktemp)
  lang_log=$(mktemp)
  synth_rss_tmp=$(mktemp)
  lang_rss_tmp=$(mktemp)

  # Start hcsynth in background — listens on $port, waits up to 8 s for the
  # first OSC packet, then renders 5 s. Wrapped in $TIME_CMD when available
  # so we capture peak RSS into $synth_rss_tmp; bash -c is the wrapper of
  # choice because gtime needs a single command and we have a `cd && ...`
  # form on the inside.
  #
  # BENCH_BLOCK_SIZE: optional env var to override the synth block size for
  # P7.5 sensitivity sweeps (docs/WAMR_PERF_PARITY_PLAN.md). Default is
  # whatever hcsynth_native picks (currently 512). Examples:
  #   BENCH_BLOCK_SIZE=64  just bench --toolchains wamr-full
  #   BENCH_BLOCK_SIZE=1024 just bench --toolchains wamr-aot
  local synth_block_arg=""
  if [[ -n "${BENCH_BLOCK_SIZE:-}" ]]; then
    synth_block_arg="--block-size ${BENCH_BLOCK_SIZE}"
  fi
  local t0 t_synth_start t_lang_end t1
  t0=$(ms_now)
  if [[ -n "$TIME_CMD" ]]; then
    ( "$TIME_CMD" -f "%M" -o "$synth_rss_tmp" -- \
        bash -c "cd '$WAMR_WASM_DIR' && '$WAMR_SYNTH_BIN' \
          --output '$tmp_wav' --duration 5 --sample-rate 48000 --channels 2 \
          --udp-port '$port' --wait-for-osc-ms 8000 $synth_block_arg" ) \
      >"$synth_log" 2>&1 &
  else
    ( cd "$WAMR_WASM_DIR" && "$WAMR_SYNTH_BIN" \
        --output "$tmp_wav" --duration 5 --sample-rate 48000 --channels 2 \
        --udp-port "$port" --wait-for-osc-ms 8000 $synth_block_arg ) \
      >"$synth_log" 2>&1 &
  fi
  local synth_pid=$!
  # Brief grace so the listener is bound before lang sends its first packet.
  sleep 0.1
  t_synth_start=$(ms_now)

  # Run hclang in foreground — boots class library, evaluates patch, sends
  # OSC. --no-server-boot makes Server.default look already-booted so
  # stock SC patches using `{...}.play` work without the /done /notify
  # handshake we don't implement on the synth side. It exits as soon
  # as the script returns.
  if [[ -n "$TIME_CMD" ]]; then
    "$TIME_CMD" -f "%M" -o "$lang_rss_tmp" -- \
      bash -c "cd '$WAMR_LANG_WASM_DIR' && '$WAMR_LANG_BIN' \
        --classlib-dir '$WAMR_CLASSLIB_DIR' \
        --scsynth-host 127.0.0.1 --scsynth-port '$port' \
        --no-server-boot \
        --script '$patch_path'" \
      >"$lang_log" 2>&1 || true
  else
    ( cd "$WAMR_LANG_WASM_DIR" && "$WAMR_LANG_BIN" \
        --classlib-dir "$WAMR_CLASSLIB_DIR" \
        --scsynth-host 127.0.0.1 --scsynth-port "$port" \
        --no-server-boot \
        --script "$patch_path" ) \
      >"$lang_log" 2>&1 || true
  fi
  t_lang_end=$(ms_now)

  # Wait for synth render to complete.
  wait "$synth_pid" 2>/dev/null || true
  t1=$(ms_now)

  RES_WALL=$(( t1 - t0 ))
  RES_COMPILE=$(( t_lang_end - t_synth_start ))
  RES_SYNTH=$(( t1 - t_synth_start ))
  RES_RSS_LANG=$(cat "$lang_rss_tmp" 2>/dev/null | tr -dc 0-9)
  RES_RSS_SYNTH=$(cat "$synth_rss_tmp" 2>/dev/null | tr -dc 0-9)
  : "${RES_RSS_LANG:=0}"
  : "${RES_RSS_SYNTH:=0}"

  # Capture lang output for sanity checks (Phase 12.4a)
  RES_LANG_LOG=$(cat "$lang_log" 2>/dev/null || true)

  rm -f "$synth_log" "$lang_log" "$synth_rss_tmp" "$lang_rss_tmp"
}

run_cold_wamr_full() {
  local patch="$1" run="$2" warmup="$3" toolchain="${4:-wamr-full}"
  local tmp_wav
  tmp_wav=$(mktemp /tmp/bench_wamrfull_XXXXXX)

  _wamr_full_run_pipeline "$patch" "$tmp_wav"

  # Validate patch execution (Phase 12.4a)
  _validate_patch_execution "$patch" "$RES_LANG_LOG"

  local output_bytes=0
  [[ -f "$tmp_wav" ]] && output_bytes=$(wc -c < "$tmp_wav")
  rm -f "$tmp_wav"

  append_result \
    "\"phase\":\"cold\""                       \
    "\"patch\":$(jstr "$patch")"               \
    "\"toolchain\":$(jstr "$toolchain")"       \
    "\"run\":$run"                             \
    "\"warmup\":$warmup"                       \
    "\"wall_total_ms\":$RES_WALL"              \
    "\"wall_compile_ms\":$RES_COMPILE"         \
    "\"wall_synth_ms\":$RES_SYNTH"             \
    "\"peak_rss_lang_kb\":$RES_RSS_LANG"       \
    "\"peak_rss_synth_kb\":$RES_RSS_SYNTH"     \
    "\"output_bytes\":$output_bytes"
}

run_startup_wamr_full() {
  local run="$1" warmup="$2" toolchain="${3:-wamr-full}"
  local tmp_wav rss_tmp
  tmp_wav=$(mktemp /tmp/bench_wamrfull_startup_XXXXXX)
  rss_tmp=$(mktemp)

  local t0 t1 wall_ms rss_kb
  t0=$(ms_now)
  # Lang-side boot only — no patch, just initialise and exit. We use a
  # one-line "no-op" script so hclang doesn't read stdin or open a REPL.
  local empty_script
  empty_script=$(mktemp /tmp/bench_wamrfull_empty_XXXXXX)
  echo '0;' > "$empty_script"
  if [[ -n "$TIME_CMD" ]]; then
    "$TIME_CMD" -f "%M" -o "$rss_tmp" -- \
      bash -c "cd '$WAMR_LANG_WASM_DIR' && '$WAMR_LANG_BIN' \
        --classlib-dir '$WAMR_CLASSLIB_DIR' \
        --script '$empty_script'" &>/dev/null || true
  else
    (cd "$WAMR_LANG_WASM_DIR" && "$WAMR_LANG_BIN" \
        --classlib-dir "$WAMR_CLASSLIB_DIR" \
        --script "$empty_script") &>/dev/null || true
  fi
  t1=$(ms_now)
  wall_ms=$(( t1 - t0 ))
  rss_kb=$(cat "$rss_tmp" 2>/dev/null | tr -dc 0-9)
  : "${rss_kb:=0}"
  rm -f "$tmp_wav" "$empty_script" "$rss_tmp"

  append_result \
    "\"phase\":\"startup\""                  \
    "\"patch\":null"                         \
    "\"toolchain\":$(jstr "$toolchain")"     \
    "\"run\":$run"                           \
    "\"warmup\":$warmup"                     \
    "\"wall_lang_startup_ms\":$wall_ms"      \
    "\"peak_rss_lang_kb\":$rss_kb"           \
    "\"peak_rss_synth_kb\":0"
}

run_warm_wamr_full() {
  # Warm = same shape as cold for now; each launch re-instantiates both
  # WASM modules so there's no shared persistent state between invocations.
  local patch="$1" run="$2" warmup="$3" toolchain="${4:-wamr-full}"
  local tmp_wav
  tmp_wav=$(mktemp /tmp/bench_wamrfull_warm_XXXXXX)

  _wamr_full_run_pipeline "$patch" "$tmp_wav"

  # Validate patch execution (Phase 12.4a)
  _validate_patch_execution "$patch" "$RES_LANG_LOG"

  local output_bytes=0
  [[ -f "$tmp_wav" ]] && output_bytes=$(wc -c < "$tmp_wav")
  rm -f "$tmp_wav"

  append_result \
    "\"phase\":\"warm\""                       \
    "\"patch\":$(jstr "$patch")"               \
    "\"toolchain\":$(jstr "$toolchain")"       \
    "\"run\":$run"                             \
    "\"warmup\":$warmup"                       \
    "\"wall_total_ms\":$RES_WALL"              \
    "\"wall_compile_ms\":$RES_COMPILE"         \
    "\"wall_synth_ms\":$RES_SYNTH"             \
    "\"peak_rss_lang_kb\":$RES_RSS_LANG"       \
    "\"peak_rss_synth_kb\":$RES_RSS_SYNTH"     \
    "\"output_bytes\":$output_bytes"
}

# wamr-aot wraps wamr-full: install .aot symlinks so the host binaries pick
# them up via their fopen("hclang.aot", "rb") probe, set HC_WASM_FROM_DISK=1
# so the host actually takes that probe (the embedded blob path otherwise
# wins), run the pipeline, then clean up.
_wamr_aot_install_links() {
  ln -sf "$WAMR_LANG_WASM_DIR/hclang.wasm.aot" "$WAMR_LANG_WASM_DIR/hclang.aot"
  ln -sf "$WAMR_WASM_DIR/hcsynth.wasm.aot"     "$WAMR_WASM_DIR/hcsynth.aot"
  export HC_WASM_FROM_DISK=1
}
_wamr_aot_remove_links() {
  rm -f "$WAMR_LANG_WASM_DIR/hclang.aot" "$WAMR_WASM_DIR/hcsynth.aot"
  unset HC_WASM_FROM_DISK
}

run_cold_wamr_aot() {
  _wamr_aot_install_links
  run_cold_wamr_full "$1" "$2" "$3" wamr-aot
  _wamr_aot_remove_links
}
run_startup_wamr_aot() {
  _wamr_aot_install_links
  run_startup_wamr_full "$1" "$2" wamr-aot
  _wamr_aot_remove_links
}
run_warm_wamr_aot() {
  _wamr_aot_install_links
  run_warm_wamr_full "$1" "$2" "$3" wamr-aot
  _wamr_aot_remove_links
}

# ── Main measurement loop ─────────────────────────────────────────────────────

TOTAL_CELLS=0
DONE_CELLS=0

# First patch in list — startup phase runs only once per toolchain (it is patch-independent)
FIRST_PATCH="${PATCHES%%,*}"

# Count total cells for progress reporting
for phase in ${PHASES//,/ }; do
  for patch in ${PATCHES//,/ }; do
    [[ "$phase" == "startup" && "$patch" != "$FIRST_PATCH" ]] && continue
    [[ "$patch" == "plugin_heavy" ]] && ! $HAVE_SC3_PLUGINS && continue
    for tc in native wasm wamr-full wamr-aot; do
      [[ "$tc" == "native" ]]    && ! $HAVE_NATIVE    && continue
      [[ "$tc" == "wasm"   ]]    && ! $HAVE_WASM      && continue
      [[ "$tc" == "wamr-full" ]] && ! $HAVE_WAMR_FULL && continue
      [[ "$tc" == "wamr-aot" ]]  && ! $HAVE_WAMR_AOT  && continue
      # When --toolchains is set, only run the listed ones.
      if [[ -n "$TOOLCHAINS" ]]; then
        case ",$TOOLCHAINS," in
          *",$tc,"*) ;;
          *) continue ;;
        esac
      fi
      # Match the per-cell skip: plugin_heavy can't run under wamr* (no sc3-plugins).
      if [[ "$patch" == "plugin_heavy" ]]; then
        case "$tc" in wamr-full|wamr-aot) continue ;; esac
      fi
      TOTAL_CELLS=$(( TOTAL_CELLS + 1 ))
    done
  done
done

for phase in ${PHASES//,/ }; do
  for patch in ${PATCHES//,/ }; do
    # Startup is patch-independent — run once per toolchain only
    [[ "$phase" == "startup" && "$patch" != "$FIRST_PATCH" ]] && continue
    # Skip plugin_heavy when sc3-plugins are absent
    if [[ "$patch" == "plugin_heavy" ]] && ! $HAVE_SC3_PLUGINS; then
      echo "  [skip] plugin_heavy (sc3-plugins not detected)"
      continue
    fi

    for tc in native wasm wamr-full wamr-aot; do
      # Skip toolchains not available
      [[ "$tc" == "native" ]]    && ! $HAVE_NATIVE    && continue
      [[ "$tc" == "wasm"   ]]    && ! $HAVE_WASM      && continue
      [[ "$tc" == "wamr-full" ]] && ! $HAVE_WAMR_FULL && continue
      [[ "$tc" == "wamr-aot" ]]  && ! $HAVE_WAMR_AOT  && continue
      # Skip toolchain if user restricted via --toolchains.
      if [[ -n "$TOOLCHAINS" ]]; then
        case ",$TOOLCHAINS," in
          *",$tc,"*) ;;
          *) continue ;;
        esac
      fi

      # plugin_heavy uses sc3-plugins UGens. The WASI build of hcsynth
      # doesn't link sc3-plugins, so wamr-full/wamr-aot can't run this
      # patch — they'd fail to load the synthdef and render silence.
      # Skip explicitly so the row doesn't lie.
      if [[ "$patch" == "plugin_heavy" ]]; then
        case "$tc" in
          wamr-full|wamr-aot)
            echo "  [skip] plugin_heavy on $tc (sc3-plugins not in WASI build)"
            continue
            ;;
        esac
      fi

      DONE_CELLS=$(( DONE_CELLS + 1 ))
      printf "  [%d/%d] phase=%-8s patch=%-14s tc=%s\n" \
        "$DONE_CELLS" "$TOTAL_CELLS" "$phase" "$patch" "$tc"

      total_runs=$(( WARMUPS + RUNS ))
      cell_t0=$(ms_now)
      run_times=()
      for run in $(seq 1 $total_runs); do
        warmup_flag="false"
        [[ $run -le $WARMUPS ]] && warmup_flag="true"
        run_measured=$(( run - WARMUPS ))
        [[ $run_measured -lt 1 ]] && run_measured=$run

        run_t0=$(ms_now)
        case "${phase}:${tc}" in
          cold:wasm)         run_cold_wasm         "$patch" "$run_measured" "$warmup_flag" ;;
          cold:native)       run_cold_native       "$patch" "$run_measured" "$warmup_flag" ;;
          cold:wamr-full)    run_cold_wamr_full    "$patch" "$run_measured" "$warmup_flag" ;;
          cold:wamr-aot)     run_cold_wamr_aot     "$patch" "$run_measured" "$warmup_flag" ;;
          startup:wasm)      run_startup_wasm              "$run_measured" "$warmup_flag" ;;
          startup:native)    run_startup_native            "$run_measured" "$warmup_flag" ;;
          startup:wamr-full) run_startup_wamr_full         "$run_measured" "$warmup_flag" ;;
          startup:wamr-aot)  run_startup_wamr_aot          "$run_measured" "$warmup_flag" ;;
          warm:wasm)         run_warm_wasm         "$patch" "$run_measured" "$warmup_flag" ;;
          warm:native)       run_warm_native       "$patch" "$run_measured" "$warmup_flag" ;;
          warm:wamr-full)    run_warm_wamr_full    "$patch" "$run_measured" "$warmup_flag" ;;
          warm:wamr-aot)     run_warm_wamr_aot     "$patch" "$run_measured" "$warmup_flag" ;;
        esac
        run_t1=$(ms_now)
        run_elapsed=$(( run_t1 - run_t0 ))
        if [[ "$warmup_flag" == "true" ]]; then
          run_times+=( "${run_elapsed}w" )
        else
          run_times+=( "$run_elapsed" )
        fi
      done
      cell_elapsed=$(( $(ms_now) - cell_t0 ))
      printf "         runs (ms): %s — total %d.%01ds\n" \
        "${run_times[*]}" $(( cell_elapsed / 1000 )) $(( (cell_elapsed % 1000) / 100 ))
    done
  done
done

# ── Emit JSON ─────────────────────────────────────────────────────────────────
NODE_VER=$(node --version 2>/dev/null || echo "n/a")
SCLANG_VER="n/a"
$HAVE_NATIVE && SCLANG_VER=$(sclang --version 2>&1 | head -1 || echo "n/a")
PLATFORM=$(uname -sm)

cat > "$JSON_OUT" <<EOF
{
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "system": {
    "node": "$NODE_VER",
    "sclang": "$SCLANG_VER",
    "platform": "$PLATFORM",
    "have_native": $HAVE_NATIVE,
    "have_wasm": $HAVE_WASM,
    "have_wamr_full": $HAVE_WAMR_FULL,
    "have_wamr_aot": $HAVE_WAMR_AOT,
    "have_sc3_plugins": $HAVE_SC3_PLUGINS
  },
  "config": {
    "phases": "$PHASES",
    "patches": "$PATCHES",
    "measured_runs": $RUNS,
    "warmup_runs": $WARMUPS
  },
  "results": [
    $RESULTS_JSON
  ]
}
EOF

echo ""
echo "Results written to:"
echo "  $JSON_OUT"

# ── Emit Markdown summary ─────────────────────────────────────────────────────
# Header is written here; the body (Startup / Cold / Warm tables) is produced
# by `bench/summarize.js --md` and appended below. The summariser emits its
# own `# Benchmark Summary` title + system line which would duplicate the
# header above, so we strip everything before the first `## ` section heading.
cat > "$MD_OUT" <<MDEOF
# Benchmark Results — $TIMESTAMP

**System:** $PLATFORM | node $NODE_VER | sclang $SCLANG_VER

Raw data: \`$JSON_OUT\`

MDEOF

if ! node bench/summarize.js --md "$JSON_OUT" \
      | awk '/^## / {p=1} p' >> "$MD_OUT"; then
  echo "  warning: summarize.js failed; markdown contains header only" >&2
fi

echo "  $MD_OUT"
echo ""
echo "Done."
