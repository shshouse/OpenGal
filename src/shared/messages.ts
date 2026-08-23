/**
 * 流水线消息模型，对齐 RachelForster 的三段流水线命名（UserInput → LLMDialog → TTSOutput）。
 *
 * 与 LLM 历史/请求层使用的 `ChatMessage` 区分：这里的 message 类型只在
 * 渲染进程内的 Worker 总线上传递，描述「从用户输入到最终 UI 演出」的中间数据。
 */

export interface UserInputMessage {
  /** 用户输入正文 */
  text: string
  /** 输入来源：手动输入 / 选项点击 / 语音识别 / 插件触发 / 弹幕 */
  source?: 'user' | 'option' | 'voice' | 'plugin' | 'live'
}

/**
 * LLM 输出的一条对话片段。
 *
 * `name` 既可以是角色名，也可以是 RachelForster 风格的系统关键字（如 BGM / CG / NARR / 选项）。
 * 当前实现先按「单角色 + 情绪 + 文本」最小集落地，AVG 演出层（M3）会扩展系统关键字派发。
 */
export interface LLMDialogMessage {
  /** 实体名：角色名（当前激活角色的名字）或系统关键字 */
  name: string
  /** 台词正文 */
  text: string
  /** 资源编号（立绘索引 / BGM 索引等），缺省 `-1` 表示不变化 */
  assetId?: string | number
  /** 情绪标签（neutral/happy/sad/...），驱动 Live2D 表情或立绘切图 */
  emotion?: string
  /** 特效名（fade/zoom/...），具体含义由演出后端决定 */
  effect?: string
  /** 可选翻译，若存在则 TTS 用翻译文本而非原文 */
  translate?: string
}

/**
 * TTSWorker 处理后送往 UIWorker 的最终演出包。
 *
 * 注意：在桌面端实现里，音频通常以 `data:` URL 或 base64 的形式传递，而非文件路径。
 * 字段命名仍沿用 RachelForster 的 `audioUrl` 概念。
 */
export interface TTSOutputMessage {
  /** 音频资源 URL（dataUrl / blobUrl / 空字符串表示无音频） */
  audioUrl: string
  /** 实体名 */
  name: string
  /** 台词正文（系统消息可为空） */
  text: string
  /** 资源编号 */
  assetId?: string | number
  /** 情绪标签 */
  emotion?: string
  /** 特效名 */
  effect?: string
  /** 是否为系统类消息（COT/BGM/CG 等不进对话气泡） */
  isSystem?: boolean
  /** 多段 TTS 中是否最后一段（驱动 ASR 恢复、effect after-dialog 等） */
  isFinalSegment?: boolean
  /** 可选的最少展示时间（秒），缺省按文本长度估算 */
  minDisplaySeconds?: number
}

/**
 * 模型思维链（reasoning）增量。
 *
 * 与 `LLMDialogMessage` 走不同通道，避免混入对话气泡。UI 端只在底栏 BusyBar 预览。
 */
export interface ReasoningMessage {
  /** 本次增量文本 */
  delta: string
  /** 当轮累计文本（便于不存增量历史的 UI 直接展示总览） */
  accumulated: string
}

/**
 * 一轮 LLM 流式生成的终结信号。
 */
export interface LLMTurnDoneMessage {
  ok: boolean
  error?: string
}
