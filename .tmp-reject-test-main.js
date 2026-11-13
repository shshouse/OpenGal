const { app } = require('electron')
app.whenReady().then(() => {
  process.on('uncaughtException', (err) => {
    console.log('[fatal] main uncaughtException:', err && err.message)
    process.exit(1)
  })
  console.log('whenReady fired, node', process.versions.node, 'electron', process.versions.electron)
  console.log('has unhandledRejection listeners:', process.listenerCount('unhandledRejection'))
  void (async () => { throw new TypeError('simulated: p.startsWith is not a function') })()
  console.log('sync code after void restoreEnabled() ran')
  setTimeout(() => { console.log('timer fired, process still alive after 1500ms'); app.exit(0) }, 1500)
})
