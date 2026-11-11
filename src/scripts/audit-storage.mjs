#!/usr/bin/env node
/**
 * 存储与资源审计：横向扫一遍，不靠改到哪行看到哪行。
 * 用法：node src/scripts/audit-storage.mjs
 * 存在 high 级发现时退出码为 1。真实数据一律只读。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []

function report(severity, title, evidence) {
  findings.push({ severity, title, evidence })
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const sources = walk(path.join(ROOT, 'src')).map((file) => ({
  file: path.relative(ROOT, file).replace(/\\/g, '/'),
  text: fs.readFileSync(file, 'utf-8'),
}))

function findSource(fragment) {
  return sources.find((s) => s.file.endsWith(fragment))
}

// R1 写库前必须把 base64 图片落成文件
function checkExternalizedWrites() {
  for (const name of ['src/main/ipc/memoryIpc.ts', 'src/main/services/memory/legacy.ts']) {
    const source = findSource(name)
    if (!source) continue
    const writesMessages = /INSERT INTO messages|saveChatMessages\(/.test(source.text)
    if (writesMessages && !source.text.includes('externalizeMessage')) {
      report('high', '写消息时未做附件外置，base64 会直接进库', name)
    }
  }
}

// R2 表只增不减
function checkTableRetention() {
  const schema = findSource('src/main/services/memory/schema.ts')
  if (!schema) return
  const tables = [...schema.text.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1])
  for (const table of tables) {
    if (table.endsWith('_fts') || table === 'meta') continue
    const deleted = sources.some((s) => new RegExp(`DELETE FROM ${table}\\b`).test(s.text))
    if (!deleted) report('high', `表 ${table} 没有任何删除路径`, '全 src 未找到 DELETE FROM ' + table)
  }
}

// R2b 有 DELETE 不等于已启用保留策略；没人调用的维护函数不能让审计变绿
function checkChangelogRetentionEnabled() {
  const called = sources.some(
    (s) => !s.file.endsWith('src/main/services/memory/changelog.ts') && /pruneMemoryChangelog\s*\(/.test(s.text),
  )
  if (!called) {
    report(
      'high',
      'memory_changelog 保留策略尚未启用',
      '已有显式清理函数，但 src 无调用；批准保留上限前不会自动删除审计记录',
    )
  }
}

// R3 备份文件必须落在清理规则内
function checkBackupRetention() {
  const backup = findSource('src/main/services/memory/backup.ts')
  if (!backup) return
  const named = [...backup.text.matchAll(/`(memory-[^`]+)`|'(memory-[^']+)'/g)]
    .map((m) => m[1] ?? m[2])
  const hasTimestamped = named.some((n) => n.includes('${'))
  const covered = /pruneBackups/.test(backup.text)
    && /memory-pre-/.test(backup.text.split('BACKUP_RETENTION')[1] ?? '')
  if (hasTimestamped && !covered) {
    report(
      'high',
      '清理规则只认每日备份，带时间戳的迁移快照永不回收',
      named.filter((n) => n.includes('${')).join('、'),
    )
  }
}

// R4 密钥字段都要过 safeStorage
function checkSecretEncryption() {
  const config = findSource('src/shared/config.ts')
  const store = findSource('src/main/services/configStore.ts')
  if (!config || !store) return
  const fields = [...config.text.matchAll(/^\s*(\w*[Kk]ey): string/gm)].map((m) => m[1])
  for (const field of fields) {
    if (!new RegExp(`encrypt\\w*\\([^)]*${field}`).test(store.text)) {
      report('high', `密钥字段 ${field} 未加密落盘`, 'configStore 未找到对它的加密调用')
    }
  }
}

// R5 附件还原不能同步读盘：主进程会卡住所有 IPC
function checkSyncInline() {
  const media = findSource('src/main/services/media.ts')
  if (!media) return
  const inline = media.text.split('export function inlineAttachments')[1] ?? ''
  if (inline.includes('readFileSync')) {
    report('high', '附件还原在主进程同步读文件', 'media.ts inlineAttachments 使用 readFileSync')
  }
}

// R6 IPC 全量返回需要上限
function checkUnboundedIpc() {
  const logs = findSource('src/main/ipc/logsIpc.ts')
  if (logs && /logs\.list[\s\S]{0,200}getAllLogs\(\)/.test(logs.text)) {
    report('info', '日志水合一次返回全部内存日志', 'logs.list 无 limit 参数')
  }
}

checkExternalizedWrites()
checkTableRetention()
checkChangelogRetentionEnabled()
checkBackupRetention()
checkSecretEncryption()
checkSyncInline()
checkUnboundedIpc()

// 实测规模（只读）
function dirSize(dir) {
  let total = 0
  if (!fs.existsSync(dir)) return 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += dirSize(full)
      else total += fs.statSync(full).size
    } catch {
      /* 跳过不可读项 */
    }
  }
  return total
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

async function measure() {
  const dataRoot = path.join(ROOT, 'data')
  const lines = []
  const dbFile = path.join(dataRoot, 'memory.db')
  if (fs.existsSync(dbFile)) {
    try {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(dbFile, { readOnly: true })
      const one = (sql) => db.prepare(sql).get()
      lines.push(`消息 ${one('SELECT COUNT(*) c FROM messages').c} 条，其中已归档 ${one('SELECT COUNT(*) c FROM messages WHERE archived=1').c}`)
      lines.push(`记忆 ${one('SELECT COUNT(*) c FROM memories').c} 条，变更记录 ${one('SELECT COUNT(*) c FROM memory_changelog').c} 条`)
      lines.push(`含 base64 图片的消息 ${one("SELECT COUNT(*) c FROM messages WHERE content LIKE '%data:image%'").c} 条`)
      db.close()
    } catch (err) {
      lines.push(`数据库读取失败：${err.message}`)
    }
  }
  const backups = path.join(os.homedir(), 'Documents', 'OpenGal', 'backups')
  for (const [label, dir] of [
    ['记忆库', path.join(dataRoot, 'memory.db')],
    ['角色资产', path.join(dataRoot, 'roles')],
    ['运行日志', path.join(dataRoot, 'logs')],
    ['图片附件', path.join(dataRoot, 'attachments')],
    ['备份', backups],
  ]) {
    const size = fs.existsSync(dir) && fs.statSync(dir).isFile() ? fs.statSync(dir).size : dirSize(dir)
    if (size > 0) lines.push(`${label} ${mb(size)}`)
  }
  return lines
}

console.log('存储审计\n' + '='.repeat(48))
if (findings.length === 0) console.log('未发现规则覆盖范围内的问题')
for (const f of findings) {
  console.log(`[${f.severity}] ${f.title}\n       ${f.evidence}`)
}
console.log('\n实测（只读）\n' + '-'.repeat(48))
for (const line of await measure()) console.log(line)
process.exit(findings.some((f) => f.severity === 'high') ? 1 : 0)
