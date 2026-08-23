export const IpcChannels = {
  config: {
    get: 'config:get',
    set: 'config:set'
  },
  llm: {
    chat: 'llm:chat',
    chatStream: 'llm:chatStream',
    streamChunk: 'llm:stream:chunk',
    streamReasoning: 'llm:stream:reasoning',
    streamDone: 'llm:stream:done',
    streamError: 'llm:stream:error',
    streamAbort: 'llm:stream:abort',
    streamToolCalls: 'llm:stream:tool_calls'
  },
  tools: {
    list: 'tools:list',
    execute: 'tools:execute'
  },
  pet: {
    open: 'pet:open',
    close: 'pet:close',
    bubble: 'pet:bubble'
  },
  model: {
    scan: 'model:scan',
    resolveDefault: 'model:resolveDefault',
    resolveFromCard: 'model:resolveFromCard'
  },
  character: {
    list: 'character:list',
    get: 'character:get',
    voiceConfig: 'character:voiceConfig'
  },
  tts: {
    speak: 'tts:speak',
    ping: 'tts:ping',
    reset: 'tts:reset',
    serverStart: 'tts:serverStart',
    serverStop: 'tts:serverStop',
    serverStatus: 'tts:serverStatus',
    serverLog: 'tts:serverLog'
  },
  window: {
    minimize: 'window:minimize',
    maximize: 'window:maximize',
    close: 'window:close',
    isMaximized: 'window:isMaximized'
  },
  asr: {
    start: 'asr:start',
    stop: 'asr:stop',
    feed: 'asr:feed',
    partial: 'asr:partial',
    final: 'asr:final',
    error: 'asr:error',
    status: 'asr:status'
  },
  logs: {
    list: 'logs:list',
    clear: 'logs:clear',
    entry: 'logs:entry',
    append: 'logs:append'
  }
} as const
