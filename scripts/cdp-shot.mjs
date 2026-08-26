/**
 * CDP 调试脚本：让主窗口重载（拿到干净的最新代码），等待模型加载后截图保存。
 * 用于远程验证 Live2D 渲染状态（模型是否可见、有无黑头套残留）。
 *
 * 用法：
 *   node scripts/cdp-shot.mjs out.png            # 立即重载并截图
 *   node scripts/cdp-shot.mjs out.png --no-reload # 不重载，直接截当前画面
 */
import { writeFileSync } from 'node:fs'

const port = process.env.OPENGAL_CDP_PORT || '9223'
const outFile = process.argv[2] || 'shot.png'
const reload = !process.argv.includes('--no-reload')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
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
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP call timeout: ${method}`))
      }, 10000)
      pending.set(id, (d) => { clearTimeout(timer); resolve(d) })
      ws.send(JSON.stringify({ id, method, params }))
    })

  if (reload) {
    // 用 location.reload() 而非 Page.reload：后者在页面重载后响应容易丢失
    await call('Runtime.evaluate', { expression: 'location.reload()', returnByValue: true })
    await sleep(3000)
    // 等 canvas 出现（模型开始渲染）
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      const r = await call('Runtime.evaluate', {
        expression: `!!document.querySelector('canvas')`,
        returnByValue: true
      })
      if (r.result?.result?.value === true) break
    }
    // 再等几秒让模型加载完成（比 canvas 首帧晚）
    await sleep(6000)
  }

  const shot = await call('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) {
    writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
    console.log('saved:', outFile)
  } else {
    console.error('screenshot failed:', JSON.stringify(shot.result?.error ?? shot).slice(0, 300))
    process.exit(1)
  }
  ws.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
