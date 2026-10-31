import { z } from 'zod'
import type { ToolDefinition } from '@shared/types'

type ToolSchema = z.ZodObject<z.ZodRawShape>

export interface ToolSpec<S extends ToolSchema> {
  name: string
  description: string
  schema: S
}

export interface DefinedTool {
  def: ToolDefinition
  handle: (args: Record<string, unknown>) => Promise<string>
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('；')
}

/**
 * 用 zod schema 同时生成 LLM 看到的 parameters 和运行时校验。
 * 工具参数由模型填充，属于不可信输入，handler 拿到的必须是校验后的值。
 */
export function defineTool<S extends ToolSchema>(
  spec: ToolSpec<S>,
  run: (args: z.infer<S>) => Promise<string>,
): DefinedTool {
  const json = z.toJSONSchema(spec.schema, { io: 'input' }) as Record<string, unknown>
  // OpenAI function calling 只接受纯 schema，$schema 声明要摘掉
  const { $schema: _draft, ...parameters } = json
  return {
    def: {
      type: 'function',
      function: {
        name: spec.name,
        description: spec.description,
        parameters: { ...parameters, type: 'object' },
      },
    },
    handle: async (args) => {
      const parsed = spec.schema.safeParse(args)
      if (!parsed.success) throw new Error(`参数不合法（${formatIssues(parsed.error)}）`)
      return run(parsed.data)
    },
  }
}
