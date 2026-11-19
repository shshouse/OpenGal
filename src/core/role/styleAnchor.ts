import type { RoleExampleTurn, RoleStateSnapshot } from './types'

const TOKEN_RE = /[\u3400-\u9fff\uf900-\ufaff]+|[A-Za-z0-9]+/g
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  const parts = text.match(TOKEN_RE) ?? []
  for (const part of parts) {
    if (CJK_RE.test(part)) {
      if (part.length === 1) tokens.add(part)
      for (let i = 0; i + 1 < part.length; i++) tokens.add(part.slice(i, i + 2))
    } else {
      tokens.add(part.toLowerCase())
    }
  }
  return tokens
}

export function selectStyleAnchors(
  examples: readonly RoleExampleTurn[] | undefined,
  greeting: string | undefined,
  query: string,
  limit = 3,
): RoleExampleTurn[] {
  const candidates: RoleExampleTurn[] = []
  if (greeting?.trim()) {
    candidates.push({ user: '（刚见面打招呼）', assistant: greeting.trim() })
  }
  for (const item of examples ?? []) {
    if (item.user?.trim() && item.assistant?.trim()) {
      candidates.push({ user: item.user.trim(), assistant: item.assistant.trim() })
    }
  }
  if (candidates.length <= limit) return candidates

  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return candidates.slice(0, limit)

  return candidates
    .map((entry, index) => {
      const entryTokens = tokenize(`${entry.user} ${entry.assistant}`)
      let overlap = 0
      for (const token of queryTokens) {
        if (entryTokens.has(token)) overlap++
      }
      return { entry, overlap, index }
    })
    .sort((a, b) => b.overlap - a.overlap || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry)
}

export function formatStyleAnchorBlock(
  examples: readonly RoleExampleTurn[] | undefined,
  greeting: string | undefined,
  query = '',
): string {
  const anchors = selectStyleAnchors(examples, greeting, query, 3)
  if (anchors.length === 0) return ''
  const lines = [
    '【角色原声语感锚点（仅锚定说话口癖、用词与句长，严禁照抄内容）】',
  ]
  for (const item of anchors) {
    lines.push(`对方：${item.user}`)
    lines.push(`台词示范：${item.assistant}`)
  }
  return lines.join('\u000a')
}

export function formatSelfStateBlock(state: RoleStateSnapshot | null | undefined): string {
  if (!state) return ''
  const lines = [
    '【你此刻的自身状态】',
    `- 当前心情：${state.mood}（精力 ${state.energy}/100）`,
    `- 与对方的关系阶段：${state.relationshipStage}`,
    `- 你刚刚正在做的事：${state.currentActivity}`,
  ]
  if (state.shortTermGoal.trim()) {
    lines.push(`- 你近期的心事或打算：${state.shortTermGoal.trim()}`)
  }
  return lines.join('\u000a')
}
