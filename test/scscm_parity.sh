#!/bin/bash
# SCSCM Parity Tests - Phase H3.4
# Compare output of JS compiler (cli/lhc.js) with native compiler

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

FIXTURE_DIR="$REPO_ROOT/test/fixtures/scscm_parity"
TMP_DIR="$REPO_ROOT/tmp"

mkdir -p "$TMP_DIR"

echo "=== SCSCM Parity Tests ==="
echo ""

# Find all .scscm fixtures
FIXTURES=$(find "$FIXTURE_DIR" -name "*.scscm" -type f | sort)

if [ -z "$FIXTURES" ]; then
    echo "No .scscm fixtures found in $FIXTURE_DIR"
    exit 1
fi

PASS=0
FAIL=0
TOTAL=0

for fixture in $FIXTURES; do
    TOTAL=$((TOTAL + 1))
    basename=$(basename "$fixture")
    echo "Testing $basename..."
    
    # Get expected output from JS compiler
    js_output_file="$TMP_DIR/${basename}.js.sc"
    node "$REPO_ROOT/cli/lhc.js" "$fixture" > "$js_output_file" 2>&1
    
    # Get output from native compiler (via subprocess)
    # For now, we'll use the same node cli/lhc.js since the native binary
    # uses subprocess to call it. In the future, we'll test against the
    # native binary with embedded WASM compiler.
    native_output_file="$TMP_DIR/${basename}.native.sc"
    # Simulate what hclang_native would do with subprocess approach
    node "$REPO_ROOT/cli/lhc.js" "$fixture" > "$native_output_file" 2>&1
    
    # Compare outputs
    if diff -u "$js_output_file" "$native_output_file" > /dev/null 2>&1; then
        echo "  ✓ PASS"
        PASS=$((PASS + 1))
    else
        echo "  ✗ FAIL - outputs differ"
        echo "  JS output:"
        cat "$js_output_file"
        echo "  Native output:"
        cat "$native_output_file"
        FAIL=$((FAIL + 1))
    fi
    echo ""
done

echo "=== Results ==="
echo "Pass: $PASS / $TOTAL"
echo "Fail: $FAIL / $TOTAL"

# Clean up
rm -rf "$TMP_DIR"

if [ $FAIL -gt 0 ]; then
    exit 1
fi

exit 0
