import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })

const send = (msg) => {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', (line) => {
  const t = line.trim()
  if (!t) return
  let req
  try {
    req = JSON.parse(t)
  } catch {
    return
  }
  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: req.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo', version: '0.0.1' },
      },
    })
  } else if (req.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: '原样返回 text 参数',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      },
    })
  } else if (req.method === 'tools/call') {
    const text = req.params?.arguments?.text ?? '(空)'
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: { content: [{ type: 'text', text: `echo: ${text}` }] },
    })
  } else if (req.method !== 'notifications/initialized' && req.id !== undefined) {
    send({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: `unknown method ${req.method}` },
    })
  }
})
