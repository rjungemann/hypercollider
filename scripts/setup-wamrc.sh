#!/bin/bash
# Automated wamrc setup for HyperCollider
# Handles: LLVM 17 detection, WAMR clone, wamrc build, PATH setup

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Match the WAMR version pinned in native/CMakeLists.txt
WAMR_VERSION="WAMR-2.4.4"
WAMR_REPO="https://github.com/bytecodealliance/wasm-micro-runtime.git"

# WAMR will be cloned here (outside any CMake build dir so `just clean` doesn't kill it)
WAMR_SRC_DIR="$REPO_DIR/build/wamr-src"
WAMR_COMPILER_DIR="$WAMR_SRC_DIR/wamr-compiler"
WAMRC_BIN="$WAMR_COMPILER_DIR/build/wamrc"

echo "🔧 Setting up wamrc for WAMR AOT compilation..."
echo ""

# ── Step 1: Locate LLVM 17 ─────────────────────────────────────────────────

echo "Step 1: Locating LLVM 17..."

LLVM_DIR=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: check Homebrew keg-only paths first (most common)
    for candidate in "/opt/homebrew/opt/llvm@17/lib/cmake/llvm" "/usr/local/opt/llvm@17/lib/cmake/llvm"; do
        if [[ -d "$candidate" ]]; then
            LLVM_DIR="$candidate"
            break
        fi
    done

    if [[ -z "$LLVM_DIR" ]]; then
        echo "  ✗ LLVM 17 not installed. Run: brew install llvm@17"
        exit 1
    fi
else
    # Linux: check standard apt paths
    for candidate in "/usr/lib/llvm-17/lib/cmake/llvm" "/usr/lib/x86_64-linux-gnu/cmake/llvm-17"; do
        if [[ -d "$candidate" ]]; then
            LLVM_DIR="$candidate"
            break
        fi
    done

    if [[ -z "$LLVM_DIR" ]]; then
        echo "  ✗ LLVM 17 not installed."
        echo "    Run: sudo apt install llvm-17 clang-17 libllvm17 libclang-17-dev ninja-build"
        exit 1
    fi
fi

echo "  ✓ LLVM 17 found at $LLVM_DIR"

# ── Step 2: Clone WAMR ─────────────────────────────────────────────────────

echo ""
echo "Step 2: Setting up WAMR source ($WAMR_VERSION)..."

if [[ -d "$WAMR_COMPILER_DIR" ]]; then
    echo "  ✓ WAMR source already present at $WAMR_SRC_DIR"
else
    mkdir -p "$(dirname "$WAMR_SRC_DIR")"
    echo "  Cloning $WAMR_VERSION from GitHub..."
    if ! git clone --depth 1 --branch "$WAMR_VERSION" "$WAMR_REPO" "$WAMR_SRC_DIR"; then
        echo "  ✗ Failed to clone WAMR"
        exit 1
    fi
    echo "  ✓ WAMR cloned to $WAMR_SRC_DIR"
fi

# ── Step 3: Build wamrc ────────────────────────────────────────────────────

echo ""
echo "Step 3: Building wamrc..."

if [[ -f "$WAMRC_BIN" ]]; then
    echo "  ✓ wamrc already built at $WAMRC_BIN"
else
    if ! command -v cmake &>/dev/null; then
        echo "  ✗ cmake not found. Install cmake first."
        exit 1
    fi

    echo "  Building wamrc (this may take 2-3 minutes)..."
    cd "$WAMR_COMPILER_DIR"
    mkdir -p build
    cd build

    if ! cmake .. -DCMAKE_BUILD_TYPE=Release \
                  -DWAMR_BUILD_WITH_CUSTOM_LLVM=ON \
                  -DLLVM_DIR="$LLVM_DIR"; then
        echo "  ✗ CMake configuration failed"
        exit 1
    fi

    if ! cmake --build . -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)"; then
        echo "  ✗ wamrc build failed"
        exit 1
    fi

    if [[ ! -f "$WAMRC_BIN" ]]; then
        echo "  ✗ wamrc binary not produced"
        exit 1
    fi

    echo "  ✓ wamrc built successfully"
fi

# ── Step 4: Symlink to PATH ────────────────────────────────────────────────

echo ""
echo "Step 4: Installing wamrc symlink..."

mkdir -p ~/.local/bin
ln -sf "$WAMRC_BIN" ~/.local/bin/wamrc
echo "  ✓ Symlinked to ~/.local/bin/wamrc"

# ── Step 5: Verify PATH ────────────────────────────────────────────────────

echo ""
if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]] && command -v wamrc &>/dev/null; then
    echo "🎉 Setup complete!"
    echo "   wamrc version: $(wamrc --version 2>&1 | head -1)"
    echo ""
    echo "Ready to build: just build-wamr-aot"
else
    echo "⚠ Almost done — wamrc is installed but ~/.local/bin is not in your PATH."
    echo ""
    echo "Add this to ~/.zshrc (or ~/.bashrc):"
    echo ""
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "Then reload: source ~/.zshrc"
fi
