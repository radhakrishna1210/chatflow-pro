#!/usr/bin/env bash
# Render every film to $RAW_DIR/<film>.mp4 (default renders/). Pass film folders to render only those.
set -e
cd "$(dirname "$0")/.."
raw=${RAW_DIR:-$PWD/renders}; mkdir -p "$raw"
films=("$@"); [ ${#films[@]} -eq 0 ] && films=([0-9][0-9]-*/)
for f in "${films[@]}"; do
  f=${f%/}
  echo "== $f"
  (cd "$f" && npx -y openfilm@latest render --workers 3 --out "$raw/$f.mp4" 2>&1 | grep -v "npm notice" | tail -3)
done
