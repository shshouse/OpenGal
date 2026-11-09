// 复杂度 ratchet：基线内的超标函数可以留，新增的不允许。
// 只比每个文件的超标函数「数量」，不比具体函数名——匿名函数多，名字不稳定。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')
const BASELINE = path.join(ROOT, 'config/complexity-baseline.json')
const THRESHOLDS = { cc: 15, lines: 60, params: 5 }

const DECISION = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
])
const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function collect() {
  const counts = new Map()
  const offenders = []

  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const source = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.ES2022,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    let fileCount = 0

    function visit(node) {
      const isFn =
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)

      if (isFn) {
        const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
        const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line
        const lines = endLine - startLine + 1
        let cc = 1

        function probe(n) {
          if (DECISION.has(n.kind)) cc++
          if (ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind)) cc++
          ts.forEachChild(n, probe)
        }
        ts.forEachChild(node, probe)

        const params = node.parameters?.length ?? 0
        if (cc >= THRESHOLDS.cc || lines >= THRESHOLDS.lines || params >= THRESHOLDS.params) {
          fileCount++
          offenders.push({
            file: rel,
            line: startLine + 1,
            cc,
            lines,
            params,
            name: node.name ? node.name.getText(sf).slice(0, 40) : '<anonymous>',
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)

    if (fileCount > 0) counts.set(rel, fileCount)
  }

  return { counts, offenders }
}

const { counts, offenders } = collect()

function groupByFile() {
  const byFile = new Map()
  for (const offender of offenders) {
    const list = byFile.get(offender.file) ?? []
    list.push(offender)
    byFile.set(offender.file, list)
  }
  return [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)
}

if (process.argv.includes('--list')) {
  for (const [file, list] of groupByFile()) {
    console.log(`${list.length}  ${file}`)
    for (const offender of list) {
      console.log(`    L${offender.line} ${offender.name}  CC=${offender.cc} 行数=${offender.lines} 参数=${offender.params}`)
    }
  }
  console.log(`\n共 ${offenders.length} 个超标函数，${counts.size} 个文件`)
  process.exit(0)
}

if (process.argv.includes('--update')) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    thresholds: THRESHOLDS,
    total: offenders.length,
    files: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
  }
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n')
  console.log(`基线已写入 ${path.relative(ROOT, BASELINE)}：${offenders.length} 个超标函数，${counts.size} 个文件`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE)) {
  console.error(`缺少基线文件 ${path.relative(ROOT, BASELINE)}，先运行：node src/scripts/check-complexity.mjs --update`)
  process.exit(1)
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
const baseFiles = baseline.files ?? {}
const baseTotal = baseline.total ?? 0

const regressions = []
const improved = []
let currentTotal = 0
// 基线里有、当前已经没有的文件也要算进来，否则“整文件清零”不会被识别成改进
for (const file of new Set([...counts.keys(), ...Object.keys(baseFiles)])) {
  const now = counts.get(file) ?? 0
  const allowed = baseFiles[file] ?? 0
  currentTotal += now
  if (now > allowed) regressions.push({ file, now, allowed })
  if (now < allowed) improved.push({ file, now, allowed })
}

// 债务数字同时写进 Actions 摘要，避免绿灯把债务藏起来
function writeStepSummary(status, totals) {
  const target = process.env.GITHUB_STEP_SUMMARY
  if (!target) return
  const top = groupByFile().slice(0, 5)
  const rows = [
    `### 复杂度门禁：${status}`,
    '',
    '| 指标 | 值 |',
    '| --- | --- |',
    `| 当前超标函数 | ${totals.currentTotal} |`,
    `| 基线 | ${totals.baseTotal} |`,
    `| 回归文件 | ${regressions.length} |`,
    `| 可收紧文件 | ${improved.length} |`,
  ]
  if (top.length > 0) {
    rows.push('', '债务最多的文件：', '')
    for (const [file, list] of top) rows.push(`- \`${file}\`：${list.length}`)
  }
  if (regressions.length > 0) {
    rows.push('', '回归：', '')
    for (const r of regressions) rows.push(`- \`${r.file}\`：${r.allowed} → ${r.now}`)
  }
  fs.appendFileSync(target, rows.join('\n') + '\n')
}

if (regressions.length > 0) {
  console.error('复杂度回归：以下文件的超标函数数量超过基线\n')
  for (const r of regressions) {
    console.error(`  ${r.file}  基线 ${r.allowed} → 当前 ${r.now}`)
    for (const o of offenders.filter((x) => x.file === r.file)) {
      console.error(`    L${o.line} ${o.name}  CC=${o.cc} 行数=${o.lines} 参数=${o.params}`)
    }
  }
  console.error(`\n总计：基线 ${baseTotal} → 当前 ${currentTotal}`)
  console.error('拆分函数后重跑；确需调整基线请运行 --update 并在评审中说明原因。')
  writeStepSummary('未通过', { currentTotal, baseTotal })
  process.exit(1)
}

console.log(`复杂度检查通过：${currentTotal} 个超标函数（基线 ${baseTotal}，未新增）`)
if (improved.length > 0) {
  const files = improved.map((item) => `${item.file}（${item.allowed} → ${item.now}）`).join('、')
  console.log(`已有文件低于基线：${files}`)
  console.log('运行 node src/scripts/check-complexity.mjs --update 收紧基线，把收益锁定')
}
writeStepSummary('通过', { currentTotal, baseTotal })
