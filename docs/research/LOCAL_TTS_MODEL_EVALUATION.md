# Local Vietnamese speech models — 2 November 2026

Follow-up: [Milestone 2](../product/MILESTONE_2_REPORT.md) adds multilingual Whisper base forced alignment, corrected WAV measurement and pitch-preserving duration fitting; its report contains the additional runtime/model pins and limitations.

User requirement: Vietnamese narration with no paid API, preferably a custom voice. Target machine inspected locally: RTX 3050 **6 GB**, approximately **32 GB system RAM**. Selection below is based on current primary model cards/source plus actual local tests; upstream quality/speed claims are not treated as our benchmarks.

| Model | Published license / capabilities | Decision on this machine |
|---|---|---|
| [VieNeu v3 Turbo](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo) | Apache-2.0; Vietnamese/English, presets, reference-clip voice cloning; torch-free ONNX CPU backend | **Implemented and tested.** FP32 CPU, four inference threads; preserves GPU capacity for other local work. The installed SDK currently exposes **25** presets, including regional and storytelling voices. |
| [VieNeu v3 Nano](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Nano) | Apache-2.0; smaller ONNX model; upstream labels it experimental and lower quality than Turbo | Alternative for weak machines. Not installed or benchmarked here; quality is the current priority. |
| [Gwen-TTS 0.6B](https://huggingface.co/g-group-ai-lab/gwen-tts-0.6B) | MIT model card; Vietnamese Qwen3-TTS fine-tune with reference audio/text cloning | Candidate for a later comparison. Requires a heavier Torch/runtime setup; no local quality or VRAM benchmark was performed. Dataset provenance and dependencies need review for the intended distribution. |
| [ZeroTTS](https://huggingface.co/danhcao/ZeroTTS) | MIT model card; Vietnamese ONNX CPU and reference-voice support | Another CPU candidate. Its published quality/speed claims were not independently tested here; not incorporated. |

VieNeu source inspected at `pnnbao97/VieNeu-TTS@04044e1b8f822f946bafb2c88b716459f4164152`: factory, v3 Turbo constructor/inference/voice loading/reference cache, ONNX loader and examples. The installed SDK is pinned to **vieneu==3.8.3**. Its [code license](https://github.com/pnnbao97/VieNeu-TTS/blob/04044e1b8f822f946bafb2c88b716459f4164152/LICENSE) is Apache-2.0. The underlying [MOSS audio codec](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano) is separately labeled Apache-2.0. No upstream application or job engine was copied.

Downloaded test snapshot: VieNeu model `61b85e3d937fbbacb387714180e8182823512523`; MOSS ONNX codec `ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae`. The local bridge records SDK/model/codec revision prefixes in its provider version so changed weights do not reuse the same audio cache namespace. Model files live under ignored `.data/tts-vieneu/hf`; Python dependencies live in an isolated `.venv`, outside system Python.

Actual smoke after the model was cached: **22.806 seconds**, including model startup, a preset narration and a cloned-reference narration at rate 1.15. Outputs: 12.160 seconds / 583,724 bytes for the preset and 8.626 seconds for the custom voice. This run used `HF_HUB_OFFLINE=1`; speech was neural, not a test tone, and no paid API was called. The reference was software-generated test audio, not a private person's recording. These checks establish operation and transport; they do not establish subjective superiority for every voice or speaker similarity to a user's future recording. Listen to the generated samples and choose the preferred narrator.

An additional offline run rendered those two neural audio segments through the existing Remotion composition: 20.907-second, 1080×1920, 30 fps H.264/AAC MP4, 1,485,683 bytes. Total model startup + speech + encoding time was 101.971 seconds. This verifies real neural audio in the video renderer as well as standalone WAV output.

## Public-comment access

The repository has no approved live Facebook/Threads adapter or licensed provider configured for arbitrary public/group links. Local inference does not grant data access. Meta's [official Threads workspace](https://www.postman.com/meta/threads/overview) documents [reply retrieval](https://www.postman.com/meta/threads/request/34203612-11c959db-21cb-4303-b717-73b661b3579c) and [OAuth authorization](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=folder-34203612-995a4593-61de-4558-9b26-6c8becae85e4); this does not establish permission to read every URL or availability of reaction metrics for every reply. Direct Meta developer pages returned access/rate-limit errors during this research, so no new claim about universal post/reaction access is made.

Automatic URL extraction remains **BLOCKED_EXTERNAL** until an approved API/license and working adapter are supplied and tested. The implemented path accepts a whole user-supplied text/TSV/JSON collection, preserves supplied reaction counts and ranks only stored comments. No cookie capture, internal GraphQL, stealth browser or Group scraping was added.
