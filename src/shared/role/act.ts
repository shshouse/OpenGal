/** 皮套动作请求：模型通过 act 工具发起，渲染进程校验后执行。 */
export interface RoleActRequest {
  /** 表情名，允许使用别名（见 live2dBus 的映射表） */
  expression?: string
  /** 动作组名，必须与模型 motion group 完全对应 */
  motion?: string
}

export interface RoleActResult {
  ok: boolean
  /** 实际执行的内容，用于回给模型确认 */
  applied: string[]
  error?: string
}
