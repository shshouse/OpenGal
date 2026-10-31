// 复杂度 ratchet：基线内的超标函数可以留，新增的不允许。
// 口径与 docs/opengal/code-quality-audit-2026-10-31.md 一致：CC>=15 或 行数>=60 或 参数>=5。
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
for (const [file, count] of counts) {
  const allowed = baseFiles[file] ?? 0
  if (count > allowed) regressions.push({ file, now: count, allowed })
}

const improved = []
let currentTotal = 0
for (const [file, count] of counts) {
  currentTotal += count
  const allowed = baseFiles[file] ?? 0
  if (count < allowed) improved.push({ file, now: count, allowed })
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
  process.exit(1)
}

console.log(`复杂度检查通过：${currentTotal} 个超标函数（基线 ${baseTotal}）`)
if (improved.length > 0 || currentTotal < baseTotal) {
  console.log('有文件低于基线，可运行 node src/scripts/check-complexity.mjs --update 收紧基线')
}
