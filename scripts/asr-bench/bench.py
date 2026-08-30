import argparse
import glob
import json
import os
import time
import wave

import numpy as np
import sherpa_onnx


def pick(model_dir, stem):
    hits = [
        p for p in glob.glob(os.path.join(model_dir, "*.onnx"))
        if stem in os.path.basename(p)
    ]
    hits.sort(key=lambda p: 0 if "int8" in p else 1)
    if not hits:
        raise FileNotFoundError(f"{stem} not found in {model_dir}")
    return hits[0]


def tokenizer_dir(model_dir):
    sub = os.path.join(model_dir, "tokenizer")
    if os.path.isdir(sub):
        return sub
    for name in os.listdir(model_dir):
        candidate = os.path.join(model_dir, name)
        if os.path.isdir(candidate) and os.path.exists(os.path.join(candidate, "vocab.json")):
            return candidate
    return model_dir


def build_recognizer(kind, model_dir, language):
    if kind == "qwen3":
        return sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
            conv_frontend=pick(model_dir, "conv_frontend"),
            encoder=pick(model_dir, "encoder"),
            decoder=pick(model_dir, "decoder"),
            tokenizer=tokenizer_dir(model_dir),
            num_threads=2,
        )
    if kind == "sensevoice":
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=pick(model_dir, "model"),
            tokens=os.path.join(model_dir, "tokens.txt"),
            language=language,
            use_itn=True,
            num_threads=2,
        )
    if kind == "funasr_nano":
        return sherpa_onnx.OfflineRecognizer.from_funasr_nano(
            encoder_adaptor=pick(model_dir, "encoder_adaptor"),
            llm=pick(model_dir, "llm"),
            embedding=pick(model_dir, "embedding"),
            tokenizer=tokenizer_dir(model_dir),
            language=language,
            num_threads=2,
        )
    raise ValueError(f"unknown kind: {kind}")


def transcribe(rec, samples, sample_rate):
    stream = rec.create_stream()
    stream.accept_waveform(sample_rate, samples)
    rec.decode_stream(stream)
    return stream.result.text.strip()


def cer(ref, hyp):
    ref = list("".join(ref.split()))
    hyp = list("".join(hyp.split()))
    dp = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, dp[0] = dp[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(dp[j] + 1, dp[j - 1] + 1, prev + (r != h))
            prev, dp[j] = dp[j], cur
    return dp[len(hyp)] / max(1, len(ref))


def load_clips(clips_dir):
    clips = []
    for wav_path in sorted(glob.glob(os.path.join(clips_dir, "*.wav"))):
        ref_path = wav_path[:-4] + ".txt"
        if not os.path.exists(ref_path):
            print(f"skip (no reference): {wav_path}")
            continue
        with wave.open(wav_path, "rb") as w:
            sample_rate = w.getframerate()
            if sample_rate != 16000 or w.getnchannels() != 1:
                print(f"warn: {wav_path} is not 16k mono")
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
            samples = samples.astype(np.float32) / 32768.0
            duration = w.getnframes() / sample_rate
            if duration > 30:
                print(f"warn: {wav_path} is {duration:.0f}s; Qwen3 解码器 KV 上限 512，超长音频会被截断，建议 5-15 秒")
        with open(ref_path, encoding="utf-8") as f:
            ref = f.read().strip()
        clips.append({
            "name": os.path.basename(wav_path),
            "samples": samples,
            "sampleRate": sample_rate,
            "duration": duration,
            "ref": ref,
        })
    return clips


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", required=True, help="测试集目录: *.wav + 同名 .txt")
    parser.add_argument("--models", required=True, help="模型配置 json: [{name, kind, dir}]")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--out", default=".", help="report.md 与 results.json 输出目录")
    args = parser.parse_args()

    with open(args.models, encoding="utf-8") as f:
        models = json.load(f)
    clips = load_clips(args.clips)
    if not clips:
        raise SystemExit("no clips with reference text found")

    results = []
    for model in models:
        name, kind, model_dir = model["name"], model["kind"], model["dir"]
        print(f"loading {name} ({kind}) ...")
        rec = build_recognizer(kind, model_dir, args.language)
        rows = []
        for clip in clips:
            started = time.perf_counter()
            hyp = transcribe(rec, clip["samples"], clip["sampleRate"])
            elapsed = time.perf_counter() - started
            rows.append({
                "clip": clip["name"],
                "ref": clip["ref"],
                "hyp": hyp,
                "cer": cer(clip["ref"], hyp),
                "rtf": elapsed / clip["duration"],
            })
            print(f"  {clip['name']}: CER={rows[-1]['cer']:.3f} RTF={rows[-1]['rtf']:.3f}")
        results.append({
            "name": name,
            "kind": kind,
            "dir": model_dir,
            "avgCer": sum(r["cer"] for r in rows) / len(rows),
            "avgRtf": sum(r["rtf"] for r in rows) / len(rows),
            "rows": rows,
        })

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    lines = ["# ASR 三模型对比", "", "| 模型 | 平均 CER | 平均 RTF |", "|---|---|---|"]
    for r in results:
        lines.append(f"| {r['name']} | {r['avgCer']:.3f} | {r['avgRtf']:.3f} |")
    for r in results:
        lines += ["", f"## {r['name']}", "", "| 样本 | 参考 | 识别 | CER | RTF |", "|---|---|---|---|---|"]
        for row in r["rows"]:
            ref = row["ref"].replace("|", "\\|")
            hyp = row["hyp"].replace("|", "\\|")
            lines.append(f"| {row['clip']} | {ref} | {hyp} | {row['cer']:.3f} | {row['rtf']:.3f} |")
    with open(os.path.join(args.out, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"report written to {args.out}")


if __name__ == "__main__":
    main()
