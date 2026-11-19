import { z } from 'zod'
import { defineTool, type DefinedTool } from './defineTool'
import {
  downloadDraftAssetFromUrl,
  finalizeWorkshopDraftToRole,
  saveWorkshopDraft,
} from '../workshop/roleWorkshop'

const saveDraftToolSchema = z.object({
  draftId: z.string().max(64).optional().describe('已有草稿 ID；首次创建留空自动分配'),
  name: z.string().min(1).max(64).describe('角色英文或拼音短名，如 miku / furina'),
  displayName: z.string().max(64).optional().describe('界面展示名，如 初音未来 / 芙宁娜'),
  color: z.string().max(16).optional().describe('代表色 #RRGGBB，可选'),
  language: z.string().max(16).optional().describe('角色台词语言，如 zh / ja / en'),
  mode: z.enum(['agent', 'life']).optional().describe('运行模式：agent 或 life'),
  greeting: z.string().max(1000).optional().describe('初次唤醒时的第一句角色台词'),
  examples: z
    .array(
      z.object({
        user: z.string().min(1).max(1000),
        assistant: z.string().min(1).max(2000),
      }),
    )
    .max(20)
    .optional()
    .describe('用于锁定说话口癖的经典对话样本（2-6 组最佳）'),
  description: z.string().min(1).max(10_000).describe('角色背景与身份设定'),
  personality: z.string().min(1).max(10_000).describe('性格特征与口癖细节'),
  scenario: z.string().max(5_000).optional().describe('与用户共处的场景设定，可选'),
  rules: z.string().max(5_000).optional().describe('说话禁区或表演规则，可选'),
  userIdentity: z.string().max(500).optional().describe('用户的身份设定，可选'),
  userTerm: z.string().max(100).optional().describe('对用户的称呼，可选'),
  referenceText: z.string().max(500).optional().describe('零样本参考音频对应的原文台词，可选'),
  fishReferenceId: z.string().max(128).optional().describe('Fish Audio 云端音色 ID，可选'),
})

const fetchAssetToolSchema = z.object({
  draftId: z.string().min(1).max(64).describe('目标草稿 ID'),
  kind: z.enum(['portrait', 'voice']).describe('素材类型：portrait（立绘）或 voice（参考音频）'),
  url: z.string().url().max(2000).describe('公网 https:// 直链地址'),
})

const finalizeDraftToolSchema = z.object({
  draftId: z.string().min(1).max(64).describe('要正式生成的草稿 ID'),
})

export const workshopBuiltinTools: DefinedTool[] = [
  defineTool(
    {
      name: 'workshop_save_draft',
      description:
        '在受限工坊沙盒内创建或更新一个新角色草稿（人设、经典台词、第一句问候、Agent/Life 模式、零样本参考语音配置）。更新后用户的工坊界面会实时预览成果。',
      schema: saveDraftToolSchema,
    },
    async (args) => {
      const saved = saveWorkshopDraft({
        draftId: args.draftId,
        name: args.name,
        displayName: args.displayName,
        color: args.color,
        language: args.language,
        mode: args.mode,
        greeting: args.greeting,
        examples: args.examples,
        persona: {
          description: args.description,
          personality: args.personality,
          ...(args.scenario ? { scenario: args.scenario } : {}),
          ...(args.rules ? { rules: args.rules } : {}),
          ...(args.userIdentity ? { userIdentity: args.userIdentity } : {}),
          ...(args.userTerm ? { userTerm: args.userTerm } : {}),
        },
        ...(args.referenceText || args.fishReferenceId
          ? {
              voice: {
                engine: args.fishReferenceId ? 'fish' : 'gpt-sovits',
                ...(args.fishReferenceId ? { fishReferenceId: args.fishReferenceId } : {}),
                ...(args.referenceText ? { referenceText: args.referenceText } : {}),
              },
            }
          : {}),
      })
      return JSON.stringify({
        ok: true,
        draftId: saved.draftId,
        displayName: saved.displayName,
        message: '角色草稿已保存并同步到工坊实时预览。',
      })
    },
  ),

  defineTool(
    {
      name: 'workshop_fetch_asset',
      description:
        '从公网 https:// 地址安全下载角色候选立绘图片（portrait）或短参考音频样本（voice）到当前工坊草稿沙盒。仅允许公网 HTTPS，严禁内网地址。',
      schema: fetchAssetToolSchema,
    },
    async (args) => {
      const updated = await downloadDraftAssetFromUrl(args.draftId, args.kind, args.url)
      return JSON.stringify({
        ok: true,
        draftId: updated.draftId,
        portraitRelPath: updated.portraitRelPath,
        referenceAudioRelPath: updated.voice.referenceAudioRelPath,
      })
    },
  ),

  defineTool(
    {
      name: 'workshop_finalize_role',
      description: '在用户确认满意后，将工坊草稿正式生成到 data/roles/ 下成为独立可唤醒的角色实例。',
      schema: finalizeDraftToolSchema,
    },
    async (args) => {
      const role = finalizeWorkshopDraftToRole(args.draftId)
      return JSON.stringify({
        ok: true,
        roleId: role.id,
        displayName: role.displayName ?? role.name,
        folderName: role.folderName,
      })
    },
  ),
]
