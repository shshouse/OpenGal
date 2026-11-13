const { spawn } = require('node:child_process')
let rounds = 0, crashes = 0, totalRounds = 300
function round() {
  rounds++
  const delay = Math.floor(Math.random() * 40)
  const child = spawn(process.execPath, ['-e', `setTimeout(()=>process.exit(1), ${delay})`], { stdio: ['pipe','pipe','pipe'] })
  let running = true
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  child.on('exit', () => { running = false })
  const t = setInterval(() => {
    if (!running || child.killed) { return }
    try { child.stdin.write(Buffer.alloc(1024)) } catch (e) { crashes++; console.log('sync catch', e.code) }
  }, 32)
  setTimeout(() => {
    clearInterval(t)
    if (rounds < totalRounds) round()
    else console.log('rounds', rounds, 'uncaught', crashes)
  }, 120)
}
process.on('uncaughtException', (e) => { crashes++; console.log('UNCAUGHT:', e.code || e.message) })
round()
