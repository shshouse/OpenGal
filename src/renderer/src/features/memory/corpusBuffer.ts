export interface CorpusEntry {
  characterId: string
  role: 'user' | 'assistant'
  text: string
  source?: string
  at: number
  seq: number
}

export class CorpusBuffer {
  private items: CorpusEntry[] = []
  private nextSeq = 1
  private readonly cap: number
  private readonly onTrim?: (dropped: number) => void

  constructor(cap = 1000, onTrim?: (dropped: number) => void) {
    this.cap = cap
    this.onTrim = onTrim
  }

  push(entry: Omit<CorpusEntry, 'seq'>): CorpusEntry {
    const item: CorpusEntry = { ...entry, seq: this.nextSeq++ }
    this.items.push(item)
    if (this.items.length > this.cap) {
      const dropped = this.items.length - this.cap
      this.items.splice(0, dropped)
      this.onTrim?.(dropped)
    }
    return item
  }

  // 快照：返回当前全部条目与最大序号。调用方在异步提取成功后用 maxSeq 精确删除。
  snapshot(): { entries: CorpusEntry[]; maxSeq: number } {
    const maxSeq = this.items[this.items.length - 1]?.seq ?? 0
    return { entries: this.items.slice(), maxSeq }
  }

  dropExtracted(characterId: string, upToSeq: number): void {
    this.items = this.items.filter((e) => e.characterId !== characterId || e.seq > upToSeq)
  }

  hasPendingUser(): boolean {
    return this.items.some((e) => e.role === 'user')
  }

  size(): number {
    return this.items.length
  }

  entries(): CorpusEntry[] {
    return this.items.slice()
  }
}
