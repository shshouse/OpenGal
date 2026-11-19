import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isSafePublicHttpsUrl, validatePublishCompliance } from '../../src/core/workshop/types'
import {
  exportDraftAsModPack,
  finalizeWorkshopDraftToRole,
  saveWorkshopDraft,
} from '../../src/main/services/workshop/roleWorkshop'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'og-workshop-test-'))
const prevDataDir = process.env.OPENGAL_DATA_DIR
process.env.OPENGAL_DATA_DIR = path.join(tmpRoot, 'data')

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.OPENGAL_DATA_DIR
  else process.env.OPENGAL_DATA_DIR = prevDataDir
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('角色工坊沙盒与 MikuMod 发布合规守卫', () => {
  it('拦截内网 SSRF 与非 HTTPS 素材地址', () => {
    expect(isSafePublicHttpsUrl('https://cdn.example.com/portrait.png')).toBe(true)
    expect(isSafePublicHttpsUrl('http://cdn.example.com/portrait.png')).toBe(false)
    expect(isSafePublicHttpsUrl('https://localhost:8080/secret')).toBe(false)
    expect(isSafePublicHttpsUrl('https://127.0.0.1/secret')).toBe(false)
    expect(isSafePublicHttpsUrl('https://192.168.1.5/file.png')).toBe(false)
    expect(isSafePublicHttpsUrl('https://172.20.0.1/file.png')).toBe(false)
  })

  it('草稿可在本地实例化为独立角色，但未授权素材禁止直接导出公开模组包', () => {
    const dataRoot = path.join(tmpRoot, 'data')
    const exportRoot = path.join(tmpRoot, 'exports')

    const personalDraft = saveWorkshopDraft(
      {
        name: 'furina',
        displayName: '芙宁娜',
        mode: 'life',
        greeting: '欢迎来到沫芒宫！',
        examples: [{ user: '下午茶', assistant: '要配小蛋糕才行！' }],
        persona: {
          description: '枫丹大明星',
          personality: '戏剧化又细腻',
        },
        provenance: {
          kind: 'local-personal',
          license: '',
          credits: '',
        },
      },
      dataRoot,
    )

    // 本地自用创建角色不受阻拦
    const localRole = finalizeWorkshopDraftToRole(personalDraft.draftId, dataRoot)
    expect(localRole.id).toBe('furina')
    expect(localRole.mode).toBe('life')
    expect(fs.existsSync(path.join(localRole.rootPath, 'opengal.json'))).toBe(true)

    // 直接公开导出会被合规守卫拦截
    expect(validatePublishCompliance(personalDraft).allowed).toBe(false)
    expect(() => exportDraftAsModPack(personalDraft.draftId, exportRoot, dataRoot)).toThrow()

    // 切换为「仅发布人设与配方」并补全署名后，可安全导出不含侵权原始素材的模组包
    const recipeDraft = saveWorkshopDraft(
      {
        draftId: personalDraft.draftId,
        name: 'furina',
        displayName: '芙宁娜',
        mode: 'life',
        persona: personalDraft.persona,
        provenance: {
          kind: 'recipe-only',
          license: 'CC-BY-NC-4.0',
          credits: '二创人设配方',
        },
      },
      dataRoot,
    )
    const exported = exportDraftAsModPack(recipeDraft.draftId, exportRoot, dataRoot)
    expect(exported.recipeOnly).toBe(true)
    expect(fs.existsSync(path.join(exported.modPath, 'opengal.json'))).toBe(true)
    expect(fs.existsSync(path.join(exported.modPath, 'sprites', 'idle.svg'))).toBe(true)
  })
})
