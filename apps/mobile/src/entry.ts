/**
 * 移动端入口：先注入 mobilePlatform，再加载 renderer。
 * 用动态 import 确保 setPlatform 在 renderer 之前执行。
 * 同时注入 window.opengal 作为 fallback -- renderer 里直接用 window.opengal 的地方不用改。
 */

import { setPlatform, type PlatformAPI } from '@shared/platform'
import { mobilePlatform } from './platform'

setPlatform(mobilePlatform)

// ponytail: renderer 代码直接用 window.opengal 的地方，fallback 到 mobilePlatform
;(globalThis as unknown as { opengal: PlatformAPI }).opengal = mobilePlatform

// 开发阶段配置结构还在变，每次启动覆盖默认值（正式版移除）
void mobilePlatform.config.get().then((res) => {
  if (res.success && res.data) {
    const patch: Record<string, unknown> = {}
    if (!res.data.showLive2D) patch.showLive2D = true
    if (res.data.activeCharacterId !== 'neuro') patch.activeCharacterId = 'neuro'
    if (Object.keys(patch).length > 0) {
      void mobilePlatform.config.set(patch as Parameters<PlatformAPI['config']['set']>[0])
    }
  }
})

void import('@/main.tsx')
