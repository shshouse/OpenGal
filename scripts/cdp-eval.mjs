/**
 * CDP 调试脚本：在主窗口页面里执行一段 JS 并打印结果。
 *
 * 用法：
 *   node scripts/cdp-eval.mjs 'window.__opengalLive2D.paramStats()'
 */
const port = process.env.OPENGAL_CDP_PORT || '9223'
const expression = process.argv[2]
if (!expression) {
  console.error('usage: node scripts/cdp-eval.mjs <js-expression>')
  process.exit(1)
}

const timeout = (ms, label) => {
  const t = setTimeout(() => { console.error(`timeout: ${label}`); process.exit(1) }, ms)
  return () => clearTimeout(t)
}

async function main() {
  const done = timeout(20000, 'overall')
  const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('devtools'))
  if (!page) throw new Error('no page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const openDone = timeout(8000, 'ws open')
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  openDone()

  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  }
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
      pending.set(id, (d) => { clearTimeout(t); resolve(d) })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const r = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  done()
  if (r.result?.exceptionDetails) {
    console.error('exception:', r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
    process.exit(1)
  }
  console.log(JSON.stringify(r.result?.result?.value, null, 2))
  ws.close()
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
