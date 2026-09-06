import { app } from 'electron'

app.whenReady().then(async () => {
  try {
    const mod = await import('better-sqlite3')
    console.log('SQLITE-LOADED', typeof mod.default)
    const Database = mod.default
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t(x)')
    db.prepare('INSERT INTO t VALUES(?)').run(1)
    console.log('SQLITE-OK', db.prepare('SELECT x FROM t').get())
    db.close()
  } catch (e) {
    console.log('SQLITE-FAIL', e.message)
  }
  app.exit(0)
})
setTimeout(() => app.exit(2), 15000)
