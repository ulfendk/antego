#!/usr/bin/env sh
# Renders every text line with Røst-v3 into packages/client/public/voice (commit the result).
#   npm run voice                        # new/changed lines
#   npm run voice -- --only menu.        # only some lines
#   npm run voice -- --force --only tal. # re-roll takes
# The ~3 GB model is cached in a Docker volume (shared with western-spil when it exists).
set -e
cd "$(dirname "$0")/../.."
VOLUME=antego-voice-models
docker volume inspect western-voice-models >/dev/null 2>&1 && VOLUME=western-voice-models
docker build -q -t antego-voice tools/voice >/dev/null
mkdir -p packages/client/public/voice
exec docker run --rm \
  -v "$PWD/content:/content:ro" \
  -v "$PWD/packages/client/public/voice:/out" \
  -v "$PWD/tools/voice/render.py:/app/render.py:ro" \
  -v "$VOLUME:/models" \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  antego-voice --content /content --out /out "$@"
