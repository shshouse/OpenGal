export const IpcChannels = {
  config: {
    get: 'config:get',
    set: 'config:set'
  },
  uiState: {
    get: 'uiState:get',
    set: 'uiState:set'
  },
  storage: {
    usage: 'storage:usage',
    reveal: 'storage:reveal'
  },
  llm: {
    chat: 'llm:chat',
    chatStream: 'llm:chatStream',
    stream: 'llm:stream',
    streamAbort: 'llm:stream:abort',
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
    changes: 'memory:changes',
  },
  mate: {
    control: 'mate:control',
    sync: 'mate:sync',
    update: 'mate:update',
    setIgnoreMouse: 'mate:setIgnoreMouse',
    setDrawerOpen: 'mate:setDrawerOpen',
    openStudio: 'mate:openStudio',
  },
  mods: {
    list: 'mods:list',
  },
  runtime: {
    snapshot: 'runtime:snapshot',
    setRunning: 'runtime:setRunning',
    setMode: 'runtime:setMode',
    focus: 'runtime:focus',
    userActivity: 'runtime:userActivity',
    triggerLifeTick: 'runtime:triggerLifeTick',
    changed: 'runtime:changed',
    autonomousSpeak: 'runtime:autonomousSpeak',
  },
  workshop: {
    list: 'workshop:list',
    get: 'workshop:get',
    save: 'workshop:save',
    delete: 'workshop:delete',
    pickAsset: 'workshop:pickAsset',
    fetchAsset: 'workshop:fetchAsset',
    portraitPreview: 'workshop:portraitPreview',
    finalizeRole: 'workshop:finalizeRole',
    exportMod: 'workshop:exportMod',
    publishMikuMod: 'workshop:publishMikuMod',
    updated: 'workshop:updated',
  },
  model: {
    scan: 'model:scan',
    resolveDefault: 'model:resolveDefault',
    resolveFromCard: 'model:resolveFromCard'
  },
  role: {
    list: 'role:list',
    templates: 'role:templates',
    get: 'role:get',
    voiceConfig: 'role:voiceConfig',
    saveCard: 'role:saveCard',
    createCopy: 'role:createCopy',
    createBlank: 'role:createBlank',
    delete: 'role:delete',
    exportFolder: 'role:exportFolder',
    getState: 'role:getState',
    patchState: 'role:patchState',
    lifeLogs: 'role:lifeLogs',
    roleLogs: 'role:roleLogs',
    outfitChanged: 'role:outfitChanged'
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
