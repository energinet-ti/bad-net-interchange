#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUST_DIR="$ROOT_DIR/src/rust-wasm"
WEB_SRC_DIR="$ROOT_DIR/src/web"
DOCS_DIR="$ROOT_DIR/docs"
PKG_DIR="$DOCS_DIR/pkg"

command -v wasm-pack >/dev/null 2>&1 || {
  echo "wasm-pack is required. Install with: cargo install wasm-pack"
  exit 1
}

mkdir -p "$DOCS_DIR"
rm -rf "$PKG_DIR"

wasm-pack build "$RUST_DIR" \
  --target web \
  --release \
  --out-dir "$PKG_DIR"

cp "$WEB_SRC_DIR/index.html" "$DOCS_DIR/index.html"
cp "$WEB_SRC_DIR/app.js" "$DOCS_DIR/app.js"
cp "$WEB_SRC_DIR/styles.css" "$DOCS_DIR/styles.css"

echo "Build complete. Static site is ready in: $DOCS_DIR"
