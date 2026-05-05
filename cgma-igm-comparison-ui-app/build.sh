#!/bin/bash
set -e
echo "Building frontend..."
cd frontend && npm run build && cd ..
echo "Building backend..."
cd backend && cargo build --release && cd ..
echo "Done. Run: cd backend && cargo run --release"
