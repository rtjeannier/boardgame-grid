#!/usr/bin/env bash
# Runs once when the container is created: install both toolchains' deps.
set -euo pipefail

echo "==> Python deps"
pip install --no-cache-dir --upgrade pip
pip install --no-cache-dir -r requirements.txt

echo "==> Node deps (web/)"
npm --prefix web ci

echo
echo "Ready. Try:"
echo "  python -m pipeline.build          # dataset -> web/public/grid.json"
echo "  npm --prefix web run dev -- --host  # site on http://localhost:5173"
