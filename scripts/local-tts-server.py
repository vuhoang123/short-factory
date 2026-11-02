"""Private loopback VieNeu bridge. Install the pinned SDK in an isolated environment."""

import base64
import contextlib
import gc
import hmac
import io
import json
import logging
import os
import re
import tempfile
import threading
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


def normalize_word_timings(words: list[dict], duration_ms: int) -> tuple[list[dict], int]:
    """Resolve DTW's zero-width 20ms cells locally, without moving anchors over 60ms."""
    original = [dict(word) for word in words]
    result = []
    cursor = 0
    for word in words:
        start = max(cursor, word["startMs"])
        end = max(start + 20, word["endMs"])
        result.append({**word, "startMs": start, "endMs": end})
        cursor = end
    if result and result[-1]["endMs"] > duration_ms:
        cursor = duration_ms
        for word in reversed(result):
            word["endMs"] = min(word["endMs"], cursor)
            word["startMs"] = min(word["startMs"], word["endMs"] - 20)
            cursor = word["startMs"]
    for index, (word, raw) in enumerate(zip(result, original)):
        if word["startMs"] < (result[index - 1]["endMs"] if index else 0) or word["endMs"] > duration_ms or word["endMs"] <= word["startMs"] or max(abs(word["startMs"] - raw["startMs"]), abs(word["endMs"] - raw["endMs"])) > 60:
            raise ValueError("Forced alignment requires manual timing review")
    return result, sum(word != raw for word, raw in zip(result, original))


def main() -> None:
    logging.disable(logging.CRITICAL)
    import numpy as np
    import soundfile as sf
    from vieneu import Vieneu
    if os.environ.get("LOCAL_ALIGNMENT_ENABLED") == "1":
        from faster_whisper import WhisperModel
        from faster_whisper.tokenizer import Tokenizer

    token = os.environ.get("TTS_LOCAL_TOKEN", "")
    if len(token) < 32:
        raise ValueError("TTS_LOCAL_TOKEN must contain at least 32 characters")
    model = Vieneu(device="cpu", backend="onnx", precision="fp32", threads=4)
    aligner = None
    alignment_model_path = None
    alignment_version = "disabled"
    if os.environ.get("LOCAL_ALIGNMENT_ENABLED") == "1":
        from huggingface_hub import snapshot_download
        revision_id = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"
        alignment_model_path = snapshot_download("Systran/faster-whisper-base", revision=revision_id)
        alignment_version = f"faster-whisper-1.2.1:base:{revision_id}"
    voices = [{"voiceId": voice_id, "name": label} for label, voice_id in model.list_preset_voices()]
    voices.sort(key=lambda voice: 0 if voice["voiceId"] == "Ngọc Linh" else 1 if voice["voiceId"] == "Thiện Minh" else 2)
    manifest = Path(os.environ["TTS_VIENEU_VOICES_FILE"])
    manifest.parent.mkdir(parents=True, exist_ok=True)
    cache = Path(os.environ["HF_HOME"]) / "hub"
    def revision(repo: str) -> str:
        reference = cache / repo / "refs" / "main"
        return reference.read_text(encoding="utf-8").strip()[:12] if reference.exists() else "unknown"
    version = f"vieneu-3.8.3-fp32:{revision('models--pnnbao-ump--VieNeu-TTS-v3-Turbo')}:{revision('models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano-ONNX')}"
    manifest.write_text(json.dumps({"version": version, "voices": voices}, ensure_ascii=False), encoding="utf-8")
    lock = threading.Lock()
    inference = ThreadPoolExecutor(max_workers=1, thread_name_prefix="local-speech")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *args: object) -> None:
            pass  # Source text and reference audio must never enter access logs.

        def reply(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            self.reply(200 if self.path == "/health" else 404, json.dumps({"status": "ready", "alignment": alignment_version}).encode(), "application/json")

        def do_POST(self) -> None:
            # Native model replicas and allocator caches must stay on one inference thread.
            inference.submit(self.handle_post).result()

        def handle_post(self) -> None:
            nonlocal aligner, model
            if self.path not in ("/speech", "/align", "/retime", "/alignment-release") or not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf-8"), f"Bearer {token}".encode("utf-8")):
                self.reply(403, b'{"code":"FORBIDDEN"}', "application/json")
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 32_000_000:
                    raise ValueError("Invalid request size")
                data = json.loads(self.rfile.read(size))
                if self.path == "/alignment-release":
                    with lock:
                        if aligner is not None:
                            aligner.model.unload_model()
                            aligner = None
                        if model is not None:
                            model.close()
                            model = None
                        gc.collect()
                    self.reply(200, b'{"status":"released"}', "application/json")
                    return
                if self.path in ("/align", "/retime"):
                    self.process_audio(data)
                    return
                text = data.get("text")
                rate = data.get("speakingRate", 1)
                voice = data.get("voiceId")
                if not isinstance(text, str) or not 0 < len(text) <= 4000 or not isinstance(rate, (int, float)) or not 0.5 <= rate <= 2:
                    raise ValueError("Invalid synthesis input")
                reference = data.get("referenceAudio")
                if reference is None and voice not in {item["voiceId"] for item in voices}:
                    raise ValueError("Unknown preset")
                if reference is not None and not isinstance(reference, str):
                    raise ValueError("Invalid reference")
                with tempfile.TemporaryDirectory(prefix="sf-voice-") as temporary:
                    reference_path = None
                    if reference is not None:
                        audio = base64.b64decode(reference, validate=True)
                        if len(audio) > 3_000_000:
                            raise ValueError("Reference too large")
                        with wave.open(io.BytesIO(audio), "rb") as source:
                            duration = source.getnframes() / source.getframerate()
                            if not 3 <= duration <= 15 or source.getnchannels() not in (1, 2) or source.getsampwidth() != 2:
                                raise ValueError("Use 3–15 seconds of PCM16 WAV")
                        reference_path = Path(temporary) / "reference.wav"
                        reference_path.write_bytes(audio)
                    with lock:
                        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                            if model is None:
                                model = Vieneu(device="cpu", backend="onnx", precision="fp32", threads=4)
                            audio = model.infer(text, ref_audio=reference_path) if reference_path else model.infer(text, voice=voice)
                            sample_rate = model.sample_rate
                        if rate != 1:
                            import librosa
                            audio = librosa.effects.time_stretch(np.asarray(audio, dtype=np.float32), rate=rate)
                    output = io.BytesIO()
                    sf.write(output, audio, sample_rate, format="WAV", subtype="PCM_16")
                    self.reply(200, output.getvalue(), "audio/wav")
            except (ValueError, TypeError, KeyError, wave.Error) as error:
                print(json.dumps({"code": "TTS_INPUT_INVALID", "errorType": type(error).__name__, "line": traceback.extract_tb(error.__traceback__)[-1].lineno}), flush=True)
                self.reply(400, b'{"code":"TTS_INPUT_INVALID"}', "application/json")
            except Exception as error:
                reason = "MEMORY_ALLOCATION" if "allocate memory" in str(error) or "bad_alloc" in str(error) else "MODEL_THREAD" if "replica" in str(error) else "OTHER"
                print(json.dumps({"code": "TTS_INFERENCE_FAILED", "reason": reason, "errorType": type(error).__name__, "line": traceback.extract_tb(error.__traceback__)[-1].lineno}), flush=True)
                self.reply(503, b'{"code":"TTS_INFERENCE_FAILED"}', "application/json")

        def process_audio(self, data: dict) -> None:
            nonlocal aligner, model
            # Fitting/alignment consume completed WAVs and do not need the speech model resident.
            with lock:
                if model is not None:
                    model.close()
                    model = None
                    gc.collect()
            import librosa
            audio_bytes = base64.b64decode(data["audio"], validate=True)
            if len(audio_bytes) > 24_000_000:
                raise ValueError("Audio too large")
            audio, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32")
            if audio.ndim != 1 or not 8000 <= sample_rate <= 96000 or not np.isfinite(audio).all():
                raise ValueError("Use finite mono speech audio")
            duration = len(audio) / sample_rate
            if self.path == "/retime":
                target = data["targetDurationMs"] / 1000
                if not 0 < target <= 120 or not 0.79 <= duration / target <= 1.26:
                    raise ValueError("Tempo change outside quality bounds")
                with lock:
                    output_audio = librosa.effects.time_stretch(audio, rate=duration / target)
                output = io.BytesIO()
                sf.write(output, output_audio, sample_rate, format="WAV", subtype="PCM_16")
                self.reply(200, output.getvalue(), "audio/wav")
                return
            text = data["text"]
            language = data["language"].split("-")[0]
            if alignment_model_path is None or not isinstance(text, str) or not 0 < len(text) <= 4000 or not 0 < duration < 30:
                raise ValueError("Forced alignment requires an enabled model and speech segments under 30 seconds")
            with lock, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                if aligner is None:
                    aligner = WhisperModel(alignment_model_path, device="cpu", compute_type="int8", cpu_threads=4, num_workers=1)
                tokenizer = Tokenizer(aligner.hf_tokenizer, aligner.model.is_multilingual, task="transcribe", language=language)
                tokens = tokenizer.encode(text)
                if len(tokens) > 400:
                    raise ValueError("Too many tokens for one alignment window")
                speech = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
                features = aligner.feature_extractor(speech)
                encoded = aligner.encode(features)
                aligned = aligner.find_alignment(tokenizer, [tokens], encoded, min(3000, int(np.ceil(len(speech) / 160))))[0]
            decoded = "".join(word["word"] for word in aligned)
            if decoded.strip() != text.strip():
                raise ValueError("Alignment text mismatch")
            leading = len(decoded) - len(decoded.lstrip())
            spans = []
            offset = 0
            for word in aligned:
                end = offset + len(word["word"])
                spans.append((offset, end, word))
                offset = end
            words = []
            for match in re.finditer(r"\S+", text.strip()):
                covered = [word for start, end, word in spans if start < match.end() + leading and end > match.start() + leading]
                start_ms = max(0, round(min(word["start"] for word in covered) * 1000))
                end_ms = min(round(duration * 1000), round(max(word["end"] for word in covered) * 1000))
                words.append({"text": match.group(), "startMs": start_ms, "endMs": end_ms})
            words, adjusted = normalize_word_timings(words, round(duration * 1000))
            self.reply(200, json.dumps({"provider": alignment_version, "words": words, "adjustedWords": adjusted}, ensure_ascii=False).encode("utf-8"), "application/json")

    print(json.dumps({"status": "ready", "provider": "vieneu", "voices": len(voices)}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("TTS_LOCAL_PORT", "3002"))), Handler).serve_forever()


if __name__ == "__main__":
    main()
