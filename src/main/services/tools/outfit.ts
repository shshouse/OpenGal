import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { IpcChannels } from '@shared/app/ipc-channels'
import type { RoleCardEntry, RoleOutfitChange } from '@shared/role'
import { readConfig } from '../configStore'
import { getRoleCard } from '../roleCardLoader'
import { defineTool } from './defineTool'

const changeOutfitSchema = z.object({
  outfit: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('服装 id 或名称；不填则先列出这个角色有哪些服装'),
})

function describeOutfits(card: RoleCardEntry): string {
  return (card.outfitEntries ?? []).map((outfit) => `${outfit.id}（${outfit.name}）`).join('、')
}

export const changeOutfitTool = defineTool(
  {
    name: 'change_outfit',
    description:
      '给当前角色换一套服装或形态。只在用户明确要求换装、或情节确实需要（出门换便服、睡前换睡衣）时调用，不要每轮都换。不填 outfit 会返回这个角色有哪些服装。',
    schema: changeOutfitSchema,
  },
  async ({ outfit }) => {
    const roleId = readConfig().activeRoleId
    if (!roleId) return '当前没有激活的角色，换不了服装。'
    const card = getRoleCard(roleId)
    const outfits = card?.outfitEntries ?? []
    if (!card || outfits.length === 0) return '这个角色没有登记可更换的服装。'
    if (!outfit) return `可选服装：${describeOutfits(card)}。`

    const wanted = outfit.toLowerCase()
    const picked =
      outfits.find((item) => item.id === outfit) ??
      outfits.find((item) => item.id.toLowerCase() === wanted) ??
      outfits.find((item) => item.name === outfit) ??
      outfits.find((item) => item.name.toLowerCase() === wanted)
    if (!picked) return `没有「${outfit}」这套服装。可选：${describeOutfits(card)}。`

    const change: RoleOutfitChange = { roleId, outfitId: picked.id }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.role.outfitChanged, change)
    }
    return `已换成「${picked.name}」。`
  },
)
