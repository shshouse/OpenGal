const WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const targetRate = options.processorOptions?.targetRate || 16000;
    this._ratio = sampleRate / targetRate;
    this._buffer = [];
    this._chunkSamples = 4096;
    this._resamplePos = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this._resamplePos += 1;
      if (this._resamplePos >= this._ratio) {
        this._resamplePos -= this._ratio;
        this._buffer.push(Math.max(-1, Math.min(1, input[i])));
      }
    }
    if (this._buffer.length >= this._chunkSamples) {
      const len = this._buffer.length;
      const pcm16 = new Int16Array(len);
      for (let j = 0; j < len; j++) {
        pcm16[j] = this._buffer[j] * 0x7FFF;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      this._buffer = [];
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`

let stream: MediaStream | null = null
let audioCtx: AudioContext | null = null
let workletNode: AudioWorkletNode | null = null
let analyser: AnalyserNode | null = null

export async function startMicCapture(targetRate: number): Promise<void> {
  if (stream) return
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true
    }
  })
  audioCtx = new AudioContext()
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  await audioCtx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
    processorOptions: { targetRate }
  })
  workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    window.opengal.asr.feed(e.data)
  }
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.6
  const source = audioCtx.createMediaStreamSource(stream)
  source.connect(analyser)
  analyser.connect(workletNode)
}

export function stopMicCapture(): void {
  if (workletNode) {
    workletNode.disconnect()
    workletNode = null
  }
  if (analyser) {
    analyser.disconnect()
    analyser = null
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {})
    audioCtx = null
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
}

export function getAnalyser(): AnalyserNode | null {
  return analyser
}

export function isMicActive(): boolean {
  return stream !== null
}
