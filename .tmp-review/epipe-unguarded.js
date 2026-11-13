const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: ['pipe','pipe','pipe'] })
child.stdout.on('data', () => {})
child.stderr.on('data', () => {})
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e.code || e.message); process.exit(7) })
let n = 0
child.on('exit', () => {
  // 模拟 exit 之后仍在写入（不含 running 守卫）
  for (let k = 0; k < 5; k++) {
    n++
    try { child.stdin.write(Buffer.alloc(64)) ; console.log('write', k, 'returned', child.stdin.writable, child.stdin.destroyed) }
    catch (e) { console.log('sync catch', e.code) }
  }
  setTimeout(() => { console.log('done, writes=', n); process.exit(0) }, 500)
})
