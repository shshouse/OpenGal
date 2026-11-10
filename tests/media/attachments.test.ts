import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ATTACHMENT_PREFIX, externalizeMessage, inlineAttachments } from '../../src/main/services/media'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-media-'))
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function message(url = PNG) {
  return {
    role: 'user',
    content: [
      { type: 'text', text: '看这个' },
      { type: 'image_url', image_url: { url } },
    ],
  }
}

describe('图片附件落盘', () => {
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('写库前把 base64 换成文件引用', () => {
    const clean = externalizeMessage(message(), root)
    const url = (clean as { content: Array<{ image_url?: { url: string } }> }).content[1].image_url?.url ?? ''
    expect(url.startsWith(ATTACHMENT_PREFIX)).toBe(true)
    const file = path.join(root, decodeURIComponent(url.slice(ATTACHMENT_PREFIX.length)))
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.statSync(file).size).toBeGreaterThan(0)
  })

  it('同一张图只落一份文件', () => {
    externalizeMessage(message(), root)
    const files = fs.readdirSync(root)
    expect(files).toHaveLength(1)
  })

  it('发请求前能还原成 data URL', () => {
    const clean = externalizeMessage(message(), root)
    const restored = inlineAttachments(clean, root)
    expect(restored).toEqual(message())
  })

  it('工具结果里的图片同样会被搬走', () => {
    const withTool = {
      role: 'assistant',
      content: '拍好了',
      toolCalls: [{ name: 'screenshot', result: `拍屏结果 ${PNG}` }],
    }
    const clean = externalizeMessage(withTool, root)
    expect(JSON.stringify(clean)).not.toContain('data:image/')
    expect(JSON.stringify(clean)).toContain(ATTACHMENT_PREFIX)
  })

  it('文件丢了就保留原引用，不抛错', () => {
    const clean = externalizeMessage(message(), root)
    fs.rmSync(root, { recursive: true, force: true })
    const restored = inlineAttachments(clean, root)
    expect(JSON.stringify(restored)).toContain(ATTACHMENT_PREFIX)
    fs.mkdirSync(root, { recursive: true })
  })

  it('非图片的 data URL 不动', () => {
    const text = { content: 'data:text/plain;base64,aGVsbG8=' }
    expect(externalizeMessage(text, root)).toEqual(text)
  })
})
