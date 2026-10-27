import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  initMemoryDb,
  memoryDbReady,
  closeMemoryDb,
  searchMessages,
  type MessageRow,
} from '../main/services/memoryDb.ts'

interface EvalQuestion {
  id: string
  character: string
  query: string
  from?: string
  to?: string
  expect?: string
  forbid?: string
}

interface EvalResult {
  id: string
  pass: boolean
  detail: string
}

function parseArgs(argv: string[]): { data: string; questions: string } {
  let data = path.resolve('data')
  let questions = path.resolve('tests/fixtures/memory-eval-questions.json')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data') data = path.resolve(argv[++i])
    else if (argv[i] === '--questions') questions = path.resolve(argv[++i])
  }
  return { data, questions }
}

function messageText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return parsed
    if (!parsed || typeof parsed !== 'object') return raw
    const content = (parsed as { content?: unknown }).content
    return typeof content === 'string' ? content : raw
  } catch {
    return raw
  }
}

function render(rows: MessageRow[]): string | null {
  if (rows.length === 0) return null
  return rows
    .map((row) => `[${new Date(row.ts).toISOString().slice(0, 10)}] ${row.role}: ${messageText(row.content)}`)
    .join('\n')
}

function runQuestion(question: EvalQuestion, text: string | null): EvalResult {
  const detail = text ? text.replace(/\s+/g, ' ').slice(0, 160) : '(空)'
  if (!text) return { id: question.id, pass: !question.expect, detail }
  if (question.forbid) return { id: question.id, pass: !text.includes(question.forbid), detail }
  if (question.expect) return { id: question.id, pass: text.includes(question.expect), detail }
  return { id: question.id, pass: true, detail }
}

async function main(): Promise<void> {
  const { data, questions } = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(questions)) {
    console.error(`题目文件不存在: ${questions}`)
    process.exit(2)
  }
  if (!fs.existsSync(path.join(data, 'memory.db'))) {
    console.error(`记忆库不存在: ${path.join(data, 'memory.db')}`)
    process.exit(2)
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-eval-'))
  fs.cpSync(data, workDir, { recursive: true })
  const list = JSON.parse(fs.readFileSync(questions, 'utf-8')) as EvalQuestion[]
  await initMemoryDb(workDir)
  await memoryDbReady()
  const results: EvalResult[] = []
  for (const question of list) {
    const rows = searchMessages(question.character, question.query, {
      fromTs: question.from ? Date.parse(question.from) : undefined,
      toTs: question.to ? Date.parse(question.to) : undefined,
    })
    results.push(runQuestion(question, render(rows)))
  }
  closeMemoryDb()
  fs.rmSync(workDir, { recursive: true, force: true })
  const passed = results.filter((r) => r.pass).length
  console.log(JSON.stringify({ total: results.length, passed, results }, null, 2))
  console.log(`\n命中 ${passed}/${results.length}`)
  process.exit(passed === results.length ? 0 : 1)
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
