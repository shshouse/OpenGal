export interface TtsEndpoint {
  /** 服务名，进入错误文案 */
  service: string
  /** 提供时错误文案会带上地址，便于定位；不提供则用简短文案 */
  baseURL?: string
  /** 连接被拒时的操作引导 */
  startHint?: string
}

export function normalizeBaseURL(url: string): string {
  return (url || '').replace(/\/+$/, '')
}

/**
 * 把连接层错误翻译成用户能照着做的提示。
 * 各适配器的文案语气不同：带 baseURL 的用详细版，不带的用简短版。
 */
export async function fetchReadable(
  input: string,
  init: RequestInit,
  endpoint: TtsEndpoint,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
    if (e.name === 'AbortError') throw err
    const code = e.cause?.code
    const where = endpoint.baseURL ? `（${endpoint.baseURL}）` : ''

    if (code === 'ECONNREFUSED') {
      throw new Error(
        endpoint.startHint
          ? `无法连接 ${endpoint.service} 服务${where}：连接被拒绝。${endpoint.startHint}`
          : `无法连接 ${endpoint.service} 服务，请确认服务已启动且端口一致`,
      )
    }
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error(
        endpoint.baseURL
          ? `连接 ${endpoint.service} 服务超时${where}：服务可能未就绪或网络不通。`
          : `连接 ${endpoint.service} 服务超时，请检查网络`,
      )
    }
    if (code === 'ENOTFOUND') {
      throw new Error(
        endpoint.baseURL
          ? `无法解析 ${endpoint.service} 主机${where}：DNS 查询失败，请检查 baseURL。`
          : `${endpoint.service} 地址无法解析，请检查网络`,
      )
    }

    const detail = [code ?? e.message ?? 'unknown', e.cause?.message].filter(Boolean).join(' - ')
    throw new Error(`请求 ${endpoint.service} 失败${where}：${detail}`)
  }
}
