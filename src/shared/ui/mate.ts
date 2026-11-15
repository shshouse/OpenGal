/** 相伴窗口的控制指令，经 mate:control 以 invoke 发送。 */
export type MateControl = 'open' | 'close' | 'dragStart' | 'dragMove'

/** 主窗口与相伴窗口之间的状态。sync 由渲染层上送，update 由主进程下发。 */
export type MateStatePayload =
  | { type: 'bubble'; text: string }
  | { type: 'performance'; emotion?: string; motion?: string; roleId?: string; speaking?: boolean }
  | { type: 'runtime'; runningRoles: Record<string, boolean>; activeRoleId: string | null }
  | { type: 'avatar'; dataUrl: string }
