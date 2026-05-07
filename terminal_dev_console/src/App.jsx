import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const MonacoEditor = lazy(() => import('@monaco-editor/react'))

let webcontainerBootPromise
let pyodideLoadPromise

const ignoredExplorerNames = new Set(['node_modules', '.git', 'dist'])
const defaultRunPort = 5173
const webContainerBootTimeoutMs = 45000
const pyodideVersion = '0.26.4'
const pyodideIndexUrl = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`
const pythonWorkspaceRoot = '/workspace'

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
  { label: 'Python version', command: 'python --version', group: 'python', hint: 'Load the Python runtime' },
  { label: 'Python hello', command: "python -c \"print('Hello from browser Python')\"", group: 'python', hint: 'Inline Python' },
  { label: 'Run main.py', command: 'python main.py', group: 'python', hint: 'Run a Python file' },
  { label: 'Install Python pkg', command: 'pip install numpy', group: 'python', hint: 'Install Pyodide package' },
  { label: 'Python sample', command: 'webterm create-python-sample', group: 'python', hint: 'Create a runnable Python file' },
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
const pythonSamplePath = 'main.py'
const pythonSampleSource = `import math
import random

print("Neon Number Dash")
print("The browser Python runtime is live.")

score = 0
for round_number in range(1, 6):
    target = random.randint(3, 12)
    boost = math.ceil(math.sqrt(target * round_number))
    score += target + boost
    print(f"round {round_number}: target={target}, boost={boost}, score={score}")

print("final score:", score)
`

const searchableFileExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.toml',
  '.ini',
  '.cfg',
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
const cloudPreviewHandoffPath = '/cloud-preview.html'
const cloudPreviewChannelName = 'runable-cloud-preview'
const cloudPreviewStoragePrefix = 'runable-cloud-preview:'
const googleAiStudioApiKeyUrl = 'https://aistudio.google.com/app/apikey'
const googleGeminiApiKeyDocsUrl = 'https://ai.google.dev/gemini-api/docs/api-key'
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
    id: 'anthropic',
    label: 'Claude',
    keyPlaceholder: 'Anthropic API key',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: [
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', inputPrice: 3, outputPrice: 15 },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', inputPrice: 1, outputPrice: 5 },
      { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', inputPrice: 15, outputPrice: 75 },
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

const aiThinkingProfiles = {
  fast: {
    id: 'fast',
    label: 'Fast',
    description: 'Small context, quick plan, smallest patch.',
    planContextLimit: 8,
    planCharsPerFile: 7000,
    patchCharsPerFile: 16000,
    planOutputTokens: 900,
    patchOutputTokens: 1400,
    patchLimit: 8,
    instruction: 'Optimize for speed. Only inspect the most likely files and avoid optional polish.',
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    description: 'Good default for everyday coding.',
    planContextLimit: 14,
    planCharsPerFile: 10000,
    patchCharsPerFile: 26000,
    planOutputTokens: 1300,
    patchOutputTokens: 2200,
    patchLimit: 12,
    instruction: 'Balance speed and care. Inspect enough context to avoid obvious regressions.',
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    description: 'More context, stronger review, safer edits.',
    planContextLimit: 22,
    planCharsPerFile: 14000,
    patchCharsPerFile: 34000,
    planOutputTokens: 1800,
    patchOutputTokens: 3200,
    patchLimit: 16,
    instruction: 'Think like a senior coding agent. Inspect related files, name edge cases, and produce a conservative patch.',
  },
  max: {
    id: 'max',
    label: 'Max',
    description: 'Largest local context and strictest self-review.',
    planContextLimit: 34,
    planCharsPerFile: 18000,
    patchCharsPerFile: 44000,
    planOutputTokens: 2600,
    patchOutputTokens: 4600,
    patchLimit: 20,
    instruction: 'Use the strongest workflow. Read broad context, break the work into phases, and self-review for regressions before returning edits.',
  },
}

const aiThinkingOptions = Object.values(aiThinkingProfiles)

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
    thinkingLevel: 'deep',
    dailyRequestLimit: 20,
    dailyTokenLimit: 50000,
    dailyBudgetUsd: 0,
    maxOutputTokens: 3200,
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
    thinkingLevel: aiThinkingProfiles[saved.thinkingLevel]?.id || defaults.thinkingLevel,
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

function getAiThinkingProfile(level) {
  return aiThinkingProfiles[level] || aiThinkingProfiles.deep
}

function getAiOutputTokens(settings, phase) {
  const profile = getAiThinkingProfile(settings.thinkingLevel)
  const requestedMax = Number(settings.maxOutputTokens) || defaultAiSettings().maxOutputTokens
  const profileMax = phase === 'plan' ? profile.planOutputTokens : profile.patchOutputTokens
  return Math.max(512, Math.min(requestedMax, profileMax))
}

function estimateAiCost(settings, inputTokens, outputTokens) {
  if (settings.priceMode === 'free') return 0
  const model = getAiModel(settings)
  return (inputTokens / 1_000_000) * model.inputPrice + (outputTokens / 1_000_000) * model.outputPrice
}

function checkAiBudget(settings, usage, prompt, estimatedOutputTokens) {
  const estimatedInputTokens = estimateTokens(prompt)
  const estimatedCost = estimateAiCost(settings, estimatedInputTokens, estimatedOutputTokens)
  const currentUsage = normalizeAiUsage(usage)
  const currentTokens = currentUsage.inputTokens + currentUsage.outputTokens
  const dailyRequestLimit = Number(settings.dailyRequestLimit) || 0
  const dailyTokenLimit = Number(settings.dailyTokenLimit) || 0
  const dailyBudgetUsd = Number(settings.dailyBudgetUsd) || 0

  if (currentUsage.requests + 1 > dailyRequestLimit) {
    return { blockedMessage: 'Blocked: your local daily AI request cap has been reached.' }
  }

  if (currentTokens + estimatedInputTokens + estimatedOutputTokens > dailyTokenLimit) {
    return { blockedMessage: 'Blocked: this request would exceed your local daily token cap.' }
  }

  if (settings.priceMode !== 'free' && currentUsage.estimatedCostUsd + estimatedCost > dailyBudgetUsd) {
    return { blockedMessage: 'Blocked: this request would exceed your local daily budget cap.' }
  }

  return { estimatedInputTokens, estimatedCost }
}

function diffLineStats(before, after) {
  const beforeLines = before ? String(before).replace(/\r\n/g, '\n').split('\n') : []
  const afterLines = after ? String(after).replace(/\r\n/g, '\n').split('\n') : []

  if (before === after) {
    return {
      added: 0,
      removed: 0,
      beforeLines: beforeLines.length,
      afterLines: afterLines.length,
    }
  }

  if (beforeLines.length * afterLines.length > 180000) {
    return {
      added: Math.max(0, afterLines.length - beforeLines.length),
      removed: Math.max(0, beforeLines.length - afterLines.length),
      beforeLines: beforeLines.length,
      afterLines: afterLines.length,
    }
  }

  let previous = new Array(afterLines.length + 1).fill(0)
  let current = new Array(afterLines.length + 1).fill(0)

  for (let beforeIndex = 1; beforeIndex <= beforeLines.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= afterLines.length; afterIndex += 1) {
      current[afterIndex] = beforeLines[beforeIndex - 1] === afterLines[afterIndex - 1]
        ? previous[afterIndex - 1] + 1
        : Math.max(previous[afterIndex], current[afterIndex - 1])
    }
    ;[previous, current] = [current, previous]
    current.fill(0)
  }

  const unchanged = previous[afterLines.length]
  return {
    added: Math.max(0, afterLines.length - unchanged),
    removed: Math.max(0, beforeLines.length - unchanged),
    beforeLines: beforeLines.length,
    afterLines: afterLines.length,
  }
}

function summarizeChangeSet(edits, existingContents = {}) {
  const changes = (edits || []).map((edit) => {
    const path = normalizePath(edit.path || '')
    const before = existingContents[path] || ''
    const after = typeof edit.content === 'string' ? edit.content : ''
    const stats = diffLineStats(before, after)

    return {
      path,
      added: stats.added,
      removed: stats.removed,
      beforeLines: stats.beforeLines,
      afterLines: stats.afterLines,
      created: !before,
    }
  }).filter((change) => change.path)

  return {
    files: changes.length,
    added: changes.reduce((total, change) => total + change.added, 0),
    removed: changes.reduce((total, change) => total + change.removed, 0),
    changes,
  }
}

const aiAgentRules = `Agent operating rules:
- Work like a cautious coding agent, not a code autocomplete.
- Understand the request, inspect relevant files, make a plan, then build the smallest patch that satisfies the plan.
- Prefer existing architecture, naming, state, CSS, and component patterns.
- Never rewrite the whole project for a small request.
- Never remove working WebContainer, terminal, editor, file explorer, preview, import, or settings behavior unless directly requested.
- Avoid speculative changes. If context is missing, ask or return no edits.
- Treat generated code as risky: validate paths, avoid unrelated files, and keep the patch reviewable.`

function tokenizeAiText(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9_.$/-]+/)
      .filter((token) => token.length > 2),
  )
}

function scoreAiFile(file, requestTokens, activePath) {
  const path = file.path || ''
  const lowerPath = path.toLowerCase()
  let score = 0

  if (path === activePath) score += 100
  if (['package.json', 'vite.config.js', 'src/App.jsx', 'src/App.tsx', 'src/main.jsx', 'src/main.tsx'].includes(path)) {
    score += 35
  }
  if (lowerPath.includes('/components/') || lowerPath.includes('\\components\\')) score += 12
  if (lowerPath.endsWith('.jsx') || lowerPath.endsWith('.tsx')) score += 12
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.ts')) score += 8
  if (lowerPath.endsWith('.css')) score += 8

  for (const token of requestTokens) {
    if (lowerPath.includes(token)) score += token.length > 5 ? 10 : 5
  }

  return score
}

function selectAiContextPaths(files, request, activePath, limit = 12) {
  const requestTokens = tokenizeAiText(request)
  return files
    .filter((file) => shouldSearchFile(file.path))
    .map((file) => ({ path: file.path, score: scoreAiFile(file, requestTokens, activePath) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((item) => item.path)
}

function formatAiFileContext(fileContents = {}, maxCharsPerFile = 14000) {
  const entries = Object.entries(fileContents)
  if (!entries.length) return '(No file contents loaded.)'

  return entries
    .map(([path, contents]) => {
      const text = String(contents || '')
      const clipped = text.length > maxCharsPerFile
        ? `${text.slice(0, maxCharsPerFile)}\n/* clipped: ${text.length - maxCharsPerFile} chars omitted */`
        : text
      return `--- ${path}\n${clipped}`
    })
    .join('\n\n')
}

function normalizeAiEdits(edits, plan, files, profile) {
  const workspacePaths = new Set(files.map((file) => file.path))
  const plannedPaths = new Set([
    ...(plan?.filesToRead || []),
    ...(plan?.filesToEdit || []),
  ].map(normalizePath).filter(Boolean))
  const normalized = []
  const rejected = []

  for (const edit of edits || []) {
    const path = normalizePath(edit.path || '')
    const content = typeof edit.content === 'string' ? edit.content : ''

    if (!path || path.includes('..') || path.startsWith('/') || path.includes('\\')) {
      rejected.push({ path: edit.path || '(empty)', reason: 'Invalid or unsafe path.' })
      continue
    }

    if (!content && workspacePaths.has(path)) {
      rejected.push({ path, reason: 'Empty replacement for an existing file.' })
      continue
    }

    if (plannedPaths.size > 0 && !plannedPaths.has(path) && !workspacePaths.has(path)) {
      rejected.push({ path, reason: 'New file was not named in the plan.' })
      continue
    }

    normalized.push({ ...edit, path, content })
  }

  return { edits: normalized.slice(0, profile.patchLimit), rejected }
}

function buildAiPlanPrompt({ userPrompt, activeTab, files, fileContents, frameworkName, projectName, thinkingProfile }) {
  const fileList = files.slice(0, 120).map((file) => file.path).join('\n')
  const activeFileBlock = activeTab
    ? `Active file: ${activeTab.path}\n\n${activeTab.contents.slice(0, 16000)}`
    : 'No active file is open.'

  return `You are a careful coding agent inside a browser IDE. Your first job is to plan, not edit.
${aiAgentRules}

Project: ${projectName}
Framework: ${frameworkName}
Thinking level: ${thinkingProfile.label}
Thinking behavior: ${thinkingProfile.instruction}

Workspace files:
${fileList || '(empty workspace)'}

${activeFileBlock}

Relevant file context selected by the IDE:
${formatAiFileContext(fileContents, thinkingProfile.planCharsPerFile)}

User request:
${userPrompt}

Return ONLY valid JSON. Do not use markdown fences.
Schema:
{
  "message": "brief response to the user",
  "goal": "one sentence goal",
  "plan": ["ordered implementation step"],
  "filesToRead": ["relative/file/path.ext"],
  "filesToEdit": ["relative/file/path.ext"],
  "commands": ["optional verification command"],
  "risks": ["specific risk or edge case"],
  "questions": ["blocking question if the request is unclear"]
}

Rules:
- Do not write code yet.
- Think like a real coding agent: understand intent, identify relevant files, plan a minimal change, and name verification steps.
- Prefer existing project patterns and avoid unrelated rewrites.
- If the request is ambiguous or unsafe, ask questions and leave filesToEdit empty.
- Only list files that exist in the workspace unless you intentionally plan to create them.
- If the workspace is empty and the user asks for a project, game, page, or script, plan the files to create instead of asking them to open files first.
- Include at least one verification command when the project has a package.json.
- Be extra explicit because the patch step will follow this plan strictly.
- For Deep or Max thinking, include likely edge cases and a short verification strategy.`
}

function buildAiPatchPrompt({ userPrompt, plan, activeTab, files, fileContents, frameworkName, projectName, thinkingProfile }) {
  const fileList = files.slice(0, 160).map((file) => file.path).join('\n')
  const contextBlock = formatAiFileContext(fileContents, thinkingProfile.patchCharsPerFile)
  const activeFileBlock = activeTab && !fileContents?.[activeTab.path]
    ? `--- ${activeTab.path}\n${activeTab.contents.slice(0, 18000)}`
    : ''

  return `You are a careful coding agent inside a browser IDE. Build from the approved plan.
${aiAgentRules}

Project: ${projectName}
Framework: ${frameworkName}
Thinking level: ${thinkingProfile.label}
Thinking behavior: ${thinkingProfile.instruction}

Workspace files:
${fileList || '(empty workspace)'}

User request:
${userPrompt}

Approved plan JSON:
${JSON.stringify(plan, null, 2)}

Relevant file contents:
${contextBlock || activeFileBlock || '(No relevant file contents were available.)'}

Return ONLY valid JSON. Do not use markdown fences.
Schema:
{
  "message": "brief explanation of what changed",
  "changeSummary": ["specific change made"],
  "selfReview": ["check you performed before returning"],
  "edits": [
    { "path": "relative/file/path.ext", "content": "full replacement file content" }
  ],
  "commands": ["optional terminal command suggestions"]
}

Rules:
- Use full file replacements only.
- If you need to create a new file, include its full path and content.
- Follow the approved plan and keep changes small.
- Preserve existing working WebContainer, terminal, editor, and preview logic unless the request directly targets them.
- Do not invent unrelated files or replace the whole project.
- For normal code-changing requests, return concrete edits. Do not return an empty edits array when the plan names filesToEdit or when you can create the requested files.
- If the workspace is empty and the request asks for a project, game, page, or script, create the necessary files from scratch.
- If needed context is truly missing, return an empty edits array and explain what must be opened or provided.
- Before returning, self-review for syntax errors, missing imports, broken state variables, and unrelated regressions.
- If no edit is needed, return an empty edits array.`
}

function parseAiJson(text) {
  const trimmed = String(text || '').trim()
  const jsonText = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(jsonText)
  } catch {
    const firstBrace = jsonText.indexOf('{')
    const lastBrace = jsonText.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(jsonText.slice(firstBrace, lastBrace + 1))
    }
    throw new Error('AI returned invalid JSON. Try again or use a stronger model.')
  }
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

  if (settings.provider === 'anthropic') {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: maxOutputTokens,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || `Claude request failed (${response.status})`)

    return {
      text: data.content?.map((part) => (part.type === 'text' ? part.text : '')).join('\n') || '',
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      totalTokens: data.usage?.input_tokens && data.usage?.output_tokens
        ? data.usage.input_tokens + data.usage.output_tokens
        : undefined,
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

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`)
    error.details = data.details || ''
    throw error
  }
  return data
}

function cloudSafeAiSettings(settings = {}) {
  return {
    provider: settings.provider || 'gemini',
    models: settings.models || {},
    customEndpoint: settings.customEndpoint || '',
    customModel: settings.customModel || '',
    priceMode: settings.priceMode || 'free',
    thinkingLevel: settings.thinkingLevel || 'deep',
    dailyRequestLimit: Number(settings.dailyRequestLimit) || 20,
    dailyTokenLimit: Number(settings.dailyTokenLimit) || 50000,
    dailyBudgetUsd: Number(settings.dailyBudgetUsd) || 0,
    maxOutputTokens: Number(settings.maxOutputTokens) || 3200,
  }
}

function buildCloudSettings({ theme, layoutMode, autosaveEnabled, aiSettings }) {
  return {
    theme,
    layoutMode,
    autosaveEnabled,
    aiSettings: cloudSafeAiSettings(aiSettings),
  }
}

function uint8ToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToUint8(base64) {
  const binary = atob(base64 || '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeCloudFile(file) {
  const path = normalizePath(file.path)
  if (typeof file.data === 'string') {
    return { path, data: file.data, encoding: 'utf8' }
  }

  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || [])
  return { path, data: uint8ToBase64(bytes), encoding: 'base64' }
}

function decodeCloudFile(file) {
  return {
    path: normalizePath(file.path),
    data: file.encoding === 'base64' ? base64ToUint8(file.data) : String(file.data || ''),
  }
}

function filesForApi(files = []) {
  return files.map(encodeCloudFile).filter((file) => file.path)
}

function projectFromApi(project) {
  if (!project) return project
  return {
    ...project,
    files: Array.isArray(project.files) ? project.files.map(decodeCloudFile) : [],
  }
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

function mimeTypeForPath(path) {
  const extension = fileExtension(path)
  if (extension === '.html') return 'text/html'
  if (extension === '.js' || extension === '.mjs') return 'text/javascript'
  if (extension === '.css') return 'text/css'
  if (extension === '.json') return 'application/json'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function resolvePreviewPath(fromPath, target) {
  if (!target || /^(https?:|data:|blob:|#)/i.test(target)) return target
  if (target.startsWith('/')) return normalizePath(target)
  const base = parentPath(fromPath)
  const stack = `${base}/${target}`.split('/').filter(Boolean)
  const resolved = []

  for (const part of stack) {
    if (part === '.') continue
    if (part === '..') {
      resolved.pop()
      continue
    }
    resolved.push(part)
  }

  return resolved.join('/')
}

function buildStaticPreview(files) {
  const decoder = new TextDecoder()
  const urls = []
  const fileMap = new Map(files.map((file) => [normalizePath(file.path), file.data]))
  const moduleUrlCache = new Map()
  const rawUrlCache = new Map()
  const indexPath = ['index.html', 'public/index.html'].find((path) => fileMap.has(path))

  if (!indexPath) {
    throw new Error('Static preview needs an index.html file.')
  }

  const textForPath = (path) => decoder.decode(fileMap.get(path) || new Uint8Array())
  const indexHtml = textForPath(indexPath)
  const scriptSources = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map((match) => resolvePreviewPath(indexPath, match[1]))
    .filter(Boolean)
  const jsxEntry = scriptSources.find((path) => /\.(jsx|tsx)$/i.test(path))

  if (jsxEntry) {
    throw new Error(`Static preview cannot run ${jsxEntry}. Use Dev or Start so Vite can compile JSX.`)
  }

  const bareImportEntry = scriptSources.find((path) => {
    if (!/\.[cm]?js$/i.test(path) || !fileMap.has(path)) return false
    const code = textForPath(path)
    return /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](?!\.{1,2}\/|\/|https?:|data:|blob:)[^'"]+['"]/m.test(code)
  })

  if (bareImportEntry) {
    throw new Error(`Static preview cannot run bare imports in ${bareImportEntry}. Use Dev or Start so Vite can bundle dependencies.`)
  }

  const makeObjectUrl = (data, type) => {
    const url = URL.createObjectURL(new Blob([data], { type }))
    urls.push(url)
    return url
  }

  const getRawUrl = (path) => {
    const normalizedPath = normalizePath(path)
    if (!fileMap.has(normalizedPath)) return ''
    if (rawUrlCache.has(normalizedPath)) return rawUrlCache.get(normalizedPath)
    const url = makeObjectUrl(fileMap.get(normalizedPath), mimeTypeForPath(normalizedPath))
    rawUrlCache.set(normalizedPath, url)
    return url
  }

  const getModuleUrl = (path) => {
    const normalizedPath = normalizePath(path)
    if (!fileMap.has(normalizedPath)) return ''
    if (moduleUrlCache.has(normalizedPath)) return moduleUrlCache.get(normalizedPath)

    let code = textForPath(normalizedPath)
    code = code.replace(/import\s+['"]([^'"]+\.css)['"]\s*;?/g, (_, specifier) => {
      const cssPath = resolvePreviewPath(normalizedPath, specifier)
      const css = fileMap.has(cssPath) ? JSON.stringify(textForPath(cssPath)) : '""'
      return `const style=document.createElement("style");style.textContent=${css};document.head.append(style);`
    })
    code = code.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (match, before, specifier, after) => {
      const targetPath = resolvePreviewPath(normalizedPath, specifier)
      const targetUrl = getModuleUrl(targetPath) || getRawUrl(targetPath)
      return targetUrl ? `${before}${targetUrl}${after}` : match
    })
    code = code.replace(/(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, (match, before, specifier, after) => {
      const targetPath = resolvePreviewPath(normalizedPath, specifier)
      const targetUrl = getModuleUrl(targetPath) || getRawUrl(targetPath)
      return targetUrl ? `${before}${targetUrl}${after}` : match
    })

    const url = makeObjectUrl(code, 'text/javascript')
    moduleUrlCache.set(normalizedPath, url)
    return url
  }

  let html = indexHtml
  html = html.replace(/(<script\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*><\/script>)/gi, (match, before, src, after) => {
    const path = resolvePreviewPath(indexPath, src)
    const url = getModuleUrl(path) || getRawUrl(path)
    return url ? `${before}${url}${after}` : match
  })
  html = html.replace(/(<link\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi, (match, before, href, after) => {
    const path = resolvePreviewPath(indexPath, href)
    const url = getRawUrl(path)
    return url ? `${before}${url}${after}` : match
  })
  html = html.replace(/(<(?:img|source|video|audio)\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (match, before, src, after) => {
    const path = resolvePreviewPath(indexPath, src)
    const url = getRawUrl(path)
    return url ? `${before}${url}${after}` : match
  })

  const htmlUrl = makeObjectUrl(html, 'text/html')
  return { url: htmlUrl, urls }
}

function isHostedApp() {
  const host = window.location.hostname
  return !['localhost', '127.0.0.1', '::1'].includes(host)
}

function makeCloudPreviewRunId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cloudPreviewStorageKey(runId) {
  return `${cloudPreviewStoragePrefix}${runId}`
}

function cloudPreviewHandoffUrl(runId) {
  const url = new URL(cloudPreviewHandoffPath, window.location.origin)
  url.searchParams.set('run', runId)
  return url.toString()
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
        coep: 'credentialless',
        forwardPreviewErrors: 'exceptions-only',
        workdirName: 'workspace',
      }),
    ).catch((error) => {
      webcontainerBootPromise = null
      throw error
    })
  }

  return webcontainerBootPromise
}

function getBrowserRuntimeSupport() {
  const issues = []

  if (!window.isSecureContext) {
    issues.push('The page is not running in a secure browser context. Use HTTPS or localhost.')
  }

  if (!window.crossOriginIsolated) {
    issues.push('Cross-origin isolation is not active. WebContainer needs COOP and COEP headers.')
  }

  if (typeof window.SharedArrayBuffer === 'undefined') {
    issues.push('SharedArrayBuffer is unavailable. Some school Chromebook policies disable it.')
  }

  if (!navigator.serviceWorker) {
    issues.push('Service workers are unavailable or blocked by this browser profile.')
  }

  if (!window.indexedDB) {
    issues.push('IndexedDB is unavailable, so the browser runtime cannot persist its workspace.')
  }

  return {
    ok: issues.length === 0,
    issues,
    message: issues.length
      ? 'This browser is blocking one or more features required by the in-browser runtime.'
      : 'Browser runtime checks passed.',
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId))
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, '')
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getPreviewSignalFromOutput(data) {
  const text = stripAnsi(data)
  const directUrl = text.match(/https?:\/\/[^\s"'<>]+webcontainer-api\.io[^\s"'<>]*/i)?.[0]
  const localUrl = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\]|[a-z0-9.-]+):(\d+)[^\s"'<>]*/i)
  const readyPort = text.match(/\b(?:port|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)\s*:?(\d{2,5})\b/i)
  const port = Number(localUrl?.[1] || readyPort?.[1] || 0)

  return {
    directUrl,
    port: Number.isFinite(port) && port > 0 ? port : 0,
  }
}

function getManagedNpmScript(command) {
  const normalized = command.trim().replace(/\s+/g, ' ')
  if (/^npm run dev$/i.test(normalized)) return 'dev'
  if (/^npm run start$/i.test(normalized) || /^npm start$/i.test(normalized)) return 'start'
  return ''
}

function getPackageInstallRequest(command) {
  const tokens = tokenizeCommandLine(command)
  const executable = tokens[0]?.toLowerCase()
  if (executable === 'npm' && ['install', 'i', 'ci', 'add'].includes(tokens[1]?.toLowerCase())) {
    return { command: 'npm', args: tokens.slice(1), label: tokens.join(' ') }
  }

  if (executable === 'pnpm' && ['install', 'i', 'add'].includes(tokens[1]?.toLowerCase())) {
    return { command: 'pnpm', args: tokens.slice(1), label: tokens.join(' ') }
  }

  if (executable === 'yarn' && (!tokens[1] || ['install', 'add'].includes(tokens[1]?.toLowerCase()))) {
    return { command: 'yarn', args: tokens.slice(1), label: tokens.join(' ') || 'yarn install' }
  }

  return null
}

function shouldOpenCloudPreviewForCommand(command) {
  const normalized = command.trim().replace(/\s+/g, ' ')
  return !normalized || /^\s*(npm\s+(run\s+)?(dev|start)|npm\s+start|pnpm\s+(dev|start)|yarn\s+(dev|start)|npx\s+vite|vite|next\s+dev|react-scripts\s+start|python3?\s+-m\s+http\.server|flask\s+run|uvicorn\b|streamlit\s+run)\b/i
    .test(normalized)
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
    'main.py',
    'app.py',
    'pyproject.toml',
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
  if (/\.py$/.test(lowerPath)) return `python ${quotedPath}`
  if (/\.(sh|bash)$/.test(lowerPath)) return `sh ${quotedPath}`
  if (/\.json$/.test(lowerPath)) return `cat ${quotedPath}`
  if (/\.html?$/.test(lowerPath)) return `npx vite --host 0.0.0.0 --port ${defaultRunPort}`
  if (/\.css$/.test(lowerPath)) return `cat ${quotedPath}`
  if (/\.md$/.test(lowerPath)) return `cat ${quotedPath}`

  return `webterm explain-runtime ${quotedPath}`
}

function tokenizeCommandLine(command) {
  const tokens = []
  let current = ''
  let quote = ''
  let escaping = false

  for (const char of command.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) current += '\\'
  if (current) tokens.push(current)
  return tokens
}

function getPythonCommandRequest(command) {
  const tokens = tokenizeCommandLine(command)
  const executable = tokens[0]?.toLowerCase()

  if (executable === 'python' || executable === 'python3' || executable === 'py') {
    if (tokens.includes('--version') || tokens.includes('-V')) {
      return { type: 'version' }
    }

    const inlineIndex = tokens.indexOf('-c')
    if (inlineIndex >= 0) {
      return { type: 'inline', code: tokens.slice(inlineIndex + 1).join(' ') }
    }

    if (tokens[1] === '-m' && tokens[2] === 'pip' && tokens[3] === 'install') {
      return { type: 'pip', packages: tokens.slice(4).filter((token) => !token.startsWith('-')) }
    }

    const fileIndex = tokens.findIndex((token, index) => index > 0 && !token.startsWith('-'))
    if (fileIndex > 0) {
      return {
        type: 'file',
        path: normalizePath(tokens[fileIndex]),
        args: tokens.slice(fileIndex + 1),
      }
    }
    return { type: 'repl' }
  }

  if (executable === 'pip' && tokens[1] === 'install') {
    return { type: 'pip', packages: tokens.slice(2).filter((token) => !token.startsWith('-')) }
  }

  return null
}

function getWebTerminalCommandRequest(command) {
  const tokens = tokenizeCommandLine(command)
  const executable = tokens[0]?.toLowerCase()
  if (executable !== 'webterm' && executable !== 'webterminal') return null
  return { action: tokens[1], args: tokens.slice(2) }
}

function pyodidePathExists(pyodide, path) {
  try {
    pyodide.FS.stat(path)
    return true
  } catch {
    return false
  }
}

function ensurePyodideDirectory(pyodide, dir) {
  const normalizedDir = dir.replace(/\/+/g, '/')
  if (!normalizedDir || normalizedDir === '/') return

  let current = ''
  for (const part of normalizedDir.split('/').filter(Boolean)) {
    current += `/${part}`
    if (!pyodidePathExists(pyodide, current)) {
      pyodide.FS.mkdir(current)
    }
  }
}

function removePyodidePath(pyodide, path) {
  if (!pyodidePathExists(pyodide, path)) return

  const stat = pyodide.FS.stat(path)
  if (pyodide.FS.isDir(stat.mode)) {
    for (const child of pyodide.FS.readdir(path)) {
      if (child === '.' || child === '..') continue
      removePyodidePath(pyodide, `${path}/${child}`)
    }
    if (path !== pythonWorkspaceRoot) pyodide.FS.rmdir(path)
    return
  }

  pyodide.FS.unlink(path)
}

async function loadPythonRuntime() {
  if (pyodideLoadPromise) return pyodideLoadPromise

  pyodideLoadPromise = new Promise((resolve, reject) => {
    const load = async () => {
      try {
        const pyodide = await window.loadPyodide({ indexURL: pyodideIndexUrl })
        resolve(pyodide)
      } catch (error) {
        pyodideLoadPromise = null
        reject(error)
      }
    }

    if (window.loadPyodide) {
      load()
      return
    }

    const existingScript = document.querySelector('script[data-pyodide-runtime="true"]')
    if (existingScript) {
      existingScript.addEventListener('load', load, { once: true })
      existingScript.addEventListener('error', () => {
        pyodideLoadPromise = null
        reject(new Error('Python runtime failed to download.'))
      }, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = `${pyodideIndexUrl}pyodide.js`
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.pyodideRuntime = 'true'
    script.addEventListener('load', load, { once: true })
    script.addEventListener('error', () => {
      pyodideLoadPromise = null
      reject(new Error('Python runtime failed to download.'))
    }, { once: true })
    document.head.append(script)
  })

  return pyodideLoadPromise
}

async function syncWorkspaceToPython(pyodide, webcontainer) {
  ensurePyodideDirectory(pyodide, pythonWorkspaceRoot)
  removePyodidePath(pyodide, pythonWorkspaceRoot)
  ensurePyodideDirectory(pyodide, pythonWorkspaceRoot)

  const files = await readWorkspaceFiles(webcontainer)
  for (const file of files) {
    const normalizedPath = normalizePath(file.path)
    const fullPath = `${pythonWorkspaceRoot}/${normalizedPath}`
    const directory = fullPath.split('/').slice(0, -1).join('/')
    ensurePyodideDirectory(pyodide, directory)
    pyodide.FS.writeFile(fullPath, file.data)
  }
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

function treeFromFiles(files = []) {
  const root = []
  const sortTreeNodes = (nodes) => sortEntries(nodes.map((node) => (
    node.type === 'directory'
      ? { ...node, children: sortTreeNodes(node.children || []) }
      : node
  )))

  files.forEach((file) => {
    const parts = normalizePath(file.path).split('/').filter(Boolean)
    let siblings = root

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/')
      const isFile = index === parts.length - 1
      let node = siblings.find((item) => item.name === part)

      if (!node) {
        node = isFile
          ? { name: part, path, type: 'file' }
          : { name: part, path, type: 'directory', children: [] }
        siblings.push(node)
      }

      if (!isFile) siblings = node.children
    })
  })

  return sortTreeNodes(root)
}

function FileTree({ nodes, activePath, changedPaths = [], onOpenFile, onSelectPath, selectedPath, depth = 0 }) {
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
              changedPaths.includes(node.path) ? 'is-ai-changed' : '',
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
              changedPaths={changedPaths}
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

function TerminalPanel({ webcontainer, onReady, onOutput, onInterceptCommand }) {
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
    let currentLine = ''

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
        if (data.startsWith('\x1b')) {
          inputWriter.write(data)
          return
        }

        for (const char of data) {
          if (char === '\r' || char === '\n') {
            const command = currentLine.trim()
            currentLine = ''

            if (command && onInterceptCommand?.(command)) {
              inputWriter.write('\x15')
              terminal.write('\r\n')
              continue
            }

            inputWriter.write(char)
            continue
          }

          if (char === '\u007f') {
            currentLine = currentLine.slice(0, -1)
            inputWriter.write(char)
            continue
          }

          if (char === '\x03' || char === '\x15') {
            currentLine = ''
            inputWriter.write(char)
            continue
          }

          if (char >= ' ') currentLine += char
          inputWriter.write(char)
        }
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
        scrollUp() {
          terminal.scrollLines(-Math.max(8, Math.floor(terminal.rows * 0.85)))
        },
        scrollDown() {
          terminal.scrollLines(Math.max(8, Math.floor(terminal.rows * 0.85)))
        },
        scrollToTop() {
          terminal.scrollToTop()
        },
        scrollToBottom() {
          terminal.scrollToBottom()
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
  }, [onInterceptCommand, onOutput, onReady, webcontainer])

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
          Open a folder, install packages, run Python files, and run scripts in a real
          browser-based development environment. Nothing starts until you choose what to run.
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

function AiWorkingAnimation({ phase = 'thinking', steps = [] }) {
  const isWriting = phase === 'writing'
  const phaseSteps = steps.length
    ? steps
    : isWriting
      ? ['Drafting edits', 'Checking diff safety', 'Preparing review']
      : ['Reading context', 'Building plan', 'Reviewing risks']
  const codeLines = isWriting
    ? [
        { text: '+ add guarded UI state', tone: 'add' },
        { text: '+ render reviewable patch rows', tone: 'add' },
        { text: '- avoid blind rewrites', tone: 'remove' },
        { text: 'npm run build', tone: 'neutral' },
      ]
    : [
        { text: 'scan(workspace.files)', tone: 'neutral' },
        { text: 'rank(relevant.context)', tone: 'neutral' },
        { text: 'plan(minimal.change)', tone: 'neutral' },
      ]

  return (
    <div className={`ai-working-visual is-${phase}`} aria-hidden="true">
      <div className="ai-thinking-stage">
        <div className="ai-thinking-orbit">
          <span />
          <span />
          <span />
        </div>
        <div className="ai-thinking-core" />
      </div>
      <div className="ai-activity-steps">
        {phaseSteps.map((step, index) => (
          <span key={step} style={{ '--index': index }}>{step}</span>
        ))}
      </div>
      <div className="ai-code-stream">
        {codeLines.map((line, index) => (
          <code className={`is-${line.tone}`} key={`${line.text}-${index}`} style={{ '--index': index }}>
            {line.text}
          </code>
        ))}
      </div>
    </div>
  )
}

function AuthScreen({ mode, form, error, status, onModeChange, onFormChange, onSubmit }) {
  const isSignup = mode === 'signup'
  const [demoStage, setDemoStage] = useState('idle')
  const demoInstalled = demoStage === 'installed' || demoStage === 'built' || demoStage === 'running'
  const demoBuilt = demoStage === 'built' || demoStage === 'running'
  const demoRunning = demoStage === 'running'

  const demoStatus = demoRunning
    ? 'Running preview'
    : demoBuilt
      ? 'Build ready'
      : demoInstalled
        ? 'Installed'
        : 'Waiting for install'

  return (
    <main className="auth-shell">
      <section className="auth-visual auth-demo-visual" aria-label="Demo project">
        <div className="auth-grid" />
        <div className={`auth-demo-workbench ${demoRunning ? 'is-running' : ''}`}>
          <div className="auth-demo-head">
            <div>
              <span>preinstalled test</span>
              <strong>Neon Runner Demo</strong>
            </div>
            <code>{demoStatus}</code>
          </div>

          <div className="auth-demo-code">
            <div>
              <span>package.json</span>
              <code>"scripts": {"{"} "start": "vite", "build": "vite build" {"}"}</code>
            </div>
            <div>
              <span>src/main.js</span>
              <code>jump(); spawnBlock(); drawFrame();</code>
            </div>
            <div>
              <span>src/styles.css</span>
              <code>canvas {"{"} background: radial-gradient(...) {"}"}</code>
            </div>
          </div>

          <div className="auth-demo-actions" aria-label="Demo commands">
            <button type="button" className={demoInstalled ? 'is-complete' : ''} onClick={() => setDemoStage('installed')}>
              Install
            </button>
            <button
              type="button"
              className={demoBuilt ? 'is-complete' : ''}
              disabled={!demoInstalled}
              onClick={() => setDemoStage('built')}
            >
              Run Build
            </button>
            <button type="button" disabled={!demoInstalled} onClick={() => setDemoStage('running')}>
              Start
            </button>
          </div>

          <div className="auth-demo-display" aria-label="Demo display preview">
            <div className="demo-game-sky">
              <span className="demo-star one" />
              <span className="demo-star two" />
              <span className="demo-star three" />
            </div>
            <div className="demo-game-hud">
              <span>NEON RUNNER</span>
              <strong>{demoRunning ? '00042' : 'READY'}</strong>
            </div>
            <span className="demo-runner" />
            <span className="demo-obstacle" />
            <span className="demo-track" />
          </div>
        </div>
      </section>
      <section className="auth-panel" aria-label={isSignup ? 'Create account' : 'Sign in'}>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <strong>Web Terminal</strong>
            <small>Sign in to save projects and settings.</small>
          </div>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" className={!isSignup ? 'is-active' : ''} onClick={() => onModeChange('signin')}>
            Sign In
          </button>
          <button type="button" className={isSignup ? 'is-active' : ''} onClick={() => onModeChange('signup')}>
            Sign Up
          </button>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          {isSignup ? (
            <label>
              Name
              <input
                value={form.name}
                autoComplete="name"
                placeholder="Your name"
                onChange={(event) => onFormChange({ ...form, name: event.target.value })}
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              value={form.email}
              autoComplete="email"
              placeholder="you@example.com"
              onChange={(event) => onFormChange({ ...form, email: event.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder="At least 8 characters"
              onChange={(event) => onFormChange({ ...form, password: event.target.value })}
            />
          </label>
          <button type="submit" className="primary-action">
            {isSignup ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
        {status ? <p className="auth-status">{status}</p> : null}
      </section>
    </main>
  )
}

function ProjectHub({ user, projects, newProjectName, status, onProjectNameChange, onCreateProject, onOpenProject, onSignOut }) {
  return (
    <main className="project-shell">
      <section className="project-header">
        <div>
          <span>Signed in as {user.email}</span>
          <h1>Create or open a project.</h1>
          <p>Your files, project list, and non-secret settings are saved through the backend.</p>
        </div>
        <button type="button" onClick={onSignOut}>Sign Out</button>
      </section>
      <section className="project-create">
        <label>
          Project name
          <input
            value={newProjectName}
            placeholder="My Browser Project"
            onChange={(event) => onProjectNameChange(event.target.value)}
          />
        </label>
        <button type="button" className="primary-action" onClick={onCreateProject}>
          Create Project
        </button>
      </section>
      <section className="project-list" aria-label="Saved projects">
        <div className="project-list-heading">
          <strong>Saved Projects</strong>
          <span>{projects.length} total</span>
        </div>
        <div className="project-scroll-menu" role="menu" aria-label="Project menu">
          {projects.length ? projects.map((project) => (
            <button type="button" role="menuitem" key={project.id} onClick={() => onOpenProject(project.id)}>
              <span>{project.name}</span>
              <small>{project.fileCount || 0} files saved</small>
            </button>
          )) : (
            <p>No projects yet. Create one to enter the IDE.</p>
          )}
        </div>
      </section>
      {status ? <p className="project-status">{status}</p> : null}
    </main>
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
  const [staticPreviewUrl, setStaticPreviewUrl] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  const [devStatus, setDevStatus] = useState('Stopped')
  const [previewStatus, setPreviewStatus] = useState('Waiting for a dev server.')
  const [popupHelp, setPopupHelp] = useState(() => ({
    visible: false,
    status: localStorage.getItem('preview-popups-allowed') === 'true' ? 'allowed' : 'unknown',
    message: '',
  }))
  const [bridgePendingPort, setBridgePendingPort] = useState(0)
  const [cloudRunner, setCloudRunner] = useState({
    status: 'idle',
    sandboxId: '',
    commandId: '',
    proxyCommandId: '',
    previewUrl: '',
    logs: '',
    error: '',
    diagnostics: null,
  })
  const [isInstalling, setIsInstalling] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [operationStatus, setOperationStatus] = useState('')
  const [runtimeIssue, setRuntimeIssue] = useState(null)
  const [projectName, setProjectName] = useState('No folder opened')
  const [activeActivity, setActiveActivity] = useState('explorer')
  const [selectedCommandGroup, setSelectedCommandGroup] = useState('all')
  const [commandQuery, setCommandQuery] = useState('')
  const [cloudCommandDraft, setCloudCommandDraft] = useState('npm install')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSavedProject, setHasSavedProject] = useState(false)
  const [projectScripts, setProjectScripts] = useState([])
  const [frameworkName, setFrameworkName] = useState('Unknown')
  const [languageStatus, setLanguageStatus] = useState('Node ready')
  const [problems, setProblems] = useState([])
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [autosaveEnabled, setAutosaveEnabled] = useState(() => localStorage.getItem('ide-autosave') !== 'false')
  const [theme, setTheme] = useState(() => localStorage.getItem('ide-theme') || 'blackblue')
  const [layoutMode, setLayoutMode] = useState(() => localStorage.getItem('ide-layout-mode') || 'all')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [aiSettings, setAiSettings] = useState(() => normalizeAiSettings(readJsonStorage(aiSettingsStorageKey, {})))
  const [aiUsage, setAiUsage] = useState(() => normalizeAiUsage(readJsonStorage(aiUsageStorageKey, defaultAiUsage())))
  const [authLoading, setAuthLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState(null)
  const [authMode, setAuthMode] = useState('signin')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [authStatus, setAuthStatus] = useState('')
  const [cloudProjects, setCloudProjects] = useState([])
  const [activeCloudProject, setActiveCloudProject] = useState(null)
  const [newProjectName, setNewProjectName] = useState('New Browser Project')
  const [projectHubStatus, setProjectHubStatus] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiResult, setAiResult] = useState(null)
  const [aiPlan, setAiPlan] = useState(null)
  const [aiLastRequest, setAiLastRequest] = useState('')
  const [aiStatus, setAiStatus] = useState('Save an AI provider key, set caps, then ask for a code change.')
  const [aiMessages, setAiMessages] = useState([
    {
      id: 'ai-welcome',
      role: 'assistant',
      content: 'Ask me for a code change. I will understand the request, plan the work, write the patch, apply it to the workspace, and show the files and line counts I changed.',
      changes: [],
      status: 'ready',
    },
  ])
  const [aiChangedPaths, setAiChangedPaths] = useState([])
  const [apiKeyStatus, setApiKeyStatus] = useState('')
  const [isAiRunning, setIsAiRunning] = useState(false)
  const [aiRunPhase, setAiRunPhase] = useState('idle')
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
  const previewIframeRef = useRef(null)
  const commandSearchRef = useRef(null)
  const aiChatLogRef = useRef(null)
  const saveSnapshotTimerRef = useRef(null)
  const cloudSettingsTimerRef = useRef(null)
  const activeCloudProjectRef = useRef(null)
  const workspaceProjectIdRef = useRef('')
  const loadedCloudProjectIdRef = useRef('')
  const previewUrlsByPortRef = useRef(new Map())
  const activePreviewPortRef = useRef(0)
  const pendingPreviewPortRef = useRef(0)
  const staticPreviewUrlsRef = useRef([])
  const lastProblemRef = useRef('')
  const projectNameRef = useRef(projectName)

  const writeTerminal = useCallback((data) => {
    if (terminalApiRef.current) {
      terminalApiRef.current.write(data)
      return
    }

    bufferedTerminalOutputRef.current += data
  }, [])

  const clearStaticPreview = useCallback(() => {
    staticPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    staticPreviewUrlsRef.current = []
    setStaticPreviewUrl('')
  }, [])

  const addProblem = useCallback((source, message) => {
    const cleanMessage = stripAnsi(message).trim()
    if (!cleanMessage || cleanMessage.length < 4) return

    const signature = `${source}:${cleanMessage}`
    if (lastProblemRef.current === signature) return
    lastProblemRef.current = signature

    setProblems((currentProblems) => [
      { id: `${Date.now()}-${Math.random()}`, source, message: cleanMessage },
      ...currentProblems,
    ].slice(0, 8))
  }, [])

  const showPopupHelp = useCallback((message = 'Preview popup was blocked. Allow popups for this site, then open the preview again.') => {
    try {
      localStorage.removeItem('preview-popups-allowed')
    } catch {
      // Storage may be unavailable in strict browser modes.
    }

    setPopupHelp({
      visible: true,
      status: 'blocked',
      message,
    })
    setPreviewStatus(message)
    setOperationStatus('Allow popups for this site, then click Test Popups or Open Preview again.')
  }, [])

  const dismissPopupHelp = useCallback(() => {
    setPopupHelp((current) => ({ ...current, visible: false }))
  }, [])

  const testPopupPermission = useCallback(() => {
    const testWindow = window.open('', '_blank', 'width=420,height=320')

    if (!testWindow) {
      showPopupHelp('Popup test was blocked. Click Chrome\'s popup-blocked icon, allow popups for this site, then click Test Popups again.')
      return
    }

    try {
      testWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Popups Allowed</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #030712;
        color: #dbeafe;
        font-family: Inter, system-ui, sans-serif;
      }
      main {
        width: min(420px, calc(100vw - 32px));
        border: 1px solid #2563eb;
        border-radius: 12px;
        background: #07111f;
        padding: 24px;
        box-shadow: 0 18px 54px rgba(0, 0, 0, 0.4);
      }
      strong { display: block; color: white; margin-bottom: 8px; }
      span { color: #93c5fd; }
    </style>
  </head>
  <body>
    <main>
      <strong>Popups are allowed.</strong>
      <span>You can close this tab. Cloud previews can open here now.</span>
    </main>
  </body>
</html>`)
      testWindow.document.close()
      testWindow.opener = null
      window.setTimeout(() => {
        if (!testWindow.closed) testWindow.close()
      }, 1100)
    } catch {
      // Some browsers prevent writing to the new tab after opening it.
    }

    try {
      localStorage.setItem('preview-popups-allowed', 'true')
    } catch {
      // Storage may be unavailable in strict browser modes.
    }

    setPopupHelp({
      visible: true,
      status: 'allowed',
      message: 'Popups are allowed. Run Cloud or Open Preview again to launch the project tab.',
    })
    setPreviewStatus('Popup test worked. Run Cloud or Open Preview again.')
    setOperationStatus('Popups are allowed for preview tabs.')
    window.setTimeout(() => {
      setPopupHelp((current) => current.status === 'allowed'
      ? { ...current, visible: false }
      : current)
    }, 2400)
  }, [showPopupHelp])

  const publishCloudPreviewHandoff = useCallback((runId, payload = {}) => {
    if (!runId) return

    const message = {
      runId,
      updatedAt: Date.now(),
      ...payload,
    }

    try {
      localStorage.setItem(cloudPreviewStorageKey(runId), JSON.stringify(message))
    } catch {
      // The preview handoff still works through BroadcastChannel when storage is blocked.
    }

    if ('BroadcastChannel' in window) {
      try {
        const channel = new BroadcastChannel(cloudPreviewChannelName)
        channel.postMessage(message)
        channel.close()
      } catch {
        // Some locked browsers disable BroadcastChannel; localStorage is the fallback.
      }
    }
  }, [])

  const openCloudPreviewHandoff = useCallback((runId) => {
    const previewWindow = window.open(cloudPreviewHandoffUrl(runId), '_blank')
    if (!previewWindow) {
      showPopupHelp('Preview popup was blocked. Allow popups for this site, then click Cloud or Open Preview again.')
      return null
    }

    try {
      previewWindow.opener = null
    } catch {
      // The browser can deny opener changes after navigation starts.
    }

    return previewWindow
  }, [showPopupHelp])

  const connectPreview = useCallback((port, url, source = 'WebContainer') => {
    if (!url) return
    const safePort = Number(port) || 0

    if (safePort) {
      previewUrlsByPortRef.current.set(safePort, url)
      activePreviewPortRef.current = safePort
      pendingPreviewPortRef.current = 0
      setBridgePendingPort(0)
    }

    clearStaticPreview()
    setPreviewUrl(url)
    setPreviewKey((key) => key + 1)
    setDevStatus(safePort ? `Running on ${safePort}` : 'Running')
    setPreviewStatus(`Preview bridge connected${safePort ? ` on port ${safePort}` : ''}.`)
    setOperationStatus(`${source} preview connected${safePort ? ` on port ${safePort}` : ''}.`)
  }, [clearStaticPreview])

  const inspectProcessOutput = useCallback((source, data) => {
    const text = String(data)
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const problemPattern = /\b(error|failed|exception|enoent|eaddrinuse|cannot find|syntaxerror|typeerror|referenceerror)\b/i
    const previewSignal = getPreviewSignalFromOutput(text)

    if (previewSignal.directUrl) {
      connectPreview(previewSignal.port || activePreviewPortRef.current, previewSignal.directUrl, source)
    } else if (previewSignal.port) {
      const bridgedUrl = previewUrlsByPortRef.current.get(previewSignal.port)
      if (bridgedUrl) {
        connectPreview(previewSignal.port, bridgedUrl, source)
      } else {
        pendingPreviewPortRef.current = previewSignal.port
        setBridgePendingPort(previewSignal.port)
        setDevStatus(`Server ready on ${previewSignal.port}`)
        setPreviewStatus(`Server is ready on ${previewSignal.port}. Waiting for the WebContainer preview bridge URL...`)
        setOperationStatus(`Detected a dev server on port ${previewSignal.port}. Waiting for WebContainer's preview bridge...`)
      }
    }

    lines.forEach((line) => {
      if (problemPattern.test(line) && !/0 errors?/i.test(line)) {
        addProblem(source, line)
      }
    })
  }, [addProblem, clearStaticPreview, connectPreview])

  const applyCloudSettings = useCallback((settings = {}) => {
    if (settings.theme) setTheme(settings.theme)
    if (settings.layoutMode) setLayoutMode(settings.layoutMode)
    if (typeof settings.autosaveEnabled === 'boolean') setAutosaveEnabled(settings.autosaveEnabled)
    if (settings.aiSettings) {
      setAiSettings((current) => normalizeAiSettings({
        ...current,
        ...settings.aiSettings,
        apiKeys: current.apiKeys,
        draftApiKey: current.draftApiKey,
      }))
    }
  }, [])

  const loadCloudProjects = useCallback(async () => {
    const data = await apiRequest('/api/projects')
    setCloudProjects(data.projects || [])
    return data.projects || []
  }, [])

  const handleAuthSubmit = useCallback(async (event) => {
    event.preventDefault()
    setAuthError('')
    setAuthStatus(authMode === 'signup' ? 'Creating account...' : 'Signing in...')

    try {
      const data = await apiRequest('/api/auth', {
        method: 'POST',
        body: {
          action: authMode,
          name: authForm.name,
          email: authForm.email,
          password: authForm.password,
          settings: buildCloudSettings({ theme, layoutMode, autosaveEnabled, aiSettings }),
        },
      })
      setCurrentUser(data.user)
      applyCloudSettings(data.user?.settings || {})
      await loadCloudProjects()
      setAuthForm({ name: '', email: authForm.email, password: '' })
      setAuthStatus('Choose a project to continue.')
      setProjectHubStatus('')
    } catch (error) {
      setAuthError(error.message)
      setAuthStatus('')
    }
  }, [
    aiSettings,
    applyCloudSettings,
    authForm,
    authMode,
    autosaveEnabled,
    layoutMode,
    loadCloudProjects,
    theme,
  ])

  const handleSignOut = useCallback(async () => {
    const activeSandboxId = cloudRunner.sandboxId
    try {
      if (activeSandboxId) {
        await apiRequest('/api/cloud-runner', { method: 'POST', body: { action: 'stop', sandboxId: activeSandboxId } })
      }
      await apiRequest('/api/auth', { method: 'POST', body: { action: 'signout' } })
    } catch {
      // Local session cleanup still happens below.
    }
    devProcessRef.current?.kill()
    devProcessRef.current = null
    try {
      webcontainer?.teardown()
    } catch {
      // Signing out should still clear the local UI if teardown is already complete.
    }
    webcontainerBootPromise = null
    bootStartedRef.current = false
    setDevStatus('Stopped')
    setWebcontainer(null)
    setCurrentUser(null)
    activeCloudProjectRef.current = null
    workspaceProjectIdRef.current = ''
    loadedCloudProjectIdRef.current = ''
    setActiveCloudProject(null)
    setCloudProjects([])
    setProjectName('No folder opened')
    setTree([])
    setTabs([])
    setCloudRunner({ status: 'idle', sandboxId: '', commandId: '', proxyCommandId: '', previewUrl: '', logs: '', error: '', diagnostics: null })
    setActivePath('')
    setSelectedPath('')
    setProjectHubStatus('')
    setAuthStatus('')
    setAuthError('')
    setAuthMode('signin')
    setAuthForm({ name: '', email: '', password: '' })
  }, [cloudRunner.sandboxId, webcontainer])

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
      const pythonScripts = []
      for (const candidate of ['main.py', 'app.py']) {
        try {
          await container.fs.readFile(candidate)
          pythonScripts.push({
            label: `Python: ${candidate}`,
            command: `python ${candidate}`,
            group: 'python',
            hint: 'Run Python entry file',
          })
        } catch {
          // Missing Python entrypoints are ignored.
        }
      }

      try {
        await container.fs.readFile('pyproject.toml')
        setFrameworkName('Python project')
      } catch {
        setFrameworkName(pythonScripts.length ? 'Python project' : 'No package.json')
      }

      setProjectScripts(pythonScripts)
    }
  }, [webcontainer])

  const saveCurrentSnapshot = useCallback(async (container = webcontainer, name = projectNameRef.current) => {
    if (!container) return

    window.clearTimeout(saveSnapshotTimerRef.current)
    saveSnapshotTimerRef.current = window.setTimeout(async () => {
      try {
        const files = await readWorkspaceFiles(container)
        const activeProject = activeCloudProjectRef.current
        if (files.length === 0 && !activeProject?.id) return
        await saveSnapshot({
          name,
          files,
          savedAt: Date.now(),
        })
        if (activeProject?.id && workspaceProjectIdRef.current === activeProject.id) {
          const data = await apiRequest('/api/projects', {
            method: 'POST',
            body: {
              action: 'save',
              id: activeProject.id,
              name,
              files: filesForApi(files),
            },
          })
          const savedProject = projectFromApi(data.project)
          activeCloudProjectRef.current = savedProject
          setActiveCloudProject(savedProject)
          setCloudProjects((projects) => {
            const summary = {
              id: savedProject.id,
              name: savedProject.name,
              fileCount: savedProject.files?.length || 0,
              createdAt: savedProject.createdAt,
              updatedAt: savedProject.updatedAt,
              lastOpenedAt: savedProject.lastOpenedAt,
            }
            const rest = projects.filter((project) => project.id !== summary.id)
            return [summary, ...rest]
          })
        }
        setHasSavedProject(true)
      } catch (error) {
        setOperationStatus(`Could not save browser snapshot: ${error.message}`)
      }
    }, 400)
  }, [webcontainer])

  const openFile = useCallback(
    async (path, container = webcontainer) => {
      if (!container) {
        const cloudFile = activeCloudProjectRef.current?.files?.find((file) => normalizePath(file.path) === normalizePath(path))
        if (!cloudFile) return
        const rawContents = cloudFile.data instanceof Uint8Array
          ? new TextDecoder().decode(cloudFile.data)
          : String(cloudFile.data || '')
        setTabs((currentTabs) => {
          const existing = currentTabs.find((tab) => tab.path === path)
          if (existing) {
            return currentTabs.map((tab) =>
              tab.path === path ? { ...tab, contents: rawContents, savedContents: rawContents, dirty: false } : tab,
            )
          }

          return [
            ...currentTabs,
            {
              path,
              name: baseName(path),
              contents: rawContents,
              savedContents: rawContents,
              dirty: false,
              language: getLanguage(path),
            },
          ]
        })
        setActivePath(path)
        setSelectedPath(path)
        setOperationStatus(`Opened ${path} from saved cloud files.`)
        return
      }
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
  const currentUserId = currentUser?.id || ''
  const hasActiveCloudProject = Boolean(activeCloudProject?.id)

  const getNpmServerArgs = useCallback((script) => {
    const scriptHint = projectScripts.find((item) => item.command === `npm run ${script}`)?.hint || ''
    const details = `${frameworkName} ${scriptHint}`.toLowerCase()

    if (details.includes('vite')) {
      return ['run', script, '--', '--host', '0.0.0.0', '--port', String(defaultRunPort)]
    }

    if (details.includes('next')) {
      return ['run', script, '--', '--hostname', '0.0.0.0']
    }

    return ['run', script]
  }, [frameworkName, projectScripts])

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
      setPreviewUrl('')
      clearStaticPreview()
      setPreviewStatus('Starting dev server and waiting for the preview bridge...')
      pendingPreviewPortRef.current = 0
      setBridgePendingPort(0)
      activePreviewPortRef.current = 0
      const npmArgs = getNpmServerArgs(script)
      writeTerminal(`\r\n\x1b[1;34m$ npm ${npmArgs.join(' ')}\x1b[0m\r\n`)
      const process = await container.spawn('npm', npmArgs)
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
    [clearStaticPreview, getNpmServerArgs, inspectProcessOutput, webcontainer, writeTerminal],
  )

  const stopDevServer = useCallback(() => {
    if (!devProcessRef.current) return
    writeTerminal('\r\n\x1b[1;34mStopping Vite dev server...\x1b[0m\r\n')
    devProcessRef.current.kill()
    devProcessRef.current = null
    setDevStatus('Stopped')
    setBridgePendingPort(0)
    setPreviewStatus('Preview stopped.')
  }, [writeTerminal])

  const saveAllDirtyTabs = useCallback(async (options = {}) => {
    const dirtyTabs = tabs.filter((tab) => tab.dirty)
    if (!dirtyTabs.length) return 0

    if (!webcontainer) {
      if (!activeCloudProject?.id) return 0

      const dirtyPaths = new Set(dirtyTabs.map((tab) => normalizePath(tab.path)))
      const nextFiles = [
        ...(activeCloudProject.files || []).filter((file) => !dirtyPaths.has(normalizePath(file.path))),
        ...dirtyTabs.map((tab) => ({ path: tab.path, data: tab.contents })),
      ]

      const data = await apiRequest('/api/projects', {
        method: 'POST',
        body: {
          action: 'save',
          id: activeCloudProject.id,
          name: projectNameRef.current || activeCloudProject.name,
          files: filesForApi(nextFiles),
        },
      })
      const project = projectFromApi(data.project)
      activeCloudProjectRef.current = project
      setActiveCloudProject(project)
      setCloudProjects((projects) => {
        const summary = {
          id: project.id,
          name: project.name,
          fileCount: project.files?.length || 0,
          updatedAt: project.updatedAt,
          lastOpenedAt: project.lastOpenedAt,
        }
        return [summary, ...projects.filter((item) => item.id !== project.id)]
      })
      setTree(treeFromFiles(project.files || []))
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          dirtyPaths.has(normalizePath(tab.path))
            ? { ...tab, savedContents: tab.contents, dirty: false }
            : tab,
        ),
      )
      setPreviewKey((key) => key + 1)

      if (!options.silent) {
        setOperationStatus(`Saved ${dirtyTabs.length} open file${dirtyTabs.length === 1 ? '' : 's'} to Cloud Runner.`)
      }

      return dirtyTabs.length
    }

    await Promise.all(dirtyTabs.map(async (tab) => {
      const dir = parentPath(tab.path)
      if (dir) await webcontainer.fs.mkdir(dir, { recursive: true })
      await webcontainer.fs.writeFile(tab.path, tab.contents)
    }))

    const dirtyPaths = new Set(dirtyTabs.map((tab) => tab.path))
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        dirtyPaths.has(tab.path)
          ? { ...tab, savedContents: tab.contents, dirty: false }
          : tab,
      ),
    )

    await refreshExplorer(webcontainer)
    if (dirtyPaths.has('package.json')) await detectProjectDetails(webcontainer)
    await saveCurrentSnapshot(webcontainer)
    setPreviewKey((key) => key + 1)

    if (!options.silent) {
      setOperationStatus(`Autosaved ${dirtyTabs.length} open file${dirtyTabs.length === 1 ? '' : 's'}.`)
    }

    return dirtyTabs.length
  }, [activeCloudProject, detectProjectDetails, refreshExplorer, saveCurrentSnapshot, tabs, webcontainer])

  const saveImportedFilesToCloudProject = useCallback(async (files, name = 'Imported Project') => {
    const activeProject = activeCloudProjectRef.current || activeCloudProject
    if (!activeProject?.id) {
      setOperationStatus('Create or open a project before saving files for Cloud Runner.')
      return
    }

    setIsImporting(true)
    setOperationStatus(`Saving ${files.length} files for Cloud Runner...`)

    try {
      const data = await apiRequest('/api/projects', {
        method: 'POST',
        body: {
          action: 'save',
          id: activeProject.id,
          name,
          files: filesForApi(files),
        },
      })
      const project = projectFromApi(data.project)
      activeCloudProjectRef.current = project
      setActiveCloudProject(project)
      setCloudProjects((projects) => {
        const summary = {
          id: project.id,
          name: project.name,
          fileCount: project.files?.length || 0,
          updatedAt: project.updatedAt,
          lastOpenedAt: project.lastOpenedAt,
        }
        return [summary, ...projects.filter((item) => item.id !== project.id)]
      })
      setProjectName(project.name)
      setTree(treeFromFiles(project.files || []))
      setTabs([])
      setActivePath('')
      setSelectedPath('')
      setOperationStatus(`Saved ${name} for Cloud Runner. Click Cloud in the preview panel to run it.`)
    } catch (error) {
      setOperationStatus(`Cloud save failed: ${error.message}`)
      addProblem('Cloud Save', error.message)
    } finally {
      setIsImporting(false)
    }
  }, [activeCloudProject, addProblem])

  const returnToProjectHub = useCallback(async () => {
    stopDevServer()
    if (cloudRunner.sandboxId) {
      apiRequest('/api/cloud-runner', {
        method: 'POST',
        body: { action: 'stop', sandboxId: cloudRunner.sandboxId },
      }).catch(() => {})
      setCloudRunner((runner) => ({ ...runner, status: 'stopped', sandboxId: '', commandId: '', proxyCommandId: '', previewUrl: '' }))
    }
    if (webcontainer && activeCloudProject?.id) {
      try {
        setProjectHubStatus('Saving project before switching...')
        await saveAllDirtyTabs({ silent: true })
        const files = await readWorkspaceFiles(webcontainer)
        await apiRequest('/api/projects', {
          method: 'POST',
          body: {
            action: 'save',
            id: activeCloudProject.id,
            name: projectNameRef.current,
            files: filesForApi(files),
          },
        })
        await loadCloudProjects()
      } catch (error) {
        setProjectHubStatus(`Project switch opened, but save failed: ${error.message}`)
      }
    }

    loadedCloudProjectIdRef.current = ''
    workspaceProjectIdRef.current = ''
    activeCloudProjectRef.current = null
    bootStartedRef.current = false
    setActiveCloudProject(null)
    setProjectHubStatus((status) => status || 'Choose a project to continue.')
  }, [activeCloudProject, cloudRunner.sandboxId, loadCloudProjects, saveAllDirtyTabs, stopDevServer, webcontainer])

  const saveActiveFile = useCallback(async () => {
    if (!activeTab) return

    if (!webcontainer) {
      if (!activeCloudProject?.id) return

      const activePath = normalizePath(activeTab.path)
      const nextFiles = [
        ...(activeCloudProject.files || []).filter((file) => normalizePath(file.path) !== activePath),
        { path: activeTab.path, data: activeTab.contents },
      ]

      try {
        const data = await apiRequest('/api/projects', {
          method: 'POST',
          body: {
            action: 'save',
            id: activeCloudProject.id,
            name: projectNameRef.current || activeCloudProject.name,
            files: filesForApi(nextFiles),
          },
        })
        const project = projectFromApi(data.project)
        activeCloudProjectRef.current = project
        setActiveCloudProject(project)
        setCloudProjects((projects) => {
          const summary = {
            id: project.id,
            name: project.name,
            fileCount: project.files?.length || 0,
            updatedAt: project.updatedAt,
            lastOpenedAt: project.lastOpenedAt,
          }
          return [summary, ...projects.filter((item) => item.id !== project.id)]
        })
        setTree(treeFromFiles(project.files || []))
        setTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.path === activeTab.path
              ? { ...tab, savedContents: activeTab.contents, dirty: false }
              : tab,
          ),
        )
        setOperationStatus(`Saved ${activeTab.path} to Cloud Runner`)
        setPreviewKey((key) => key + 1)
      } catch (error) {
        setOperationStatus(`Cloud save failed: ${error.message}`)
        addProblem('Cloud Save', error.message)
      }
      return
    }

    const dir = parentPath(activeTab.path)
    if (dir) await webcontainer.fs.mkdir(dir, { recursive: true })
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
  }, [activeCloudProject, activeTab, addProblem, detectProjectDetails, refreshExplorer, saveCurrentSnapshot, webcontainer])

  useEffect(() => {
    saveActiveRef.current = saveActiveFile
  }, [saveActiveFile])

  useEffect(() => {
    projectNameRef.current = projectName
  }, [projectName])

  const dirtyTabsSignature = useMemo(
    () => tabs.filter((tab) => tab.dirty).map((tab) => `${tab.path}:${tab.contents}`).join('\n---dirty-tab---\n'),
    [tabs],
  )

  useEffect(() => {
    if (!autosaveEnabled || !dirtyTabsSignature) return undefined

    const timer = window.setTimeout(() => {
      saveAllDirtyTabs({ silent: true }).catch((error) => {
        setOperationStatus(`Autosave failed: ${error.message}`)
        addProblem('Autosave', error.message)
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [addProblem, autosaveEnabled, dirtyTabsSignature, saveAllDirtyTabs])

  useEffect(() => {
    const flushBeforeHidden = () => {
      if (document.visibilityState === 'hidden') {
        saveAllDirtyTabs({ silent: true }).catch(() => {})
      }
    }

    document.addEventListener('visibilitychange', flushBeforeHidden)
    return () => document.removeEventListener('visibilitychange', flushBeforeHidden)
  }, [saveAllDirtyTabs])

  useEffect(() => {
    localStorage.setItem('ide-autosave', String(autosaveEnabled))
  }, [autosaveEnabled])

  useEffect(() => {
    localStorage.setItem('ide-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('ide-layout-mode', layoutMode)
  }, [layoutMode])

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
    activeCloudProjectRef.current = activeCloudProject
  }, [activeCloudProject])

  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      try {
        const data = await apiRequest('/api/auth')
        if (cancelled) return
        setCurrentUser(data.user || null)
        if (data.user?.settings) applyCloudSettings(data.user.settings)
        if (data.user) await loadCloudProjects()
      } catch {
        if (!cancelled) setCurrentUser(null)
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    }

    loadSession()
    return () => {
      cancelled = true
    }
  }, [applyCloudSettings, loadCloudProjects])

  useEffect(() => {
    if (!currentUser) return undefined

    window.clearTimeout(cloudSettingsTimerRef.current)
    cloudSettingsTimerRef.current = window.setTimeout(() => {
      apiRequest('/api/settings', {
        method: 'POST',
        body: {
          settings: buildCloudSettings({ theme, layoutMode, autosaveEnabled, aiSettings }),
        },
      }).catch((error) => setOperationStatus(`Could not save cloud settings: ${error.message}`))
    }, 900)

    return () => window.clearTimeout(cloudSettingsTimerRef.current)
  }, [aiSettings, autosaveEnabled, currentUser, layoutMode, theme])

  useEffect(() => {
    getSavedSnapshot().then((snapshot) => {
      setHasSavedProject(Boolean(snapshot?.files?.length))
    })
  }, [])

  useEffect(() => {
    const log = aiChatLogRef.current
    if (!log) return
    log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
  }, [aiMessages.length, aiRunPhase])

  useEffect(() => {
    return () => {
      window.clearTimeout(saveSnapshotTimerRef.current)
      window.clearTimeout(cloudSettingsTimerRef.current)
      staticPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      staticPreviewUrlsRef.current = []
    }
  }, [])

  useEffect(() => {
    const stopProcessesOnLeave = () => {
      saveAllDirtyTabs({ silent: true }).catch(() => {})
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
  }, [saveAllDirtyTabs, webcontainer])

  useEffect(() => {
    const cleanupBoot = () => {
      window.clearTimeout(bootCleanupRef.current.refreshTimer)
      bootCleanupRef.current.watcher?.close()
      bootCleanupRef.current.unsubscribeServer?.()
      bootCleanupRef.current.unsubscribePort?.()
      bootCleanupRef.current.unsubscribeError?.()
      bootCleanupRef.current.unsubscribePreviewMessage?.()
    }

    if (authLoading || !currentUserId || !hasActiveCloudProject) return cleanupBoot
    if (bootStartedRef.current) return cleanupBoot
    bootStartedRef.current = true

    let watcher
    let unsubscribeServer
    let unsubscribePort
    let unsubscribeError
    let refreshTimer

    async function boot() {
      try {
        setRuntimeIssue(null)
        setWebcontainer(null)
        setBootStatus('Checking browser support...')
        setOperationStatus('Checking whether this browser can run the in-browser runtime...')

        const support = getBrowserRuntimeSupport()
        if (!support.ok) {
          const message = `${support.message} ${support.issues.join(' ')}`
          setRuntimeIssue({
            title: 'Runtime blocked by this browser',
            message,
            issues: support.issues,
          })
          setBootStatus('Browser runtime blocked')
          setOperationStatus(message)
          addProblem('Browser Runtime', message)
          bootStartedRef.current = false
          return
        }

        setBootStatus('Loading WebContainer runtime...')
        const container = await withTimeout(
          getWebContainer(),
          webContainerBootTimeoutMs,
          'WebContainer startup timed out. On school Chromebooks this usually means the browser, extension policy, or network filter blocked the isolated runtime.',
        )

        setBootStatus('Connecting runtime services...')

        unsubscribeServer = container.on('server-ready', (port, url) => {
          writeTerminal(`\r\n\x1b[2m[preview] server-ready ${port}: ${url}\x1b[0m\r\n`)
          connectPreview(port, url, 'WebContainer')
        })
        unsubscribePort = container.on('port', (port, type, url) => {
          writeTerminal(`\r\n\x1b[2m[preview] port ${type} ${port}${url ? `: ${url}` : ''}\x1b[0m\r\n`)
          if (type === 'open') {
            previewUrlsByPortRef.current.set(Number(port), url)
            if (!activePreviewPortRef.current || pendingPreviewPortRef.current === Number(port)) {
              connectPreview(port, url, 'WebContainer')
            }
          } else {
            previewUrlsByPortRef.current.delete(Number(port))
            if (activePreviewPortRef.current === Number(port)) {
              activePreviewPortRef.current = 0
              setBridgePendingPort(0)
              setPreviewUrl('')
              setDevStatus('Stopped')
            }
          }
        })
        unsubscribeError = container.on('error', (error) => {
          setOperationStatus(`WebContainer error: ${error.message}`)
          addProblem('WebContainer', error.message)
        })
        const unsubscribePreviewMessage = container.on('preview-message', (message) => {
          const previewMessage = message?.message || message?.args?.join?.(' ') || 'Preview runtime error'
          addProblem('Preview', previewMessage)
          setPreviewStatus(`Preview reported: ${previewMessage}`)
        })
        bootCleanupRef.current.unsubscribeServer = unsubscribeServer
        bootCleanupRef.current.unsubscribePort = unsubscribePort
        bootCleanupRef.current.unsubscribeError = unsubscribeError
        bootCleanupRef.current.unsubscribePreviewMessage = unsubscribePreviewMessage

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
        setRuntimeIssue(null)
        setOperationStatus('Open a folder or files to start running Node, Python, and browser code.')
      } catch (error) {
        const message = error?.message || 'WebContainer failed to start.'
        setIsInstalling(false)
        setBootStatus('WebContainer failed to start')
        setRuntimeIssue({
          title: 'WebContainer could not start',
          message,
          issues: [
            'Reload the page once after this deploy so the new browser isolation headers are active.',
            'Use Chrome on HTTPS. School-managed guest or locked profiles can block SharedArrayBuffer, service workers, or IndexedDB.',
            'If it still hangs on a school Chromebook, the admin policy may be blocking the browser runtime itself.',
          ],
        })
        setOperationStatus(message)
        addProblem('WebContainer', message)
        writeTerminal(`\r\nWebContainer failed: ${message}\r\n`)
        if (!/timed out/i.test(message)) {
          webcontainerBootPromise = null
          bootStartedRef.current = false
        }
      }
    }

    boot()

    return cleanupBoot
  }, [authLoading, currentUserId, hasActiveCloudProject])

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

  const activeRunCommand = useMemo(
    () => activeTab ? getRunCommandForPath(activeTab.path) : '',
    [activeTab],
  )

  const dynamicCommands = useMemo(
    () => [
      ...(activeTab
        ? [{
            label: `Run ${activeTab.path.split('/').pop()}`,
            command: activeRunCommand,
            group: 'active',
            hint: 'Run the open file with the matching runtime',
          }]
        : []),
      ...projectScripts,
      ...quickCommands,
    ],
    [activeRunCommand, activeTab, projectScripts],
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

  const runPythonRequest = useCallback(async (request, originalCommand) => {
    if (!webcontainer) {
      setOperationStatus('The browser runtime is still starting. Try again in a moment.')
      return
    }

    setActiveActivity('commands')
    setBottomPanelTab('terminal')
    writeTerminal(`\r\n\x1b[1;35m$ ${originalCommand}\x1b[0m\r\n`)

    try {
      setLanguageStatus('Loading Python...')
      const pyodide = await loadPythonRuntime()

      pyodide.setStdout({
        batched: (line) => writeTerminal(`${line}\r\n`),
      })
      pyodide.setStderr({
        batched: (line) => writeTerminal(`\x1b[31m${line}\x1b[0m\r\n`),
      })

      if (request.type === 'version') {
        const version = pyodide.runPython('import sys; sys.version.split()[0]')
        writeTerminal(`Python ${version} (Pyodide ${pyodideVersion})\r\n`)
        setLanguageStatus(`Python ${version}`)
        setOperationStatus(`Python ${version} is ready.`)
        return
      }

      if (request.type === 'repl') {
        writeTerminal('Interactive Python REPL is not available yet. Run a .py file or use python -c "print(123)".\r\n')
        setOperationStatus('Use Run File, python file.py, or python -c for browser Python.')
        setLanguageStatus('Python ready')
        return
      }

      if (request.type === 'pip') {
        if (!request.packages?.length) {
          writeTerminal('Usage: pip install package-name\r\n')
          setOperationStatus('Add a package name after pip install.')
          return
        }

        setLanguageStatus('Installing Python package...')
        writeTerminal(`Installing Python packages: ${request.packages.join(', ')}\r\n`)
        const micropipPackages = []
        for (const packageName of request.packages) {
          try {
            await pyodide.loadPackage(packageName)
          } catch {
            micropipPackages.push(packageName)
          }
        }

        if (micropipPackages.length > 0) {
          await pyodide.loadPackage('micropip')
          await pyodide.runPythonAsync(`
import micropip
await micropip.install(${JSON.stringify(micropipPackages)})
`)
        }
        writeTerminal(`\x1b[32mInstalled ${request.packages.join(', ')} for Python.\x1b[0m\r\n`)
        setLanguageStatus('Python packages ready')
        setOperationStatus(`Installed Python package${request.packages.length === 1 ? '' : 's'}: ${request.packages.join(', ')}.`)
        return
      }

      setLanguageStatus('Syncing workspace...')
      await syncWorkspaceToPython(pyodide, webcontainer)
      pyodide.FS.chdir(pythonWorkspaceRoot)

      if (request.type === 'inline') {
        if (!request.code) {
          writeTerminal('Usage: python -c "print(123)"\r\n')
          setOperationStatus('Add Python code after python -c.')
          return
        }

        setLanguageStatus('Running Python...')
        await pyodide.runPythonAsync(request.code)
        writeTerminal('\x1b[2mPython inline command finished.\x1b[0m\r\n')
        setLanguageStatus('Python ready')
        setOperationStatus('Python inline command finished.')
        return
      }

      if (request.type === 'file') {
        const path = normalizePath(request.path)
        if (activeTab?.path === path && activeTab.dirty) {
          await saveActiveFile()
          await syncWorkspaceToPython(pyodide, webcontainer)
        } else {
          await webcontainer.fs.readFile(path)
        }

        const fullPath = `${pythonWorkspaceRoot}/${path}`
        const argv = [path, ...(request.args || [])]
        setLanguageStatus('Running Python...')
        setOperationStatus(`Running Python file: ${path}`)
        await pyodide.runPythonAsync(`
import os
import runpy
import sys

workspace = ${JSON.stringify(pythonWorkspaceRoot)}
target = ${JSON.stringify(fullPath)}
script_dir = os.path.dirname(target)
os.chdir(workspace)
for entry in (workspace, script_dir):
    if entry and entry not in sys.path:
        sys.path.insert(0, entry)
sys.argv = ${JSON.stringify(argv)}
runpy.run_path(target, run_name="__main__")
`)
        writeTerminal(`\r\n\x1b[2mPython file ${path} finished.\x1b[0m\r\n`)
        setLanguageStatus('Python ready')
        setOperationStatus(`Finished Python file: ${path}`)
      }
    } catch (error) {
      const message = error?.message || String(error)
      writeTerminal(`\r\n\x1b[1;31mPython failed:\x1b[0m ${message}\r\n`)
      addProblem('Python', message)
      setLanguageStatus('Python error')
      setOperationStatus(`Python failed: ${message}`)
    }
  }, [activeTab, addProblem, saveActiveFile, webcontainer, writeTerminal])

  const handleWebTerminalCommand = useCallback(async (request, originalCommand) => {
    setActiveActivity('commands')
    setBottomPanelTab('terminal')
    writeTerminal(`\r\n\x1b[1;35m$ ${originalCommand}\x1b[0m\r\n`)

    if (request.action === 'create-python-sample') {
      if (!webcontainer) {
        setOperationStatus('The browser runtime is still starting. Try again in a moment.')
        return
      }

      try {
        await webcontainer.fs.writeFile(pythonSamplePath, pythonSampleSource)
        await refreshExplorer(webcontainer)
        await openFile(pythonSamplePath, webcontainer)
        await saveCurrentSnapshot(webcontainer)
        writeTerminal(`Created ${pythonSamplePath}. Run it with: python ${pythonSamplePath}\r\n`)
        setOperationStatus(`Created ${pythonSamplePath}. Click Run File or run python ${pythonSamplePath}.`)
      } catch (error) {
        const message = error?.message || String(error)
        writeTerminal(`Could not create Python sample: ${message}\r\n`)
        setOperationStatus(`Could not create Python sample: ${message}`)
      }
      return
    }

    if (request.action === 'explain-runtime') {
      const path = request.args?.[0] || 'this file'
      writeTerminal([
        `${path} can be edited and saved here, but it needs a browser-compatible runtime to execute.`,
        'Real support is enabled for Node/npm, browser previews, shell scripts, and Python through Pyodide.',
        'For languages like Java, C/C++, Rust, Go, Ruby, or PHP, upload a project that includes a JS/WASM runner or an npm script, then run that script.',
      ].join('\r\n'))
      writeTerminal('\r\n')
      setOperationStatus(`No browser runtime is configured for ${path}.`)
      return
    }

    writeTerminal('Unknown webterm command. Try webterm create-python-sample.\r\n')
    setOperationStatus('Unknown webterm command.')
  }, [openFile, refreshExplorer, saveCurrentSnapshot, webcontainer, writeTerminal])

  const stopCloudRunner = useCallback(async (options = {}) => {
    const sandboxId = options.sandboxId || cloudRunner.sandboxId
    if (!sandboxId) return

    setCloudRunner((runner) => ({ ...runner, status: 'stopping' }))
    try {
      await apiRequest('/api/cloud-runner', {
        method: 'POST',
        body: { action: 'stop', sandboxId },
      })
      setCloudRunner({
        status: 'stopped',
        sandboxId: '',
        commandId: '',
        proxyCommandId: '',
        previewUrl: '',
        logs: `${cloudRunner.logs || ''}\nCloud sandbox stopped.`,
        error: '',
        diagnostics: cloudRunner.diagnostics || null,
      })
      if (previewUrl === cloudRunner.previewUrl) {
        setPreviewUrl('')
        setPreviewStatus('Cloud Runner stopped.')
      }
      setDevStatus('Stopped')
    } catch (error) {
      setCloudRunner((runner) => ({ ...runner, status: 'error', error: error.message }))
      addProblem('Cloud Runner', error.message)
    }
  }, [addProblem, cloudRunner, previewUrl])

  const refreshCloudRunnerStatus = useCallback(async () => {
    if (!cloudRunner.sandboxId) {
      setOperationStatus('No Cloud Runner sandbox is active.')
      return
    }

    try {
      const params = new URLSearchParams({
        sandboxId: cloudRunner.sandboxId,
        ...(cloudRunner.commandId ? { commandId: cloudRunner.commandId } : {}),
      })
      const result = await apiRequest(`/api/cloud-runner?${params.toString()}`)
      setCloudRunner((runner) => ({
        ...runner,
        status: result.status || runner.status,
        logs: result.logs ? `${runner.logs || ''}\n\nLatest output:\n${result.logs}` : runner.logs,
      }))
      setOperationStatus('Cloud Runner status refreshed.')
    } catch (error) {
      setCloudRunner((runner) => ({ ...runner, status: 'error', error: error.message }))
      setOperationStatus(`Cloud status failed: ${error.message}`)
      addProblem('Cloud Runner', error.message)
    }
  }, [addProblem, cloudRunner.commandId, cloudRunner.sandboxId])

  const startCloudRunner = useCallback(async (command = '', options = {}) => {
    const activeProject = activeCloudProjectRef.current || activeCloudProject
    if (!activeProject?.id) {
      setOperationStatus('Create or open a project before starting Cloud Runner.')
      return
    }

    let files = activeProject.files || []
    let fileSource = files.length ? 'saved project' : 'empty project'
    const previousSandboxId = cloudRunner.sandboxId
    const persistFilesBeforeRun = options.persistFilesBeforeRun ?? true
    let previewWindow = null
    let previewTabOpened = false
    const previewRunId = options.openInNewTab ? makeCloudPreviewRunId() : ''
    const updatePreviewTab = (payload) => publishCloudPreviewHandoff(previewRunId, payload)

    if (options.openInNewTab) {
      updatePreviewTab({
        status: 'starting',
        message: 'Booting hosted cloud preview...',
        logs: 'Starting Cloud Runner...',
      })
      previewWindow = openCloudPreviewHandoff(previewRunId)
      if (previewWindow) {
        previewTabOpened = true
      }
    }

    setActiveActivity('preview')
    setBottomPanelTab('terminal')
    setCloudRunner((runner) => ({ ...runner, status: 'starting', error: '', logs: 'Starting Cloud Runner...', diagnostics: null }))
    setDevStatus('Cloud starting')
    setPreviewStatus('Uploading files to a hosted sandbox...')
    updatePreviewTab({ status: 'uploading', message: 'Uploading project files to the cloud sandbox...' })
    writeTerminal('\r\n\x1b[1;36mStarting Cloud Runner on Vercel Sandbox...\x1b[0m\r\n')

    try {
      if (previousSandboxId) {
        setPreviewStatus('Stopping the previous cloud sandbox first...')
        updatePreviewTab({ status: 'stopping', message: 'Stopping the previous cloud sandbox...' })
        await apiRequest('/api/cloud-runner', {
          method: 'POST',
          body: { action: 'stop', sandboxId: previousSandboxId },
        }).catch(() => {})
      }

      if (webcontainer) {
        await saveAllDirtyTabs({ silent: true })
        if (workspaceProjectIdRef.current === activeProject.id || options.useWorkspaceFiles === true || !files.length) {
          const workspaceFiles = await readWorkspaceFiles(webcontainer)
          if (workspaceFiles.length || !files.length) {
            files = workspaceFiles
          }
          fileSource = 'active workspace'
        }
      }

      if (!files.length) {
        throw new Error('Cloud Runner needs project files. Upload a folder or load the demo first.')
      }

      const previewFileList = files.slice(0, 8).map((file) => file.path).join(', ')
      writeTerminal(`\x1b[36mCloud Runner source:\x1b[0m ${fileSource} (${files.length} files${previewFileList ? `: ${previewFileList}` : ''})\r\n`)
      updatePreviewTab({
        status: 'uploading',
        message: `Uploading ${files.length} project files from ${fileSource}...`,
      })

      if (persistFilesBeforeRun) {
        const data = await apiRequest('/api/projects', {
          method: 'POST',
          body: {
            action: 'save',
            id: activeProject.id,
            name: projectNameRef.current || activeProject.name,
            files: filesForApi(files),
          },
        })
        const project = projectFromApi(data.project)
        activeCloudProjectRef.current = project
        setActiveCloudProject(project)
        setCloudProjects((projects) => {
          const summary = {
            id: project.id,
            name: project.name,
            fileCount: project.files?.length || 0,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            lastOpenedAt: project.lastOpenedAt,
          }
          return [summary, ...projects.filter((item) => item.id !== project.id)]
        })
      }

      updatePreviewTab({
        status: 'running',
        message: 'Installing dependencies and starting the dev server in Vercel Sandbox...',
      })
      const body = {
        action: 'start',
        projectId: activeProject.id,
        command,
        files: filesForApi(files),
        useStoredFiles: false,
        port: defaultRunPort,
        install: true,
      }
      const result = await apiRequest('/api/cloud-runner', { method: 'POST', body })
      const logs = result.logs || 'Cloud Runner started.'
      writeTerminal(`${logs.replace(/\n/g, '\r\n')}\r\n`)
      updatePreviewTab({
        status: result.previewUrl ? 'ready' : 'finished',
        message: result.previewUrl
          ? 'Cloud server is ready. Opening your running project...'
          : 'Cloud command finished, but it did not start a web preview.',
        previewUrl: result.previewUrl || '',
        logs,
      })
      setCloudRunner({
        status: result.status || 'running',
        sandboxId: result.sandboxId || '',
        commandId: result.commandId || '',
        proxyCommandId: result.proxyCommandId || '',
        previewUrl: result.previewUrl || '',
        logs,
        error: '',
        diagnostics: result.diagnostics || null,
      })
      if (result.previewUrl) {
        setPreviewUrl(result.previewUrl)
        clearStaticPreview()
        setPreviewKey((key) => key + 1)
        if (previewWindow && !previewWindow.closed) {
          try {
            previewWindow.location.replace(result.previewUrl)
            previewWindow.opener = null
          } catch {
            const fallbackWindow = window.open(result.previewUrl, '_blank')
            if (!fallbackWindow) {
              showPopupHelp('Preview popup was blocked. Allow popups for this site, then click Open Preview again.')
            } else {
              try {
                fallbackWindow.opener = null
              } catch {
                // The browser can deny opener changes after navigation starts.
              }
            }
          }
        }
      } else if (previewWindow && !previewWindow.closed) {
        updatePreviewTab({
          status: 'finished',
          message: 'Cloud command finished, but no preview URL was created. Run npm run dev, npm start, or Cloud Run on a web project.',
          logs,
        })
      }
      setDevStatus(result.previewUrl ? 'Cloud running' : 'Cloud finished')
      setPreviewStatus(result.previewUrl
        ? (previewTabOpened ? 'Cloud Runner opened the live preview in a dedicated browser tab.' : 'Cloud Runner is ready. Click Open Preview Tab to view it.')
        : 'Cloud command finished. Start a dev server to open a preview.')
      setOperationStatus(result.previewUrl
        ? (previewTabOpened ? 'Cloud Runner started on Vercel Sandbox and opened the preview tab.' : 'Cloud Runner started on Vercel Sandbox. Open the preview tab manually.')
        : 'Cloud command finished.')
    } catch (error) {
      const details = error.details ? `\n${error.details}` : ''
      writeTerminal(`\r\n\x1b[1;31mCloud Runner failed:\x1b[0m ${error.message}${details}\r\n`)
      updatePreviewTab({
        status: 'error',
        message: `Cloud Runner failed: ${error.message}`,
        logs: `${error.message}${details}`,
      })
      setCloudRunner((runner) => ({ ...runner, status: 'error', error: error.message }))
      setDevStatus('Cloud error')
      setPreviewStatus(`Cloud Runner failed: ${error.message}`)
      addProblem('Cloud Runner', error.message)
    }
  }, [activeCloudProject, addProblem, clearStaticPreview, cloudRunner.sandboxId, openCloudPreviewHandoff, publishCloudPreviewHandoff, saveAllDirtyTabs, showPopupHelp, webcontainer, writeTerminal])

  const runPackageInstall = useCallback(
    async (request = { command: 'npm', args: ['install'], label: 'npm install' }) => {
      const commandText = [request.command, ...(request.args || [])].join(' ')
      setActiveActivity('commands')
      setBottomPanelTab('terminal')
      setIsInstalling(true)
      setOperationStatus(`Installing packages: ${commandText}`)
      setLanguageStatus('Installing packages')

      try {
        if (!webcontainer) {
          await startCloudRunner(commandText, { useWorkspaceFiles: true })
          setOperationStatus(`Cloud install finished: ${commandText}`)
          return
        }

        const installArgs = request.args || ['install']
        const installMode = installArgs[0]?.toLowerCase()
        const packages = installArgs.slice(1).filter((arg) => arg && !arg.startsWith('-'))
        const needsPackageJson = request.command === 'npm' && ['install', 'i', 'ci'].includes(installMode) && packages.length === 0

        if (needsPackageJson) {
          try {
            await webcontainer.fs.readFile('package.json')
          } catch {
            const message = 'npm install needs a package.json. Open a real project folder first, or run npm install <package-name>.'
            writeTerminal(`\r\n\x1b[1;33m${message}\x1b[0m\r\n`)
            setOperationStatus(message)
            addProblem('npm install', message)
            return
          }
        }

        await saveAllDirtyTabs({ silent: true })
        const exitCode = await runProcess(webcontainer, request.command, installArgs, request.label || commandText)
        await refreshExplorer(webcontainer)
        await detectProjectDetails(webcontainer)
        await saveCurrentSnapshot(webcontainer)
        setOperationStatus(exitCode === 0 ? `Installed packages with ${commandText}.` : `${commandText} exited with code ${exitCode}.`)
      } catch (error) {
        const message = error?.message || String(error)
        writeTerminal(`\r\n\x1b[1;31mInstall failed:\x1b[0m ${message}\r\n`)
        setOperationStatus(`Install failed: ${message}`)
        addProblem('npm install', message)
      } finally {
        setIsInstalling(false)
        setLanguageStatus('Node ready')
      }
    },
    [addProblem, detectProjectDetails, refreshExplorer, runProcess, saveAllDirtyTabs, saveCurrentSnapshot, startCloudRunner, webcontainer, writeTerminal],
  )

  const runTerminalCommand = useCallback((command) => {
    const pythonRequest = getPythonCommandRequest(command)
    if (pythonRequest) {
      if (webcontainer || pythonRequest.type === 'version' || pythonRequest.type === 'inline') {
        runPythonRequest(pythonRequest, command)
      } else {
        startCloudRunner(command)
      }
      return
    }

    const webTerminalRequest = getWebTerminalCommandRequest(command)
    if (webTerminalRequest) {
      handleWebTerminalCommand(webTerminalRequest, command)
      return
    }

    const packageInstallRequest = getPackageInstallRequest(command)
    if (packageInstallRequest) {
      runPackageInstall(packageInstallRequest)
      return
    }

    const managedNpmScript = getManagedNpmScript(command)
    if (managedNpmScript) {
      if (webcontainer) {
        startDevServer(undefined, managedNpmScript)
      } else {
        startCloudRunner(command)
      }
      return
    }

    if (!terminalApiRef.current) {
      startCloudRunner(command)
      return
    }

    terminalApiRef.current.run(command)
    setOperationStatus(`Running: ${command}`)
  }, [handleWebTerminalCommand, runPackageInstall, runPythonRequest, startCloudRunner, startDevServer, webcontainer])

  const runCloudCommand = useCallback((event) => {
    event?.preventDefault?.()
    const command = cloudCommandDraft.trim()
    if (!command) return

    const packageInstallRequest = getPackageInstallRequest(command)
    if (packageInstallRequest) {
      runPackageInstall(packageInstallRequest)
      setCloudCommandDraft('')
      return
    }

    startCloudRunner(command, {
      openInNewTab: shouldOpenCloudPreviewForCommand(command),
      useWorkspaceFiles: true,
    })
    setCloudCommandDraft('')
  }, [cloudCommandDraft, runPackageInstall, startCloudRunner])

  const interceptTerminalCommand = useCallback((command) => {
    if (getPythonCommandRequest(command) || getWebTerminalCommandRequest(command) || getPackageInstallRequest(command) || getManagedNpmScript(command)) {
      runTerminalCommand(command)
      return true
    }

    return false
  }, [runTerminalCommand])

  useEffect(() => {
    if (!cloudRunner.sandboxId) return undefined

    const stopCloudOnLeave = () => {
      fetch('/api/cloud-runner', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', sandboxId: cloudRunner.sandboxId }),
      }).catch(() => {})
    }

    window.addEventListener('pagehide', stopCloudOnLeave)
    window.addEventListener('beforeunload', stopCloudOnLeave)

    return () => {
      window.removeEventListener('pagehide', stopCloudOnLeave)
      window.removeEventListener('beforeunload', stopCloudOnLeave)
    }
  }, [cloudRunner.sandboxId])

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

  const scrollTerminal = useCallback((direction) => {
    if (direction === 'top') terminalApiRef.current?.scrollToTop?.()
    if (direction === 'up') terminalApiRef.current?.scrollUp?.()
    if (direction === 'down') terminalApiRef.current?.scrollDown?.()
    if (direction === 'bottom') terminalApiRef.current?.scrollToBottom?.()
  }, [])

  const openPreviewInNewTab = useCallback(() => {
    const url = previewUrl || cloudRunner.previewUrl || staticPreviewUrl
    if (!url) {
      setPreviewStatus('No preview URL is available yet. Run Dev first and wait for the bridge URL.')
      return
    }

    const isStaticUrl = Boolean(staticPreviewUrl && url === staticPreviewUrl)
    const isCloudUrl = Boolean(cloudRunner.previewUrl && url === cloudRunner.previewUrl)
    const shouldOpenCloudInstead = isHostedApp() && !isStaticUrl && !isCloudUrl && activeCloudProjectRef.current?.id

    if (shouldOpenCloudInstead) {
      setPreviewStatus('Raw WebContainer preview links can 404 in hosted or locked browsers. Opening a Cloud Runner preview tab instead...')
      setOperationStatus('Opening Cloud Runner so the preview tab uses a public sandbox URL.')
      startCloudRunner('', { openInNewTab: true, useWorkspaceFiles: true })
      return
    }

    const previewWindow = window.open(url, '_blank')
    if (!previewWindow) {
      showPopupHelp('Preview popup was blocked. Allow popups for this site, then click Open Preview again.')
      return
    }

    try {
      previewWindow.opener = null
    } catch {
      // The browser can deny opener changes after navigation starts.
    }
    setPreviewStatus('Opened the preview in a new tab. This helps when a managed Chromebook blocks embedded iframes.')
  }, [cloudRunner.previewUrl, previewUrl, showPopupHelp, startCloudRunner, staticPreviewUrl])

  const buildStaticPreviewFallback = useCallback(async (options = {}) => {
    if (!webcontainer) {
      setPreviewStatus('The workspace is still starting. Try again when the terminal is ready.')
      return
    }

    try {
      await saveAllDirtyTabs({ silent: true })
      const files = await readWorkspaceFiles(webcontainer)
      const preview = buildStaticPreview(files)
      clearStaticPreview()
      staticPreviewUrlsRef.current = preview.urls
      setStaticPreviewUrl(preview.url)
      setPreviewKey((key) => key + 1)
      setPreviewStatus('Static preview fallback loaded from your files. Dev-server features like HMR may not work here.')
      if (!options.silent) setOperationStatus('Static preview fallback loaded.')
    } catch (error) {
      const message = error?.message || 'Static preview fallback failed.'
      setPreviewStatus(`Static preview fallback failed: ${message}`)
      addProblem('Static Preview', message)
    }
  }, [addProblem, clearStaticPreview, saveAllDirtyTabs, webcontainer])

  const retryPreviewBridge = useCallback(() => {
    if (previewUrl) {
      setPreviewKey((key) => key + 1)
      setPreviewStatus('Reloading the connected WebContainer preview...')
      return
    }

    const port = bridgePendingPort || pendingPreviewPortRef.current || activePreviewPortRef.current || defaultRunPort
    const bridgedUrl = previewUrlsByPortRef.current.get(Number(port))

    if (bridgedUrl) {
      connectPreview(port, bridgedUrl, 'WebContainer')
      return
    }

    setPreviewStatus(`Still waiting for WebContainer to expose port ${port}. Keep the dev server running, or click Dev to restart it.`)
    setOperationStatus(`No preview URL has been emitted for port ${port} yet.`)
    writeTerminal(`\r\n\x1b[1;33mPreview bridge has not emitted a URL for port ${port} yet. If this stays stuck, click Dev to restart the server.\x1b[0m\r\n`)
  }, [bridgePendingPort, connectPreview, previewUrl, writeTerminal])

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

  const readCurrentFileContents = useCallback(async (paths) => {
    const contents = {}

    for (const rawPath of paths) {
      const path = normalizePath(rawPath || '')
      if (!path) continue

      const openTab = tabs.find((tab) => tab.path === path)
      if (openTab) {
        contents[path] = openTab.contents
        continue
      }

      try {
        contents[path] = webcontainer ? await webcontainer.fs.readFile(path, 'utf-8') : ''
      } catch {
        contents[path] = ''
      }
    }

    return contents
  }, [tabs, webcontainer])

  const recordAiUsage = useCallback((inputTokens, outputTokens, estimatedCostUsd) => {
    setAiUsage((current) => {
      const normalized = normalizeAiUsage(current)
      return {
        ...normalized,
        requests: normalized.requests + 1,
        inputTokens: normalized.inputTokens + inputTokens,
        outputTokens: normalized.outputTokens + outputTokens,
        estimatedCostUsd: normalized.estimatedCostUsd + estimatedCostUsd,
      }
    })
  }, [])

  const applyAiEditsToWorkspace = useCallback(async (edits) => {
    if (!webcontainer) throw new Error('WebContainer is still starting. Try again once it is ready.')

    const validEdits = (edits || [])
      .map((edit) => ({ ...edit, path: normalizePath(edit.path || '') }))
      .filter((edit) => edit.path && typeof edit.content === 'string')

    if (!validEdits.length) return 0

    for (const edit of validEdits) {
      const dir = parentPath(edit.path)
      if (dir) await webcontainer.fs.mkdir(dir, { recursive: true })
      await webcontainer.fs.writeFile(edit.path, edit.content)
    }

    await refreshExplorer(webcontainer)
    await detectProjectDetails(webcontainer)
    await saveCurrentSnapshot(webcontainer)

    const firstEdit = validEdits.find((edit) => edit.path)
    if (firstEdit?.path) await openFile(firstEdit.path, webcontainer)

    setPreviewKey((key) => key + 1)
    return validEdits.length
  }, [
    detectProjectDetails,
    openFile,
    refreshExplorer,
    saveCurrentSnapshot,
    webcontainer,
  ])

  const runAiPlan = useCallback(async () => {
    const provider = getAiProvider(aiSettings.provider)
    const apiKey = aiSettings.apiKeys?.[aiSettings.provider]?.trim()
    const request = aiPrompt.trim()
    let runningUsage = normalizeAiUsage(aiUsage)

    const trackAiUsage = (inputTokens, outputTokens, estimatedCostUsd) => {
      const safeInput = Number(inputTokens) || 0
      const safeOutput = Number(outputTokens) || 0
      const safeCost = Number(estimatedCostUsd) || 0
      recordAiUsage(safeInput, safeOutput, safeCost)
      runningUsage = {
        ...runningUsage,
        requests: runningUsage.requests + 1,
        inputTokens: runningUsage.inputTokens + safeInput,
        outputTokens: runningUsage.outputTokens + safeOutput,
        estimatedCostUsd: runningUsage.estimatedCostUsd + safeCost,
      }
    }

    if (!apiKey) {
      setAiStatus(`Open Settings and save a ${provider.label} API key first.`)
      setIsSettingsOpen(true)
      return
    }

    if (!request) {
      setAiStatus('Describe what you want the AI coder to plan.')
      return
    }

    const files = flattenTree(tree)
    const thinkingProfile = getAiThinkingProfile(aiSettings.thinkingLevel)
    const contextPaths = selectAiContextPaths(files, request, activeTab?.path, thinkingProfile.planContextLimit)
    const contextContents = await readCurrentFileContents(contextPaths)
    const prompt = buildAiPlanPrompt({
      userPrompt: request,
      activeTab,
      files,
      fileContents: contextContents,
      frameworkName,
      projectName,
      thinkingProfile,
    })
    const planOutputTokens = getAiOutputTokens(aiSettings, 'plan')
    const budget = checkAiBudget(aiSettings, runningUsage, prompt, planOutputTokens)

    if (budget.blockedMessage) {
      setAiStatus(budget.blockedMessage)
      return
    }

    setAiPrompt('')
    setIsAiRunning(true)
    setAiRunPhase('thinking')
    setAiStatus(`${provider.label} is planning the change...`)
    setAiResult(null)
    setAiPlan(null)
    setAiChangedPaths([])
    setAiLastRequest(request)
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: request,
    }
    setAiMessages((messages) => [
      ...messages,
      userMessage,
      {
        id: `assistant-working-${Date.now()}`,
        role: 'assistant',
        content: `${provider.label} is using ${thinkingProfile.label} thinking: selecting context, planning target files, and drafting a safe plan before touching code...`,
        changes: [],
        phase: 'thinking',
        activitySteps: ['Selecting files', 'Building plan', 'Reviewing risk'],
        status: 'working',
      },
    ])

    try {
      const response = await requestAiCoder(aiSettings, prompt, planOutputTokens)
      const text = response.text
      const parsed = parseAiJson(text)
      const plan = {
        message: parsed.message || `${provider.label} created a plan.`,
        goal: parsed.goal || request,
        plan: Array.isArray(parsed.plan) ? parsed.plan : [],
        filesToRead: Array.isArray(parsed.filesToRead) ? parsed.filesToRead.map(normalizePath).filter(Boolean) : [],
        filesToEdit: Array.isArray(parsed.filesToEdit) ? parsed.filesToEdit.map(normalizePath).filter(Boolean) : [],
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      }
      const actualInputTokens = response.inputTokens || budget.estimatedInputTokens
      const actualOutputTokens =
        response.outputTokens ||
        Math.max(estimateTokens(text), response.totalTokens ? response.totalTokens - actualInputTokens : 1)
      const actualCost = estimateAiCost(aiSettings, actualInputTokens, actualOutputTokens)

      trackAiUsage(actualInputTokens, actualOutputTokens, actualCost)
      setAiPlan(plan)
      setAiMessages((messages) => [
        ...messages.filter((message) => message.status !== 'working'),
        {
          id: `assistant-plan-${Date.now()}`,
          role: 'assistant',
          content: plan.message,
          plan,
          commands: plan.commands,
          usage: {
            inputTokens: actualInputTokens,
            outputTokens: actualOutputTokens,
            estimatedCostUsd: actualCost,
          },
          status: plan.questions.length ? 'questions' : 'planned',
        },
      ])
      setAiStatus(plan.questions.length
        ? 'Plan needs clarification before the agent can safely continue.'
        : `Plan ready. Building ${plan.filesToEdit.length || 'the needed'} file edit(s) now...`)

      if (plan.questions.length) return

      setAiRunPhase('writing')
      setAiStatus(`${provider.label} is writing and applying the planned changes...`)
      setAiMessages((messages) => [
        ...messages,
        {
          id: `assistant-working-${Date.now()}`,
          role: 'assistant',
          content: `${provider.label} is following its plan now: generating edits, validating paths, and applying the patch to the workspace...`,
          changes: [],
          phase: 'writing',
          activitySteps: ['Writing edits', 'Checking file paths', 'Applying patch'],
          status: 'working',
        },
      ])

      const patchContextPaths = Array.from(new Set([
        ...contextPaths,
        ...(plan.filesToRead || []),
        ...(plan.filesToEdit || []),
        activeTab?.path || '',
      ].map(normalizePath).filter(Boolean)))
      const patchFileContents = await readCurrentFileContents(patchContextPaths)
      const patchPrompt = buildAiPatchPrompt({
        userPrompt: request,
        plan,
        activeTab,
        files,
        fileContents: patchFileContents,
        frameworkName,
        projectName,
        thinkingProfile,
      })
      const patchOutputTokens = getAiOutputTokens(aiSettings, 'patch')
      const patchBudget = checkAiBudget(aiSettings, runningUsage, patchPrompt, patchOutputTokens)

      if (patchBudget.blockedMessage) throw new Error(patchBudget.blockedMessage)

      const patchResponse = await requestAiCoder(aiSettings, patchPrompt, patchOutputTokens)
      const patchText = patchResponse.text
      const patchParsed = parseAiJson(patchText)
      const normalizedEdits = normalizeAiEdits(Array.isArray(patchParsed.edits) ? patchParsed.edits : [], plan, files, thinkingProfile)
      const edits = normalizedEdits.edits
      const existingContents = await readCurrentFileContents(edits.map((edit) => edit.path))
      const changeSet = summarizeChangeSet(edits, existingContents)
      const patchInputTokens = patchResponse.inputTokens || patchBudget.estimatedInputTokens
      const patchActualOutputTokens =
        patchResponse.outputTokens ||
        Math.max(estimateTokens(patchText), patchResponse.totalTokens ? patchResponse.totalTokens - patchInputTokens : 1)
      const patchActualCost = estimateAiCost(aiSettings, patchInputTokens, patchActualOutputTokens)
      const patchReview = [
        ...(Array.isArray(patchParsed.changeSummary) ? patchParsed.changeSummary : []),
        ...(Array.isArray(patchParsed.selfReview) ? patchParsed.selfReview : []),
        ...normalizedEdits.rejected.map((item) => `Blocked ${item.path}: ${item.reason}`),
      ]

      trackAiUsage(patchInputTokens, patchActualOutputTokens, patchActualCost)

      if (!edits.length) {
        setAiResult({
          message: patchParsed.message || `${provider.label} did not return any safe edits.`,
          edits: [],
          commands: Array.isArray(patchParsed.commands) ? patchParsed.commands : [],
          changeSet,
          applied: false,
          usage: {
            inputTokens: patchInputTokens,
            outputTokens: patchActualOutputTokens,
            estimatedCostUsd: patchActualCost,
          },
        })
        setAiMessages((messages) => [
          ...messages.filter((message) => message.status !== 'working'),
          {
            id: `assistant-no-edits-${Date.now()}`,
            role: 'assistant',
            content: normalizedEdits.rejected.length
              ? `${patchParsed.message || `${provider.label} generated edits, but none were safe to apply.`} ${normalizedEdits.rejected.length} unsafe edit(s) were blocked.`
              : patchParsed.message || `${provider.label} did not return edits for this request.`,
            changes: [],
            commands: Array.isArray(patchParsed.commands) ? patchParsed.commands : [],
            review: patchReview,
            usage: {
              inputTokens: patchInputTokens,
              outputTokens: patchActualOutputTokens,
              estimatedCostUsd: patchActualCost,
            },
            status: 'error',
          },
        ])
        setAiStatus('No code was changed because the AI did not return safe edits.')
        return
      }

      const appliedCount = await applyAiEditsToWorkspace(edits)
      setAiResult({
        message: patchParsed.message || `${provider.label} applied the planned patch.`,
        edits,
        commands: Array.isArray(patchParsed.commands) ? patchParsed.commands : [],
        changeSet,
        applied: true,
        usage: {
          inputTokens: patchInputTokens,
          outputTokens: patchActualOutputTokens,
          estimatedCostUsd: patchActualCost,
        },
      })
      setAiChangedPaths(changeSet.changes.map((change) => change.path))
      setAiMessages((messages) => [
        ...messages.filter((message) => message.status !== 'working'),
        {
          id: `assistant-applied-${Date.now()}`,
          role: 'assistant',
          content: normalizedEdits.rejected.length
            ? `${patchParsed.message || `${provider.label} applied the planned patch.`} Applied ${appliedCount} file edit(s). ${normalizedEdits.rejected.length} unsafe edit(s) were blocked.`
            : `${patchParsed.message || `${provider.label} applied the planned patch.`} Applied ${appliedCount} file edit(s) to the workspace.`,
          changes: changeSet.changes,
          commands: Array.isArray(patchParsed.commands) ? patchParsed.commands : [],
          review: patchReview,
          usage: {
            inputTokens: patchInputTokens,
            outputTokens: patchActualOutputTokens,
            estimatedCostUsd: patchActualCost,
          },
          status: 'applied',
        },
      ])
      setAiStatus(`Applied ${appliedCount} file edit(s), +${changeSet.added} / -${changeSet.removed} lines.`)
      setOperationStatus(`AI applied ${appliedCount} file edit(s).`)
    } catch (error) {
      setAiStatus(error.message)
      addProblem('AI Agent', error.message)
      setAiMessages((messages) => [
        ...messages.filter((message) => message.status !== 'working'),
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: error.message,
          changes: [],
          status: 'error',
        },
      ])
    } finally {
      setIsAiRunning(false)
      setAiRunPhase('idle')
    }
  }, [
    activeTab,
    addProblem,
    aiPrompt,
    aiSettings,
    aiUsage,
    applyAiEditsToWorkspace,
    frameworkName,
    projectName,
    readCurrentFileContents,
    recordAiUsage,
    tree,
  ])

  const buildAiPlannedPatch = useCallback(async () => {
    if (!aiPlan || !aiLastRequest) {
      setAiStatus('Ask the AI coder to create a plan first.')
      return
    }

    if (aiPlan.questions?.length) {
      setAiStatus('Answer the plan questions before building.')
      return
    }

    const provider = getAiProvider(aiSettings.provider)
    const apiKey = aiSettings.apiKeys?.[aiSettings.provider]?.trim()

    if (!apiKey) {
      setAiStatus(`Open Settings and save a ${provider.label} API key first.`)
      setIsSettingsOpen(true)
      return
    }

    const files = flattenTree(tree)
    const thinkingProfile = getAiThinkingProfile(aiSettings.thinkingLevel)
    const contextPaths = Array.from(new Set([
      ...(aiPlan.filesToRead || []),
      ...(aiPlan.filesToEdit || []),
      activeTab?.path || '',
    ].map(normalizePath).filter(Boolean)))
    const fileContents = await readCurrentFileContents(contextPaths)
    const prompt = buildAiPatchPrompt({
      userPrompt: aiLastRequest,
      plan: aiPlan,
      activeTab,
      files,
      fileContents,
      frameworkName,
      projectName,
      thinkingProfile,
    })
    const estimatedOutputTokens = getAiOutputTokens(aiSettings, 'patch')
    const budget = checkAiBudget(aiSettings, aiUsage, prompt, estimatedOutputTokens)

    if (budget.blockedMessage) {
      setAiStatus(budget.blockedMessage)
      return
    }

    setIsAiRunning(true)
    setAiRunPhase('writing')
    setAiStatus(`${provider.label} is building the planned patch...`)
    setAiResult(null)
    setAiMessages((messages) => [
      ...messages,
      {
        id: `assistant-working-${Date.now()}`,
        role: 'assistant',
        content: `${provider.label} is using ${thinkingProfile.label} thinking to apply the plan, validate paths, and prepare a reviewable patch...`,
        changes: [],
        phase: 'writing',
        activitySteps: ['Drafting edits', 'Validating paths', 'Preparing diff'],
        status: 'working',
      },
    ])

    try {
      const response = await requestAiCoder(aiSettings, prompt, estimatedOutputTokens)
      const text = response.text
      const parsed = parseAiJson(text)
      const normalizedEdits = normalizeAiEdits(Array.isArray(parsed.edits) ? parsed.edits : [], aiPlan, files, thinkingProfile)
      const edits = normalizedEdits.edits
      const existingContents = await readCurrentFileContents(edits.map((edit) => edit.path))
      const changeSet = summarizeChangeSet(edits, existingContents)
      const actualInputTokens = response.inputTokens || budget.estimatedInputTokens
      const actualOutputTokens =
        response.outputTokens ||
        Math.max(estimateTokens(text), response.totalTokens ? response.totalTokens - actualInputTokens : 1)
      const actualCost = estimateAiCost(aiSettings, actualInputTokens, actualOutputTokens)
      const review = [
        ...(Array.isArray(parsed.changeSummary) ? parsed.changeSummary : []),
        ...(Array.isArray(parsed.selfReview) ? parsed.selfReview : []),
        ...normalizedEdits.rejected.map((item) => `Blocked ${item.path}: ${item.reason}`),
      ]

      recordAiUsage(actualInputTokens, actualOutputTokens, actualCost)

      if (!edits.length) {
        setAiResult({
          message: parsed.message || `${provider.label} did not return any safe edits.`,
          edits: [],
          commands: Array.isArray(parsed.commands) ? parsed.commands : [],
          changeSet,
          applied: false,
          usage: {
            inputTokens: actualInputTokens,
            outputTokens: actualOutputTokens,
            estimatedCostUsd: actualCost,
          },
        })
        setAiMessages((messages) => [
          ...messages.filter((message) => message.status !== 'working'),
          {
            id: `assistant-no-edits-${Date.now()}`,
            role: 'assistant',
            content: normalizedEdits.rejected.length
              ? `${parsed.message || `${provider.label} generated edits, but none were safe to apply.`} ${normalizedEdits.rejected.length} unsafe edit(s) were blocked.`
              : parsed.message || `${provider.label} did not return edits for this request.`,
            changes: [],
            commands: Array.isArray(parsed.commands) ? parsed.commands : [],
            review,
            usage: {
              inputTokens: actualInputTokens,
              outputTokens: actualOutputTokens,
              estimatedCostUsd: actualCost,
            },
            status: 'error',
          },
        ])
        setAiStatus('No code was changed because the AI did not return safe edits.')
        return
      }

      const appliedCount = await applyAiEditsToWorkspace(edits)
      setAiResult({
        message: parsed.message || `${provider.label} applied the planned patch.`,
        edits,
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        changeSet,
        applied: true,
        usage: {
          inputTokens: actualInputTokens,
          outputTokens: actualOutputTokens,
          estimatedCostUsd: actualCost,
        },
      })
      setAiChangedPaths(changeSet.changes.map((change) => change.path))
      setAiMessages((messages) => [
        ...messages.filter((message) => message.status !== 'working'),
        {
          id: `assistant-applied-${Date.now()}`,
          role: 'assistant',
          content: normalizedEdits.rejected.length
            ? `${parsed.message || `${provider.label} applied the planned patch.`} Applied ${appliedCount} file edit(s). ${normalizedEdits.rejected.length} unsafe edit(s) were blocked.`
            : `${parsed.message || `${provider.label} applied the planned patch.`} Applied ${appliedCount} file edit(s) to the workspace.`,
          changes: changeSet.changes,
          commands: Array.isArray(parsed.commands) ? parsed.commands : [],
          review,
          usage: {
            inputTokens: actualInputTokens,
            outputTokens: actualOutputTokens,
            estimatedCostUsd: actualCost,
          },
          status: 'applied',
        },
      ])
      setAiStatus(`Applied ${appliedCount} file edit(s), +${changeSet.added} / -${changeSet.removed} lines.`)
      setOperationStatus(`AI applied ${appliedCount} file edit(s).`)
    } catch (error) {
      setAiStatus(error.message)
      addProblem('AI Build', error.message)
      setAiMessages((messages) => [
        ...messages.filter((message) => message.status !== 'working'),
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: error.message,
          changes: [],
          status: 'error',
        },
      ])
    } finally {
      setIsAiRunning(false)
      setAiRunPhase('idle')
    }
  }, [
    activeTab,
    addProblem,
    aiLastRequest,
    aiPlan,
    aiSettings,
    aiUsage,
    applyAiEditsToWorkspace,
    frameworkName,
    projectName,
    readCurrentFileContents,
    recordAiUsage,
    tree,
  ])

  const applyAiEdits = useCallback(async () => {
    if (!aiResult?.edits?.length || aiResult.applied) return

    try {
      const appliedCount = await applyAiEditsToWorkspace(aiResult.edits)
      setAiResult((result) => result ? { ...result, applied: true } : result)
      setAiStatus(`Applied ${appliedCount} AI edit(s).`)
      setOperationStatus(`Applied ${appliedCount} AI edit(s).`)
      setAiMessages((messages) => messages.map((message) => (
        message.status === 'proposed'
          ? { ...message, status: 'applied', content: `${message.content} Applied to the workspace.` }
          : message
      )))
    } catch (error) {
      setAiStatus(`Apply failed: ${error.message}`)
      addProblem('AI Apply', error.message)
    }
  }, [
    addProblem,
    aiResult,
    applyAiEditsToWorkspace,
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
    setIsSettingsOpen(false)

    if (activity === 'explorer') {
      setLayoutMode('agentCode')
      setLayoutSizes((sizes) => ({ ...sizes, explorer: Math.max(sizes.explorer, 250) }))
      explorerPanelRef.current?.focus({ preventScroll: true })
      setOperationStatus('AI coder and files focused.')
      return
    }

    if (activity === 'commands') {
      setLayoutMode('agentCode')
      setBottomPanelTab('commands')
      setLayoutSizes((sizes) => ({ ...sizes, terminal: Math.max(sizes.terminal, 300) }))
      commandSearchRef.current?.focus({ preventScroll: true })
      setOperationStatus('Command deck and terminal focused.')
      return
    }

    setLayoutMode('codePreview')
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
    const activityWidth = shellRect.width <= 1180 ? 44 : 46
    const editorMin = shellRect.width <= 1180 ? 360 : 420
    const previewMin = 320
    const explorerMin = 210
    const handleWidth = 6
    const visiblePreview = layoutMode === 'all' || layoutMode === 'codePreview'
    const visibleExplorer = layoutMode === 'all' || layoutMode === 'agentCode' || layoutMode === 'agentPreview'
    const visibleWorkbench = layoutMode !== 'agentPreview'
    const maxExplorer = visiblePreview
      ? shellRect.width - activityWidth - editorMin - previewMin - handleWidth * 2
      : shellRect.width - activityWidth - editorMin - handleWidth
    const maxPreview = layoutMode === 'all'
      ? shellRect.width - activityWidth - startSizes.explorer - editorMin - handleWidth * 2
      : shellRect.width - activityWidth - editorMin - handleWidth
    const maxTerminal = visibleWorkbench
      ? Math.max(260, shellRect.height - 52 - 170 - handleWidth)
      : 520

    const handlePointerMove = (moveEvent) => {
      setLayoutSizes((currentSizes) => {
        if (panel === 'explorer') {
          return {
            ...currentSizes,
            explorer: visibleExplorer
              ? clamp(startSizes.explorer + moveEvent.clientX - startX, explorerMin, Math.max(explorerMin, maxExplorer))
              : currentSizes.explorer,
          }
        }

        if (panel === 'preview') {
          return {
            ...currentSizes,
            preview: visiblePreview
              ? clamp(startSizes.preview - (moveEvent.clientX - startX), previewMin, Math.max(previewMin, maxPreview))
              : currentSizes.preview,
          }
        }

        return {
          ...currentSizes,
          terminal: clamp(startSizes.terminal - (moveEvent.clientY - startY), 220, maxTerminal),
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
  }, [layoutMode, layoutSizes])

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
    if (tabs.some((tab) => tab.path === path && tab.dirty)) {
      saveAllDirtyTabs({ silent: true }).catch((error) => {
        setOperationStatus(`Could not save before closing ${path}: ${error.message}`)
      })
    }
    setTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tab) => tab.path !== path)
      if (path === activePath) {
        const closedIndex = currentTabs.findIndex((tab) => tab.path === path)
        const nextActive = nextTabs[Math.max(0, closedIndex - 1)] || nextTabs[0]
        setActivePath(nextActive?.path || '')
      }
      return nextTabs
    })
  }, [activePath, saveAllDirtyTabs, tabs])

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
      if (!webcontainer) {
        if (files.length === 0 && !options.allowEmpty) return
        await saveImportedFilesToCloudProject(files, name)
        return
      }
      if (files.length === 0 && !options.allowEmpty) return

      setIsImporting(true)
      setOperationStatus(`Importing ${files.length} files...`)
      stopDevServer()
      terminalApiRef.current = null
      bufferedTerminalOutputRef.current = ''
      setTerminalSessionKey((key) => key + 1)
      let cloudSaveWarning = ''

      try {
        await clearWorkspace(webcontainer)
        await writeUploadedFiles(webcontainer, files)
        setTabs([])
        setActivePath('')
        setSelectedPath('')
        setPreviewUrl('')
        clearStaticPreview()
        setBridgePendingPort(0)
        setPreviewKey((key) => key + 1)
        setProjectName(name)
        await refreshExplorer(webcontainer)
        await detectProjectDetails(webcontainer)

        const firstFile = pickDefaultFile(files)
        if (firstFile) await openFile(firstFile, webcontainer)

        workspaceProjectIdRef.current = activeCloudProjectRef.current?.id || ''

        if (!options.skipCloudSave && activeCloudProjectRef.current?.id) {
          try {
            const activeProject = activeCloudProjectRef.current
            const data = await apiRequest('/api/projects', {
              method: 'POST',
              body: {
                action: 'save',
                id: activeProject.id,
                name,
                files: filesForApi(files),
              },
            })
            const project = projectFromApi(data.project)
            activeCloudProjectRef.current = project
            setActiveCloudProject(project)
            setCloudProjects((projects) => {
              const summary = {
                id: project.id,
                name: project.name,
                fileCount: project.files?.length || 0,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                lastOpenedAt: project.lastOpenedAt,
              }
              return [summary, ...projects.filter((item) => item.id !== project.id)]
            })
            workspaceProjectIdRef.current = project.id
          } catch (error) {
            cloudSaveWarning = ` Cloud save failed: ${error.message}`
            addProblem('Cloud Save', error.message)
          }
        }

        if (!options.skipSnapshot) {
          await saveCurrentSnapshot(webcontainer, name)
        }

        setLayoutMode('all')
        setOperationStatus(`Imported ${name}. Run npm scripts for web apps, or open a .py file and click Run File.${cloudSaveWarning}`)
        writeTerminal(`\r\n\x1b[1;32mImported ${files.length} files into WebContainer.\x1b[0m\r\n`)
      } catch (error) {
        setOperationStatus(`Import failed: ${error.message}`)
        writeTerminal(`\r\nImport failed: ${error.message}\r\n`)
      } finally {
        setIsImporting(false)
      }
    },
    [addProblem, clearStaticPreview, detectProjectDetails, openFile, refreshExplorer, saveCurrentSnapshot, saveImportedFilesToCloudProject, stopDevServer, webcontainer, writeTerminal],
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

  const createCloudProject = useCallback(async () => {
    const name = newProjectName.trim() || 'Untitled Project'
    setProjectHubStatus('Creating project...')

    try {
      const data = await apiRequest('/api/projects', {
        method: 'POST',
        body: { action: 'create', name, files: [] },
      })
      const project = projectFromApi(data.project)
      activeCloudProjectRef.current = project
      workspaceProjectIdRef.current = ''
      setLayoutMode('all')
      setIsSettingsOpen(false)
      loadedCloudProjectIdRef.current = ''
      setActiveCloudProject(project)
      setTree(treeFromFiles(project.files || []))
      setCloudProjects((projects) => [
        {
          id: project.id,
          name: project.name,
          fileCount: project.files?.length || 0,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          lastOpenedAt: project.lastOpenedAt,
        },
        ...projects.filter((item) => item.id !== project.id),
      ])
      setProjectName(project.name)
      setProjectHubStatus('Project created. Starting workspace...')
    } catch (error) {
      setProjectHubStatus(error.message)
    }
  }, [newProjectName])

  const openCloudProject = useCallback(async (projectId) => {
    setProjectHubStatus('Opening project...')

    try {
      const data = await apiRequest(`/api/projects?id=${encodeURIComponent(projectId)}`)
      const project = projectFromApi(data.project)
      loadedCloudProjectIdRef.current = ''
      activeCloudProjectRef.current = project
      workspaceProjectIdRef.current = ''
      setActiveCloudProject(project)
      setTree(treeFromFiles(project.files || []))
      setProjectName(project.name)
      setProjectHubStatus('Project opened. Starting workspace...')
    } catch (error) {
      setProjectHubStatus(error.message)
    }
  }, [])

  useEffect(() => {
    if (!webcontainer || !activeCloudProject || loadedCloudProjectIdRef.current === activeCloudProject.id) return

    loadedCloudProjectIdRef.current = activeCloudProject.id
    importProjectFiles(activeCloudProject.files || [], activeCloudProject.name || 'Cloud Project', {
      skipSnapshot: true,
      skipCloudSave: true,
      allowEmpty: true,
    }).then(() => {
      setOperationStatus(`Opened ${activeCloudProject.name || 'cloud project'}.`)
      setProjectHubStatus('')
    })
  }, [activeCloudProject, importProjectFiles, webcontainer])

  const openLocalFolder = useCallback(async () => {
    if (isImporting) return

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
  }, [importProjectFiles, isImporting])

  const openLocalFiles = useCallback(() => {
    if (isImporting) return
    fileInputRef.current?.click()
  }, [isImporting])

  const loadDemoGame = useCallback(async () => {
    if (isImporting) return
    if (tree.length > 0 && !window.confirm('Load the demo game and replace the current workspace?')) {
      return
    }

    await importProjectFiles(demoGameFiles, 'Neon Runner Demo')
    await openFile('src/main.js', webcontainer)
    setOperationStatus(webcontainer
      ? 'Demo game loaded. Run npm install, then npm run dev.'
      : 'Demo game saved for Cloud Runner. Click Cloud in the preview panel to run it.')
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

  const aiCoderPanel = (
    <section className={`ai-coder-panel left-ai-panel is-active ${isAiRunning ? 'is-running' : ''} phase-${aiRunPhase}`}>
      <div className="ai-header">
        <div>
          <strong>AI Coder</strong>
          <span>{aiUsageSummary.provider.label} / {aiSettings.priceMode === 'free' ? 'Free-tier local tracker' : 'Paid estimate tracker'}</span>
        </div>
        <button type="button" onClick={resetAiUsage}>Reset Usage</button>
      </div>

      <div className={`ai-agent-strip ${isAiRunning ? 'is-running' : ''} phase-${aiRunPhase}`}>
        <div>
          <strong>{aiUsageSummary.model.label}</strong>
          <span>
            {getAiThinkingProfile(aiSettings.thinkingLevel).label} thinking /
            {' '}{aiSettings.apiKeys?.[aiSettings.provider] ? 'Ready to build' : 'API key needed in Settings'}
          </span>
        </div>
        {isAiRunning ? (
          <div className="ai-mini-activity" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <button type="button" onClick={() => setIsSettingsOpen(true)}>Settings</button>
      </div>

      <div className="ai-usage-bar">
        <span>{aiUsageSummary.requestsLeft} req left</span>
        <span>{aiUsageSummary.tokensLeft.toLocaleString()} tokens left</span>
        <span>${aiUsageSummary.estimatedCostUsd.toFixed(4)} spent</span>
      </div>

      <div className="ai-chat-log" ref={aiChatLogRef} aria-live="polite">
        {aiMessages.map((message) => (
          <article
            className={`ai-message is-${message.role} ${message.status ? `is-${message.status}` : ''} ${message.phase ? `phase-${message.phase}` : ''}`}
            key={message.id}
          >
            <p>{message.content}</p>
            {message.status === 'working' ? (
              <AiWorkingAnimation phase={message.phase} steps={message.activitySteps} />
            ) : null}
            {message.plan ? (
              <div className="ai-plan-block">
                <strong>{message.plan.goal}</strong>
                {message.plan.plan?.length ? (
                  <ol>
                    {message.plan.plan.map((step, index) => (
                      <li key={`${step}-${index}`}>{step}</li>
                    ))}
                  </ol>
                ) : null}
                {message.plan.filesToEdit?.length ? (
                  <div className="ai-plan-files">
                    {message.plan.filesToEdit.map((path) => (
                      <button key={path} type="button" onClick={() => openFile(path)}>{path}</button>
                    ))}
                  </div>
                ) : null}
                {message.plan.risks?.length ? (
                  <small>Risks: {message.plan.risks.join('; ')}</small>
                ) : null}
                {message.plan.questions?.length ? (
                  <small>Questions: {message.plan.questions.join('; ')}</small>
                ) : null}
              </div>
            ) : null}
            {message.changes?.length ? (
              <div className="ai-change-list">
                {message.changes.map((change, index) => (
                  <button
                    key={change.path}
                    type="button"
                    title={change.path}
                    style={{ '--index': index }}
                    onClick={() => openFile(change.path)}
                  >
                    <span>{change.path}</span>
                    <small>+{change.added} / -{change.removed} lines</small>
                  </button>
                ))}
              </div>
            ) : null}
            {message.review?.length ? (
              <ul className="ai-review-list">
                {message.review.slice(0, 8).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : null}
            {message.commands?.length ? (
              <div className="ai-command-list">
                {message.commands.map((command) => (
                  <button key={command} type="button" onClick={() => runTerminalCommand(command)}>{command}</button>
                ))}
              </div>
            ) : null}
            {message.usage ? (
              <small>
                {message.usage.inputTokens.toLocaleString()} in / {message.usage.outputTokens.toLocaleString()} out /
                {' '}${message.usage.estimatedCostUsd.toFixed(5)}
              </small>
            ) : null}
          </article>
        ))}
      </div>

      {aiResult?.changeSet?.changes?.length ? (
        <div className="ai-change-summary">
          <strong>{aiResult.changeSet.files} file(s), +{aiResult.changeSet.added} / -{aiResult.changeSet.removed} lines</strong>
          <div className="ai-edit-list">
            {aiResult.changeSet.changes.map((change) => (
              <code key={change.path}>{change.path}</code>
            ))}
          </div>
        </div>
      ) : null}

      <form
        className="ai-compose"
        onSubmit={(event) => {
          event.preventDefault()
          runAiPlan()
        }}
      >
        <textarea
          value={aiPrompt}
          placeholder="Ask the AI agent to build or change something..."
          onChange={(event) => setAiPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <div className="ai-actions">
          <button type="submit" disabled={isAiRunning}>
            {aiRunPhase === 'thinking' ? 'Thinking...' : aiRunPhase === 'writing' ? 'Writing...' : 'Ask Agent'}
          </button>
          <button type="button" disabled={isAiRunning || !aiPlan || aiPlan.questions?.length > 0} onClick={buildAiPlannedPatch}>
            {aiRunPhase === 'writing' ? 'Writing...' : 'Run Plan'}
          </button>
          <button type="button" disabled={!aiResult?.edits?.length || aiResult.applied} onClick={applyAiEdits}>
            {aiResult?.applied ? 'Applied' : 'Apply Changes'}
          </button>
        </div>
      </form>

      <div className="ai-result">
        <p>{aiStatus}</p>
      </div>
    </section>
  )

  const settingsPage = (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-header">
        <div>
          <strong>Settings</strong>
          <span>AI keys, model provider, usage caps, and workspace preferences.</span>
        </div>
        <button type="button" onClick={() => setIsSettingsOpen(false)}>Close</button>
      </div>

      <div className="settings-grid">
        <section className="settings-section">
          <h2>AI Provider</h2>
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
            {aiSettings.provider === 'gemini' ? (
              <div className="provider-help ai-wide">
                <a href={googleAiStudioApiKeyUrl} target="_blank" rel="noreferrer">Get a free Gemini API key</a>
                <span>Opens Google AI Studio. Google says Gemini API keys can be created from AI Studio.</span>
                <a href={googleGeminiApiKeyDocsUrl} target="_blank" rel="noreferrer">Google setup docs</a>
              </div>
            ) : null}
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
            <label className="ai-wide">
              Thinking level
              <select
                value={aiSettings.thinkingLevel}
                onChange={(event) => setAiSettings((settings) => ({ ...settings, thinkingLevel: event.target.value }))}
              >
                {aiThinkingOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label} - {profile.description}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h2>Usage Guardrails</h2>
          <div className="ai-settings-grid">
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
            <label>
              Max output tokens
              <input
                type="number"
                min="256"
                step="128"
                value={aiSettings.maxOutputTokens}
                onChange={(event) => setAiSettings((settings) => ({ ...settings, maxOutputTokens: Number(event.target.value) }))}
              />
            </label>
          </div>
          <div className="ai-usage-bar settings-usage">
            <span>{aiUsageSummary.requestsLeft} req left</span>
            <span>{aiUsageSummary.tokensLeft.toLocaleString()} tokens left</span>
            <span>${aiUsageSummary.estimatedCostUsd.toFixed(4)} spent</span>
          </div>
        </section>

        <section className="settings-section">
          <h2>Workspace</h2>
          <div className="settings-row">
            <label className="toolbar-toggle">
              <input
                type="checkbox"
                checked={autosaveEnabled}
                onChange={(event) => setAutosaveEnabled(event.target.checked)}
              />
              Autosave open files
            </label>
            <select value={theme} onChange={(event) => setTheme(event.target.value)} title="Theme">
              {appThemes.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </section>
  )

  const displayPreviewUrl = previewUrl || cloudRunner.previewUrl || staticPreviewUrl
  const isStaticPreview = Boolean(staticPreviewUrl && !previewUrl)
  const localRuntimeReady = Boolean(webcontainer && !runtimeIssue)
  const preferCloudPreview = Boolean(!localRuntimeReady && runtimeIssue)
  const previewOpensInTab = false
  const cloudDiagnostics = cloudRunner.diagnostics || {}
  const troubleshootRows = [
    ['Status', cloudRunner.status || 'idle'],
    ['Sandbox', cloudRunner.sandboxId || 'not started'],
    ['Preview mode', cloudDiagnostics.mode || (cloudRunner.previewUrl ? 'preview-proxy' : 'not started')],
    ['Preview URL', cloudRunner.previewUrl || 'not available'],
    ['Public preview host', cloudDiagnostics.previewHost || 'not available'],
    ['File source', cloudDiagnostics.fileSource || 'not available'],
    ['Proxy port', cloudDiagnostics.proxyPort || 'not available'],
    ['App port', cloudDiagnostics.targetPort || 'not available'],
    ['Command', cloudDiagnostics.command || 'not started'],
    ['Vite allowed host', cloudDiagnostics.viteAllowedHost || 'not available'],
    ['Runtime', cloudDiagnostics.runtime || 'not available'],
    ['Compile check', cloudDiagnostics.compileCheck || 'not run'],
    ['Preview ready', cloudDiagnostics.previewReady === undefined ? 'not checked' : (cloudDiagnostics.previewReady ? 'yes' : 'still starting')],
    ['Package', cloudDiagnostics.packageName || 'not detected'],
    ['Sample files', cloudDiagnostics.sampleFiles?.length ? cloudDiagnostics.sampleFiles.join(', ') : 'not available'],
    ['Auto repairs', cloudDiagnostics.repairs?.length ? `${cloudDiagnostics.repairs.length} JSX repair(s)` : 'none'],
    ['Repairs saved', cloudDiagnostics.repairs?.length ? (cloudDiagnostics.repairsPersisted ? 'yes' : 'this run only') : 'none'],
  ]

  if (authLoading) {
    return (
      <main className="auth-shell auth-loading-shell">
        <section className="auth-panel">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <div>
              <strong>Web Terminal</strong>
              <small>Checking your session...</small>
            </div>
          </div>
          <div className="auth-loader" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      </main>
    )
  }

  if (!currentUser) {
    return (
      <AuthScreen
        mode={authMode}
        form={authForm}
        error={authError}
        status={authStatus}
        onModeChange={(nextMode) => {
          setAuthMode(nextMode)
          setAuthError('')
          setAuthStatus('')
        }}
        onFormChange={setAuthForm}
        onSubmit={handleAuthSubmit}
      />
    )
  }

  if (!activeCloudProject) {
    return (
      <ProjectHub
        user={currentUser}
        projects={cloudProjects}
        newProjectName={newProjectName}
        status={projectHubStatus}
        onProjectNameChange={setNewProjectName}
        onCreateProject={createCloudProject}
        onOpenProject={openCloudProject}
        onSignOut={handleSignOut}
      />
    )
  }

  return (
    <div
      className={`ide-shell theme-${theme} mobile-activity-${activeActivity} layout-${layoutMode} ${isSettingsOpen ? 'settings-open' : ''}`}
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
          <div className="session-chip" title={`${currentUser.email} - ${activeCloudProject.name}`}>
            <span>{activeCloudProject.name}</span>
            <small>{currentUser.email}</small>
          </div>
          <button
            type="button"
            onClick={returnToProjectHub}
          >
            Projects
          </button>
          <button type="button" onClick={handleSignOut}>Sign Out</button>
          <button type="button" className="primary-action" disabled={isImporting || isInstalling} onClick={openLocalFolder}>
            {isImporting ? 'Importing...' : 'Open Folder'}
          </button>
          <button type="button" disabled={isImporting} onClick={openLocalFiles}>Open Files</button>
          <button type="button" disabled={!webcontainer || !hasSavedProject || isImporting} onClick={restoreSavedProject}>Restore</button>
          <button type="button" disabled={!webcontainer || tree.length === 0} onClick={exportProject}>Export ZIP</button>
          <button type="button" disabled={isImporting} onClick={loadDemoGame}>Demo Game</button>
          <button type="button" disabled={!activeTab} onClick={runActiveFile}>Run File</button>
          <button
            type="button"
            className={`install-action ${isInstalling ? 'is-installing' : ''}`}
            disabled={isInstalling}
            onClick={() => runPackageInstall({ command: 'npm', args: ['install'], label: 'npm install' })}
          >
            {isInstalling ? 'Installing...' : 'Install'}
          </button>
          <button type="button" onClick={() => preferCloudPreview ? startCloudRunner('npm run dev', { openInNewTab: true, useWorkspaceFiles: true }) : webcontainer ? startDevServer(undefined, 'dev') : startCloudRunner('npm run dev', { openInNewTab: true, useWorkspaceFiles: true })}>Run Dev</button>
          <button type="button" onClick={() => preferCloudPreview ? startCloudRunner('npm start', { openInNewTab: true, useWorkspaceFiles: true }) : webcontainer ? startDevServer(undefined, 'start') : startCloudRunner('npm start', { openInNewTab: true, useWorkspaceFiles: true })}>Run Start</button>
          <button type="button" onClick={() => startCloudRunner('', { openInNewTab: true, useWorkspaceFiles: true })}>Cloud Run</button>
          <div className="view-switcher" role="group" aria-label="Visible sections">
            <button
              className={layoutMode === 'agentCode' && !isSettingsOpen ? 'is-active' : ''}
              type="button"
              onClick={() => {
                setLayoutMode('agentCode')
                setIsSettingsOpen(false)
                setActiveActivity('explorer')
              }}
            >
              AI+Code
            </button>
            <button
              className={layoutMode === 'codePreview' && !isSettingsOpen ? 'is-active' : ''}
              type="button"
              onClick={() => {
                setLayoutMode('codePreview')
                setIsSettingsOpen(false)
                setActiveActivity('preview')
              }}
            >
              Code+Preview
            </button>
            <button
              className={layoutMode === 'agentPreview' && !isSettingsOpen ? 'is-active' : ''}
              type="button"
              onClick={() => {
                setLayoutMode('agentPreview')
                setIsSettingsOpen(false)
                setActiveActivity('preview')
              }}
            >
              AI+Preview
            </button>
            <button
              className={layoutMode === 'all' && !isSettingsOpen ? 'is-active' : ''}
              type="button"
              onClick={() => {
                setLayoutMode('all')
                setIsSettingsOpen(false)
                setActiveActivity('preview')
              }}
            >
              All
            </button>
          </div>
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
          <button
            type="button"
            className="settings-gear"
            title="Settings"
            aria-label="Settings"
            onClick={() => setIsSettingsOpen((open) => !open)}
          >
            ⚙
          </button>
        </div>
      </header>

      {popupHelp.visible ? (
        <section className={`popup-permission-banner is-${popupHelp.status}`} role="status" aria-live="polite">
          <div>
            <strong>{popupHelp.status === 'allowed' ? 'Popups Allowed' : 'Allow Popups'}</strong>
            <span>
              {popupHelp.message || 'Cloud previews open in a new tab. If Chrome blocks it, click the popup-blocked icon in the address bar and allow popups for this site.'}
            </span>
          </div>
          <button type="button" onClick={testPopupPermission}>Test Popups</button>
          <button type="button" disabled={!displayPreviewUrl} onClick={openPreviewInNewTab}>Open Preview</button>
          <button type="button" onClick={dismissPopupHelp}>Dismiss</button>
        </section>
      ) : null}

      <aside className="activity-bar" aria-label="Activity">
        <button
          className={`activity-dot ${activeActivity === 'explorer' ? 'is-active' : ''}`}
          type="button"
          title="Show AI and code"
          aria-pressed={activeActivity === 'explorer'}
          onClick={() => focusActivity('explorer')}
        >
          AI
        </button>
        <button
          className={`activity-dot ${activeActivity === 'commands' ? 'is-active' : ''}`}
          type="button"
          title="Show commands and terminal"
          aria-pressed={activeActivity === 'commands'}
          onClick={() => focusActivity('commands')}
        >
          CM
        </button>
        <button
          className={`activity-dot ${activeActivity === 'preview' ? 'is-active' : ''}`}
          type="button"
          title="Show code and preview"
          aria-pressed={activeActivity === 'preview'}
          onClick={() => focusActivity('preview')}
        >
          PV
        </button>
      </aside>

      {settingsPage}

      <aside
        className={`explorer-panel ${activeActivity === 'explorer' ? 'is-activity-active' : ''}`}
        ref={explorerPanelRef}
        tabIndex={-1}
      >
        <div className="panel-header">
          <span>Assistant</span>
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
        {runtimeIssue ? (
          <div className="runtime-alert" role="alert">
            <strong>{runtimeIssue.title}</strong>
            <p>{runtimeIssue.message}</p>
            {runtimeIssue.issues?.length ? (
              <ul>
                {runtimeIssue.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
            <button type="button" onClick={() => window.location.reload()}>
              Reload and retry
            </button>
            <button type="button" onClick={() => startCloudRunner('', { openInNewTab: true, useWorkspaceFiles: true })}>
              Run in Cloud
            </button>
          </div>
        ) : null}
        {aiCoderPanel}
        <div className="file-dock-header">
          <div>
            <strong>Files</strong>
            <span>{projectName}</span>
          </div>
          <div className="file-dock-actions">
            <button type="button" title="Search files" onClick={() => setSearchQuery((query) => (query ? '' : ' '))}>Search</button>
            <button type="button" title="New file" onClick={() => createEntry('file')}>New</button>
            <button type="button" title="New folder" onClick={() => createEntry('directory')}>Folder</button>
            <button type="button" title="Rename" disabled={!selectedPath} onClick={renameEntry}>Rename</button>
            <button type="button" title="Delete" disabled={!selectedPath} onClick={deleteEntry}>Delete</button>
          </div>
        </div>
        {searchQuery ? (
          <div className="project-search compact-search">
            <input
              type="search"
              value={searchQuery.trimStart()}
              placeholder="Search files and text..."
              onChange={(event) => setSearchQuery(event.target.value)}
              autoFocus
            />
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
          </div>
        ) : null}
        <div className="explorer-scroll">
          {tree.length > 0 ? (
            <FileTree
              nodes={tree}
              activePath={activePath}
              changedPaths={aiChangedPaths}
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
              <span>Next: run npm scripts for web apps, or open a Python file and use Run File.</span>
              <button
                type="button"
                className={`install-action ${isInstalling ? 'is-installing' : ''}`}
                disabled={isInstalling}
                onClick={() => runPackageInstall({ command: 'npm', args: ['install'], label: 'npm install' })}
              >
                {isInstalling ? 'Installing...' : 'npm install'}
              </button>
              <button type="button" onClick={runActiveFile} disabled={!activeTab}>Run File</button>
              <button type="button" onClick={() => preferCloudPreview ? startCloudRunner(projectScripts.some((script) => script.command === 'npm run dev') ? 'npm run dev' : 'npm start', { openInNewTab: true, useWorkspaceFiles: true }) : webcontainer ? startDevServer(undefined, projectScripts.some((script) => script.command === 'npm run dev') ? 'dev' : 'start') : startCloudRunner('', { openInNewTab: true, useWorkspaceFiles: true })}>
                Run app
              </button>
              <button type="button" onClick={() => setShowOnboarding(false)}>Dismiss</button>
            </div>
          ) : null}
          <div className="tabs-bar">
            {tabs.length > 0 ? (
              tabs.map((tab) => (
                <button
                  className={[
                    'tab',
                    tab.path === activePath ? 'is-active' : '',
                    aiChangedPaths.includes(tab.path) ? 'is-ai-changed' : '',
                  ].join(' ')}
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
              <button
                className={bottomPanelTab === 'troubleshoot' ? 'is-active' : ''}
                type="button"
                onClick={() => selectBottomPanelTab('troubleshoot')}
              >
                Troubleshoot
              </button>
            </div>
            <div className="terminal-actions">
              <span>{isInstalling ? 'Installing packages' : `Interactive jsh + ${languageStatus}`}</span>
              <button type="button" onClick={() => scrollTerminal('top')}>Top</button>
              <button type="button" onClick={() => scrollTerminal('up')}>Up</button>
              <button type="button" onClick={() => scrollTerminal('down')}>Down</button>
              <button type="button" onClick={() => scrollTerminal('bottom')}>Bottom</button>
              <button type="button" onClick={restartTerminal}>New</button>
              <button type="button" onClick={clearTerminal}>Clear</button>
              <button type="button" onClick={killTerminal}>Kill</button>
            </div>
          </div>
          <div className={`command-shelf ${bottomPanelTab === 'commands' ? 'is-active' : ''}`}>
            <div className="command-header">
              <div>
                <strong>Command Deck</strong>
                <span>{visibleCommands.length} commands and language runners</span>
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
              Windows commands are mapped to WebContainer shell equivalents. Python commands run through a real Pyodide runtime in the browser.
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
          <div className={`troubleshoot-panel ${bottomPanelTab === 'troubleshoot' ? 'is-active' : ''}`}>
            <div className="troubleshoot-header">
              <div>
                <strong>Cloud Runner Troubleshoot</strong>
                <span>Preview requests are routed through a proxy so Vite sees localhost instead of the Vercel sandbox host.</span>
              </div>
              <div>
                <button type="button" onClick={refreshCloudRunnerStatus} disabled={!cloudRunner.sandboxId}>Refresh</button>
                <button type="button" onClick={() => startCloudRunner('', { openInNewTab: true, useWorkspaceFiles: true })} disabled={cloudRunner.status === 'starting'}>Restart Cloud</button>
                <button type="button" onClick={openPreviewInNewTab} disabled={!displayPreviewUrl}>Open Preview</button>
              </div>
            </div>
            <div className="troubleshoot-grid">
              {troubleshootRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <code>{String(value || 'not available')}</code>
                </div>
              ))}
            </div>
            <div className="troubleshoot-log">
              <strong>Runner Logs</strong>
              {cloudDiagnostics.repairs?.length ? (
                <div className="troubleshoot-repairs">
                  {cloudDiagnostics.repairs.map((repair) => (
                    <span key={`${repair.path}-${repair.line || 0}-${repair.message}`}>
                      {repair.path}{repair.line ? `:${repair.line}` : ''}: {repair.message}
                    </span>
                  ))}
                </div>
              ) : null}
              <pre>{cloudRunner.logs || runtimeIssue?.message || 'No Cloud Runner logs yet. Start Cloud Run to collect diagnostics.'}</pre>
            </div>
          </div>
          <div className={`terminal-tab-pane ${bottomPanelTab === 'terminal' ? 'is-active' : ''}`}>
            {webcontainer ? (
              <TerminalPanel
                key={terminalSessionKey}
                webcontainer={webcontainer}
                onReady={handleTerminalReady}
                onOutput={inspectProcessOutput}
                onInterceptCommand={interceptTerminalCommand}
              />
            ) : (
              <div className="cloud-terminal-fallback">
                <div>
                  <strong>Cloud Runner</strong>
                  <span>{cloudRunner.status === 'idle' ? 'Ready to run this project on hosted compute.' : cloudRunner.status}</span>
                </div>
                <pre>{cloudRunner.logs || runtimeIssue?.message || 'The local browser runtime is blocked. Use Cloud Run to execute on Vercel Sandbox and stream the preview back here.'}</pre>
                <form className="cloud-command-form" onSubmit={runCloudCommand}>
                  <input
                    value={cloudCommandDraft}
                    onChange={(event) => setCloudCommandDraft(event.target.value)}
                    placeholder="npm install, npm run build, npm run dev, ls"
                    spellCheck="false"
                  />
                  <button type="submit" disabled={cloudRunner.status === 'starting'}>Run</button>
                </form>
                <div>
                  <button
                    type="button"
                    className={`install-action ${isInstalling ? 'is-installing' : ''}`}
                    disabled={isInstalling}
                    onClick={() => runPackageInstall({ command: 'npm', args: ['install'], label: 'npm install' })}
                  >
                    {isInstalling ? 'Installing...' : 'npm install'}
                  </button>
                  <button type="button" onClick={() => { setCloudCommandDraft('npm run build'); startCloudRunner('npm run build', { useWorkspaceFiles: true }) }}>Build</button>
                  <button type="button" onClick={() => startCloudRunner('npm run dev', { openInNewTab: true, useWorkspaceFiles: true })}>Dev</button>
                  <button type="button" onClick={() => startCloudRunner('', { openInNewTab: true, useWorkspaceFiles: true })}>Cloud Run</button>
                  <button type="button" disabled={!cloudRunner.sandboxId} onClick={() => stopCloudRunner()}>Stop Cloud</button>
                </div>
              </div>
            )}
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
          <div>
            <strong>Preview</strong>
            <span>{devStatus}</span>
          </div>
          <div className="preview-actions">
            <button type="button" title={preferCloudPreview ? 'Run npm run dev in Cloud Runner and open the preview tab' : 'Run npm run dev'} onClick={() => preferCloudPreview ? startCloudRunner('npm run dev', { openInNewTab: true, useWorkspaceFiles: true }) : webcontainer ? startDevServer(undefined, 'dev') : startCloudRunner('npm run dev', { openInNewTab: true, useWorkspaceFiles: true })}>Dev</button>
            <button type="button" title={preferCloudPreview ? 'Run npm start in Cloud Runner and open the preview tab' : 'Run npm run start'} onClick={() => preferCloudPreview ? startCloudRunner('npm start', { openInNewTab: true, useWorkspaceFiles: true }) : webcontainer ? startDevServer(undefined, 'start') : startCloudRunner('npm start', { openInNewTab: true, useWorkspaceFiles: true })}>Start</button>
            <button type="button" title="Run on Vercel Sandbox for locked Chromebooks" onClick={() => startCloudRunner('', { openInNewTab: true, useWorkspaceFiles: true })}>Cloud</button>
            <button type="button" title="Stop dev server" onClick={() => { stopDevServer(); stopCloudRunner() }}>Stop</button>
            <button type="button" title="Retry the real WebContainer preview bridge" disabled={!webcontainer} onClick={retryPreviewBridge}>Repair</button>
            <button type="button" title="Open preview in a new tab" disabled={!displayPreviewUrl} onClick={openPreviewInNewTab}>Open</button>
            <button type="button" title="Reload preview" onClick={() => setPreviewKey((key) => key + 1)}>Reload</button>
          </div>
        </div>
        <div className="preview-frame-wrap is-active">
          {displayPreviewUrl && previewOpensInTab ? (
            <div className="preview-tab-launcher">
              <strong>Preview opened in a new tab</strong>
              <span>{previewStatus || 'Your project is running in its own browser tab.'}</span>
              <button type="button" onClick={openPreviewInNewTab}>Open Preview Tab</button>
              <code title={displayPreviewUrl}>{displayPreviewUrl}</code>
            </div>
          ) : displayPreviewUrl ? (
            <>
              <iframe
                key={previewKey}
                ref={previewIframeRef}
                title={isStaticPreview ? 'Static fallback preview' : 'On-page project preview'}
                src={displayPreviewUrl}
                allow="cross-origin-isolated; clipboard-read; clipboard-write"
                sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts"
                onLoad={() => setPreviewStatus(isStaticPreview ? 'Static preview loaded on this page.' : 'Preview loaded on this page.')}
                onError={() => setPreviewStatus('Preview could not load on this page. Try Cloud or Open.')}
              />
              <div className="preview-live-bar">
                <span>{previewStatus}</span>
                <button
                  type="button"
                  title="Open the running project in a separate tab"
                  onClick={openPreviewInNewTab}
                >
                  Open tab
                </button>
              </div>
            </>
          ) : (
            <div className="preview-placeholder">
              <span>{previewStatus || 'Waiting for a dev server. Try npm run dev, npm start, or run a Python file in the terminal panel.'}</span>
              {bridgePendingPort ? (
                <button type="button" onClick={() => preferCloudPreview ? startCloudRunner('npm run dev', { openInNewTab: true, useWorkspaceFiles: true }) : webcontainer ? startDevServer(undefined, 'dev') : startCloudRunner('npm run dev', { openInNewTab: true, useWorkspaceFiles: true })}>Restart managed dev server</button>
              ) : null}
              <button type="button" disabled={!webcontainer} onClick={retryPreviewBridge}>Repair preview bridge</button>
            </div>
          )}
        </div>
        <div className="status-strip" title={operationStatus || bootStatus}>
          {operationStatus || 'Commands run through WebContainer, with Python handled by the browser runtime.'}
        </div>
      </aside>
    </div>
  )
}
