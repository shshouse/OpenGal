import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { LLMRequest } from '@shared/types'
import { callLLM, callLLMStream, abortStream, listProviderModels } from '../services/llmClient'
import { getToolDefinitions, executeTool } from '../services/tools'
import { inlineAttachments } from '../services/media'
import { scanPlugins, setPluginEnabled, rescanPlugins, getPluginManifest } from '../services/plugins/registry'
import { wrap } from './wrap'
import { handleValidated, handleValidatedRaw, handleValidatedWithEvent } from './validated'
import { llmRequestSchema } from '@shared/schemas'
import { z } from 'zod'

export function registerLlmIpc(): void {

  handleValidated(IpcChannels.llm.chat, [llmRequestSchema], (request) => {
    // schema 已校验结构；passthrough 允许的额外字段使推导类型比 LLMRequest 宽
    const typed = request as LLMRequest
    // 库里只存附件引用，发请求前再还原成 data URL
    return callLLM({ ...typed, messages: inlineAttachments(typed.messages) })
  })

  ipcMain.handle(
    IpcChannels.llm.chatStream,
    (event, request: unknown, streamId: unknown) => {
      const parsed = llmRequestSchema.safeParse(request)
      const sid = z.string().min(1).safeParse(streamId)
      if (!parsed.success || !sid.success) return { success: false, error: '参数不合法' }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'No window' }
      const typed = parsed.data as LLMRequest
      void callLLMStream({ ...typed, messages: inlineAttachments(typed.messages) }, sid.data, win.webContents).catch(() => {})
      return { success: true }
    }
  )

  handleValidatedRaw(IpcChannels.llm.streamAbort, [z.string().min(1)], (streamId) => {
    abortStream(streamId)
    return { success: true }
  })

  handleValidated(IpcChannels.llm.listModels, [z.string().min(1), z.string()], (baseURL, apiKey) =>
    listProviderModels(baseURL, apiKey),
  )

  ipcMain.handle(IpcChannels.tools.list, () => wrap(() => getToolDefinitions()))
  handleValidated(IpcChannels.tools.execute, [z.string().min(1), z.string()], (name, argsJson) =>
    executeTool(name, argsJson),
  )
  ipcMain.handle(IpcChannels.plugins.list, () => wrap(() => scanPlugins()))
  handleValidatedWithEvent(IpcChannels.plugins.setEnabled, [z.string().min(1), z.boolean()], async (event, pluginId, enabled) => {
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
  ipcMain.handle(IpcChannels.plugins.rescan, () => wrap(() => rescanPlugins()))
}
