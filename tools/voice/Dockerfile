# Offline narration renderer using Røst-v3 (CoRal project's Danish Chatterbox fine-tune).
# Renders content/lines/*.yaml -> packages/client/public/voice/*.mp3 + manifest.json, which are committed.
#
#   npm run voice            (see tools/voice/render.sh)
#   npm run voice -- --gpu   NVIDIA GPU build (CUDA wheels, amd64 only)
FROM python:3.12-slim

# CPU wheels by default (small, amd64 + arm64); render.sh --gpu passes the CUDA index instead.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --index-url ${TORCH_INDEX} \
      torch==2.6.0 torchaudio==2.6.0 \
 && pip install --no-cache-dir chatterbox-tts==0.1.7 pyyaml huggingface_hub

# World-writable so the renderer can run as the host user (files in content/ stay yours).
RUN mkdir -p /models && chmod 1777 /models
ENV HF_HOME=/models \
    PYTHONUNBUFFERED=1 \
    TQDM_DISABLE=1 \
    TRANSFORMERS_VERBOSITY=error
WORKDIR /app
COPY render.py .
ENTRYPOINT ["python", "render.py"]
CMD ["--content", "/content"]
