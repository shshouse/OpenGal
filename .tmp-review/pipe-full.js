const { spawn } = require('node:child_process')
let phase = 'fill'
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: ['pipe','pipe','pipe'] })
child.stdout.on('data', () => {})
child.stderr.on('data', () => {})
child.on('exit', (c, s) => { console.log('exit', c, s); phase = 'dead' })
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e.code || e.message); process.exit(7) })
let writes = 0
const t = setInterval(() => {
  if (child.killed) return
  writes++
  try { child.stdin.write(Buffer.alloc(65536)) } catch (e) { console.log('sync catch', e.code) }
}, 1)
setTimeout(() => { console.log('filling done, writes=', writes, 'killing'); child.kill(); }, 30)
setTimeout(() => { console.log('survived total writes', writes); process.exit(0) }, 1500)
