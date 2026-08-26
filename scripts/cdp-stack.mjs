/** 抓取渲染层未捕获 Promise 拒绝的完整堆栈 */
const port = process.env.OPENGAL_CDP_PORT || '9223'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('devtools'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  }
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? 'no-result'
  }

  await evalJs(`window.__stacks = [];
    window.addEventListener('unhandledrejection', e => {
      window.__stacks.push(String((e.reason && e.reason.stack) || e.reason));
    });`)
  console.log('listener installed, waiting 16s for next periodic error...')
  await sleep(16000)
  const stacks = await evalJs('JSON.stringify(window.__stacks, null, 1)')
  console.log('STACKS:', stacks)
  ws.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
