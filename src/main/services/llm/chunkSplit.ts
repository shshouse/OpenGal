export function splitChunk(
  chunk: string,
  state: { insideThinkBlock: boolean },
): { content: string; reasoning: string } {
  let result = chunk
  let content = ''
  let reasoning = ''

  if (state.insideThinkBlock) {
    const closeIdx = result.indexOf('</think>')
    if (closeIdx === -1) {
      const closeIdx2 = result.indexOf('</thinking>')
      if (closeIdx2 === -1) {
        return { content: '', reasoning: result }
      }
      reasoning += result.slice(0, closeIdx2)
      result = result.slice(closeIdx2 + '</thinking>'.length)
      state.insideThinkBlock = false
    } else {
      reasoning += result.slice(0, closeIdx)
      result = result.slice(closeIdx + '</think>'.length)
      state.insideThinkBlock = false
    }
  }

  const openMatch = result.match(/<think(?:ing)?>/i)
  if (openMatch && openMatch.index !== undefined) {
    content += result.slice(0, openMatch.index)
    const after = result.slice(openMatch.index + openMatch[0].length)
    const closeMatch = after.match(/<\/think(?:ing)?>/i)
    if (closeMatch && closeMatch.index !== undefined) {
      reasoning += after.slice(0, closeMatch.index)
      content += after.slice(closeMatch.index + closeMatch[0].length)
    } else {
      reasoning += after
      state.insideThinkBlock = true
    }
  } else {
    content += result
  }

  return { content, reasoning }
}
