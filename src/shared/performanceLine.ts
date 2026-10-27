import { SpeechStreamParser } from './roleCard'
import type { LLMDialogMessage } from './messages'

/** 导演直出的一行台词可能是纯文本，也可能带行内表演标记；统一走同一个解析器 */
export function parsePerformanceLine(line: string, name: string): LLMDialogMessage[] {
  const parser = new SpeechStreamParser()
  const items = [...parser.feed(line), ...parser.flush()]
  return items.map((item) => {
    const message: LLMDialogMessage = { name, text: item.text }
    if (item.emotion) message.emotion = item.emotion
    if (item.action) message.motion = item.action
    return message
  })
}
