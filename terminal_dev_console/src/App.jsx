import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const MonacoEditor = lazy(() => import('@monaco-editor/react'))

let webcontainerBootPromise

const ignoredExplorerNames = new Set(['node_modules', '.git', 'dist'])
const defaultRunPort = 5173

const quickCommands = [
  { label: 'Install packages', command: 'npm install', group: 'npm', hint: 'Install dependencies' },
  { label: 'Run dev', command: 'npm run dev', group: 'npm', hint: 'Start dev script' },
  { label: 'Run start', command: 'npm start', group: 'npm', hint: 'Start app script' },
  { label: 'Build', command: 'npm run build', group: 'npm', hint: 'Production build' },
  { label: 'Preview', command: 'npm run preview', group: 'npm', hint: 'Serve built app' },
  { label: 'Test', command: 'npm test', group: 'npm', hint: 'Run tests' },
  { label: 'Lint', command: 'npm run lint', group: 'npm', hint: 'Run linter' },
  { label: 'Format', command: 'npm run format', group: 'npm', hint: 'Run formatter' },
  { label: 'Package scripts', command: 'npm run', group: 'npm', hint: 'List scripts' },
  { label: 'Packages', command: 'npm list --depth=0', group: 'npm', hint: 'List installed deps' },
  { label: 'Outdated', command: 'npm outdated', group: 'npm', hint: 'Check old packages' },
  { label: 'Audit', command: 'npm audit', group: 'npm', hint: 'Security audit' },
  { label: 'Clean install', command: 'rm -rf node_modules package-lock.json && npm install', group: 'npm', hint: 'Fresh install' },
  { label: 'Node version', command: 'node -v', group: 'runtime', hint: 'Node.js version' },
  { label: 'NPM version', command: 'npm -v', group: 'runtime', hint: 'npm version' },
  { label: 'Run Node snippet', command: "node -e \"console.log('Hello from WebContainer')\"", group: 'runtime', hint: 'Inline JS' },
  { label: 'Env', command: 'env', group: 'runtime', hint: 'Environment vars' },
  { label: 'Processes', command: 'ps aux', group: 'runtime', hint: 'Running processes' },
  { label: 'Kill Node', command: 'pkill node', group: 'runtime', hint: 'Stop node processes' },
  { label: 'Memory', command: 'node -e "console.log(process.memoryUsage())"', group: 'runtime', hint: 'Node memory' },
  { label: 'Platform', command: 'node -p "process.platform"', group: 'runtime', hint: 'Runtime platform' },
  { label: 'List', command: 'ls', group: 'files', hint: 'List files' },
  { label: 'List all', command: 'ls -la', group: 'files', hint: 'Detailed list' },
  { label: 'Tree', command: 'find . -maxdepth 3 -print', group: 'files', hint: 'Folder tree' },
  { label: 'Where am I', command: 'pwd', group: 'files', hint: 'Current path' },
  { label: 'Make dir', command: 'mkdir -p scratch', group: 'files', hint: 'Create folder' },
  { label: 'Touch file', command: 'touch scratch/notes.md', group: 'files', hint: 'Create file' },
  { label: 'Read package', command: 'cat package.json', group: 'files', hint: 'Print file' },
  { label: 'Copy file', command: 'cp package.json package.copy.json', group: 'files', hint: 'Copy example' },
  { label: 'Move file', command: 'mv package.copy.json package.moved.json', group: 'files', hint: 'Move example' },
  { label: 'Remove file', command: 'rm -f package.moved.json', group: 'files', hint: 'Delete file' },
  { label: 'Remove folder', command: 'rm -rf dist', group: 'files', hint: 'Delete folder' },
  { label: 'Find files', command: 'find . -maxdepth 3 -type f', group: 'files', hint: 'Find by type' },
  { label: 'Disk use', command: 'du -sh .', group: 'files', hint: 'Workspace size' },
  { label: 'File count', command: 'find . -type f | wc -l', group: 'files', hint: 'Count files' },
  { label: 'Search text', command: "grep -R \"TODO\" .", group: 'files', hint: 'Search workspace' },
  { label: 'Head file', command: 'head -40 package.json', group: 'files', hint: 'First lines' },
  { label: 'Tail file', command: 'tail -40 package.json', group: 'files', hint: 'Last lines' },
  { label: 'Clear', command: 'clear', group: 'shell', hint: 'Clear terminal' },
  { label: 'Home', command: 'cd /home/workspace', group: 'shell', hint: 'Go workspace root' },
  { label: 'Go src', command: 'cd src', group: 'shell', hint: 'Change directory' },
  { label: 'Back one', command: 'cd ..', group: 'shell', hint: 'Parent directory' },
  { label: 'Help', command: 'help', group: 'shell', hint: 'Shell help' },
  { label: 'Which node', command: 'which node', group: 'shell', hint: 'Find executable' },
  { label: 'Print PATH', command: 'echo $PATH', group: 'shell', hint: 'Path variable' },
  { label: 'History', command: 'history', group: 'shell', hint: 'Command history' },
  { label: 'Date', command: 'date', group: 'shell', hint: 'Current date' },
  { label: 'Whoami', command: 'whoami', group: 'shell', hint: 'Current user' },
  { label: 'Dir', command: 'ls -la', group: 'windows', hint: 'Windows-style list' },
  { label: 'Cls', command: 'clear', group: 'windows', hint: 'Windows-style clear' },
  { label: 'Type', command: 'cat package.json', group: 'windows', hint: 'Windows-style print' },
  { label: 'Copy', command: 'cp package.json package.copy.json', group: 'windows', hint: 'Windows-style copy' },
  { label: 'Move', command: 'mv package.copy.json package.moved.json', group: 'windows', hint: 'Windows-style move' },
  { label: 'Del', command: 'rm -f package.moved.json', group: 'windows', hint: 'Windows-style delete' },
  { label: 'Mkdir', command: 'mkdir -p scratch', group: 'windows', hint: 'Windows-style folder create' },
  { label: 'Rmdir', command: 'rm -rf scratch', group: 'windows', hint: 'Windows-style folder remove' },
  { label: 'Echo', command: 'echo Hello from WebContainer', group: 'windows', hint: 'Print text' },
  { label: 'Set', command: 'env', group: 'windows', hint: 'Show env vars' },
  { label: 'Tasklist', command: 'ps aux', group: 'windows', hint: 'Process list equivalent' },
  { label: 'Where', command: 'which node', group: 'windows', hint: 'Find command equivalent' },
  { label: 'Code server', command: 'npx vite --host 0.0.0.0 --port 5173', group: 'servers', hint: 'Run Vite directly' },
  { label: 'HTTP server', command: 'npx serve .', group: 'servers', hint: 'Serve static files' },
  { label: 'Next dev', command: 'npm run dev -- --hostname 0.0.0.0', group: 'servers', hint: 'Next.js compatible dev' },
  { label: 'Stop server', command: 'pkill node', group: 'servers', hint: 'Stop node servers' },
]

const demoGameFiles = [
  {
    path: 'package.json',
    data: `{
  "name": "neon-runner-demo",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "start": "vite --host 0.0.0.0 --port 5173",
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0 --port 5173"
  },
  "devDependencies": {
    "vite": "^5.4.11"
  }
}
`,
  },
  {
    path: 'index.html',
    data: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Neon Runner</title>
  </head>
  <body>
    <canvas id="game" aria-label="Neon Runner game"></canvas>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  },
  {
    path: 'src/main.js',
    data: `import './styles.css'

const canvas = document.querySelector('#game')
const ctx = canvas.getContext('2d')
const state = {
  running: true,
  score: 0,
  speed: 4,
  keys: new Set(),
  player: { x: 80, y: 0, width: 34, height: 34, vy: 0, grounded: false },
  blocks: [],
  sparks: [],
}

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio
  canvas.height = window.innerHeight * devicePixelRatio
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
}

function reset() {
  state.running = true
  state.score = 0
  state.speed = 4
  state.blocks = []
  state.sparks = []
  state.player.y = innerHeight - 112
  state.player.vy = 0
}

function jump() {
  if (!state.running) {
    reset()
    return
  }

  if (state.player.grounded) {
    state.player.vy = -15
    state.player.grounded = false
  }
}

function addBlock() {
  const size = 26 + Math.random() * 34
  state.blocks.push({
    x: innerWidth + 40,
    y: innerHeight - 78 - size,
    width: size,
    height: size,
  })
}

function addSpark(x, y) {
  state.sparks.push({
    x,
    y,
    vx: -2 - Math.random() * 4,
    vy: -1 + Math.random() * 2,
    life: 24,
  })
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function update() {
  const floor = innerHeight - 78
  const player = state.player

  if (state.running) {
    state.score += 1
    state.speed = Math.min(10, 4 + state.score / 900)

    player.vy += 0.75
    player.y += player.vy
    if (player.y + player.height >= floor) {
      player.y = floor - player.height
      player.vy = 0
      player.grounded = true
    }

    if (state.blocks.length === 0 || state.blocks.at(-1).x < innerWidth - 220 - Math.random() * 180) {
      addBlock()
    }

    state.blocks.forEach((block) => {
      block.x -= state.speed
      if (intersects(player, block)) state.running = false
    })
    state.blocks = state.blocks.filter((block) => block.x + block.width > -20)

    if (state.score % 5 === 0) addSpark(player.x + 8, player.y + player.height)
  }

  state.sparks.forEach((spark) => {
    spark.x += spark.vx
    spark.y += spark.vy
    spark.life -= 1
  })
  state.sparks = state.sparks.filter((spark) => spark.life > 0)
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.14)'
  ctx.lineWidth = 1
  for (let x = 0; x < innerWidth; x += 42) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, innerHeight)
    ctx.stroke()
  }
  for (let y = 0; y < innerHeight; y += 42) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(innerWidth, y)
    ctx.stroke()
  }
}

function draw() {
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  const gradient = ctx.createLinearGradient(0, 0, innerWidth, innerHeight)
  gradient.addColorStop(0, '#05070d')
  gradient.addColorStop(1, '#071a33')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, innerWidth, innerHeight)
  drawGrid()

  ctx.fillStyle = '#60a5fa'
  ctx.shadowColor = '#60a5fa'
  ctx.shadowBlur = 18
  ctx.fillRect(state.player.x, state.player.y, state.player.width, state.player.height)

  ctx.fillStyle = '#1d4ed8'
  state.blocks.forEach((block) => ctx.fillRect(block.x, block.y, block.width, block.height))

  ctx.shadowBlur = 8
  ctx.fillStyle = '#93c5fd'
  state.sparks.forEach((spark) => {
    ctx.globalAlpha = spark.life / 24
    ctx.fillRect(spark.x, spark.y, 4, 4)
  })
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  ctx.fillStyle = '#e5efff'
  ctx.font = '700 18px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.fillText(\`SCORE \${Math.floor(state.score / 6)}\`, 26, 36)
  ctx.font = '500 14px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.fillStyle = '#93a4bc'
  ctx.fillText('SPACE / CLICK TO JUMP', 26, 60)

  if (!state.running) {
    ctx.fillStyle = 'rgba(5, 7, 13, 0.72)'
    ctx.fillRect(0, 0, innerWidth, innerHeight)
    ctx.fillStyle = '#e5efff'
    ctx.font = '800 42px system-ui, sans-serif'
    ctx.fillText('CRASHED', innerWidth / 2 - 98, innerHeight / 2 - 18)
    ctx.font = '600 16px system-ui, sans-serif'
    ctx.fillStyle = '#93c5fd'
    ctx.fillText('Press space or click to restart', innerWidth / 2 - 104, innerHeight / 2 + 18)
  }
}

function loop() {
  update()
  draw()
  requestAnimationFrame(loop)
}

window.addEventListener('resize', resize)
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code === 'ArrowUp') {
    event.preventDefault()
    jump()
  }
})
window.addEventListener('pointerdown', jump)

resize()
reset()
loop()
`,
  },
  {
    path: 'src/styles.css',
    data: `* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: #05070d;
}

canvas {
  width: 100vw;
  height: 100vh;
  display: block;
}
`,
  },
  {
    path: 'README.md',
    data: `# Neon Runner Demo

This is an optional test project for the browser IDE.

Run it with:

\`\`\`bash
npm install
npm run dev
\`\`\`

Click the preview and press Space or click to jump.
`,
  },
]

const snapshotDatabaseName = 'browser-dev-workspace'
const snapshotStoreName = 'snapshots'
const currentSnapshotKey = 'current'
const searchableFileExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.css',
  '.html',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
])

const appThemes = [
  { id: 'blackblue', label: 'Black / Blue' },
  { id: 'cobalt', label: 'Cobalt' },
  { id: 'contrast', label: 'High Contrast' },
]

const aiSettingsStorageKey = 'ide-ai-settings-v1'
const aiUsageStorageKey = 'ide-ai-usage-v1'
const aiProviders = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    keyPlaceholder: 'Gemini API key',
    models: [
      {
        id: 'gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash-Lite',
        inputPrice: 0.25,
        outputPrice: 1.5,
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash',
        inputPrice: 0.5,
        outputPrice: 3,
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        inputPrice: 0.1,
        outputPrice: 0.4,
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        inputPrice: 0.3,
        outputPrice: 2.5,
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyPlaceholder: 'OpenAI API key',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', inputPrice: 0.15, outputPrice: 0.6 },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', inputPrice: 0.4, outputPrice: 1.6 },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', inputPrice: 0.1, outputPrice: 0.4 },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyPlaceholder: 'OpenRouter API key',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini Flash Free', inputPrice: 0, outputPrice: 0 },
      { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B Free', inputPrice: 0, outputPrice: 0 },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', inputPrice: 0.15, outputPrice: 0.6 },
    ],
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-Compatible',
    keyPlaceholder: 'API key',
    endpoint: '',
    models: [
      { id: 'gpt-4o-mini', label: 'Default model', inputPrice: 0, outputPrice: 0 },
    ],
  },
]

const defaultModelsByProvider = Object.fromEntries(
  aiProviders.map((provider) => [provider.id, provider.models[0].id]),
)

function todayUsageKey() {
  return new Date().toISOString().slice(0, 10)
}

function readJsonStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key)
    return saved ? { ...fallback, ...JSON.parse(saved) } : fallback
  } catch {
    return fallback
  }
}

function defaultAiSettings() {
  return {
    provider: 'gemini',
    apiKeys: {},
    draftApiKey: '',
    models: { ...defaultModelsByProvider },
    customEndpoint: '',
    customModel: 'gpt-4o-mini',
    priceMode: 'free',
    dailyRequestLimit: 20,
    dailyTokenLimit: 50000,
    dailyBudgetUsd: 0,
    maxOutputTokens: 1400,
  }
}

function normalizeAiSettings(savedSettings) {
  const defaults = defaultAiSettings()
  const saved = savedSettings || {}
  const provider = getAiProvider(saved.provider).id
  const apiKeys = { ...(saved.apiKeys || {}) }
  const models = { ...defaultModelsByProvider, ...(saved.models || {}) }

  if (saved.apiKey && !apiKeys.gemini) apiKeys.gemini = saved.apiKey
  if (saved.model && !saved.models?.gemini) models.gemini = saved.model

  return {
    ...defaults,
    ...saved,
    provider,
    apiKeys,
    draftApiKey: apiKeys[provider] || '',
    models,
    customEndpoint: saved.customEndpoint || defaults.customEndpoint,
    customModel: saved.customModel || defaults.customModel,
  }
}

function defaultAiUsage() {
  return {
    date: todayUsageKey(),
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  }
}

function normalizeAiUsage(usage) {
  const currentDate = todayUsageKey()
  if (!usage || usage.date !== currentDate) return defaultAiUsage()
  return { ...defaultAiUsage(), ...usage, date: currentDate }
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4))
}

function getAiProvider(providerId) {
  return aiProviders.find((provider) => provider.id === providerId) || aiProviders[0]
}

function getAiModel(settings) {
  const provider = getAiProvider(settings.provider)
  const modelId = settings.provider === 'custom'
    ? settings.customModel
    : settings.models?.[settings.provider] || provider.models[0].id
  return provider.models.find((model) => model.id === modelId) || {
    id: modelId,
    label: modelId,
    inputPrice: 0,
    outputPrice: 0,
  }
}

function estimateAiCost(settings, inputTokens, outputTokens) {
  if (settings.priceMode === 'free') return 0
  const model = getAiModel(settings)
  return (inputTokens / 1_000_000) * model.inputPrice + (outputTokens / 1_000_000) * model.outputPrice
}

function buildAiPrompt({ userPrompt, activeTab, files, frameworkName, projectName }) {
  const fileList = files.slice(0, 120).map((file) => file.path).join('\n')
  const activeFileBlock = activeTab
    ? `Active file: ${activeTab.path}\n\n${activeTab.contents.slice(0, 24000)}`
    : 'No active file is open.'

  return `You are an AI coding assistant inside a browser IDE.
Project: ${projectName}
Framework: ${frameworkName}

Workspace files:
${fileList || '(empty workspace)'}

${activeFileBlock}

User request:
${userPrompt}

Return ONLY valid JSON. Do not use markdown fences.
Schema:
{
  "message": "brief explanation",
  "edits": [
    { "path": "relative/file/path.ext", "content": "full replacement file content" }
  ],
  "commands": ["optional terminal command suggestions"]
}

Rules:
- Use full file replacements only.
- If you need to create a new file, include its full path and content.
- Keep changes small and directly related to the request.
- If no edit is needed, return an empty edits array.`
}

function parseAiJson(text) {
  const trimmed = String(text || '').trim()
  const jsonText = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  return JSON.parse(jsonText)
}

async function requestAiCoder(settings, prompt, maxOutputTokens) {
  const provider = getAiProvider(settings.provider)
  const apiKey = settings.apiKeys?.[settings.provider]?.trim()
  const model = getAiModel(settings)

  if (!apiKey) {
    throw new Error(`Save a ${provider.label} API key first.`)
  }

  if (settings.provider === 'gemini') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens,
          },
        }),
      },
    )
    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || `Gemini request failed (${response.status})`)

    return {
      text: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '',
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      totalTokens: data.usageMetadata?.totalTokenCount,
    }
  }

  const endpoint = settings.provider === 'custom'
    ? settings.customEndpoint?.trim()
    : provider.endpoint
  if (!endpoint) throw new Error('Enter a custom OpenAI-compatible endpoint first.')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(settings.provider === 'openrouter'
        ? {
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Browser Dev Workspace',
          }
        : {}),
    },
    body: JSON.stringify({
      model: model.id,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: maxOutputTokens,
      response_format: { type: 'json_object' },
    }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || `AI request failed (${response.status})`)

  return {
    text: data.choices?.[0]?.message?.content || '',
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    totalTokens: data.usage?.total_tokens,
  }
}

function databaseRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function openSnapshotDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }

    const request = indexedDB.open(snapshotDatabaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(snapshotStoreName)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withSnapshotStore(mode, callback) {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(snapshotStoreName, mode)
    const store = transaction.objectStore(snapshotStoreName)
    const result = await callback(store)
    await transactionDone(transaction)
    return result
  } finally {
    database.close()
  }
}

async function getSavedSnapshot() {
  try {
    return await withSnapshotStore('readonly', (store) => databaseRequest(store.get(currentSnapshotKey)))
  } catch {
    return null
  }
}

async function saveSnapshot(snapshot) {
  await withSnapshotStore('readwrite', (store) => databaseRequest(store.put(snapshot, currentSnapshotKey)))
}

async function clearSavedSnapshot() {
  await withSnapshotStore('readwrite', (store) => databaseRequest(store.delete(currentSnapshotKey)))
}

function flattenTree(nodes) {
  return nodes.flatMap((node) => (node.type === 'directory' ? flattenTree(node.children || []) : [node]))
}

function fileExtension(path) {
  const match = path.toLowerCase().match(/\.[^.]+$/)
  return match ? match[0] : ''
}

function shouldSearchFile(path) {
  return searchableFileExtensions.has(fileExtension(path))
}

function safeArchiveName(name) {
  return `${name || 'browser-workspace'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'browser-workspace'
}

async function readWorkspaceFiles(webcontainer, dir = '') {
  const entries = await webcontainer.fs.readdir(dir || '.', { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (ignoredExplorerNames.has(entry.name)) continue
    const path = joinPath(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await readWorkspaceFiles(webcontainer, path)))
    } else {
      files.push({ path, data: await webcontainer.fs.readFile(path) })
    }
  }

  return files
}

async function downloadWorkspaceZip(webcontainer, name) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const files = await readWorkspaceFiles(webcontainer)

  files.forEach((file) => {
    zip.file(file.path, file.data)
  })

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeArchiveName(name)}.zip`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function detectFramework(packageJson) {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }

  if (dependencies.next) return 'Next.js'
  if (dependencies.vite) return 'Vite'
  if (dependencies.react) return 'React'
  if (dependencies.vue) return 'Vue'
  if (dependencies.svelte) return 'Svelte'
  if (dependencies.express) return 'Express'
  return 'Node.js'
}

const getWebContainer = async () => {
  if (!webcontainerBootPromise) {
    webcontainerBootPromise = import('@webcontainer/api').then(({ WebContainer }) =>
      WebContainer.boot({
        coep: 'require-corp',
        forwardPreviewErrors: 'exceptions-only',
        workdirName: 'workspace',
      }),
    )
  }

  return webcontainerBootPromise
}

const joinPath = (base, name) => (base ? `${base}/${name}` : name)
const parentPath = (path) => path.split('/').slice(0, -1).join('/')
const baseName = (path) => path.split('/').filter(Boolean).pop() || ''
const normalizePath = (path) => path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')

const getLanguage = (path) => {
  if (path.endsWith('.jsx') || path.endsWith('.tsx')) return 'javascript'
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript'
  if (path.endsWith('.ts')) return 'typescript'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

const sortEntries = (entries) =>
  [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

async function clearWorkspace(webcontainer) {
  const entries = await webcontainer.fs.readdir('.', { withFileTypes: true })
  await Promise.all(entries.map((entry) => webcontainer.fs.rm(entry.name, { recursive: true, force: true })))
}

async function writeUploadedFiles(webcontainer, files) {
  for (const file of files) {
    const path = normalizePath(file.path)
    if (!path) continue
    const segments = path.split('/')
    if (segments.some((segment) => ignoredExplorerNames.has(segment))) continue

    const dir = parentPath(path)
    if (dir) await webcontainer.fs.mkdir(dir, { recursive: true })
    await webcontainer.fs.writeFile(path, file.data)
  }
}

async function readDirectoryHandle(directoryHandle, root = '') {
  const files = []

  for await (const [name, handle] of directoryHandle.entries()) {
    if (ignoredExplorerNames.has(name)) continue
    const path = joinPath(root, name)

    if (handle.kind === 'directory') {
      files.push(...(await readDirectoryHandle(handle, path)))
    } else if (handle.kind === 'file') {
      const file = await handle.getFile()
      files.push({ path, data: new Uint8Array(await file.arrayBuffer()) })
    }
  }

  return files
}

async function filesFromInputList(fileList) {
  const rawFiles = Array.from(fileList).filter((file) => file.webkitRelativePath || file.name)
  const paths = rawFiles.map((file) => normalizePath(file.webkitRelativePath || file.name))
  const roots = new Set(paths.map((path) => path.split('/')[0]).filter(Boolean))
  const stripRoot = roots.size === 1 && paths.every((path) => path.includes('/'))

  return Promise.all(
    rawFiles.map(async (file, index) => {
      const path = stripRoot ? paths[index].split('/').slice(1).join('/') : paths[index]
      return {
        path,
        data: new Uint8Array(await file.arrayBuffer()),
      }
    }),
  )
}

function pickDefaultFile(files) {
  const candidates = [
    'package.json',
    'src/App.jsx',
    'src/App.tsx',
    'src/main.jsx',
    'src/main.tsx',
    'app/page.tsx',
    'pages/index.js',
    'index.html',
    'README.md',
  ]

  return candidates.find((candidate) => files.some((file) => normalizePath(file.path) === candidate))
}

function getRunCommandForPath(path) {
  const normalizedPath = normalizePath(path)
  const quotedPath = normalizedPath.includes(' ') ? `"${normalizedPath}"` : normalizedPath
  const lowerPath = normalizedPath.toLowerCase()

  if (/\.(mjs|cjs|js)$/.test(lowerPath)) return `node ${quotedPath}`
  if (/\.(ts|tsx|jsx)$/.test(lowerPath)) return `npx tsx ${quotedPath}`
  if (/\.(sh|bash)$/.test(lowerPath)) return `sh ${quotedPath}`
  if (/\.json$/.test(lowerPath)) return `cat ${quotedPath}`
  if (/\.html?$/.test(lowerPath)) return `npx vite --host 0.0.0.0 --port ${defaultRunPort}`
  if (/\.css$/.test(lowerPath)) return `cat ${quotedPath}`
  if (/\.md$/.test(lowerPath)) return `cat ${quotedPath}`

  return `node ${quotedPath}`
}

async function readExplorerTree(webcontainer, dir = '') {
  const entries = await webcontainer.fs.readdir(dir || '.', { withFileTypes: true })
  const nodes = await Promise.all(
    entries
      .filter((entry) => !ignoredExplorerNames.has(entry.name))
      .map(async (entry) => {
        const path = joinPath(dir, entry.name)
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path,
            type: 'directory',
            children: await readExplorerTree(webcontainer, path),
          }
        }

        return { name: entry.name, path, type: 'file' }
      }),
  )

  return sortEntries(nodes)
}

function FileTree({ nodes, activePath, onOpenFile, onSelectPath, selectedPath, depth = 0 }) {
  return (
    <div className="file-tree">
      {nodes.map((node) => (
        <div key={node.path}>
          <button
            className={[
              'tree-row',
              node.type === 'directory' ? 'is-directory' : 'is-file',
              node.path === activePath ? 'is-active' : '',
              node.path === selectedPath ? 'is-selected' : '',
            ].join(' ')}
            style={{ '--depth': depth }}
            type="button"
            title={node.path}
            onClick={() => {
              onSelectPath(node.path)
              if (node.type === 'file') onOpenFile(node.path)
            }}
          >
            <span className="tree-icon">{node.type === 'directory' ? 'v' : '-'}</span>
            <span className="tree-name">{node.name}</span>
          </button>
          {node.type === 'directory' && node.children?.length > 0 ? (
            <FileTree
              nodes={node.children}
              activePath={activePath}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              onSelectPath={onSelectPath}
              depth={depth + 1}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function TerminalPanel({ webcontainer, onReady, onOutput }) {
  const terminalElementRef = useRef(null)

  useEffect(() => {
    if (!webcontainer || !terminalElementRef.current) return undefined

    let disposed = false
    let terminal
    let fitAddon
    let shellProcess
    let inputWriter
    let dataDisposable
    let resizeObserver
    let killShellOnLeave

    async function connectTerminal() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css'),
      ])

      if (disposed || !terminalElementRef.current) return

      terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: {
          background: '#080914',
          foreground: '#e6edf7',
          cursor: '#60a5fa',
          selectionBackground: '#17345f',
          black: '#080914',
          red: '#7aa2ff',
          green: '#60a5fa',
          yellow: '#93c5fd',
          blue: '#60a5fa',
          magenta: '#3b82f6',
          cyan: '#93c5fd',
          white: '#d8dee9',
        },
      })
      fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.open(terminalElementRef.current)
      fitAddon.fit()

      terminal.writeln('Booting WebContainer shell...')

      shellProcess = await webcontainer.spawn('jsh', {
        terminal: {
          cols: terminal.cols,
          rows: terminal.rows,
        },
      })

      killShellOnLeave = () => {
        shellProcess?.kill()
      }
      window.addEventListener('pagehide', killShellOnLeave)
      window.addEventListener('beforeunload', killShellOnLeave)

      inputWriter = shellProcess.input.getWriter()
      dataDisposable = terminal.onData((data) => {
        inputWriter.write(data)
      })
      shellProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            terminal.write(data)
            onOutput?.('terminal', data)
          },
        }),
      )

      onReady({
        write(data) {
          terminal.write(data)
        },
        run(command) {
          inputWriter.write(`${command}\n`)
        },
        resize() {
          fitAddon.fit()
          shellProcess.resize({ cols: terminal.cols, rows: terminal.rows })
        },
        focus() {
          terminal.focus()
        },
        kill() {
          shellProcess?.kill()
        },
      })

      resizeObserver = new ResizeObserver(() => {
        if (!terminal || !fitAddon || !shellProcess) return
        fitAddon.fit()
        shellProcess.resize({ cols: terminal.cols, rows: terminal.rows })
      })
      resizeObserver.observe(terminalElementRef.current)
    }

    connectTerminal().catch((error) => {
      terminal?.writeln(`\r\nTerminal failed: ${error.message}`)
    })

    return () => {
      disposed = true
      if (killShellOnLeave) {
        window.removeEventListener('pagehide', killShellOnLeave)
        window.removeEventListener('beforeunload', killShellOnLeave)
      }
      resizeObserver?.disconnect()
      dataDisposable?.dispose()
      inputWriter?.releaseLock()
      shellProcess?.kill()
      terminal?.dispose()
    }
  }, [onOutput, onReady, webcontainer])

  return <div className="terminal-host" ref={terminalElementRef} />
}

function StartScreen({ bootStatus, isImporting, onOpenFolder, onOpenFiles, onLoadDemoGame }) {
  return (
    <div className="start-screen">
      <div className="start-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <section className="start-card">
        <p className="start-kicker">{bootStatus}</p>
        <h1>Drop your project into the terminal.</h1>
        <p>
          Open a folder, install packages, and run scripts in a real browser-based
          Node.js environment. Nothing starts until you choose what to run.
        </p>
        <div className="start-actions">
          <button type="button" className="primary-action" onClick={onOpenFolder} disabled={isImporting}>
            {isImporting ? 'Importing...' : 'Open Folder'}
          </button>
          <button type="button" onClick={onOpenFiles} disabled={isImporting}>
            Open Files
          </button>
          <button type="button" onClick={onLoadDemoGame} disabled={isImporting}>
            Demo Game
          </button>
        </div>
        <div className="start-steps">
          <span>1. Open folder</span>
          <span>or load demo</span>
          <span>2. npm install</span>
          <span>3. npm run dev</span>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [bootStatus, setBootStatus] = useState('Starting WebContainer...')
  const [webcontainer, setWebcontainer] = useState(null)
  const [tree, setTree] = useState([])
  const [selectedPath, setSelectedPath] = useState('')
  const [tabs, setTabs] = useState([])
  const [activePath, setActivePath] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  const [devStatus, setDevStatus] = useState('Stopped')
  const [isInstalling, setIsInstalling] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [operationStatus, setOperationStatus] = useState('')
  const [projectName, setProjectName] = useState('No folder opened')
  const [activeActivity, setActiveActivity] = useState('explorer')
  const [selectedCommandGroup, setSelectedCommandGroup] = useState('all')
  const [commandQuery, setCommandQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSavedProject, setHasSavedProject] = useState(false)
  const [projectScripts, setProjectScripts] = useState([])
  const [frameworkName, setFrameworkName] = useState('Unknown')
  const [problems, setProblems] = useState([])
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [autosaveEnabled, setAutosaveEnabled] = useState(() => localStorage.getItem('ide-autosave') !== 'false')
  const [theme, setTheme] = useState(() => localStorage.getItem('ide-theme') || 'blackblue')
  const [aiSettings, setAiSettings] = useState(() => normalizeAiSettings(readJsonStorage(aiSettingsStorageKey, {})))
  const [aiUsage, setAiUsage] = useState(() => normalizeAiUsage(readJsonStorage(aiUsageStorageKey, defaultAiUsage())))
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiResult, setAiResult] = useState(null)
  const [aiStatus, setAiStatus] = useState('Save an AI provider key, set caps, then ask for a code change.')
  const [apiKeyStatus, setApiKeyStatus] = useState('')
  const [isAiRunning, setIsAiRunning] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState('preview')
  const [bottomPanelTab, setBottomPanelTab] = useState('terminal')
  const [terminalSessionKey, setTerminalSessionKey] = useState(0)
  const [layoutSizes, setLayoutSizes] = useState({
    explorer: 250,
    preview: 560,
    terminal: 300,
  })

  const terminalApiRef = useRef(null)
  const bufferedTerminalOutputRef = useRef('')
  const devProcessRef = useRef(null)
  const bootStartedRef = useRef(false)
  const bootCleanupRef = useRef({})
  const folderInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const saveActiveRef = useRef(null)
  const shellRef = useRef(null)
  const explorerPanelRef = useRef(null)
  const terminalPanelRef = useRef(null)
  const previewPanelRef = useRef(null)
  const commandSearchRef = useRef(null)
  const saveSnapshotTimerRef = useRef(null)
  const lastProblemRef = useRef('')
  const projectNameRef = useRef(projectName)

  const writeTerminal = useCallback((data) => {
    if (terminalApiRef.current) {
      terminalApiRef.current.write(data)
      return
    }

    bufferedTerminalOutputRef.current += data
  }, [])

  const addProblem = useCallback((source, message) => {
    const cleanMessage = message.replace(/\u001b\[[0-9;]*m/g, '').trim()
    if (!cleanMessage || cleanMessage.length < 4) return

    const signature = `${source}:${cleanMessage}`
    if (lastProblemRef.current === signature) return
    lastProblemRef.current = signature

    setProblems((currentProblems) => [
      { id: `${Date.now()}-${Math.random()}`, source, message: cleanMessage },
      ...currentProblems,
    ].slice(0, 8))
  }, [])

  const inspectProcessOutput = useCallback((source, data) => {
    const text = String(data)
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const problemPattern = /\b(error|failed|exception|enoent|eaddrinuse|cannot find|syntaxerror|typeerror|referenceerror)\b/i
    lines.forEach((line) => {
      if (problemPattern.test(line) && !/0 errors?/i.test(line)) {
        addProblem(source, line)
      }
    })
  }, [addProblem])

  const refreshExplorer = useCallback(async (container = webcontainer) => {
    if (!container) return
    const nextTree = await readExplorerTree(container)
    setTree(nextTree)
  }, [webcontainer])

  const detectProjectDetails = useCallback(async (container = webcontainer) => {
    if (!container) return

    try {
      const packageJson = JSON.parse(await container.fs.readFile('package.json', 'utf-8'))
      const scripts = Object.entries(packageJson.scripts || {}).map(([name, script]) => ({
        label: `Script: ${name}`,
        command: `npm run ${name}`,
        group: 'scripts',
        hint: script,
      }))

      setProjectScripts(scripts)
      setFrameworkName(detectFramework(packageJson))
    } catch {
      setProjectScripts([])
      setFrameworkName('No package.json')
    }
  }, [webcontainer])

  const saveCurrentSnapshot = useCallback(async (container = webcontainer, name = projectNameRef.current) => {
    if (!container) return

    window.clearTimeout(saveSnapshotTimerRef.current)
    saveSnapshotTimerRef.current = window.setTimeout(async () => {
      try {
        const files = await readWorkspaceFiles(container)
        if (files.length === 0) return
        await saveSnapshot({
          name,
          files,
          savedAt: Date.now(),
        })
        setHasSavedProject(true)
      } catch (error) {
        setOperationStatus(`Could not save browser snapshot: ${error.message}`)
      }
    }, 400)
  }, [webcontainer])

  const openFile = useCallback(
    async (path, container = webcontainer) => {
      if (!container) return
      try {
        const contents = await container.fs.readFile(path, 'utf-8')
        setTabs((currentTabs) => {
          const existing = currentTabs.find((tab) => tab.path === path)
          if (existing) {
            return currentTabs.map((tab) =>
              tab.path === path ? { ...tab, contents, savedContents: contents, dirty: false } : tab,
            )
          }

          return [
            ...currentTabs,
            {
              path,
              name: baseName(path),
              contents,
              savedContents: contents,
              dirty: false,
              language: getLanguage(path),
            },
          ]
        })
        setActivePath(path)
        setSelectedPath(path)
      } catch (error) {
        setOperationStatus(`Could not open ${path}: ${error.message}`)
      }
    },
    [webcontainer],
  )

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath), [activePath, tabs])

  const runProcess = useCallback(
    async (container, command, args, label) => {
      writeTerminal(`\r\n\x1b[1;36m$ ${[command, ...args].join(' ')}\x1b[0m\r\n`)
      const process = await container.spawn(command, args)
      process.output.pipeTo(
        new WritableStream({
          write(data) {
            writeTerminal(data)
            inspectProcessOutput(label, data)
          },
        }),
      )

      const exitCode = await process.exit
      writeTerminal(`\r\n\x1b[2m${label} exited with code ${exitCode}\x1b[0m\r\n`)
      return exitCode
    },
    [inspectProcessOutput, writeTerminal],
  )

  const startDevServer = useCallback(
    async (container = webcontainer, script = 'dev') => {
      if (!container) return

      if (devProcessRef.current) {
        devProcessRef.current.kill()
        devProcessRef.current = null
      }

      setDevStatus('Starting')
      writeTerminal(`\r\n\x1b[1;34mStarting npm run ${script}...\x1b[0m\r\n`)
      const process = await container.spawn('npm', ['run', script])
      devProcessRef.current = process
      process.output.pipeTo(
        new WritableStream({
          write(data) {
            writeTerminal(data)
            inspectProcessOutput(`npm run ${script}`, data)
          },
        }),
      )
      process.exit.then((exitCode) => {
        if (devProcessRef.current === process) {
          devProcessRef.current = null
          setDevStatus(`Stopped (${exitCode})`)
        }
      })
    },
    [inspectProcessOutput, webcontainer, writeTerminal],
  )

  const stopDevServer = useCallback(() => {
    if (!devProcessRef.current) return
    writeTerminal('\r\n\x1b[1;34mStopping Vite dev server...\x1b[0m\r\n')
    devProcessRef.current.kill()
    devProcessRef.current = null
    setDevStatus('Stopped')
  }, [writeTerminal])

  const saveActiveFile = useCallback(async () => {
    if (!webcontainer || !activeTab) return
    await webcontainer.fs.writeFile(activeTab.path, activeTab.contents)
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === activeTab.path
          ? { ...tab, savedContents: activeTab.contents, dirty: false }
          : tab,
      ),
    )
    setOperationStatus(`Saved ${activeTab.path}`)
    await refreshExplorer(webcontainer)
    if (activeTab.path === 'package.json') await detectProjectDetails(webcontainer)
    await saveCurrentSnapshot(webcontainer)
    setPreviewKey((key) => key + 1)
  }, [activeTab, detectProjectDetails, refreshExplorer, saveCurrentSnapshot, webcontainer])

  useEffect(() => {
    saveActiveRef.current = saveActiveFile
  }, [saveActiveFile])

  useEffect(() => {
    projectNameRef.current = projectName
  }, [projectName])

  useEffect(() => {
    if (!autosaveEnabled || !activeTab?.dirty) return undefined

    const timer = window.setTimeout(() => {
      saveActiveRef.current?.()
    }, 900)

    return () => window.clearTimeout(timer)
  }, [activeTab?.contents, activeTab?.dirty, autosaveEnabled])

  useEffect(() => {
    localStorage.setItem('ide-autosave', String(autosaveEnabled))
  }, [autosaveEnabled])

  useEffect(() => {
    localStorage.setItem('ide-theme', theme)
  }, [theme])

  useEffect(() => {
    setAiSettings((settings) => ({
      ...settings,
      draftApiKey: settings.apiKeys?.[settings.provider] || '',
    }))
    setApiKeyStatus('')
  }, [aiSettings.provider])

  useEffect(() => {
    localStorage.setItem(
      aiSettingsStorageKey,
      JSON.stringify({
        ...aiSettings,
        draftApiKey: aiSettings.apiKeys?.[aiSettings.provider] || '',
      }),
    )
  }, [aiSettings])

  useEffect(() => {
    const normalizedUsage = normalizeAiUsage(aiUsage)
    if (normalizedUsage.date !== aiUsage.date) {
      setAiUsage(normalizedUsage)
      return
    }

    localStorage.setItem(aiUsageStorageKey, JSON.stringify(aiUsage))
  }, [aiUsage])

  useEffect(() => {
    getSavedSnapshot().then((snapshot) => {
      setHasSavedProject(Boolean(snapshot?.files?.length))
    })
  }, [])

  useEffect(() => {
    return () => {
      window.clearTimeout(saveSnapshotTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const stopProcessesOnLeave = () => {
      devProcessRef.current?.kill()
      devProcessRef.current = null
      try {
        webcontainer?.teardown()
      } catch {
        // The page is leaving; the container may already be torn down.
      }
    }

    window.addEventListener('pagehide', stopProcessesOnLeave)
    window.addEventListener('beforeunload', stopProcessesOnLeave)

    return () => {
      window.removeEventListener('pagehide', stopProcessesOnLeave)
      window.removeEventListener('beforeunload', stopProcessesOnLeave)
    }
  }, [webcontainer])

  useEffect(() => {
    const cleanupBoot = () => {
      window.clearTimeout(bootCleanupRef.current.refreshTimer)
      bootCleanupRef.current.watcher?.close()
      bootCleanupRef.current.unsubscribeServer?.()
      bootCleanupRef.current.unsubscribePort?.()
      bootCleanupRef.current.unsubscribeError?.()
    }

    if (bootStartedRef.current) return cleanupBoot
    bootStartedRef.current = true

    let watcher
    let unsubscribeServer
    let unsubscribePort
    let unsubscribeError
    let refreshTimer

    async function boot() {
      try {
        const container = await getWebContainer()

        unsubscribeServer = container.on('server-ready', (port, url) => {
          setPreviewUrl(url)
          setPreviewKey((key) => key + 1)
          setDevStatus(`Running on ${port}`)
        })
        unsubscribePort = container.on('port', (port, type, url) => {
          if (type === 'open') {
            setPreviewUrl(url)
            setPreviewKey((key) => key + 1)
            setDevStatus(`Running on ${port}`)
          } else {
            setPreviewUrl('')
            setDevStatus('Stopped')
          }
        })
        unsubscribeError = container.on('error', (error) => {
          setOperationStatus(`WebContainer error: ${error.message}`)
          addProblem('WebContainer', error.message)
        })
        bootCleanupRef.current.unsubscribeServer = unsubscribeServer
        bootCleanupRef.current.unsubscribePort = unsubscribePort
        bootCleanupRef.current.unsubscribeError = unsubscribeError

        setWebcontainer(container)
        await refreshExplorer(container)
        await detectProjectDetails(container)

        try {
          watcher = container.fs.watch('.', { recursive: true }, () => {
            window.clearTimeout(refreshTimer)
            refreshTimer = window.setTimeout(() => {
              bootCleanupRef.current.refreshTimer = refreshTimer
              refreshExplorer(container)
              detectProjectDetails(container)
              saveCurrentSnapshot(container)
              setPreviewKey((key) => key + 1)
            }, 250)
          })
          bootCleanupRef.current.watcher = watcher
        } catch (error) {
          setOperationStatus(`File watcher unavailable: ${error.message}`)
        }

        setBootStatus('Ready')
        setOperationStatus('Open a folder or files to start running code in the browser.')
      } catch (error) {
        setIsInstalling(false)
        setBootStatus('WebContainer failed to start')
        setOperationStatus(error.message)
        writeTerminal(`\r\nWebContainer failed: ${error.message}\r\n`)
      }
    }

    boot()

    return cleanupBoot
  }, [])

  const handleTerminalReady = useCallback(
    (api) => {
      terminalApiRef.current = api
      if (bufferedTerminalOutputRef.current) {
        api.write(bufferedTerminalOutputRef.current)
        bufferedTerminalOutputRef.current = ''
      }
    },
    [],
  )

  const dynamicCommands = useMemo(
    () => [...projectScripts, ...quickCommands],
    [projectScripts],
  )

  const commandGroups = useMemo(
    () => ['all', ...Array.from(new Set(dynamicCommands.map((command) => command.group)))],
    [dynamicCommands],
  )

  const visibleCommands = useMemo(
    () => {
      const query = commandQuery.trim().toLowerCase()

      return dynamicCommands.filter((item) => {
        const inGroup = selectedCommandGroup === 'all' || item.group === selectedCommandGroup
        const searchable = `${item.label} ${item.command} ${item.group} ${item.hint || ''}`.toLowerCase()
        return inGroup && (!query || searchable.includes(query))
      })
    },
    [commandQuery, dynamicCommands, selectedCommandGroup],
  )

  const aiUsageSummary = useMemo(() => {
    const normalizedUsage = normalizeAiUsage(aiUsage)
    const tokenLimit = Number(aiSettings.dailyTokenLimit) || 0
    const requestLimit = Number(aiSettings.dailyRequestLimit) || 0
    const budget = Number(aiSettings.dailyBudgetUsd) || 0
    const usedTokens = normalizedUsage.inputTokens + normalizedUsage.outputTokens

    return {
      ...normalizedUsage,
      usedTokens,
      requestsLeft: Math.max(0, requestLimit - normalizedUsage.requests),
      tokensLeft: Math.max(0, tokenLimit - usedTokens),
      budgetLeft: Math.max(0, budget - normalizedUsage.estimatedCostUsd),
      provider: getAiProvider(aiSettings.provider),
      model: getAiModel(aiSettings),
    }
  }, [aiSettings, aiUsage])

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!webcontainer || !query) {
      setSearchResults([])
      setIsSearching(false)
      return undefined
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setIsSearching(true)
      const files = flattenTree(tree)
      const results = []

      for (const file of files) {
        if (results.length >= 40) break

        const pathMatch = file.path.toLowerCase().includes(query)
        if (pathMatch) {
          results.push({ path: file.path, label: file.name, snippet: 'Path match' })
          continue
        }

        if (!shouldSearchFile(file.path)) continue

        try {
          const text = await webcontainer.fs.readFile(file.path, 'utf-8')
          const lowerText = text.toLowerCase()
          const index = lowerText.indexOf(query)
          if (index >= 0) {
            const lineNumber = text.slice(0, index).split(/\r?\n/).length
            const line = text.split(/\r?\n/)[lineNumber - 1]?.trim() || ''
            results.push({
              path: file.path,
              label: `${file.name}:${lineNumber}`,
              snippet: line.slice(0, 120),
            })
          }
        } catch {
          // Binary or unreadable files are skipped in text search.
        }
      }

      if (!cancelled) {
        setSearchResults(results)
        setIsSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchQuery, tree, webcontainer])

  const runTerminalCommand = useCallback((command) => {
    if (!terminalApiRef.current) {
      setOperationStatus('Terminal is still connecting. Try again in a moment.')
      return
    }

    terminalApiRef.current.run(command)
    setOperationStatus(`Running: ${command}`)
  }, [])

  const restartTerminal = useCallback(() => {
    terminalApiRef.current?.kill()
    terminalApiRef.current = null
    bufferedTerminalOutputRef.current = ''
    setTerminalSessionKey((key) => key + 1)
    setOperationStatus('Started a fresh terminal session.')
    setActiveActivity('commands')
  }, [])

  const killTerminal = useCallback(() => {
    terminalApiRef.current?.kill()
    setOperationStatus('Terminal process stopped.')
  }, [])

  const clearTerminal = useCallback(() => {
    terminalApiRef.current?.run('clear')
    setOperationStatus('Terminal cleared.')
  }, [])

  const exportProject = useCallback(async () => {
    if (!webcontainer || tree.length === 0) {
      setOperationStatus('Open or create a project before exporting.')
      return
    }

    try {
      await downloadWorkspaceZip(webcontainer, projectName)
      setOperationStatus('Project ZIP exported.')
    } catch (error) {
      setOperationStatus(`Export failed: ${error.message}`)
      addProblem('Export', error.message)
    }
  }, [addProblem, projectName, tree.length, webcontainer])

  const clearBrowserProject = useCallback(async () => {
    await clearSavedSnapshot()
    setHasSavedProject(false)
    setOperationStatus('Saved browser project cleared.')
  }, [])

  const runAiCoder = useCallback(async () => {
    const provider = getAiProvider(aiSettings.provider)
    const apiKey = aiSettings.apiKeys?.[aiSettings.provider]?.trim()
    const request = aiPrompt.trim()

    if (!apiKey) {
      setAiStatus(`Save a ${provider.label} API key first.`)
      return
    }

    if (!request) {
      setAiStatus('Describe what you want the AI coder to change.')
      return
    }

    const files = flattenTree(tree)
    const prompt = buildAiPrompt({
      userPrompt: request,
      activeTab,
      files,
      frameworkName,
      projectName,
    })
    const estimatedInputTokens = estimateTokens(prompt)
    const estimatedOutputTokens = Number(aiSettings.maxOutputTokens) || 1400
    const estimatedCost = estimateAiCost(aiSettings, estimatedInputTokens, estimatedOutputTokens)
    const currentUsage = normalizeAiUsage(aiUsage)
    const currentTokens = currentUsage.inputTokens + currentUsage.outputTokens
    const dailyRequestLimit = Number(aiSettings.dailyRequestLimit) || 0
    const dailyTokenLimit = Number(aiSettings.dailyTokenLimit) || 0
    const dailyBudgetUsd = Number(aiSettings.dailyBudgetUsd) || 0

    if (currentUsage.requests + 1 > dailyRequestLimit) {
      setAiStatus('Blocked: your local daily AI request cap has been reached.')
      return
    }

    if (currentTokens + estimatedInputTokens + estimatedOutputTokens > dailyTokenLimit) {
      setAiStatus('Blocked: this request would exceed your local daily token cap.')
      return
    }

    if (aiSettings.priceMode !== 'free' && currentUsage.estimatedCostUsd + estimatedCost > dailyBudgetUsd) {
      setAiStatus('Blocked: this request would exceed your local daily budget cap.')
      return
    }

    setIsAiRunning(true)
    setAiStatus(`Asking ${provider.label} for a patch...`)
    setAiResult(null)

    try {
      const response = await requestAiCoder(aiSettings, prompt, estimatedOutputTokens)
      const text = response.text
      const parsed = parseAiJson(text)
      const actualInputTokens = response.inputTokens || estimatedInputTokens
      const actualOutputTokens =
        response.outputTokens ||
        Math.max(estimateTokens(text), response.totalTokens ? response.totalTokens - actualInputTokens : 1)
      const actualCost = estimateAiCost(aiSettings, actualInputTokens, actualOutputTokens)

      setAiUsage((current) => {
        const normalized = normalizeAiUsage(current)
        return {
          ...normalized,
          requests: normalized.requests + 1,
          inputTokens: normalized.inputTokens + actualInputTokens,
          outputTokens: normalized.outputTokens + actualOutputTokens,
          estimatedCostUsd: normalized.estimatedCostUsd + actualCost,
        }
      })
      setAiResult({
        message: parsed.message || 'Gemini returned a proposed change.',
        edits: Array.isArray(parsed.edits) ? parsed.edits : [],
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        usage: {
          inputTokens: actualInputTokens,
          outputTokens: actualOutputTokens,
          estimatedCostUsd: actualCost,
        },
      })
      setAiStatus(`Ready: ${Array.isArray(parsed.edits) ? parsed.edits.length : 0} file edit(s) proposed.`)
    } catch (error) {
      setAiStatus(error.message)
      addProblem('AI Coder', error.message)
    } finally {
      setIsAiRunning(false)
    }
  }, [
    activeTab,
    addProblem,
    aiPrompt,
    aiSettings,
    aiUsage,
    frameworkName,
    projectName,
    tree,
  ])

  const applyAiEdits = useCallback(async () => {
    if (!webcontainer || !aiResult?.edits?.length) return

    try {
      for (const edit of aiResult.edits) {
        const path = normalizePath(edit.path || '')
        if (!path || typeof edit.content !== 'string') continue
        const dir = parentPath(path)
        if (dir) await webcontainer.fs.mkdir(dir, { recursive: true })
        await webcontainer.fs.writeFile(path, edit.content)
      }

      await refreshExplorer(webcontainer)
      await detectProjectDetails(webcontainer)
      await saveCurrentSnapshot(webcontainer)

      const firstEdit = aiResult.edits.find((edit) => edit.path)
      if (firstEdit?.path) await openFile(normalizePath(firstEdit.path), webcontainer)

      setPreviewKey((key) => key + 1)
      setAiStatus(`Applied ${aiResult.edits.length} AI edit(s).`)
      setOperationStatus(`Applied ${aiResult.edits.length} AI edit(s).`)
    } catch (error) {
      setAiStatus(`Apply failed: ${error.message}`)
      addProblem('AI Apply', error.message)
    }
  }, [
    addProblem,
    aiResult,
    detectProjectDetails,
    openFile,
    refreshExplorer,
    saveCurrentSnapshot,
    webcontainer,
  ])

  const resetAiUsage = useCallback(() => {
    const nextUsage = defaultAiUsage()
    setAiUsage(nextUsage)
    localStorage.setItem(aiUsageStorageKey, JSON.stringify(nextUsage))
    setAiStatus('Local AI usage counters reset.')
  }, [])

  const saveCurrentApiKey = useCallback(() => {
    const provider = getAiProvider(aiSettings.provider)
    const key = aiSettings.draftApiKey.trim()

    if (!key) {
      setApiKeyStatus(`Enter a ${provider.label} API key before saving.`)
      return
    }

    const nextSettings = {
      ...aiSettings,
      apiKeys: {
        ...aiSettings.apiKeys,
        [aiSettings.provider]: key,
      },
      draftApiKey: key,
    }

    setAiSettings(nextSettings)
    localStorage.setItem(aiSettingsStorageKey, JSON.stringify(nextSettings))
    setApiKeyStatus(`${provider.label} key saved in this browser.`)
    setAiStatus(`${provider.label} key saved. Ask the AI coder for a change.`)
  }, [aiSettings])

  const forgetCurrentApiKey = useCallback(() => {
    const provider = getAiProvider(aiSettings.provider)
    const nextKeys = { ...aiSettings.apiKeys }
    delete nextKeys[aiSettings.provider]
    const nextSettings = {
      ...aiSettings,
      apiKeys: nextKeys,
      draftApiKey: '',
    }

    setAiSettings(nextSettings)
    localStorage.setItem(aiSettingsStorageKey, JSON.stringify(nextSettings))
    setApiKeyStatus(`${provider.label} key removed from this browser.`)
  }, [aiSettings])

  const selectBottomPanelTab = useCallback((tab) => {
    setBottomPanelTab(tab)
    if (tab === 'terminal') {
      window.setTimeout(() => {
        terminalApiRef.current?.resize()
        terminalApiRef.current?.focus()
      }, 50)
    }
  }, [])

  const focusActivity = useCallback((activity) => {
    setActiveActivity(activity)

    if (activity === 'explorer') {
      setLayoutSizes((sizes) => ({ ...sizes, explorer: Math.max(sizes.explorer, 250) }))
      explorerPanelRef.current?.focus({ preventScroll: true })
      setOperationStatus('Explorer focused.')
      return
    }

    if (activity === 'commands') {
      setBottomPanelTab('commands')
      setLayoutSizes((sizes) => ({ ...sizes, terminal: Math.max(sizes.terminal, 300) }))
      commandSearchRef.current?.focus({ preventScroll: true })
      setOperationStatus('Command deck and terminal focused.')
      return
    }

    setRightPanelTab('preview')
    setLayoutSizes((sizes) => ({ ...sizes, preview: Math.max(sizes.preview, 560) }))
    previewPanelRef.current?.focus({ preventScroll: true })
    setOperationStatus('Preview focused.')
  }, [])

  const beginResize = useCallback((panel, event) => {
    event.preventDefault()
    const shellRect = shellRef.current?.getBoundingClientRect()
    if (!shellRect) return

    const startX = event.clientX
    const startY = event.clientY
    const startSizes = { ...layoutSizes }

    const handlePointerMove = (moveEvent) => {
      setLayoutSizes((currentSizes) => {
        if (panel === 'explorer') {
          return {
            ...currentSizes,
            explorer: clamp(startSizes.explorer + moveEvent.clientX - startX, 210, 380),
          }
        }

        if (panel === 'preview') {
          const maxPreview = Math.max(340, shellRect.width - startSizes.explorer - 560)
          return {
            ...currentSizes,
            preview: clamp(startSizes.preview - (moveEvent.clientX - startX), 320, maxPreview),
          }
        }

        return {
          ...currentSizes,
          terminal: clamp(startSizes.terminal - (moveEvent.clientY - startY), 220, 520),
        }
      })
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      document.body.classList.remove('is-resizing')
      terminalApiRef.current?.resize()
    }

    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }, [layoutSizes])

  const updateActiveContents = useCallback((value = '') => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === activePath
          ? { ...tab, contents: value, dirty: value !== tab.savedContents }
          : tab,
      ),
    )
  }, [activePath])

  const closeTab = useCallback((path, event) => {
    event.stopPropagation()
    setTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tab) => tab.path !== path)
      if (path === activePath) {
        const closedIndex = currentTabs.findIndex((tab) => tab.path === path)
        const nextActive = nextTabs[Math.max(0, closedIndex - 1)] || nextTabs[0]
        setActivePath(nextActive?.path || '')
      }
      return nextTabs
    })
  }, [activePath])

  const createEntry = useCallback(
    async (kind) => {
      if (!webcontainer) return
      const base =
        selectedPath && tabs.some((tab) => tab.path === selectedPath)
          ? parentPath(selectedPath)
          : selectedPath
      const requestedName = window.prompt(
        kind === 'directory' ? 'New folder path' : 'New file path',
        base ? `${base}/` : '',
      )
      if (!requestedName) return

      const normalizedPath = requestedName.replace(/^\/+|\/+$/g, '')
      if (!normalizedPath) return

      if (kind === 'directory') {
        await webcontainer.fs.mkdir(normalizedPath, { recursive: true })
      } else {
        const dir = parentPath(normalizedPath)
        if (dir) await webcontainer.fs.mkdir(dir, { recursive: true })
        await webcontainer.fs.writeFile(normalizedPath, '')
        await openFile(normalizedPath, webcontainer)
      }
      await refreshExplorer(webcontainer)
      await saveCurrentSnapshot(webcontainer)
      setOperationStatus(`Created ${normalizedPath}`)
    },
    [openFile, refreshExplorer, saveCurrentSnapshot, selectedPath, tabs, webcontainer],
  )

  const deleteEntry = useCallback(async () => {
    if (!webcontainer || !selectedPath) return
    const confirmed = window.confirm(`Delete ${selectedPath}?`)
    if (!confirmed) return

    await webcontainer.fs.rm(selectedPath, { recursive: true, force: true })
    setTabs((currentTabs) => currentTabs.filter((tab) => !tab.path.startsWith(selectedPath)))
    if (activePath.startsWith(selectedPath)) setActivePath('')
    setSelectedPath('')
    await refreshExplorer(webcontainer)
    await saveCurrentSnapshot(webcontainer)
    setOperationStatus(`Deleted ${selectedPath}`)
  }, [activePath, refreshExplorer, saveCurrentSnapshot, selectedPath, webcontainer])

  const renameEntry = useCallback(async () => {
    if (!webcontainer || !selectedPath) return
    const currentParent = parentPath(selectedPath)
    const nextName = window.prompt('Rename to', baseName(selectedPath))
    if (!nextName) return
    const nextPath = joinPath(currentParent, nextName.replace(/^\/+|\/+$/g, ''))
    if (!nextPath || nextPath === selectedPath) return

    await webcontainer.fs.rename(selectedPath, nextPath)
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === selectedPath || tab.path.startsWith(`${selectedPath}/`)
          ? {
              ...tab,
              path: tab.path.replace(selectedPath, nextPath),
              name: baseName(tab.path.replace(selectedPath, nextPath)),
            }
          : tab,
      ),
    )
    if (activePath === selectedPath || activePath.startsWith(`${selectedPath}/`)) {
      setActivePath(activePath.replace(selectedPath, nextPath))
    }
    setSelectedPath(nextPath)
    await refreshExplorer(webcontainer)
    await saveCurrentSnapshot(webcontainer)
    setOperationStatus(`Renamed to ${nextPath}`)
  }, [activePath, refreshExplorer, saveCurrentSnapshot, selectedPath, webcontainer])

  const importProjectFiles = useCallback(
    async (files, name = 'Imported Project', options = {}) => {
      if (!webcontainer || files.length === 0) return

      setIsImporting(true)
      setOperationStatus(`Importing ${files.length} files...`)
      stopDevServer()
      terminalApiRef.current = null
      bufferedTerminalOutputRef.current = ''
      setTerminalSessionKey((key) => key + 1)

      try {
        await clearWorkspace(webcontainer)
        await writeUploadedFiles(webcontainer, files)
        setTabs([])
        setActivePath('')
        setSelectedPath('')
        setPreviewUrl('')
        setPreviewKey((key) => key + 1)
        setProjectName(name)
        await refreshExplorer(webcontainer)
        await detectProjectDetails(webcontainer)

        const firstFile = pickDefaultFile(files)
        if (firstFile) await openFile(firstFile, webcontainer)

        if (!options.skipSnapshot) {
          await saveCurrentSnapshot(webcontainer, name)
        }

        setOperationStatus(`Imported ${name}. Run npm install, then npm run dev or npm start.`)
        writeTerminal(`\r\n\x1b[1;32mImported ${files.length} files into WebContainer.\x1b[0m\r\n`)
      } catch (error) {
        setOperationStatus(`Import failed: ${error.message}`)
        writeTerminal(`\r\nImport failed: ${error.message}\r\n`)
      } finally {
        setIsImporting(false)
      }
    },
    [detectProjectDetails, openFile, refreshExplorer, saveCurrentSnapshot, stopDevServer, webcontainer, writeTerminal],
  )

  const restoreSavedProject = useCallback(async () => {
    if (!webcontainer) return
    const snapshot = await getSavedSnapshot()
    if (!snapshot?.files?.length) {
      setHasSavedProject(false)
      setOperationStatus('No saved browser project was found.')
      return
    }

    if (tree.length > 0 && !window.confirm('Restore the saved project and replace the current WebContainer workspace?')) {
      return
    }

    await importProjectFiles(snapshot.files, snapshot.name || 'Restored Project', { skipSnapshot: true })
    setOperationStatus(`Restored ${snapshot.name || 'saved project'} from browser storage.`)
  }, [importProjectFiles, tree.length, webcontainer])

  const openLocalFolder = useCallback(async () => {
    if (!webcontainer) return

    if ('showDirectoryPicker' in window) {
      try {
        const directoryHandle = await window.showDirectoryPicker({ mode: 'read' })
        const files = await readDirectoryHandle(directoryHandle)
        await importProjectFiles(files, directoryHandle.name)
        return
      } catch (error) {
        if (error.name !== 'AbortError') {
          setOperationStatus(`Folder picker failed: ${error.message}`)
        }
        return
      }
    }

    folderInputRef.current?.click()
  }, [importProjectFiles, webcontainer])

  const openLocalFiles = useCallback(() => {
    if (!webcontainer || isImporting) return
    fileInputRef.current?.click()
  }, [isImporting, webcontainer])

  const loadDemoGame = useCallback(async () => {
    if (!webcontainer || isImporting) return
    if (tree.length > 0 && !window.confirm('Load the demo game and replace the current WebContainer workspace?')) {
      return
    }

    await importProjectFiles(demoGameFiles, 'Neon Runner Demo')
    await openFile('src/main.js', webcontainer)
    setOperationStatus('Demo game loaded. Run npm install, then npm run dev.')
  }, [importProjectFiles, isImporting, openFile, tree.length, webcontainer])

  const handleFolderInput = useCallback(
    async (event) => {
      const files = event.target.files
      if (!files?.length) return

      const importedFiles = await filesFromInputList(files)
      const firstPath = normalizePath(files[0].webkitRelativePath || files[0].name)
      const name = firstPath.includes('/') ? firstPath.split('/')[0] : 'Imported Project'
      await importProjectFiles(importedFiles, name)
      event.target.value = ''
    },
    [importProjectFiles],
  )

  const handleFileInput = useCallback(
    async (event) => {
      const files = event.target.files
      if (!files?.length) return

      const importedFiles = await Promise.all(
        Array.from(files).map(async (file) => ({
          path: normalizePath(file.name),
          data: new Uint8Array(await file.arrayBuffer()),
        })),
      )
      await importProjectFiles(importedFiles, files.length === 1 ? files[0].name : 'Imported Files')
      event.target.value = ''
    },
    [importProjectFiles],
  )

  const runActiveFile = useCallback(async () => {
    if (!activeTab) {
      setOperationStatus('Open a file first, then run it.')
      return
    }

    if (activeTab.dirty) {
      await saveActiveFile()
    }

    const command = getRunCommandForPath(activeTab.path)
    runTerminalCommand(command)
  }, [activeTab, runTerminalCommand, saveActiveFile])

  return (
    <div
      className={`ide-shell theme-${theme} mobile-activity-${activeActivity}`}
      ref={shellRef}
      style={{
        '--explorer-width': `${layoutSizes.explorer}px`,
        '--preview-width': `${layoutSizes.preview}px`,
        '--terminal-height': `${layoutSizes.terminal}px`,
      }}
    >
      <header className="top-bar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <strong>Browser Dev Workspace</strong>
            <span>{projectName}</span>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="primary-action" disabled={!webcontainer || isImporting || isInstalling} onClick={openLocalFolder}>
            {isImporting ? 'Importing...' : 'Open Folder'}
          </button>
          <button type="button" disabled={!webcontainer || isImporting} onClick={openLocalFiles}>Open Files</button>
          <button type="button" disabled={!webcontainer || !hasSavedProject || isImporting} onClick={restoreSavedProject}>Restore</button>
          <button type="button" disabled={!webcontainer || tree.length === 0} onClick={exportProject}>Export ZIP</button>
          <button type="button" disabled={!webcontainer || isImporting} onClick={loadDemoGame}>Demo Game</button>
          <button type="button" disabled={!activeTab} onClick={runActiveFile}>Run File</button>
          <button type="button" onClick={() => runTerminalCommand('npm install')}>Install</button>
          <button type="button" onClick={() => startDevServer(undefined, 'dev')}>Run Dev</button>
          <button type="button" onClick={() => startDevServer(undefined, 'start')}>Run Start</button>
          <label className="toolbar-toggle">
            <input
              type="checkbox"
              checked={autosaveEnabled}
              onChange={(event) => setAutosaveEnabled(event.target.checked)}
            />
            Autosave
          </label>
          <select value={theme} onChange={(event) => setTheme(event.target.value)} title="Theme">
            {appThemes.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </div>
      </header>

      <aside className="activity-bar" aria-label="Activity">
        <button
          className={`activity-dot ${activeActivity === 'explorer' ? 'is-active' : ''}`}
          type="button"
          title="Focus Explorer"
          aria-pressed={activeActivity === 'explorer'}
          onClick={() => focusActivity('explorer')}
        >
          EX
        </button>
        <button
          className={`activity-dot ${activeActivity === 'commands' ? 'is-active' : ''}`}
          type="button"
          title="Focus Commands and Terminal"
          aria-pressed={activeActivity === 'commands'}
          onClick={() => focusActivity('commands')}
        >
          CM
        </button>
        <button
          className={`activity-dot ${activeActivity === 'preview' ? 'is-active' : ''}`}
          type="button"
          title="Focus Preview"
          aria-pressed={activeActivity === 'preview'}
          onClick={() => focusActivity('preview')}
        >
          PV
        </button>
      </aside>

      <aside
        className={`explorer-panel ${activeActivity === 'explorer' ? 'is-activity-active' : ''}`}
        ref={explorerPanelRef}
        tabIndex={-1}
      >
        <div className="panel-header">
          <span>Explorer</span>
        </div>
        <div className="explorer-actions">
          <button type="button" title="Open local folder" disabled={!webcontainer || isImporting || isInstalling} onClick={openLocalFolder}>Open</button>
          <button type="button" title="Open files" disabled={!webcontainer || isImporting} onClick={openLocalFiles}>Files</button>
          <button type="button" title="New file" onClick={() => createEntry('file')}>New</button>
          <button type="button" title="New folder" onClick={() => createEntry('directory')}>Folder</button>
          <button type="button" title="Rename" disabled={!selectedPath} onClick={renameEntry}>Rename</button>
          <button type="button" title="Delete" disabled={!selectedPath} onClick={deleteEntry}>Delete</button>
        </div>
        <input
          ref={folderInputRef}
          className="folder-input"
          type="file"
          multiple
          webkitdirectory=""
          directory=""
          onChange={handleFolderInput}
        />
        <input
          ref={fileInputRef}
          className="folder-input"
          type="file"
          multiple
          onChange={handleFileInput}
        />
        <div className="boot-line">
          <span className={bootStatus === 'Ready' ? 'status-ok' : 'status-busy'} />
          {bootStatus}
        </div>
        <div className="project-summary">
          <span>Workspace</span>
          <strong>{projectName}</strong>
          <small>{frameworkName} project running inside the browser WebContainer.</small>
          {hasSavedProject ? (
            <div className="saved-tools">
              <button type="button" onClick={restoreSavedProject}>Restore saved</button>
              <button type="button" onClick={clearBrowserProject}>Clear save</button>
            </div>
          ) : null}
        </div>
        <div className="project-search">
          <input
            type="search"
            value={searchQuery}
            placeholder="Search files and text..."
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery ? (
            <div className="search-results">
              {isSearching ? <p>Searching...</p> : null}
              {!isSearching && searchResults.length === 0 ? <p>No matches</p> : null}
              {searchResults.map((result) => (
                <button
                  key={`${result.path}-${result.label}-${result.snippet}`}
                  type="button"
                  title={result.path}
                  onClick={() => openFile(result.path)}
                >
                  <span>{result.label}</span>
                  <small>{result.path}</small>
                  <code>{result.snippet}</code>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="explorer-scroll">
          {tree.length > 0 ? (
            <FileTree
              nodes={tree}
              activePath={activePath}
              selectedPath={selectedPath}
              onOpenFile={openFile}
              onSelectPath={setSelectedPath}
            />
          ) : (
            <p className="empty-state">Open a folder or files to populate the workspace.</p>
          )}
        </div>
      </aside>

      <div
        className="resize-handle resize-handle-vertical explorer-resizer"
        role="separator"
        aria-label="Resize explorer"
        aria-orientation="vertical"
        onPointerDown={(event) => beginResize('explorer', event)}
      />

      <main className="workbench">
        <section className="editor-panel">
          {tree.length > 0 && showOnboarding ? (
            <div className="onboarding-strip">
              <span>Next: install dependencies, run a script, then watch the preview connect automatically.</span>
              <button type="button" onClick={() => runTerminalCommand('npm install')}>npm install</button>
              <button type="button" onClick={() => startDevServer(undefined, projectScripts.some((script) => script.command === 'npm run dev') ? 'dev' : 'start')}>
                Run app
              </button>
              <button type="button" onClick={() => setShowOnboarding(false)}>Dismiss</button>
            </div>
          ) : null}
          <div className="tabs-bar">
            {tabs.length > 0 ? (
              tabs.map((tab) => (
                <button
                  className={`tab ${tab.path === activePath ? 'is-active' : ''}`}
                  key={tab.path}
                  type="button"
                  title={tab.path}
                  onClick={() => setActivePath(tab.path)}
                >
                  <span>{tab.name}</span>
                  {tab.dirty ? <span className="dirty-dot" /> : null}
                  <span className="close-tab" onClick={(event) => closeTab(tab.path, event)}>x</span>
                </button>
              ))
            ) : (
              <span className="no-tabs">Open a file from the explorer</span>
            )}
            <button className="save-button" type="button" disabled={!activeTab || !activeTab.dirty} onClick={saveActiveFile}>
              Save
            </button>
          </div>
          <div className="editor-host">
            {activeTab ? (
              <Suspense fallback={<div className="editor-loading">Loading Monaco...</div>}>
                <MonacoEditor
                  height="100%"
                  language={activeTab.language}
                  path={activeTab.path}
                  theme="vs-dark"
                  value={activeTab.contents}
                  onChange={updateActiveContents}
                  onMount={(editor, monaco) => {
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                      saveActiveRef.current?.()
                    })
                  }}
                  options={{
                    automaticLayout: true,
                    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    tabSize: 2,
                  }}
                />
              </Suspense>
            ) : (
              <StartScreen
                bootStatus={bootStatus}
                isImporting={isImporting}
                onOpenFolder={openLocalFolder}
                onOpenFiles={openLocalFiles}
                onLoadDemoGame={loadDemoGame}
              />
            )}
          </div>
        </section>

        <div
          className="resize-handle resize-handle-horizontal terminal-resizer"
          role="separator"
          aria-label="Resize terminal"
          aria-orientation="horizontal"
          onPointerDown={(event) => beginResize('terminal', event)}
        />

        <section
          className={`terminal-panel ${activeActivity === 'commands' ? 'is-activity-active' : ''}`}
          ref={terminalPanelRef}
          tabIndex={-1}
        >
          <div className="panel-title-row">
            <div className="bottom-tabs" role="tablist" aria-label="Bottom panel">
              <button
                className={bottomPanelTab === 'terminal' ? 'is-active' : ''}
                type="button"
                onClick={() => selectBottomPanelTab('terminal')}
              >
                Terminal
              </button>
              <button
                className={bottomPanelTab === 'commands' ? 'is-active' : ''}
                type="button"
                onClick={() => selectBottomPanelTab('commands')}
              >
                Commands
              </button>
              <button
                className={bottomPanelTab === 'problems' ? 'is-active' : ''}
                type="button"
                onClick={() => selectBottomPanelTab('problems')}
              >
                Problems
              </button>
            </div>
            <div className="terminal-actions">
              <span>{isInstalling ? 'Installing packages' : 'Interactive jsh'}</span>
              <button type="button" onClick={restartTerminal}>New</button>
              <button type="button" onClick={clearTerminal}>Clear</button>
              <button type="button" onClick={killTerminal}>Kill</button>
            </div>
          </div>
          <div className={`command-shelf ${bottomPanelTab === 'commands' ? 'is-active' : ''}`}>
            <div className="command-header">
              <div>
                <strong>Command Deck</strong>
                <span>{visibleCommands.length} real WebContainer commands</span>
              </div>
              <input
                ref={commandSearchRef}
                type="search"
                value={commandQuery}
                placeholder="Search commands..."
                onChange={(event) => setCommandQuery(event.target.value)}
              />
            </div>
            <div className="command-layout">
              <div className="command-tabs">
                {commandGroups.map((group) => (
                  <button
                    key={group}
                    className={group === selectedCommandGroup ? 'is-active' : ''}
                    type="button"
                    onClick={() => setSelectedCommandGroup(group)}
                  >
                    <span>{group}</span>
                    <small>{group === 'all' ? dynamicCommands.length : dynamicCommands.filter((item) => item.group === group).length}</small>
                  </button>
                ))}
              </div>
              <div className="command-grid">
                {visibleCommands.map((item) => (
                  <button key={`${item.group}-${item.label}-${item.command}`} type="button" title={item.command} onClick={() => runTerminalCommand(item.command)}>
                    <span>{item.label}</span>
                    <small>{item.hint}</small>
                    <code>{item.command}</code>
                  </button>
                ))}
                {visibleCommands.length === 0 ? (
                  <p className="command-empty">No commands match that search.</p>
                ) : null}
              </div>
            </div>
            <div className="command-note">
              Windows commands are mapped to WebContainer shell equivalents because the browser runtime is not native Windows.
            </div>
          </div>
          <div className={`problems-panel ${bottomPanelTab === 'problems' ? 'is-active' : ''}`}>
            {problems.length > 0 ? (
              <>
              <div>
                <strong>Problems</strong>
                <button type="button" onClick={() => setProblems([])}>Clear</button>
              </div>
              {problems.map((problem) => (
                <button key={problem.id} type="button" title={problem.message}>
                  <span>{problem.source}</span>
                  <code>{problem.message}</code>
                </button>
              ))}
              </>
            ) : (
              <p className="empty-panel-state">No problems captured yet.</p>
            )}
            </div>
          <div className={`terminal-tab-pane ${bottomPanelTab === 'terminal' ? 'is-active' : ''}`}>
            <TerminalPanel
              key={terminalSessionKey}
              webcontainer={webcontainer}
              onReady={handleTerminalReady}
              onOutput={inspectProcessOutput}
            />
          </div>
        </section>
      </main>

      <div
        className="resize-handle resize-handle-vertical preview-resizer"
        role="separator"
        aria-label="Resize preview"
        aria-orientation="vertical"
        onPointerDown={(event) => beginResize('preview', event)}
      />

      <aside
        className={`preview-panel ${activeActivity === 'preview' ? 'is-activity-active' : ''}`}
        ref={previewPanelRef}
        tabIndex={-1}
      >
        <div className="preview-toolbar">
          <div className="right-panel-tabs" role="tablist" aria-label="Right panel">
            <button
              className={rightPanelTab === 'preview' ? 'is-active' : ''}
              type="button"
              onClick={() => setRightPanelTab('preview')}
            >
              Preview
            </button>
            <button
              className={rightPanelTab === 'ai' ? 'is-active' : ''}
              type="button"
              onClick={() => setRightPanelTab('ai')}
            >
              AI Coder
            </button>
          </div>
          {rightPanelTab === 'preview' ? (
          <div className="preview-actions">
            <button type="button" title="Run npm run dev" onClick={() => startDevServer(undefined, 'dev')}>Dev</button>
            <button type="button" title="Run npm run start" onClick={() => startDevServer(undefined, 'start')}>Start</button>
            <button type="button" title="Stop dev server" onClick={stopDevServer}>Stop</button>
            <button type="button" title="Reload preview" onClick={() => setPreviewKey((key) => key + 1)}>Reload</button>
          </div>
          ) : (
            <span className="right-panel-status">{aiUsageSummary.requestsLeft} req / {aiUsageSummary.tokensLeft.toLocaleString()} tokens left</span>
          )}
        </div>
        <section className={`ai-coder-panel ${rightPanelTab === 'ai' ? 'is-active' : ''}`}>
          <div className="ai-header">
            <div>
              <strong>AI Coder</strong>
              <span>
                {aiUsageSummary.provider.label} / {aiSettings.priceMode === 'free' ? 'Free-tier local tracker' : 'Paid estimate tracker'}
              </span>
            </div>
            <button type="button" onClick={resetAiUsage}>Reset Usage</button>
          </div>

          <div className="ai-settings-grid">
            <label className="ai-wide">
              Provider
              <select
                value={aiSettings.provider}
                onChange={(event) => setAiSettings((settings) => ({
                  ...settings,
                  provider: event.target.value,
                  models: { ...defaultModelsByProvider, ...settings.models },
                }))}
              >
                {aiProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
            </label>
            <label className="ai-wide">
              API key
              <input
                type="password"
                value={aiSettings.draftApiKey}
                placeholder={aiUsageSummary.provider.keyPlaceholder}
                autoComplete="off"
                onChange={(event) => setAiSettings((settings) => ({ ...settings, draftApiKey: event.target.value }))}
              />
            </label>
            <div className="ai-key-actions ai-wide">
              <button type="button" onClick={saveCurrentApiKey}>Save API Key</button>
              <button type="button" onClick={forgetCurrentApiKey}>Forget Key</button>
              <span>{apiKeyStatus || (aiSettings.apiKeys?.[aiSettings.provider] ? 'Saved in this browser.' : 'No key saved for this provider.')}</span>
            </div>
            {aiSettings.provider === 'custom' ? (
              <>
                <label className="ai-wide">
                  Endpoint
                  <input
                    type="url"
                    value={aiSettings.customEndpoint}
                    placeholder="https://api.example.com/v1/chat/completions"
                    onChange={(event) => setAiSettings((settings) => ({ ...settings, customEndpoint: event.target.value }))}
                  />
                </label>
                <label>
                  Model
                  <input
                    type="text"
                    value={aiSettings.customModel}
                    placeholder="model-name"
                    onChange={(event) => setAiSettings((settings) => ({ ...settings, customModel: event.target.value }))}
                  />
                </label>
              </>
            ) : (
              <label>
                Model
                <select
                  value={aiSettings.models?.[aiSettings.provider] || aiUsageSummary.provider.models[0].id}
                  onChange={(event) => setAiSettings((settings) => ({
                    ...settings,
                    models: {
                      ...defaultModelsByProvider,
                      ...settings.models,
                      [settings.provider]: event.target.value,
                    },
                  }))}
                >
                  {aiUsageSummary.provider.models.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Mode
              <select
                value={aiSettings.priceMode}
                onChange={(event) => setAiSettings((settings) => ({ ...settings, priceMode: event.target.value }))}
              >
                <option value="free">Free tier</option>
                <option value="paid">Paid estimate</option>
              </select>
            </label>
            <label>
              Requests/day
              <input
                type="number"
                min="1"
                value={aiSettings.dailyRequestLimit}
                onChange={(event) => setAiSettings((settings) => ({ ...settings, dailyRequestLimit: Number(event.target.value) }))}
              />
            </label>
            <label>
              Tokens/day
              <input
                type="number"
                min="1000"
                step="1000"
                value={aiSettings.dailyTokenLimit}
                onChange={(event) => setAiSettings((settings) => ({ ...settings, dailyTokenLimit: Number(event.target.value) }))}
              />
            </label>
            <label>
              Budget/day
              <input
                type="number"
                min="0"
                step="0.01"
                value={aiSettings.dailyBudgetUsd}
                onChange={(event) => setAiSettings((settings) => ({ ...settings, dailyBudgetUsd: Number(event.target.value) }))}
              />
            </label>
          </div>

          <div className="ai-usage-bar">
            <span>{aiUsageSummary.requestsLeft} req left</span>
            <span>{aiUsageSummary.tokensLeft.toLocaleString()} tokens left</span>
            <span>${aiUsageSummary.estimatedCostUsd.toFixed(4)} spent</span>
          </div>

          <textarea
            value={aiPrompt}
            placeholder="Ask the AI coder to change the active file or create files..."
            onChange={(event) => setAiPrompt(event.target.value)}
          />

          <div className="ai-actions">
            <button type="button" disabled={isAiRunning} onClick={runAiCoder}>
              {isAiRunning ? 'Thinking...' : 'Ask AI'}
            </button>
            <button type="button" disabled={!aiResult?.edits?.length} onClick={applyAiEdits}>
              Apply Edits
            </button>
          </div>

          <div className="ai-result">
            <p>{aiStatus}</p>
            {aiResult ? (
              <>
                <strong>{aiResult.message}</strong>
                {aiResult.edits.length > 0 ? (
                  <div className="ai-edit-list">
                    {aiResult.edits.map((edit) => (
                      <code key={`${edit.path}-${edit.content?.length || 0}`}>{edit.path}</code>
                    ))}
                  </div>
                ) : null}
                {aiResult.commands.length > 0 ? (
                  <div className="ai-command-list">
                    {aiResult.commands.map((command) => (
                      <button key={command} type="button" onClick={() => runTerminalCommand(command)}>{command}</button>
                    ))}
                  </div>
                ) : null}
                <small>
                  Last: {aiResult.usage.inputTokens.toLocaleString()} in /
                  {' '}{aiResult.usage.outputTokens.toLocaleString()} out /
                  {' '}${aiResult.usage.estimatedCostUsd.toFixed(5)}
                </small>
              </>
            ) : null}
          </div>
        </section>
        <div className={`preview-frame-wrap ${rightPanelTab === 'preview' ? 'is-active' : ''}`}>
          {previewUrl ? (
            <iframe key={previewKey} title="WebContainer preview" src={previewUrl} />
          ) : (
            <div className="preview-placeholder">
              <span>Waiting for a dev server. Try npm run dev, npm start, or any script that opens a browser port.</span>
            </div>
          )}
        </div>
        <div className="status-strip" title={operationStatus || bootStatus}>
          {operationStatus || 'Commands and file edits run inside the WebContainer runtime.'}
        </div>
      </aside>
    </div>
  )
}
