import { z } from 'zod'

export const screenshotSchema = z.object({})

export const localFileSearchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, '搜索词不能为空')
    .describe('文件名关键词或 glob 模式（支持 * 和 ?）'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('最多返回条数，默认 20，上限 50'),
})

export const webSearchSchema = z.object({
  query: z.string().trim().min(1, '搜索词不能为空').describe('搜索关键词'),
})

export const readWebPageSchema = z.object({
  url: z
    .url()
    .refine((value) => value.startsWith('https://'), '仅支持 https:// 链接')
    .describe('https:// 开头的网页链接'),
})

export const recallMemorySchema = z.object({
  query: z.string().trim().min(1, '回忆主题不能为空').describe('要回忆的主题或关键词'),
  from: z
    .string()
    .trim()
    .optional()
    .describe('可选，起始日期（YYYY-MM-DD），用于只回溯某段时间'),
  to: z.string().trim().optional().describe('可选，结束日期（YYYY-MM-DD）'),
})
