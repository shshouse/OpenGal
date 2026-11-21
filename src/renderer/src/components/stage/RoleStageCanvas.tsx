import * as React from 'react'
import type { Live2DModelConfig, RoleAvatarRegion, RoleCardEntry } from '@shared/types'
import { Live2DStage } from '@/components/live2d/Live2DStage'
import { SpriteStage } from '@/components/sprite/SpriteStage'
import { SpineStage } from '@/components/spine/SpineStage'

interface Props {
  role: RoleCardEntry | null
  model: Live2DModelConfig | null
  sleeping: boolean
  outfitId?: string
  transparent?: boolean
  mate?: boolean
  previewPortraitUrl?: string | null
  onTransformChange?: (next: { scale: number; xRatio: number; yRatio: number }) => void
  onSnapshot?: (dataUrl: string) => void
  avatarRegion?: RoleAvatarRegion
  captureRequest?: number
  onCapture?: (dataUrl: string) => void
}

export function RoleStageCanvas({
  role,
  model,
  sleeping,
  outfitId,
  transparent = false,
  mate = false,
  previewPortraitUrl,
  onTransformChange,
  onSnapshot,
  avatarRegion,
  captureRequest,
  onCapture,
}: Props): React.JSX.Element {
  if (previewPortraitUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <img
          src={previewPortraitUrl}
          alt="工坊立绘预览"
          className="max-h-full max-w-full object-contain select-none"
          draggable={false}
        />
      </div>
    )
  }

  const chosenOutfitId = outfitId ?? role?.activeOutfitId ?? role?.performance.defaultOutfit
  const activeOutfit = role?.outfitEntries?.find((item) => item.id === chosenOutfitId)

  if (activeOutfit?.mode === 'spine' && activeOutfit.spineSkelUrl && activeOutfit.spineAtlasUrl) {
    return (
      <SpineStage
        key={`${role?.id}:${activeOutfit.id}`}
        skelUrl={activeOutfit.spineSkelUrl}
        atlasUrl={activeOutfit.spineAtlasUrl}
        roleId={role?.id}
        sleeping={sleeping}
        mate={mate}
        scale={activeOutfit.spine?.scale}
      />
    )
  }

  const spriteFrames =
    activeOutfit?.mode === 'sprite' && activeOutfit.spriteFrames
      ? activeOutfit.spriteFrames
      : role?.performance.mode === 'sprite'
        ? role.spriteFrames
        : undefined

  if (spriteFrames && role) {
    return (
      <SpriteStage
        frames={spriteFrames}
        roleId={role.id}
        sleeping={sleeping}
        mate={mate}
      />
    )
  }

  return (
    <Live2DStage
      model={model}
      sleeping={sleeping}
      transparent={transparent}
      interactive={!mate}
      transformGestures={!mate}
      onChange={onTransformChange}
      onSnapshot={onSnapshot}
      avatarRegion={avatarRegion}
      captureRequest={captureRequest}
      onCapture={onCapture}
    />
  )
}
