import glob
import json
import os
import sys

import numpy as np
import sherpa_onnx

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

MODEL_DIR = sys.argv[1] if len(sys.argv) > 1 else ""
SAMPLE_RATE = int(sys.argv[2]) if len(sys.argv) > 2 else 16000
VAD_SILENCE_MS = int(sys.argv[3]) if len(sys.argv) > 3 else 600
NUM_THREADS = int(sys.argv[4]) if len(sys.argv) > 4 else 4


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


def build_recognizer():
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=os.path.join(MODEL_DIR, "tokens.txt"),
        encoder=pick_model_file("encoder"),
        decoder=pick_model_file("decoder"),
        joiner=pick_model_file("joiner"),
        num_threads=NUM_THREADS,
        sample_rate=SAMPLE_RATE,
        feature_dim=80,
        decoding_method="greedy_search",
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=max(0.3, VAD_SILENCE_MS / 1000),
        rule2_min_trailing_silence=0.8,
        rule3_min_utterance_length=20.0,
    )


def main():
    recognizer = build_recognizer()
    stream = recognizer.create_stream()
    emit({"type": "ready", "kind": "streaming_zipformer"})

    last_partial = ""
    in_speech = False
    while True:
        chunk = sys.stdin.buffer.read(1024)
        if not chunk:
            break
        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        stream.accept_waveform(SAMPLE_RATE, samples)
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream).strip()
        if text and text != last_partial:
            last_partial = text
            if not in_speech:
                in_speech = True
                emit({"type": "speech_start"})
            emit({"type": "partial", "text": text})
        if recognizer.is_endpoint(stream):
            final = recognizer.get_result(stream).strip()
            if final:
                emit({"type": "final", "text": final})
            recognizer.reset(stream)
            last_partial = ""
            in_speech = False

    if last_partial:
        emit({"type": "final", "text": last_partial})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"streaming worker fatal: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
