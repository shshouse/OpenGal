export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiUrl, apiKey, model, systemPrompt, userPrompt } = body as {
    apiUrl: string
    apiKey: string
    model: string
    systemPrompt: string
    userPrompt: string
  }

  if (!apiUrl || !apiKey || !model) {
    throw createError({ statusCode: 400, statusMessage: 'Missing API configuration' })
  }

  const baseUrl = apiUrl.replace(/\/+$/, '')
  const endpoint = `${baseUrl}/chat/completions`

  const response = await $fetch<any>(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    },
  }).catch((err) => {
    throw createError({
      statusCode: err.statusCode || 502,
      statusMessage: `LLM API error: ${err.message}`,
    })
  })

  const content = response.choices?.[0]?.message?.content
  if (!content) {
    throw createError({ statusCode: 500, statusMessage: 'Empty response from LLM' })
  }

  let script
  try {
    script = JSON.parse(content)
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      script = JSON.parse(match[1])
    } else {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to parse LLM response as JSON',
      })
    }
  }

  return { script }
})
