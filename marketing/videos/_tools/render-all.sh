#!/usr/bin/env bash
# Render every film to renders/<film>.mp4. Pass film folders to render only those.
set -e
cd "$(dirname "$0")/.."
films=("$@"); [ ${#films[@]} -eq 0 ] && films=(0*/)
for f in "${films[@]}"; do
  f=${f%/}
  echo "== $f"
  (cd "$f" && npx -y openfilm@latest render --out "../renders/$f.mp4" 2>&1 | grep -v "npm notice" | tail -3)
done
