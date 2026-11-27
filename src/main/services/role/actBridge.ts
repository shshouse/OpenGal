import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IpcChannels } from '@shared/app/ipc-channels'
import type { RoleActRequest, RoleActResult } from '@shared/role/act'
import { logBus } from '../infra/logBus'

const ACT_TIMEOUT_MS = 2500
const pending = new Map<
  string,
  { resolve: (result: RoleActResult) => void; timer: ReturnType<typeof setTimeout> }
>()

function normalizeResult(raw: unknown): RoleActResult {
  const value = (raw ?? {}) as Partial<RoleActResult>
  const applied = Array.isArray(value.applied)
    ? value.applied.filter((item): item is string => typeof item === 'string')
    : []
  return {
    ok: value.ok === true,
    applied,
    ...(typeof value.error === 'string' && value.error ? { error: value.error } : {}),
  }
}

function pickWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  const ready = windows.find((win) => win.isVisible() && !win.webContents.isLoading())
  return ready ?? windows[0] ?? null
}

/** 工具在主进程执行，皮套在渲染进程；这里做一次带超时的请求-响应。 */
export function requestRoleAct(request: RoleActRequest): Promise<RoleActResult> {
  const win = pickWindow()
  if (!win) {
    return Promise.resolve({ ok: false, applied: [], error: '当前没有可用的窗口' })
  }

  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      logBus.warn('role', '皮套动作请求超时')
      resolve({ ok: false, applied: [], error: '皮套没有响应' })
    }, ACT_TIMEOUT_MS)

    pending.set(requestId, { resolve, timer })
    win.webContents.send(IpcChannels.role.actRequest, requestId, request)
  })
}

export function registerRoleActBridge(): void {
  ipcMain.on(IpcChannels.role.actResult, (_event, requestId: unknown, result: unknown) => {
    if (typeof requestId !== 'string') return
    const entry = pending.get(requestId)
    if (!entry) return
    pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(normalizeResult(result))
  })
}
