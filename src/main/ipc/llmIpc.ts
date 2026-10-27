import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { LLMRequest, LLMResponse } from '@shared/types'
import { callLLM, callLLMStream, abortStream, listProviderModels } from '../services/llmClient'
import { getToolDefinitions, executeTool } from '../services/tools'
import { scanPlugins, setPluginEnabled, rescanPlugins, getPluginManifest } from '../services/plugins/registry'
import { wrap } from './wrap'

export function registerLlmIpc(): void {

  ipcMain.handle(IpcChannels.llm.chat, (_, request: LLMRequest) =>
    wrap<LLMResponse>(() => callLLM(request))
  )

  ipcMain.handle(
    IpcChannels.llm.chatStream,
    (event, request: LLMRequest, streamId: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'No window' }
      callLLMStream(request, streamId, win.webContents).catch(() => {})
      return { success: true }
    }
  )

  ipcMain.handle(IpcChannels.llm.streamAbort, (_, streamId: string) => {
    abortStream(streamId)
    return { success: true }
  })

  ipcMain.handle(
    IpcChannels.llm.listModels,
    (_, baseURL: string, apiKey: string) =>
      wrap<string[]>(() => listProviderModels(baseURL, apiKey))
  )

  ipcMain.handle(IpcChannels.tools.list, () => wrap(() => getToolDefinitions()))
  ipcMain.handle(IpcChannels.tools.execute, (_, name: string, argsJson: string) =>
    wrap(() => executeTool(name, argsJson))
  )
  ipcMain.handle(IpcChannels.plugins.list, () => wrap(() => scanPlugins()))
  ipcMain.handle(IpcChannels.plugins.setEnabled, (event, pluginId: string, enabled: boolean) =>
    wrap(async () => {
      if (enabled) {
        const m = getPluginManifest(pluginId)
        const servers = m.contributions?.mcpServers ?? []
        if (servers.length > 0) {
          // 启用即 spawn 本地进程：必须用户在本机原生弹窗里明确同意，渲染进程无法绕过
          const win = BrowserWindow.fromWebContents(event.sender)
          const cmds = servers
            .map((s) => (s.command ? `${s.command} ${(s.args ?? []).join(' ')}`.trim() : (s.url ?? '')))
            .join('\n')
          const perms = (m.permissions ?? []).join('、') || '无声明'
          const { response } = await dialog.showMessageBox(win!, {
            type: 'warning',
            title: '启用插件',
            message: `启用插件「${m.name}」？`,
            detail: `该插件将在你的电脑上启动本地进程：\n${cmds}\n\n声明权限：${perms}`,
            buttons: ['启用', '取消'],
            defaultId: 1,
            cancelId: 1,
          })
          if (response !== 0) return scanPlugins()
        }
      }
      await setPluginEnabled(pluginId, enabled)
      return scanPlugins()
    })
  )
  ipcMain.handle(IpcChannels.plugins.rescan, () => wrap(() => rescanPlugins()))
}
