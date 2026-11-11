import { describe, expect, it } from 'vitest'
import { timeOfDayLabel } from '../../src/shared/timeOfDay'

const at = (hour: number): string => timeOfDayLabel(new Date(2026, 0, 1, hour, 30))

describe('timeOfDayLabel', () => {
  it('按小时给出统一的时段说法', () => {
    expect(at(3)).toBe('凌晨')
    expect(at(5)).toBe('清晨')
    expect(at(9)).toBe('上午')
    expect(at(12)).toBe('中午')
    expect(at(14)).toBe('下午')
    expect(at(18)).toBe('晚上')
    expect(at(23)).toBe('深夜')
  })
})
