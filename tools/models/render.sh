#!/usr/bin/env sh
# Builds the soldier models with headless Blender, then compresses them (meshopt) into
# packages/client/public/models (commit the result).
#   npm run models                       # build new/changed ranks
#   npm run models -- --only sergent     # only some ranks
#   npm run models -- --preview          # also render preview PNGs to tools/models/.cache
set -e
cd "$(dirname "$0")/../.."
OUT=packages/client/public/models
RAW=tools/models/.cache/raw
docker build -q -t antego-models tools/models >/dev/null
mkdir -p "$OUT" "$RAW"
docker run --rm \
  -v "$PWD/$RAW:/out" \
  -v "$PWD/tools/models/.cache:/cache" \
  -v "$PWD/tools/models/build.py:/app/build.py:ro" \
  --user "$(id -u):$(id -g)" \
  antego-models --out /out --cache /cache "$@"

for f in "$RAW"/*.glb; do
  dst="$OUT/$(basename "$f")"
  if [ ! -f "$dst" ] || [ "$f" -nt "$dst" ]; then
    npx --no-install gltf-transform meshopt "$f" "$dst" --level medium >/dev/null
    echo "[models] compressed $(basename "$f")"
  fi
done
cp "$RAW/manifest.json" "$OUT/manifest.json"
