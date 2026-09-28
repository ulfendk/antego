"""
Renders every text the game shows (content/lines/*.yaml) to Danish speech with
Røst-v3 (CoRal project's Danish fine-tune of Chatterbox) and writes
<out>/<hash>.mp3 + manifest.json. Output is committed, so the game image never
needs PyTorch. Lines whose text changed are re-rendered; unchanged lines are
skipped. Voices per speaker live in content/voices.yaml.

Adapted from western-spil/tools/voice/render.py.

    npm run voice                       # render new/changed lines
    npm run voice -- --only menu.       # only some lines
    npm run voice -- --force --only tal.  # re-roll takes
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import torch
import torchaudio as ta
import yaml
from huggingface_hub import snapshot_download

MODEL_ID = "CoRal-project/roest-v3-chatterbox-500m"
MODEL_FILES = [
    "ve.pt",
    "s3gen.pt",
    "t3_mtl23ls_v2.safetensors",
    "grapheme_mtl_merged_expanded_v1.json",
    "mtl_tokenizer.json",
    "tokenizer.json",
    "Cangjie5_TC.json",
    "conds.pt",
    "audio_samples/00_*",
]
BUILTIN_PROMPTS = {
    "mic": "audio_samples/00_mic_00_t0.8_p0.95_e0.5_c0.5_m0.05_r2.0.wav",
    "nic": "audio_samples/00_nic_00_t0.8_p0.95_e0.5_c0.5_m0.05_r2.0.wav",
}
GEN_KEYS = ("exaggeration", "cfg_weight", "temperature", "top_p", "min_p", "repetition_penalty")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--content", default="/content", type=Path)
    ap.add_argument("--out", default="/out", type=Path)
    ap.add_argument("--only", default="", help="only render line ids starting with this")
    ap.add_argument("--force", action="store_true", help="re-render even if unchanged")
    args = ap.parse_args()

    content: Path = args.content
    voices = yaml.safe_load((content / "voices.yaml").read_text())
    lexicon = voices.get("lexicon") or {}
    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    lines = []
    for f in sorted((content / "lines").glob("*.yaml")):
        doc = yaml.safe_load(f.read_text())
        for line in walk(doc["lines"]):
            text = " ".join(str(line["text"]).split())
            spoken = apply_lexicon(" ".join(line.get("say", line["text"]).split()), lexicon)
            lines.append((f"{doc['id']}.{line['id']}", line["speaker"], text, spoken))

    model = None
    model_dir = None
    manifest = {}
    for line_id, speaker, text, spoken in lines:
        voice = voices["speakers"][speaker]
        key = hashlib.sha1(
            json.dumps({"engine": voices["engine"], "voice": voice, "text": spoken}, sort_keys=True).encode()
        ).hexdigest()[:16]
        name = f"{key}.mp3"
        manifest[line_id] = {"file": name, "text": text, "speaker": speaker}
        target = out_dir / name
        wanted = line_id.startswith(args.only)
        if target.exists() and not (args.force and wanted):
            continue
        if not wanted:
            # Keep the previous rendering for lines outside --only, if any.
            if line_id in old and (out_dir / old[line_id]["file"]).exists():
                manifest[line_id] = old[line_id]
            else:
                del manifest[line_id]
            continue
        if model is None:
            model_dir, model = load_model()
        print(f"[voice] {line_id} ({speaker}): {spoken[:60]}…", flush=True)
        try:
            render_line(model, model_dir, content, voice, spoken, target, seed=int(key[:8], 16))
        except RuntimeError as err:
            # Don't lose the whole run over one line; the game falls back to Piper for it.
            print(f"[voice] FAILED {line_id}: {err}", flush=True)
            del manifest[line_id]
            continue
        # Save progress after every line so an interrupted run loses nothing.
        write_manifest(manifest_path, {**old, **manifest})

    write_manifest(manifest_path, manifest)
    used = {v["file"] for v in manifest.values()}
    for f in out_dir.glob("*.mp3"):
        if f.name not in used:
            f.unlink()
            print(f"[voice] removed stale {f.name}")
    print(f"[voice] manifest: {len(manifest)} lines")


def apply_lexicon(text: str, lexicon: dict) -> str:
    """Replaces words the voice mispronounces with a spelling it reads correctly."""
    for word, spoken in lexicon.items():
        text = re.sub(rf"(?<!\w){re.escape(word)}(?!\w)", spoken, text)
    return text


def write_manifest(path: Path, manifest: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def walk(lines):
    """Yields every line, including voiced answer prompts and lines inside choices."""
    for line in lines:
        yield line
        for n, choice in enumerate(line.get("choices", []), start=1):
            if choice.get("say"):
                # Same id scheme as the game's parser: "<line id>-valg<n>".
                yield {"id": f"{line['id']}-valg{n}", "speaker": "fortaeller", "text": choice["say"]}
            yield from walk(choice.get("lines", []))


def load_model():
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    torch.set_num_threads(os.cpu_count() or 4)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[voice] loading {MODEL_ID} on {device}", flush=True)
    model_dir = Path(snapshot_download(MODEL_ID, allow_patterns=MODEL_FILES))
    return model_dir, ChatterboxMultilingualTTS.from_local(model_dir, device=device)


def prompt_path(model_dir: Path, content: Path, prompt: str) -> str:
    if prompt.startswith("builtin:"):
        return str(model_dir / BUILTIN_PROMPTS[prompt.split(":", 1)[1]])
    return str(content / "voices" / prompt)


MIN_SENTENCE = 16


def split_sentences(text: str) -> list[str]:
    # Chatterbox degrades on long inputs, so render sentence by sentence. Very short
    # sentences ("Se.") crash its alignment analyser, so they're joined with the next one.
    parts = [p.strip() for p in re.split(r"(?<=[.!?…])\s+", text) if p.strip()]
    merged: list[str] = []
    carry = ""
    for part in parts:
        carry = f"{carry} {part}".strip()
        if len(carry) >= MIN_SENTENCE:
            merged.append(carry)
            carry = ""
    if carry:
        if merged:
            merged[-1] = f"{merged[-1]} {carry}"
        else:
            merged.append(carry)
    return merged


def render_line(model, model_dir, content, voice, text, target: Path, seed: int) -> None:
    gen = {k: voice[k] for k in GEN_KEYS if k in voice}
    prompt = prompt_path(model_dir, content, voice["prompt"])
    pieces = []
    silence = torch.zeros(1, int(model.sr * 0.28))
    for i, sentence in enumerate(split_sentences(text)):
        wav = None
        # Retry with a new seed if the take looks truncated or runaway.
        for attempt in range(4):
            torch.manual_seed(seed + i * 101 + attempt * 7919)
            try:
                wav = model.generate(sentence, language_id="da", audio_prompt_path=prompt, **gen)
            except (IndexError, RuntimeError) as err:
                print(f"[voice]   model error ({err}); retrying", flush=True)
                continue
            secs = wav.shape[-1] / model.sr
            per_char = secs / max(len(sentence), 1)
            if 0.035 < per_char < 0.14:
                break
            print(f"[voice]   retry ({secs:.1f}s for {len(sentence)} chars)", flush=True)
        if wav is None:
            raise RuntimeError(f"could not render: {sentence}")
        pieces += [wav.cpu(), silence]
    audio = torch.cat(pieces[:-1], dim=-1)

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "line.wav"
        ta.save(str(wav_path), audio, model.sr)
        filters = []
        pitch = float(voice.get("pitch", 0))
        tempo = float(voice.get("tempo", 1))
        if pitch or tempo != 1:
            filters.append(f"rubberband=pitch={2 ** (pitch / 12):.4f}:tempo={tempo:.3f}")
        filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav_path), "-af", ",".join(filters),
             "-ar", "44100", "-ac", "1", "-codec:a", "libmp3lame", "-q:a", "4", str(target)],
            check=True,
        )


if __name__ == "__main__":
    sys.exit(main())
