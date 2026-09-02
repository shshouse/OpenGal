import assert from 'node:assert'
import {
  applyTtsPortShift,
  clearTtsPortShift,
  parseTtsPort,
  setTtsPortShift,
} from '../src/main/services/ttsPort.ts'

assert.strictEqual(parseTtsPort('http://127.0.0.1:9880'), 9880)
assert.strictEqual(parseTtsPort('http://127.0.0.1'), 9880)
assert.strictEqual(parseTtsPort('not a url'), 9880)

assert.strictEqual(applyTtsPortShift('http://127.0.0.1:9880'), 'http://127.0.0.1:9880')

setTtsPortShift(9880, 9883)
assert.strictEqual(applyTtsPortShift('http://127.0.0.1:9880/'), 'http://127.0.0.1:9883')
assert.strictEqual(applyTtsPortShift('http://127.0.0.1:9880'), 'http://127.0.0.1:9883')
assert.strictEqual(applyTtsPortShift('http://192.168.1.5:7000'), 'http://192.168.1.5:7000')
assert.strictEqual(applyTtsPortShift('bad url'), 'bad url')

clearTtsPortShift()
assert.strictEqual(applyTtsPortShift('http://127.0.0.1:9880'), 'http://127.0.0.1:9880')

console.log('selfcheck-ttsport: all pass')
