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
    streamUsage: 'llm:stream:usage',
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
    getRelevant: 'memory:getRelevant',
    apply: 'memory:apply',
    manualAdd: 'memory:manualAdd',
    clear: 'memory:clear',
    pending: 'memory:pending',
    advanceCursor: 'memory:advanceCursor',
    rebuild: 'memory:rebuild',
    freezeFact: 'memory:freezeFact',
    unfreezeFact: 'memory:unfreezeFact',
    deleteFact: 'memory:deleteFact',
    prune: 'memory:prune',
    evidence: 'memory:evidence',
  },
  pet: {
    open: 'pet:open',
    close: 'pet:close',
    dragStart: 'pet:dragStart',
    dragMove: 'pet:dragMove',
    setBubble: 'pet:setBubble',
    bubble: 'pet:bubble',
    emitPerformance: 'pet:emitPerformance',
    performance: 'pet:performance',
    emitRuntime: 'pet:emitRuntime',
    runtime: 'pet:runtime',
    emitAvatar: 'pet:emitAvatar',
    avatar: 'pet:avatar'
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
    summaryAdd: 'chatHistory:summaryAdd',
    commitCompression: 'chatHistory:commitCompression'
  },
  tts: {
    speak: 'tts:speak',
    cancel: 'tts:cancel',
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
    speechStart: 'asr:speechStart',
    status: 'asr:status'
  },
  director: {
    log: 'director:log'
  },
  market: {
    list: 'market:list',
    open: 'market:open'
  },
  screen: {
    capture: 'screen:capture'
  },
  env: {
    get: 'env:get'
  },
  boot: {
    start: 'boot:start',
    step: 'boot:step',
    recheckTts: 'boot:recheckTts'
  },
  logs: {
    list: 'logs:list',
    clear: 'logs:clear',
    entry: 'logs:entry',
    append: 'logs:append',
    export: 'logs:export',
    reveal: 'logs:reveal'
  }
} as const
