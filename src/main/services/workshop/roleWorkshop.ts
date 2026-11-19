import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import {
  isSafePublicHttpsUrl,
  validatePublishCompliance,
  type WorkshopDraft,
} from '@core/workshop/types'
import { IpcChannels } from '@shared/app/ipc-channels'
import type { RoleCardEntry } from '@shared/types'
import { getDataRoot, getModRoot } from '../infra/paths'
import { getOwnedRoleCard } from '../role/cardLoader'
import { allocateUniqueRoleId, ensureRolesRoot, sanitizeFolderName } from '../role/store'

const DRAFT_FILE = 'draft.json'
const LF = String.fromCharCode(10)
const MAX_ASSET_BYTES = 15 * 1024 * 1024
const MIKUMOD_UPLOAD_URL = process.env.OPENGAL_MIKUMOD_UPLOAD_URL || 'https://mikumod.com/upload'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg'])
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg', '.flac'])

function getWorkshopRoot(dataRoot = getDataRoot()): string {
  const dir = path.join(dataRoot, 'workshop')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeDraftDir(draftId: string, dataRoot = getDataRoot()): string {
  const root = getWorkshopRoot(dataRoot)
  const clean = sanitizeFolderName(draftId)
  if (!clean || clean === '.' || clean === '..') throw new Error('无效的工坊草稿 ID')
  const resolved = path.resolve(root, clean)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('越界草稿路径已被拦截')
  }
  return resolved
}

function defaultPlaceholderSvg(label: string, accent = '#3B82F6'): string {
  const safeChar = (label.trim()[0] ?? 'R').replace(/[<>&"']/g, '')
  const safeColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent) ? accent : '#3B82F6'
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">',
    '  <rect width="512" height="768" rx="48" fill="none"/>',
    `  <circle cx="256" cy="248" r="96" fill="${safeColor}" fill-opacity="0.18" stroke="${safeColor}" stroke-width="4"/>`,
    `  <path d="M116 640c0-88 62-152 140-152s140 64 140 152" fill="${safeColor}" fill-opacity="0.14" stroke="${safeColor}" stroke-width="4" stroke-linecap="round"/>`,
    `  <text x="256" y="276" text-anchor="middle" font-family="sans-serif" font-size="76" font-weight="600" fill="${safeColor}">${safeChar}</text>`,
    '</svg>',
  ].join(LF)
}

function broadcastDraftUpdate(draft: WorkshopDraft): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.workshop.updated, draft)
      }
    }
  } catch {
    // 测试环境无 BrowserWindow 时静默跳过
  }
}

export function listWorkshopDrafts(dataRoot = getDataRoot()): WorkshopDraft[] {
  const root = getWorkshopRoot(dataRoot)
  const out: WorkshopDraft[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(root, entry.name, DRAFT_FILE)
    if (!fs.existsSync(file)) continue
    try {
      out.push(JSON.parse(fs.readFileSync(file, 'utf-8')) as WorkshopDraft)
    } catch {
      continue
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getWorkshopDraft(draftId: string, dataRoot = getDataRoot()): WorkshopDraft | null {
  const dir = safeDraftDir(draftId, dataRoot)
  const file = path.join(dir, DRAFT_FILE)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as WorkshopDraft
  } catch {
    return null
  }
}

export interface SaveWorkshopDraftInput {
  draftId?: string
  name: string
  displayName?: string
  color?: string
  language?: string
  mode?: WorkshopDraft['mode']
  greeting?: string
  examples?: WorkshopDraft['examples']
  persona: WorkshopDraft['persona']
  voice?: Partial<WorkshopDraft['voice']>
  provenance?: Partial<WorkshopDraft['provenance']>
}

export function saveWorkshopDraft(
  input: SaveWorkshopDraftInput,
  dataRoot = getDataRoot(),
): WorkshopDraft {
  const draftId =
    input.draftId?.trim() ||
    `draft-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`
  const dir = safeDraftDir(draftId, dataRoot)
  const existing = getWorkshopDraft(draftId, dataRoot)

  fs.mkdirSync(path.join(dir, 'sprites'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'voice'), { recursive: true })

  const color = input.color?.trim() || existing?.color || '#3B82F6'
  let portraitRelPath = existing?.portraitRelPath
  if (!portraitRelPath || !fs.existsSync(path.join(dir, portraitRelPath))) {
    portraitRelPath = 'sprites/idle.svg'
    fs.writeFileSync(
      path.join(dir, portraitRelPath),
      defaultPlaceholderSvg(input.displayName || input.name, color),
      'utf-8',
    )
  }

  const next: WorkshopDraft = {
    draftId,
    name: input.name.trim(),
    displayName: input.displayName?.trim() || input.name.trim(),
    color,
    language: input.language?.trim() ?? existing?.language ?? 'zh',
    mode: input.mode ?? existing?.mode ?? 'agent',
    greeting: input.greeting?.trim() ?? existing?.greeting ?? '',
    examples: input.examples ?? existing?.examples ?? [],
    persona: input.persona,
    portraitRelPath,
    voice: {
      engine: input.voice?.engine ?? existing?.voice.engine ?? 'none',
      ...(input.voice?.fishReferenceId !== undefined
        ? { fishReferenceId: input.voice.fishReferenceId }
        : existing?.voice.fishReferenceId
          ? { fishReferenceId: existing.voice.fishReferenceId }
          : {}),
      ...(input.voice?.referenceAudioRelPath !== undefined
        ? { referenceAudioRelPath: input.voice.referenceAudioRelPath }
        : existing?.voice.referenceAudioRelPath
          ? { referenceAudioRelPath: existing.voice.referenceAudioRelPath }
          : {}),
      ...(input.voice?.referenceText !== undefined
        ? { referenceText: input.voice.referenceText }
        : existing?.voice.referenceText
          ? { referenceText: existing.voice.referenceText }
          : {}),
      ...(input.voice?.language !== undefined
        ? { language: input.voice.language }
        : existing?.voice.language
          ? { language: existing.voice.language }
          : {}),
    },
    provenance: {
      kind: input.provenance?.kind ?? existing?.provenance.kind ?? 'local-personal',
      license: input.provenance?.license ?? existing?.provenance.license ?? '',
      credits: input.provenance?.credits ?? existing?.provenance.credits ?? '',
      ...(input.provenance?.sourceNotes !== undefined
        ? { sourceNotes: input.provenance.sourceNotes }
        : existing?.provenance.sourceNotes
          ? { sourceNotes: existing.provenance.sourceNotes }
          : {}),
    },
    updatedAt: Date.now(),
  }

  fs.writeFileSync(path.join(dir, DRAFT_FILE), JSON.stringify(next, null, 2) + LF, 'utf-8')
  broadcastDraftUpdate(next)
  return next
}

export function deleteWorkshopDraft(draftId: string, dataRoot = getDataRoot()): boolean {
  const dir = safeDraftDir(draftId, dataRoot)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

export async function downloadDraftAssetFromUrl(
  draftId: string,
  kind: 'portrait' | 'voice',
  url: string,
  dataRoot = getDataRoot(),
): Promise<WorkshopDraft> {
  if (!isSafePublicHttpsUrl(url)) {
    throw new Error('仅允许从公网 https:// 地址下载候选素材')
  }
  const draft = getWorkshopDraft(draftId, dataRoot)
  if (!draft) throw new Error(`未找到草稿 ${draftId}`)

  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) })
  if (!res.ok) throw new Error(`素材下载失败：HTTP ${res.status}`)

  const contentLength = Number(res.headers.get('content-length') ?? 0)
  if (contentLength > MAX_ASSET_BYTES) {
    throw new Error('素材体积超过 15MB 上限')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0 || buf.byteLength > MAX_ASSET_BYTES) {
    throw new Error('素材内容为空或体积超过 15MB 上限')
  }

  const parsedPath = new URL(url).pathname
  const rawExt = path.extname(parsedPath).toLowerCase()
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  const dir = safeDraftDir(draftId, dataRoot)

  if (kind === 'portrait') {
    const ext = IMAGE_EXTS.has(rawExt)
      ? rawExt
      : contentType.includes('webp')
        ? '.webp'
        : contentType.includes('jpeg') || contentType.includes('jpg')
          ? '.jpg'
          : contentType.includes('svg')
            ? '.svg'
            : '.png'
    const rel = `sprites/idle${ext}`
    fs.mkdirSync(path.join(dir, 'sprites'), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), buf)
    draft.portraitRelPath = rel
  } else {
    const ext = AUDIO_EXTS.has(rawExt)
      ? rawExt
      : contentType.includes('mpeg') || contentType.includes('mp3')
        ? '.mp3'
        : contentType.includes('ogg')
          ? '.ogg'
          : '.wav'
    const rel = `voice/reference${ext}`
    fs.mkdirSync(path.join(dir, 'voice'), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), buf)
    draft.voice.referenceAudioRelPath = rel
    if (draft.voice.engine === 'none') draft.voice.engine = 'gpt-sovits'
  }

  draft.updatedAt = Date.now()
  fs.writeFileSync(path.join(dir, DRAFT_FILE), JSON.stringify(draft, null, 2) + LF, 'utf-8')
  broadcastDraftUpdate(draft)
  return draft
}

export async function pickLocalDraftAsset(
  draftId: string,
  kind: 'portrait' | 'voice',
  dataRoot = getDataRoot(),
): Promise<WorkshopDraft | null> {
  const draft = getWorkshopDraft(draftId, dataRoot)
  if (!draft) throw new Error(`未找到草稿 ${draftId}`)

  const picked = await dialog.showOpenDialog({
    title: kind === 'portrait' ? '选择角色立绘图片' : '选择 10-30 秒干净参考音频',
    properties: ['openFile'],
    filters:
      kind === 'portrait'
        ? [{ name: '立绘图像', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }]
        : [{ name: '参考音频', extensions: ['wav', 'mp3', 'ogg', 'flac'] }],
  })
  if (picked.canceled || !picked.filePaths[0]) return null

  const sourceFile = picked.filePaths[0]
  const stat = fs.statSync(sourceFile)
  if (stat.size > MAX_ASSET_BYTES) {
    throw new Error('所选素材超过 15MB 上限')
  }
  const ext = path.extname(sourceFile).toLowerCase()
  const dir = safeDraftDir(draftId, dataRoot)

  if (kind === 'portrait') {
    if (!IMAGE_EXTS.has(ext)) throw new Error('不支持的图片格式')
    const rel = `sprites/idle${ext}`
    fs.mkdirSync(path.join(dir, 'sprites'), { recursive: true })
    fs.copyFileSync(sourceFile, path.join(dir, rel))
    draft.portraitRelPath = rel
  } else {
    if (!AUDIO_EXTS.has(ext)) throw new Error('不支持的音频格式')
    const rel = `voice/reference${ext}`
    fs.mkdirSync(path.join(dir, 'voice'), { recursive: true })
    fs.copyFileSync(sourceFile, path.join(dir, rel))
    draft.voice.referenceAudioRelPath = rel
    if (draft.voice.engine === 'none') draft.voice.engine = 'gpt-sovits'
  }

  draft.updatedAt = Date.now()
  fs.writeFileSync(path.join(dir, DRAFT_FILE), JSON.stringify(draft, null, 2) + LF, 'utf-8')
  broadcastDraftUpdate(draft)
  return draft
}

export function readDraftPortraitDataUrl(draftId: string, dataRoot = getDataRoot()): string | null {
  const draft = getWorkshopDraft(draftId, dataRoot)
  if (!draft?.portraitRelPath) return null
  const dir = safeDraftDir(draftId, dataRoot)
  const file = path.join(dir, draft.portraitRelPath)
  if (!fs.existsSync(file)) return null
  const ext = path.extname(file).toLowerCase()
  const mime =
    ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'image/png'
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

function buildManifestFromDraft(
  draft: WorkshopDraft,
  roleId: string,
  includeBinaryAssets: boolean,
): Record<string, unknown> {
  const defaultSprite =
    includeBinaryAssets && draft.portraitRelPath
      ? path.basename(draft.portraitRelPath)
      : 'idle.svg'

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id: roleId,
    name: draft.name,
    displayName: draft.displayName,
    color: draft.color,
    ...(draft.language ? { language: draft.language } : {}),
    mode: draft.mode,
    windowMode: 'mate',
    ...(draft.greeting ? { greeting: draft.greeting } : {}),
    ...(draft.examples.length > 0 ? { examples: draft.examples } : {}),
    describe: {
      summary: draft.persona.description.slice(0, 120),
      tags: [draft.mode === 'life' ? 'Life' : 'Agent'],
    },
    performance: {
      mode: 'sprite',
      sprite: {
        spriteDir: 'sprites',
        defaultSprite,
      },
    },
    persona: draft.persona,
    license: draft.provenance.license || 'Personal-Use-Only',
    credits: draft.provenance.credits || draft.displayName,
    provenance: draft.provenance,
  }

  if (draft.voice.engine !== 'none') {
    manifest.voice = {
      engine: draft.voice.engine,
      config: 'voice/config.json',
    }
  }
  return manifest
}

function writeVoiceConfigIfPresent(draft: WorkshopDraft, targetRoot: string, includeAudio: boolean): void {
  if (draft.voice.engine === 'none') return
  const voiceDir = path.join(targetRoot, 'voice')
  fs.mkdirSync(voiceDir, { recursive: true })
  const config: Record<string, unknown> = {
    engine: draft.voice.engine,
    ...(draft.voice.fishReferenceId ? { referenceId: draft.voice.fishReferenceId } : {}),
    ...(draft.voice.referenceText ? { promptText: draft.voice.referenceText } : {}),
    ...(draft.voice.language ? { promptLanguage: draft.voice.language } : {}),
  }
  if (includeAudio && draft.voice.referenceAudioRelPath) {
    config.promptAudio = path.basename(draft.voice.referenceAudioRelPath)
  }
  fs.writeFileSync(path.join(voiceDir, 'config.json'), JSON.stringify(config, null, 2) + LF, 'utf-8')
}

function copyDirectoryContents(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name)
    const dst = path.join(destDir, entry.name)
    if (entry.isDirectory()) copyDirectoryContents(src, dst)
    else if (entry.isFile()) fs.copyFileSync(src, dst)
  }
}

/** 将工坊草稿直接实例化到 data/roles/<角色目录> 供立即唤醒陪伴 */
export function finalizeWorkshopDraftToRole(
  draftId: string,
  dataRoot = getDataRoot(),
): RoleCardEntry {
  const draft = getWorkshopDraft(draftId, dataRoot)
  if (!draft) throw new Error(`未找到草稿 ${draftId}`)
  const draftDir = safeDraftDir(draftId, dataRoot)

  const baseFolder = sanitizeFolderName(draft.displayName || draft.name)
  const rolesRoot = ensureRolesRoot(dataRoot)
  let folderName = baseFolder
  let n = 2
  while (fs.existsSync(path.join(rolesRoot, folderName))) {
    folderName = `${baseFolder} ${n}`
    n++
  }

  const roleId = allocateUniqueRoleId(dataRoot, draft.name)
  const targetDir = path.join(rolesRoot, folderName)
  fs.mkdirSync(path.join(targetDir, 'sprites'), { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'attachments'), { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'logs'), { recursive: true })

  copyDirectoryContents(path.join(draftDir, 'sprites'), path.join(targetDir, 'sprites'))
  copyDirectoryContents(path.join(draftDir, 'voice'), path.join(targetDir, 'voice'))
  writeVoiceConfigIfPresent(draft, targetDir, true)

  const manifest = buildManifestFromDraft(draft, roleId, true)
  fs.writeFileSync(path.join(targetDir, 'opengal.json'), JSON.stringify(manifest, null, 2) + LF, 'utf-8')
  fs.writeFileSync(
    path.join(targetDir, 'meta.json'),
    JSON.stringify(
      {
        roleId,
        templateId: 'workshop',
        templateFolder: draftId,
        templateVersion: '1.0.0',
        displayName: draft.displayName,
        mode: draft.mode,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  )

  const card = getOwnedRoleCard(roleId, dataRoot)
  if (!card) throw new Error('角色生成后校验未通过，请检查人设字段')
  return card
}

/** 导出标准 OpenGal 模组目录（支持放入 mods/ 或打包上传到 MikuMod） */
export function exportDraftAsModPack(
  draftId: string,
  targetParentDir = getModRoot(),
  dataRoot = getDataRoot(),
): { modPath: string; recipeOnly: boolean } {
  const draft = getWorkshopDraft(draftId, dataRoot)
  if (!draft) throw new Error(`未找到草稿 ${draftId}`)
  const compliance = validatePublishCompliance(draft)
  if (!compliance.allowed) {
    throw new Error(compliance.reason ?? '不满足模组发布合规要求')
  }

  const draftDir = safeDraftDir(draftId, dataRoot)
  const slug =
    draft.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || sanitizeFolderName(draft.name)
  const modPath = path.join(targetParentDir, slug)
  fs.mkdirSync(path.join(modPath, 'sprites'), { recursive: true })

  if (compliance.recipeOnly) {
    fs.writeFileSync(
      path.join(modPath, 'sprites', 'idle.svg'),
      defaultPlaceholderSvg(draft.displayName, draft.color),
      'utf-8',
    )
    writeVoiceConfigIfPresent(draft, modPath, false)
  } else {
    copyDirectoryContents(path.join(draftDir, 'sprites'), path.join(modPath, 'sprites'))
    copyDirectoryContents(path.join(draftDir, 'voice'), path.join(modPath, 'voice'))
    writeVoiceConfigIfPresent(draft, modPath, true)
  }

  const manifest = buildManifestFromDraft(draft, slug, !compliance.recipeOnly)
  fs.writeFileSync(path.join(modPath, 'opengal.json'), JSON.stringify(manifest, null, 2) + LF, 'utf-8')
  return { modPath, recipeOnly: compliance.recipeOnly }
}

export async function publishDraftToMikuMod(
  draftId: string,
  dataRoot = getDataRoot(),
): Promise<{ modPath: string; uploadUrl: string; recipeOnly: boolean }> {
  const exportDir = path.join(dataRoot, 'exports')
  fs.mkdirSync(exportDir, { recursive: true })
  const { modPath, recipeOnly } = exportDraftAsModPack(draftId, exportDir, dataRoot)
  shell.showItemInFolder(path.join(modPath, 'opengal.json'))
  await shell.openExternal(MIKUMOD_UPLOAD_URL)
  return { modPath, uploadUrl: MIKUMOD_UPLOAD_URL, recipeOnly }
}
