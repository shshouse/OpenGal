import type { RoleExampleTurn, RoleMode } from '../role/types'
import type { RoleAvatarRegion } from '@shared/role/avatar'

export type AssetProvenanceKind =
  | 'original'
  | 'authorized-derivative'
  | 'recipe-only'
  | 'local-personal'

export interface WorkshopVoiceRef {
  engine: 'fish' | 'gpt-sovits' | 'genie' | 'none'
  fishReferenceId?: string
  referenceAudioRelPath?: string
  referenceText?: string
  language?: string
}

export interface WorkshopDraft {
  draftId: string
  name: string
  displayName: string
  color: string
  language: string
  mode: RoleMode
  greeting: string
  examples: RoleExampleTurn[]
  persona: {
    description: string
    personality: string
    scenario?: string
    rules?: string
    userIdentity?: string
    userTerm?: string
  }
  portraitRelPath?: string
  avatar?: RoleAvatarRegion
  voice: WorkshopVoiceRef
  provenance: {
    kind: AssetProvenanceKind
    license: string
    credits: string
    sourceNotes?: string
  }
  updatedAt: number
}

export interface PublishComplianceCheck {
  allowed: boolean
  recipeOnly: boolean
  reason?: string
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(?:1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/,
  /^\[?fc/i,
  /^\[?fd/i,
  /^\[?fe80/i,
]

export function isSafePublicHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.trim().toLowerCase()
    if (!host) return false
    return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))
  } catch {
    return false
  }
}

export function validatePublishCompliance(draft: WorkshopDraft): PublishComplianceCheck {
  if (draft.provenance.kind === 'local-personal') {
    return {
      allowed: false,
      recipeOnly: false,
      reason: '当前草稿标记为「仅本地自用（含未授权原始素材）」，可在本地创建角色，但不能直接发布原始版权素材到 MikuMod。若要公开分享，请切换为「仅发布人设与配方（不含版权素材）」或替换为已授权素材。',
    }
  }
  if (!draft.provenance.license.trim() || !draft.provenance.credits.trim()) {
    return {
      allowed: false,
      recipeOnly: draft.provenance.kind === 'recipe-only',
      reason: '发布到 MikuMod 前请填写协议声明（license）与来源署名（credits）。',
    }
  }
  return {
    allowed: true,
    recipeOnly: draft.provenance.kind === 'recipe-only',
  }
}
