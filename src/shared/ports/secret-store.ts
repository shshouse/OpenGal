/** 密钥端口：桌面用 safeStorage，移动端用 Keychain/Keystore。 */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}
