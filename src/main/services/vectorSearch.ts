import type { MemoryFact } from '@shared/types'
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'
import path from 'node:path'
import fs from 'node:fs'

export interface VectorSearchResult {
  fact: MemoryFact
  similarity: number
}

const MODEL_ID = 'Xenova/bge-small-zh-v1.5'
const VECTOR_DIM = 512

function localModelPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'resources', 'models', 'bge-small-zh-v1.5'),
    path.join(process.resourcesPath ?? '', 'models', 'bge-small-zh-v1.5'),
  ]
  try {
    const { app } = require('electron')
    if (app?.getAppPath) {
      candidates.unshift(path.join(app.getAppPath(), 'resources', 'models', 'bge-small-zh-v1.5'))
    }
  } catch {
    /* 非 Electron 环境 */
  }
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'onnx', 'model_quantized.onnx'))) return p
  }
  return null
}

let extractor: FeatureExtractionPipeline | null = null
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null
let modelReady = false
let modelError: string | null = null

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor
  if (extractorPromise) return extractorPromise

  const localPath = localModelPath()
  if (localPath) {
    env.allowLocalModels = true
    env.allowRemoteModels = false
    env.localModelPath = path.dirname(localPath)
    extractorPromise = pipeline('feature-extraction', 'bge-small-zh-v1.5', {
      local_files_only: true,
      model_file_name: 'model_quantized',
    } as Parameters<typeof pipeline>[2])
  } else {
    env.allowLocalModels = false
    env.allowRemoteModels = true
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      progress_callback: () => {},
    })
  }

  try {
    extractor = await extractorPromise
    modelReady = true
    return extractor
  } catch (err) {
    modelError = (err as Error).message
    extractorPromise = null
    throw new Error(`ONNX 模型加载失败: ${modelError}。请确认模型文件存在或网络可用。`)
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom > 0 ? dot / denom : 0
}

export async function computeEmbeddingAsync(text: string): Promise<number[]> {
  const ext = await getExtractor()
  const output = await ext(text, { pooling: 'mean', normalize: true })
  const vec = Array.from(output.data as Float32Array)
  if (vec.length === VECTOR_DIM) return vec
  return vec.slice(0, VECTOR_DIM)
}

export async function searchSimilarAsync(
  facts: MemoryFact[],
  query: string,
  topK = 5,
  minScore = 0.3,
): Promise<VectorSearchResult[]> {
  const queryVec = await computeEmbeddingAsync(query)
  const scored: VectorSearchResult[] = []
  for (const f of facts) {
    if (f.status !== 'active') continue
    const factVec = f.embedding ?? (await computeEmbeddingAsync(f.text))
    const sim = cosineSimilarity(queryVec, factVec)
    if (sim >= minScore) {
      scored.push({ fact: f, similarity: sim })
    }
  }
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
}

export function isModelReady(): boolean {
  return modelReady
}

export function getModelError(): string | null {
  return modelError
}
