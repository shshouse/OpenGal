/**
 * CDP 调试脚本：向 OpenGal 主窗口的聊天输入框注入文字并发送，
 * 用于在无人工操作的情况下驱动完整对话流水线。
 *
 * 用法（先用 OPENGAL_CDP_PORT=9223 启动应用）：
 *   node scripts/cdp-send.mjs "你好呀，今天心情怎么样？"
 */

const port = process.env.OPENGAL_CDP_PORT || '9223'
const message = process.argv[2] || '你好呀，很高兴见到你！'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 等待调试端口就绪
  let targets = null
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`)
      targets = await res.json()
      break
    } catch {
      await sleep(1000)
    }
  }
  if (!targets) {
    console.error('CDP port not reachable')
    process.exit(1)
  }
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('devtools'))
  if (!page) {
    console.error('no page target; targets:', targets.map((t) => `${t.type}:${t.url}`))
    process.exit(1)
  }
  console.log('attaching to:', page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data)
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data)
      pending.delete(data.id)
    }
  }
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.result?.exceptionDetails) {
      return { error: r.result.exceptionDetails.text }
    }
    return r.result?.result ?? { error: 'no result' }
  }

  // 等待渲染层加载完成（textarea 出现）
  for (let i = 0; i < 60; i++) {
    const has = await evalJs(`!!document.querySelector('textarea')`)
    if (has.value === true) break
    await sleep(1000)
  }

  // 注入文本并触发 React input
  const typeRes = await evalJs(`(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return 'no textarea'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(message)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)
  console.log('type:', typeRes.value)

  await sleep(300)

  // Enter 发送
  const sendRes = await evalJs(`(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return 'no textarea'
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return 'enter'
  })()`)
  console.log('send:', sendRes.value)

  // 轮询读取对话气泡，直到出现助手回复或超时
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const state = await evalJs(`(() => {
      const ta = document.querySelector('textarea')
      const sending = document.body.innerText.includes('……')
      return JSON.stringify({ draft: ta ? ta.value : null })
    })()`)
    console.log(`[${i * 2}s]`, state.value)
    // 30 秒后退出观察，交给终端日志
    if (i >= 14) break
  }

  ws.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
