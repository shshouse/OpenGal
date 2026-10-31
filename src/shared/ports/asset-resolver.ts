/** 资源地址端口：桌面 mod://，移动端 file:// 或 blob:。 */
export interface AssetResolver {
  toUrl(absPath: string): string
  /** 非本协议的地址返回 null */
  fromUrl(url: string): string | null
}
