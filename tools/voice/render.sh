#!/usr/bin/env sh
# Renders every text line with Røst-v3 into packages/client/public/voice (commit the result).
#   npm run voice                        # new/changed lines (CPU)
#   npm run voice -- --gpu               # on an NVIDIA GPU (much faster)
#   npm run voice -- --only menu.        # only some lines
#   npm run voice -- --force --only tal. # re-roll takes
# The ~3 GB model is cached in a Docker volume (shared with western-spil when it exists).
set -e
cd "$(dirname "$0")/../.."

GPU=0
ARGS=""
for a in "$@"; do
  if [ "$a" = "--gpu" ]; then GPU=1; else ARGS="$ARGS $a"; fi
done

VOLUME=antego-voice-models
docker volume inspect western-voice-models >/dev/null 2>&1 && VOLUME=western-voice-models

if [ "$GPU" = 1 ]; then
  IMAGE=antego-voice-gpu
  docker build -q -t "$IMAGE" --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124 tools/voice >/dev/null
  GPU_FLAGS="--gpus all -e VOICE_REQUIRE_GPU=1"
else
  IMAGE=antego-voice
  docker build -q -t "$IMAGE" tools/voice >/dev/null
  GPU_FLAGS=""
fi

mkdir -p packages/client/public/voice
# shellcheck disable=SC2086
exec docker run --rm $GPU_FLAGS \
  -v "$PWD/content:/content:ro" \
  -v "$PWD/packages/client/public/voice:/out" \
  -v "$PWD/tools/voice/render.py:/app/render.py:ro" \
  -v "$VOLUME:/models" \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  "$IMAGE" --content /content --out /out $ARGS
