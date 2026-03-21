import type { ApiSettings } from '~/utils/api-settings'

function parseLlmJson(content: string): any {
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      return JSON.parse(match[1])
    }
    throw new Error('无法将 LLM 响应解析为 JSON')
  }
}

export async function generateScriptFromLLM(
  apiSettings: ApiSettings,
  systemPrompt: string,
  userPrompt: string,
): Promise<any> {
  const baseUrl = apiSettings.apiUrl.replace(/\/+$/, '')
  const endpoint = `${baseUrl}/chat/completions`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiSettings.apiKey}`,
    },
    body: JSON.stringify({
      model: apiSettings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`LLM API 请求失败 (${response.status}): ${text || response.statusText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('LLM 返回了空响应')
  }

  return parseLlmJson(content)
}
