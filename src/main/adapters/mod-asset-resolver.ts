import type { AssetResolver } from '@shared/ports'
import { modUrlToAbsPath, toModUrl } from '../services/paths'

export class ModAssetResolver implements AssetResolver {
  toUrl(absPath: string): string {
    return toModUrl(absPath)
  }

  fromUrl(url: string): string | null {
    return modUrlToAbsPath(url)
  }
}
