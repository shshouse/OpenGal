const { spawn } = require('node:child_process')
let uncaught = 0, emitted = 0, iterations = 0
process.on('uncaughtException', (e) => { uncaught++; console.log('UNCAUGHT:', e.code || e.message) })
function round() {
  iterations++
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(3), 15)'], { stdio: ['pipe','pipe','pipe'] })
  let running = true
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  child.on('exit', () => { running = false })
  child.stdin.on('error', (e) => { emitted++ })
  const t = setInterval(() => {
    if (!running || child.killed) return
    try { child.stdin.write(Buffer.alloc(4096)) } catch (e) { console.log('sync catch', e.code) }
  }, 1)
  setTimeout(() => { clearInterval(t); if (iterations < 60) round(); else console.log('rounds', iterations, 'uncaught', uncaught, 'emitted', emitted) }, 60)
}
round()
