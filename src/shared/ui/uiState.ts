export type AppViewName = 'home' | 'chat' | 'market' | 'settings' | 'logs'

export interface SavedRect {
  x?: number
  y?: number
  width: number
  height: number
}

export interface WindowState extends SavedRect {
  maximized?: boolean
}

export interface MateState extends SavedRect {
  open?: boolean
}

export interface ChatLayoutState {
  ratio: number
  collapsed: boolean
}

export interface MarketViewState {
  page: number
  sort: string
  category?: string
}

export interface LogsViewState {
  levels?: string[]
  source?: string
  query?: string
  following?: boolean
}

/** 只存小型、非增长的界面偏好；聊天/记忆/角色资产不在这里。 */
export interface UIState {
  view?: AppViewName
  window?: WindowState
  mate?: MateState
  chat?: ChatLayoutState
  roleTab?: string
  settingsTab?: string
  market?: MarketViewState
  logs?: LogsViewState
  homeSelectedId?: string | null
  memorySearch?: string
}

type SectionKey = 'window' | 'mate' | 'chat' | 'market' | 'logs'

/** 允许只提交某个分区的部分字段，例如 { mate: { open: true } }。 */
export type UIStatePatch = {
  [K in keyof UIState]?: K extends SectionKey ? Partial<NonNullable<UIState[K]>> : UIState[K]
}

export function mergeUIState(current: UIState, patch: UIStatePatch): UIState {
  const next: UIState = { ...current, ...patch } as UIState
  if (patch.window) next.window = { ...current.window, ...patch.window } as UIState['window']
  if (patch.mate) next.mate = { ...current.mate, ...patch.mate } as UIState['mate']
  if (patch.chat) next.chat = { ...current.chat, ...patch.chat } as UIState['chat']
  if (patch.market) next.market = { ...current.market, ...patch.market } as UIState['market']
  if (patch.logs) next.logs = { ...current.logs, ...patch.logs } as UIState['logs']
  return next
}
