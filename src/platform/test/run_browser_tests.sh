#!/bin/bash
# run_browser_tests.sh - Run WASM SuperCollider cross-browser tests
# Usage: ./run_browser_tests.sh [browser]
#   browser: chrome | firefox | safari | edge | all

SC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_DIR="$SC_DIR/platform/wasm/test"
SERVER_PORT=8000

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}============================================================"
echo "  WASM SuperCollider - Cross-Browser Test Runner"
echo "============================================================${NC}"

# Verify build
echo -e "\n${YELLOW}Verifying WASM Build...${NC}"
if [ ! -f "$SC_DIR/build/wasm/server/scsynth/scsynth.js" ] || [ ! -f "$SC_DIR/build/wasm/server/scsynth/scsynth.wasm" ]; then
    echo -e "${RED}Error: WASM artifacts not found${NC}"
    echo "Run: cmake --preset wasm_release && cmake --build build/wasm --target scsynth"
    exit 1
fi

# Create symlinks if needed
if [ ! -L "$TEST_DIR/scsynth.js" ]; then
    cd "$SC_DIR"
    ln -sf build/wasm/server/scsynth/scsynth.js platform/wasm/test/scsynth.js
    ln -sf build/wasm/server/scsynth/scsynth.wasm platform/wasm/test/scsynth.wasm
    echo -e "${GREEN}Created symlinks${NC}"
fi

# Run Node.js test
echo -e "\n${YELLOW}Running Node.js offline test...${NC}"
cd "$SC_DIR"
if node platform/wasm/test/sc_wasm_test.js build/wasm/server/scsynth/scsynth.js testsuite/server/supernova/help_out.scsyndef 2>&1 | grep -q "Passed: 10"; then
    echo -e "${GREEN}Node.js test: 10/10 PASSED${NC}"
else
    echo -e "${RED}Node.js test failed${NC}"
    exit 1
fi

# Start server
echo -e "\n${YELLOW}Starting local HTTP server on port $SERVER_PORT...${NC}"
cd "$SC_DIR"
python3 -m http.server $SERVER_PORT &
SERVER_PID=$!
sleep 2
echo -e "${GREEN}Server running PID: $SERVER_PID${NC}"

# Open browsers based on argument
TARGET="${1:-all}"

open_page() {
    local browser=$1
    local url="http://localhost:$SERVER_PORT/platform/wasm/test/$2"
    echo -e "${GREEN}Opening: $url in $browser${NC}"
    case "$browser" in
        chrome) google-chrome "$url" 2>/dev/null || open -a "Google Chrome" "$url" ;;
        firefox) firefox "$url" 2>/dev/null || open -a Firefox "$url" ;;
        safari) open -a Safari "$url" ;;
        edge) msedge "$url" 2>/dev/null || open -a "Microsoft Edge" "$url" ;;
    esac
    sleep 1
}

# Define test pages
declare -a PAGES=(
    "sc_wasm_browser_compat.html:Compatibility Test Suite"
    "sc_wasm_demo.html:Production Demo"
    "sc_wasm_mainthread_test.html:Main-thread Test"
    "sclang_eval_test.html:JS sclang Evaluator Tests"
    "synthdef_compiler_test.html:SynthDef Compiler Tests"
    "synthdef_ide_demo.html:SynthDef IDE Demo"
    "sc_ide.html:Full IDE"
)

# Open pages based on target
case "$TARGET" in
    chrome|firefox|safari|edge)
        for page in "${PAGES[@]}"; do
            url="${page%%:*}"
            name="${page##*:}"
            open_page "$TARGET" "$url"
            echo "  -> Test: $name"
        done
        ;;
    all)
        for browser in chrome firefox safari edge; do
            echo -e "\n${YELLOW}=== Testing in $browser ===${NC}"
            for page in "${PAGES[@]}"; do
                url="${page%%:*}"
                name="${page##*:}"
                open_page "$browser" "$url" 2>/dev/null || echo "  $browser not available"
            done
        done
        ;;
    *)
        echo -e "\n${RED}Usage: $0 [chrome|firefox|safari|edge|all]${NC}"
        echo "Example:"
        echo "  $0 chrome    # Test in Chrome only"
        echo "  $0 firefox   # Test in Firefox only"
        echo "  $0 all       # Test in all available browsers"
        exit 1
        ;;
esac

echo -e "\n${YELLOW}============================================================"
echo "  TEST INSTRUCTIONS"
echo "============================================================${NC}"
echo ""
echo "For each browser tab that opened:"
echo ""
echo "1. sc_wasm_browser_compat.html:"
echo "   - Click 'Run All Tests'"
echo "   - Click 'Export JSON' and save results"
echo ""
echo "2. sc_wasm_demo.html:"
echo "   - Click 'Initialize' then 'Play'"
echo "   - Verify audio plays with waveform"
echo ""
echo "3. sclang_eval_test.html:"
echo "   - Click 'Run All Tests'"
echo "   - Verify all 8 tests pass"
echo ""
echo "4. synthdef_ide_demo.html:"
echo "   - Enter: SynthDef(\sine, { SinOsc.ar(440) * 0.1 }).add"
echo "   - Press Shift+Enter, then click Play"
echo ""
echo "5. sc_ide.html:"
echo "   - Full IDE with Shift+Enter evaluation"
echo ""
echo "Document results in docs/WASM_PHASE6_PROGRESS.md"
echo ""
echo "Press Enter to stop the server..."
read -p ""

# Stop server
pkill -f "python3 -m http.server $SERVER_PORT" 2>/dev/null || true
echo -e "\n${GREEN}Server stopped. Test session complete.${NC}"
