import { SpeechStreamParser } from './roleCard'

export interface PerformanceSegment {
  text: string
  emotion?: string
  motion?: string
}

export interface ParsedPerformance {
  /** 原始输出，含行内表演标记；用于落库与下一轮历史 */
  raw: string
  /** 去掉标记后给用户看的文本 */
  displayText: string
  /** 送进 TTS 的文本，不含任何表演标记 */
  ttsText: string
  /** 皮套消费的片段与动作 */
  segments: PerformanceSegment[]
}

/**
 * 表演模块的单一入口：一行台词同时给出"原文 / 展示 / 语音 / 皮套"四种视图。
 * 后续支持更多表演通道时，在这里扩展，不要把解析散到各个消费者里。
 */
export function parsePerformance(raw: string): ParsedPerformance {
  const parser = new SpeechStreamParser()
  const items = [...parser.feed(raw), ...parser.flush()]
  const text = items.map((item) => item.text).join('')
  return {
    raw,
    displayText: text,
    ttsText: text,
    segments: items.map((item) => ({
      text: item.text,
      emotion: item.emotion,
      motion: item.action,
    })),
  }
}
