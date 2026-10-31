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
