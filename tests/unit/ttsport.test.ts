import { describe, expect, it } from 'vitest'
import { applyTtsPortShift, clearTtsPortShift, parseTtsPort, setTtsPortShift } from '../../src/main/services/ttsPort'

describe('ttsPort', () => {
  it('解析端口并在缺失时使用默认值', () => {
    expect(parseTtsPort('http://127.0.0.1:9880')).toBe(9880)
    expect(parseTtsPort('http://127.0.0.1')).toBe(39880)
    expect(parseTtsPort('not a url')).toBe(39880)
  })

  it('按偏移改写本地端口，不影响其他地址', () => {
    expect(applyTtsPortShift('http://127.0.0.1:9880')).toBe('http://127.0.0.1:9880')
    setTtsPortShift(9880, 9883)
    expect(applyTtsPortShift('http://127.0.0.1:9880/')).toBe('http://127.0.0.1:9883')
    expect(applyTtsPortShift('http://127.0.0.1:9880')).toBe('http://127.0.0.1:9883')
    expect(applyTtsPortShift('http://192.168.1.5:7000')).toBe('http://192.168.1.5:7000')
    expect(applyTtsPortShift('bad url')).toBe('bad url')
    clearTtsPortShift()
    expect(applyTtsPortShift('http://127.0.0.1:9880')).toBe('http://127.0.0.1:9880')
  })
})
