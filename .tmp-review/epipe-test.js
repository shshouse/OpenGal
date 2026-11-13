const { spawn } = require('node:child_process')
// 子进程立刻退出，模拟 ASR worker 崩溃
const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 0)'], { stdio: ['pipe','pipe','pipe'] })
let running = true
child.on('exit', (code) => { running = false; console.log('exit event', code) })
child.stdout.on('data', () => {})
child.stderr.on('data', () => {})
let i = 0
const timer = setInterval(() => {
  i++
  if (!running || child.killed) { console.log('skip', i); return }
  try { child.stdin.write(Buffer.alloc(1024)) } catch (e) { console.log('sync catch', e.code) }
}, 32)
setTimeout(() => { console.log('survived', i, 'writes'); process.exit(0) }, 3000)
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e.code || e.message); process.exit(7) })
