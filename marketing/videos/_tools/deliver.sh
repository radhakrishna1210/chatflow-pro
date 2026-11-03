#!/usr/bin/env bash
# Make the shareable copies of a rendered film:
#   renders/<film>.mp4          full size, H.264 CRF 23 (posting quality)
#   showcase/v/<id>.mp4 + .jpg  smaller copy and poster for the showcase page
# Usage: _tools/deliver.sh <raw.mp4> [...]
set -e
cd "$(dirname "$0")/.."
mkdir -p renders showcase/v
for raw in "$@"; do
  name=$(basename "$raw" .mp4)
  id=${name%%-*}; [ "$id" = "09" ] && id=09-product-tour
  ffmpeg -v error -y -i "$raw" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k "renders/$name.mp4"
  w=$(ffprobe -v error -select_streams v -show_entries stream=width -of csv=p=0 "$raw")
  scale=$([ "$w" -gt 1100 ] && echo "1280:-2" || echo "720:-2")
  ffmpeg -v error -y -i "$raw" -vf "scale=$scale" -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 96k "showcase/v/$id.mp4"
  ffmpeg -v error -y -ss "$([ "$id" = 09-product-tour ] && echo 8.5 || echo 2.5)" -i "$raw" -frames:v 1 -vf "scale=$scale" -q:v 4 "showcase/v/$id.jpg"
  echo "$name: $(du -h "renders/$name.mp4" | cut -f1) full, $(du -h "showcase/v/$id.mp4" | cut -f1) showcase"
done
