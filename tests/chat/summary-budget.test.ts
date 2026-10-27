import { describe, expect, it } from 'vitest'
import { pickRecentSummaries } from '../../src/shared/summaryBudget'

interface Row {
  text: string
  end_ts: number
  start_ts: number
}

function row(end: number, text: string): Row {
  return { text, end_ts: end, start_ts: end - 1000 }
}

describe('摘要预算', () => {
  it('只保留最近的若干条，并按时间正序输出', () => {
    const rows = [row(5, '第五'), row(1, '第一'), row(3, '第三'), row(2, '第二'), row(4, '第四')]
    const picked = pickRecentSummaries(rows, 1000, 3)
    expect(picked.map((r) => r.text)).toEqual(['第三', '第四', '第五'])
  })

  it('按字符预算从新到旧累计，超出的旧摘要被丢弃', () => {
    const rows = [row(1, '甲'.repeat(40)), row(2, '乙'.repeat(40)), row(3, '丙'.repeat(40))]
    const picked = pickRecentSummaries(rows, 90, 10)
    expect(picked.map((r) => r.text.slice(0, 1))).toEqual(['乙', '丙'])
  })

  it('空输入返回空数组', () => {
    expect(pickRecentSummaries([], 100, 10)).toEqual([])
  })
})
