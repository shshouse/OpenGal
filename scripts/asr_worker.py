import sys, json
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)
model_path = sys.argv[1]
sample_rate = int(sys.argv[2])

model = Model(model_path=model_path)
rec = KaldiRecognizer(model, sample_rate)
rec.SetWords(True)
print(json.dumps({"type": "ready", "text": ""}), flush=True)

CHUNK = 4096
while True:
    data = sys.stdin.buffer.read(CHUNK)
    if not data:
        break
    if rec.AcceptWaveform(data):
        r = json.loads(rec.Result())
        if r.get("text"):
            print(json.dumps({"type": "final", "text": r["text"]}), flush=True)
    else:
        r = json.loads(rec.PartialResult())
        if r.get("partial"):
            print(json.dumps({"type": "partial", "text": r["partial"]}), flush=True)

r = json.loads(rec.FinalResult())
if r.get("text"):
    print(json.dumps({"type": "final", "text": r["text"]}), flush=True)
