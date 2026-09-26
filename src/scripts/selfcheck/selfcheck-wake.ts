import assert from 'node:assert'
import { WAKE_OPEN_MS, wakeEyeOpen } from '../../shared/wake.ts'

assert.strictEqual(wakeEyeOpen(0, 0), 0)
assert.strictEqual(wakeEyeOpen(0, -100), 0)
assert.strictEqual(wakeEyeOpen(0, WAKE_OPEN_MS), 1)
assert.strictEqual(wakeEyeOpen(0, WAKE_OPEN_MS * 10), 1)

let prev = -1
for (let t = 0; t <= WAKE_OPEN_MS; t += 16) {
  const v = wakeEyeOpen(0, t)
  assert.ok(v >= prev && v >= 0 && v <= 1, `t=${t} v=${v}`)
  prev = v
}
assert.strictEqual(prev, 1)
assert.ok(Math.abs(wakeEyeOpen(0, WAKE_OPEN_MS / 2) - 0.5) < 1e-9)

console.log('selfcheck-wake: all pass')
