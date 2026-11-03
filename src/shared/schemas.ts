import { z } from 'zod'

/** 各 IPC 通道的入参 schema。跨进程边界的数据一律视为不可信，主进程收到先过这里。 */

export const characterIdSchema = z.string().min(1, 'characterId 不能为空')

export const chatRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])

const contentPartSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    image_url: z.object({ url: z.string() }).optional(),
  })
  .passthrough()

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.union([z.string(), z.array(contentPartSchema)]),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
  dbId: z.number().optional(),
  ts: z.number().optional(),
  contextTag: z.enum(['summary', 'env', 'intent']).optional(),
})

export const memoryEntitySchema = z.enum(['user', 'character', 'relationship'])

export const memoryCandidateFactSchema = z
  .object({
    text: z.string().min(1),
    entity: memoryEntitySchema,
    subject: z.string().nullable().optional(),
    attribute: z.string().nullable().optional(),
    object: z.string().nullable().optional(),
    polarity: z.boolean().optional(),
    attributed_to: z.enum(['user', 'character', 'inferred']).optional(),
    importance: z.number(),
    confidence: z.number(),
    reason: z.string(),
    valid_until: z.string().nullable().optional(),
    frozen: z.boolean().optional(),
  })
  .passthrough()

export const memoryCandidateStorySchema = z
  .object({
    kind: z.enum(['event', 'promise', 'milestone', 'joke']),
    text: z.string().min(1),
    importance: z.number(),
    reason: z.string(),
    due_at: z.string().nullable().optional(),
  })
  .passthrough()

export const memoryApplyPayloadSchema = z.object({
  facts: z.array(memoryCandidateFactSchema),
  stories: z.array(memoryCandidateStorySchema),
  evidence: z.object({ fromTs: z.number(), toTs: z.number() }).optional(),
})

export const summarySchema = z.object({
  start_ts: z.number(),
  end_ts: z.number(),
  text: z.string().min(1),
  message_count: z.number().int().min(0),
})

/** config.set 的部分更新：校验顶层字段与类型，深层结构交给默认值合并逻辑。 */
export const configPatchSchema = z
  .object({
    subtitles: z
      .object({
        mode: z.enum(['off', 'translated', 'bilingual']),
        targetLanguage: z.string(),
      })
      .optional(),
    systemLocale: z.string().optional(),
    uiLanguage: z.enum(['zh', 'en', 'ja']).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    llm: z.record(z.string(), z.unknown()).optional(),
    llmPresets: z.array(z.record(z.string(), z.unknown())).optional(),
    llmSubPresetId: z.string().optional(),
    tts: z.record(z.string(), z.unknown()).optional(),
    asr: z.record(z.string(), z.unknown()).optional(),
    model: z.record(z.string(), z.unknown()).nullable().optional(),
    activeCharacterId: z.string().nullable().optional(),
    runningCharacters: z.record(z.string(), z.boolean()).optional(),
    showLive2D: z.boolean().optional(),
    memory: z.record(z.string(), z.unknown()).optional(),
    tools: z.record(z.string(), z.unknown()).optional(),
    gameMode: z.record(z.string(), z.unknown()).optional(),
    startup: z.record(z.string(), z.unknown()).optional(),
    screen: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const llmRequestSchema = z.object({
  messages: z.array(chatMessageSchema),
  overrides: z
    .object({
      provider: z.string().optional(),
      baseURL: z.string().optional(),
      apiKey: z.string().optional(),
      modelName: z.string().optional(),
      temperature: z.number().optional(),
      maxTokens: z.number().optional(),
      contextWindow: z.number().optional(),
      multimodal: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  slot: z.enum(['main', 'sub']).optional(),
  tools: z
    .array(
      z.object({
        type: z.literal('function'),
        function: z.object({
          name: z.string(),
          description: z.string(),
          parameters: z.record(z.string(), z.unknown()),
        }),
      }),
    )
    .optional(),
  toolChoice: z.unknown().optional(),
})
