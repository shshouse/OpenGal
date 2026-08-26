/**
 * CDP 调试脚本：从运行中的应用里提取「LLM 实际收到的完整请求」。
 *
 * 组装 llmWorker.runTurn 的完整输入：system prompt（含动作组菜单）、
 * chatStore 历史、工具定义。输出 JSON 到 stdout 或指定文件。
 *
 * 用法：
 *   node scripts/cdp-dump-payload.mjs            # 打印到 stdout
 *   node scripts/cdp-dump-payload.mjs out.json   # 同时写文件
 */
import { writeFileSync } from 'node:fs'

const port = process.env.OPENGAL_CDP_PORT || '9223'
const outFile = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('devtools'))
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  }
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
      pending.set(id, (d) => { clearTimeout(t); resolve(d) })
      ws.send(JSON.stringify({ id, method, params }))
    })

  // 在页面里动态 import 各模块，按 llmWorker.runTurn 的真实逻辑组装 payload。
  // URL 必须与应用模块图一致才能拿到同一个 store 实例：renderer root 内用 /src/...，
  // root 外（src/shared）用 /@fs/ 绝对路径
  const root = 'D:/Project2025/MikuMod/OpenGal'
  const expression = `(async () => {
    const roleCard = await import('/@fs/${root}/src/shared/roleCard.ts')
    const chatStore = await import('/src/features/chat/chatStore.ts')
    const characterStore = await import('/src/features/character/characterStore.ts')
    const groups = window.__opengalLive2D ? window.__opengalLive2D.getMotionGroups() : []
    const cs = characterStore.useCharacterStore.getState()
    const card = cs.list.find((c) => c.id === cs.activeId) || null
    const history = chatStore.useChatStore.getState().messages
    const toolsResp = await window.opengal.tools.list()
    const tools = toolsResp.success ? toolsResp.data : []
    return JSON.stringify({
      cardName: card ? card.name : null,
      motionGroups: groups,
      systemPrompt: roleCard.buildSystemPrompt(card, groups),
      history,
      tools,
    })
  })()`

  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) {
    console.error('exception:', r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
    process.exit(1)
  }
  const payload = r.result?.result?.value
  if (!payload) { console.error('empty result'); process.exit(1) }
  if (outFile) { writeFileSync(outFile, payload); console.log('saved:', outFile) }
  console.log(payload)
  ws.close()
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
