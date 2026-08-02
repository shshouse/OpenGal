/**
 * TTS 适配器抽象。对齐 RachelForster 的 `sdk/adapters/tts.TTSAdapter`。
 *
 * 设计：
 * - 适配器无状态：可以被多个角色共用，所有运行时参数从 TTSAdapterRequest 传入
 * - generateSpeech 返回标准化的 base64 + mimeType（main 进程内打包给前端）
 * - 模型切换（如 GPT-SoVITS 的 set_gpt_weights / set_sovits_weights）由适配器内部根据
 *   request 自行决定是否需要重切，调用方不必关心
 */

import type { RoleCardEntry, TTSConfig } from '@shared/types'

export interface TTSGenerateRequest {
  text: string
  /** 顶层 TTSConfig：通常来自 `AppConfig.tts`，可被角色卡覆盖 */
  globalConfig: TTSConfig
  /** 当前激活角色卡（main 端视图），用于解析相对路径和 voice 配置 */
  card?: RoleCardEntry | null
  /** 显式 overrides（IPC 调用方传入），优先级最高 */
  overrides?: Partial<TTSConfig>
}

export interface TTSGenerateResponse {
  audioBase64: string
  mimeType: string
}

export interface TTSAdapter {
  /** 适配器协议标识，与 RoleCard.voice.provider 字段对应 */
  readonly provider: string
  /** 健康检查：TTS server 是否在线 */
  ping(req: { globalConfig: TTSConfig }): Promise<{ ok: boolean; message?: string }>
  /** 合成语音 */
  generateSpeech(req: TTSGenerateRequest): Promise<TTSGenerateResponse>
  /** 重置内部状态（如缓存的 weights 标记），用于切换角色/模型时强制重切 */
  reset(): void
}
