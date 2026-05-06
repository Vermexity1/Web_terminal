import { Sandbox } from '@vercel/sandbox'
import {
  getSessionUser,
  json,
  readJsonBody,
  sanitizeFiles,
} from './_store.js'

const defaultPort = 5173
const defaultTimeoutMs = 30 * 60 * 1000
const appRoot = '/vercel/sandbox'

async function requireUser(req) {
  const { user } = await getSessionUser(req)
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  return user
}

function fileContent(file) {
  if (file.encoding === 'base64') return Buffer.from(file.data || '', 'base64')
  return Buffer.from(String(file.data || ''), 'utf8')
}

function directoryPaths(files) {
  const paths = new Set()
  files.forEach((file) => {
    const parts = String(file.path || '').split('/').filter(Boolean)
    parts.pop()
    let current = ''
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part
      paths.add(current)
    })
  })
  return [...paths].sort((a, b) => a.split('/').length - b.split('/').length)
}

function packageJsonFromFiles(files) {
  const packageFile = files.find((file) => file.path === 'package.json')
  if (!packageFile) return null

  try {
    return JSON.parse(fileContent(packageFile).toString('utf8'))
  } catch {
    return null
  }
}

function hasScript(packageJson, script) {
  return Boolean(packageJson?.scripts?.[script])
}

function firstPythonFile(files) {
  const preferred = ['main.py', 'app.py', 'server.py']
  return preferred.find((path) => files.some((file) => file.path === path))
    || files.find((file) => file.path.endsWith('.py'))?.path
    || ''
}

function defaultCommand(files, requestedCommand, port) {
  if (requestedCommand) return String(requestedCommand)
  const packageJson = packageJsonFromFiles(files)
  if (hasScript(packageJson, 'dev')) return `npm run dev -- --host 0.0.0.0 --port ${port}`
  if (hasScript(packageJson, 'start')) return `npm run start -- --host 0.0.0.0 --port ${port}`
  const pythonFile = firstPythonFile(files)
  if (pythonFile) return `python3 ${JSON.stringify(pythonFile)}`
  return `npx vite --host 0.0.0.0 --port ${port}`
}

function commandUsesPython(command = '') {
  return /^\s*(python|python3|pip|pip3)\b/i.test(command)
}

function chooseRuntime(files, requestedCommand) {
  if (commandUsesPython(requestedCommand)) return 'python3.13'
  if (!packageJsonFromFiles(files) && files.some((file) => file.path.endsWith('.py'))) return 'python3.13'
  return 'node24'
}

function isInstallCommand(command = '') {
  return /^\s*(npm\s+(install|i)|pnpm\s+(install|i)|yarn\s+(install|add))\b/i.test(command)
}

function isServerCommand(command = '', requestedCommand = '') {
  if (!requestedCommand) return true
  return /^\s*(npm\s+(run\s+)?(dev|start)|npm\s+start|pnpm\s+(dev|start)|yarn\s+(dev|start)|npx\s+vite|vite|next\s+dev|react-scripts\s+start|python3?\s+-m\s+http\.server|flask\s+run|uvicorn\b|streamlit\s+run)\b/i
    .test(command)
}

function previewHost(sandbox, port) {
  try {
    return new URL(sandbox.domain(port)).hostname
  } catch {
    return ''
  }
}

function runnerEnv(sandbox, port) {
  const host = previewHost(sandbox, port)
  return {
    NODE_ENV: 'development',
    HOST: '0.0.0.0',
    PORT: String(port),
    ...(host ? { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: host } : {}),
  }
}

async function commandOutput(result) {
  const [stdout, stderr] = await Promise.all([
    result.stdout().catch(() => ''),
    result.stderr().catch(() => ''),
  ])
  return `${stdout || ''}${stderr || ''}`
}

async function startRunner(body) {
  const files = sanitizeFiles(body.files || [])
  if (files.length === 0) throw Object.assign(new Error('Cloud Runner needs saved project files.'), { status: 400 })

  const port = Number(body.port) || defaultPort
  const timeout = Math.max(5 * 60 * 1000, Math.min(Number(body.timeoutMs) || defaultTimeoutMs, 45 * 60 * 1000))
  const requestedCommand = String(body.command || '').trim()
  const command = defaultCommand(files, requestedCommand, port)
  const serverCommand = isServerCommand(command, requestedCommand)
  const sandbox = await Sandbox.create({
    runtime: body.runtime || chooseRuntime(files, requestedCommand),
    ports: [port],
    timeout,
    resources: { vcpus: 2 },
    env: {
      CI: '1',
      HOST: '0.0.0.0',
      PORT: String(port),
    },
  })

  const logs = [`Cloud sandbox ${sandbox.sandboxId} created.`]

  for (const dir of directoryPaths(files)) {
    await sandbox.mkDir(dir).catch(() => {})
  }

  await sandbox.writeFiles(files.map((file) => ({
    path: file.path,
    content: fileContent(file),
  })))
  logs.push(`Uploaded ${files.length} project files.`)

  if (body.install !== false && files.some((file) => file.path === 'package.json') && !isInstallCommand(command)) {
    logs.push('$ npm install')
    const install = await sandbox.runCommand({
      cmd: 'npm',
      args: ['install'],
      cwd: appRoot,
      env: { NODE_ENV: 'development' },
    })
    logs.push(await commandOutput(install))
    if (install.exitCode !== 0) {
      await sandbox.stop({ blocking: false }).catch(() => {})
      throw Object.assign(new Error('npm install failed in the cloud sandbox.'), {
        status: 500,
        details: logs.join('\n'),
      })
    }
  }

  logs.push(`$ ${command}`)

  if (!serverCommand) {
    const result = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', command],
      cwd: appRoot,
      env: runnerEnv(sandbox, port),
    })
    logs.push(await commandOutput(result))
    logs.push(`Command exited with code ${result.exitCode}.`)
    await sandbox.stop({ blocking: false }).catch(() => {})

    if (result.exitCode !== 0) {
      throw Object.assign(new Error('Cloud command failed.'), {
        status: 500,
        details: logs.join('\n'),
      })
    }

    return {
      sandboxId: sandbox.sandboxId,
      commandId: result.cmdId,
      status: 'finished',
      port,
      previewUrl: '',
      logs: logs.join('\n'),
    }
  }

  const process = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', command],
    cwd: appRoot,
    detached: true,
    env: runnerEnv(sandbox, port),
  })

  return {
    sandboxId: sandbox.sandboxId,
    commandId: process.cmdId,
    status: sandbox.status,
    port,
    previewUrl: sandbox.domain(port),
    logs: logs.join('\n'),
  }
}

async function stopRunner(body) {
  const sandboxId = String(body.sandboxId || '')
  if (!sandboxId) throw Object.assign(new Error('Missing sandbox id.'), { status: 400 })
  const sandbox = await Sandbox.get({ sandboxId })
  const stopped = await sandbox.stop({ blocking: false })
  return { sandboxId, status: stopped.status || 'stopping' }
}

async function runnerStatus(req) {
  const params = new URL(req.url, 'http://localhost').searchParams
  const sandboxId = params.get('sandboxId')
  const commandId = params.get('commandId')
  if (!sandboxId) throw Object.assign(new Error('Missing sandbox id.'), { status: 400 })

  const sandbox = await Sandbox.get({ sandboxId })
  let logs = ''
  if (commandId) {
    let timer = null
    try {
      const command = await sandbox.getCommand(commandId)
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), 1200)
      logs = await command.output('both', { signal: controller.signal })
    } catch {
      logs = ''
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return {
    sandboxId,
    commandId,
    status: sandbox.status,
    logs,
  }
}

export default async function handler(req, res) {
  try {
    await requireUser(req)

    if (req.method === 'GET') {
      json(res, 200, await runnerStatus(req))
      return
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' })
      return
    }

    const body = await readJsonBody(req)
    const action = body.action || 'start'

    if (action === 'start') {
      json(res, 200, await startRunner(body))
      return
    }

    if (action === 'stop') {
      json(res, 200, await stopRunner(body))
      return
    }

    json(res, 400, { error: 'Unknown cloud runner action.' })
  } catch (error) {
    json(res, error.status || 500, {
      error: error.message || 'Cloud runner failed.',
      details: error.details || '',
    })
  }
}
