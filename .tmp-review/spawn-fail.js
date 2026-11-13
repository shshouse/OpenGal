const { spawn } = require('node:child_process')
// 复刻 sherpaEngine 的监听集合（无 'error'）
const c = spawn('D:/nonexistent-xyz/python.exe', ['-c', 'pass'], { stdio: ['pipe','pipe','pipe'], windowsHide: true })
c.stdout.on('data', () => {})
c.stderr.on('data', () => {})
c.on('exit', (code) => console.log('exit', code))
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e.code || e.message); process.exit(7) })
setTimeout(() => { console.log('survived'); process.exit(0) }, 1500)
