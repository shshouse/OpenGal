import glob
import json
import os
import queue
import sys
import threading

import numpy as np
import sherpa_onnx

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

MODEL_DIR = sys.argv[1] if len(sys.argv) > 1 else ""
SAMPLE_RATE = int(sys.argv[2]) if len(sys.argv) > 2 else 16000
LANGUAGE = sys.argv[3] if len(sys.argv) > 3 else "auto"
VAD_PATH = sys.argv[4] if len(sys.argv) > 4 else ""
VAD_SILENCE_MS = int(sys.argv[5]) if len(sys.argv) > 5 else 600
HOTWORDS_FILE = sys.argv[6] if len(sys.argv) > 6 else ""
NUM_THREADS = int(sys.argv[7]) if len(sys.argv) > 7 else 2

# 目录名前缀 -> 模型类型；接入新模型 = 在此加一行 + build_recognizer 加一个分支
KIND_BY_PREFIX = [
    ("sherpa-onnx-qwen3-asr-", "qwen3"),
    ("sherpa-onnx-sense-voice-", "sensevoice"),
    ("sherpa-onnx-funasr-nano-", "funasr_nano"),
]


def detect_kind():
    name = os.path.basename(os.path.normpath(MODEL_DIR)).lower()
    for prefix, kind in KIND_BY_PREFIX:
        if name.startswith(prefix):
            return kind
    print(f"warn: unknown model dir {MODEL_DIR}, fallback to qwen3", file=sys.stderr, flush=True)
    return "qwen3"


KIND = detect_kind()


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def pick_model_file(stem):
    hits = [
        p for p in glob.glob(os.path.join(MODEL_DIR, "*.onnx"))
        if stem in os.path.basename(p)
    ]
    hits.sort(key=lambda p: 0 if "int8" in p else 1)
    if not hits:
        raise FileNotFoundError(f"{stem} not found in {MODEL_DIR}")
    return hits[0]


def load_hotwords():
    if not HOTWORDS_FILE or not os.path.exists(HOTWORDS_FILE):
        return ""
    with open(HOTWORDS_FILE, encoding="utf-8") as f:
        return ",".join(line.strip() for line in f if line.strip())


def build_vad():
    config = sherpa_onnx.VadModelConfig()
    config.sample_rate = SAMPLE_RATE
    config.silero_vad.model = VAD_PATH
    config.silero_vad.min_silence_duration = VAD_SILENCE_MS / 1000
    config.silero_vad.min_speech_duration = 0.25
    config.silero_vad.max_speech_duration = 15
    return sherpa_onnx.VoiceActivityDetector(config)


def tokenizer_dir():
    sub = os.path.join(MODEL_DIR, "tokenizer")
    return sub if os.path.isdir(sub) else MODEL_DIR


def build_recognizer():
    if KIND == "qwen3":
        return sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
            conv_frontend=pick_model_file("conv_frontend"),
            encoder=pick_model_file("encoder"),
            decoder=pick_model_file("decoder"),
            tokenizer=tokenizer_dir(),
            num_threads=NUM_THREADS,
            sample_rate=SAMPLE_RATE,
            hotwords=load_hotwords(),
        )
    if KIND == "sensevoice":
        warn_hotwords_ignored()
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=pick_model_file("model"),
            tokens=os.path.join(MODEL_DIR, "tokens.txt"),
            language=LANGUAGE,
            use_itn=True,
            num_threads=NUM_THREADS,
        )
    if KIND == "funasr_nano":
        warn_hotwords_ignored()
        return sherpa_onnx.OfflineRecognizer.from_funasr_nano(
            encoder_adaptor=pick_model_file("encoder_adaptor"),
            llm=pick_model_file("llm"),
            embedding=pick_model_file("embedding"),
            tokenizer=tokenizer_dir(),
            language=LANGUAGE,
            num_threads=NUM_THREADS,
        )
    raise ValueError(f"unknown model kind: {KIND}")


def warn_hotwords_ignored():
    if load_hotwords():
        print(f"warn: {KIND} does not support hotwords, ignored", file=sys.stderr, flush=True)


def main():
    vad = build_vad()
    rec = build_recognizer()
    emit({"type": "ready", "kind": KIND})

    chunks = queue.Queue()

    def read_stdin():
        while True:
            data = sys.stdin.buffer.read(4096)
            chunks.put(data)
            if not data:
                return

    threading.Thread(target=read_stdin, daemon=True).start()

    def recognize(samples):
        stream = rec.create_stream()
        stream.accept_waveform(SAMPLE_RATE, samples)
        if KIND == "qwen3" and LANGUAGE != "auto":
            try:
                stream.set_option("language", LANGUAGE)
            except Exception as exc:
                print(f"warn: set language failed: {exc}", file=sys.stderr, flush=True)
        rec.decode_stream(stream)
        result = stream.result
        if result.text.strip():
            emit({
                "type": "final",
                "text": result.text.strip(),
                "lang": getattr(result, "lang", "") or LANGUAGE,
                "durationMs": int(len(samples) * 1000 / SAMPLE_RATE),
            })

    in_speech = False
    while True:
        chunk = chunks.get()
        if not chunk:
            vad.flush()
            while not vad.empty():
                segment = vad.front
                recognize(segment.samples)
                vad.pop()
            return
        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        vad.accept_waveform(samples)
        speech = vad.is_speech_detected()
        if speech and not in_speech:
            emit({"type": "speech_start"})
        in_speech = speech
        while not vad.empty():
            segment = vad.front
            recognize(segment.samples)
            vad.pop()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"sherpa_worker fatal: {exc}", file=sys.stderr, flush=True)
        os._exit(1)
