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
    streamToolCalls: 'llm:stream:tool_calls',
    listModels: 'llm:listModels'
  },
  tools: {
    list: 'tools:list',
    execute: 'tools:execute'
  },
  plugins: {
    list: 'plugins:list',
    setEnabled: 'plugins:setEnabled',
    rescan: 'plugins:rescan'
  },
  memory: {
    get: 'memory:get',
    apply: 'memory:apply',
    manualAdd: 'memory:manualAdd',
    clear: 'memory:clear'
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
  chatHistory: {
    load: 'chatHistory:load',
    append: 'chatHistory:append',
    replaceAll: 'chatHistory:replaceAll',
    archiveRange: 'chatHistory:archiveRange',
    latestMessageId: 'chatHistory:latestMessageId',
    summaries: 'chatHistory:summaries',
    summaryAdd: 'chatHistory:summaryAdd'
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
    status: 'asr:status',
    event: 'asr:event'
  },
  director: {
    log: 'director:log'
  },
  screen: {
    capture: 'screen:capture'
  },
  logs: {
    list: 'logs:list',
    clear: 'logs:clear',
    entry: 'logs:entry',
    append: 'logs:append'
  }
} as const
