/** 向量化端口：桌面用本地 ONNX，移动端可换 ORT Mobile 或降级关键词检索。 */
export interface EmbeddingProvider {
  readonly dimensions: number
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>
}
