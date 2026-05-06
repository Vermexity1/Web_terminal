import { Sandbox } from '@vercel/sandbox'
import {
  getSessionUser,
  json,
  readJsonBody,
  sanitizeFiles,
} from './_store.js'

const defaultPort = 5173
const defaultProxyPort = 4173
const defaultTimeoutMs = 30 * 60 * 1000
const appRoot = '/vercel/sandbox'
const previewProxyPath = '.runable-preview-proxy.mjs'

const previewProxySource = `
import http from 'node:http'
import net from 'node:net'

const targetHost = '127.0.0.1'
const targetPort = Number(process.env.RUNABLE_TARGET_PORT || 5173)
const proxyPort = Number(process.env.RUNABLE_PROXY_PORT || 4173)

function targetHeaders(headers) {
  const next = { ...headers, host: 'localhost:' + targetPort }
  if (next.origin) next.origin = 'http://localhost:' + targetPort
  return next
}

function waitingPage(message) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2"><title>Starting preview</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#dbeafe;font:14px system-ui,sans-serif}.box{max-width:520px;padding:24px;border:1px solid #1d4ed8;border-radius:10px;background:#08111f}strong{display:block;margin-bottom:8px;color:white}</style></head><body><div class="box"><strong>Starting preview...</strong><span>' + message.replace(/[<>&]/g, '') + '</span></div></body></html>'
}

const server = http.createServer((req, res) => {
  const proxyReq = http.request({
    hostname: targetHost,
    port: targetPort,
    method: req.method,
    path: req.url,
    headers: targetHeaders(req.headers),
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers)
    proxyRes.pipe(res)
  })

  proxyReq.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(waitingPage(error.message || 'Waiting for the app server.'))
  })

  req.pipe(proxyReq)
})

server.on('upgrade', (req, socket, head) => {
  const target = net.connect(targetPort, targetHost, () => {
    const headers = targetHeaders(req.headers)
    target.write(req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\\r\\n')
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const item of value) target.write(key + ': ' + item + '\\r\\n')
      } else if (value !== undefined) {
        target.write(key + ': ' + value + '\\r\\n')
      }
    }
    target.write('\\r\\n')
    if (head?.length) target.write(head)
    target.pipe(socket)
    socket.pipe(target)
  })

  target.on('error', () => socket.destroy())
})

server.listen(proxyPort, '0.0.0.0', () => {
  console.log('Runable preview proxy listening on ' + proxyPort + ' -> ' + targetPort)
})
`

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

function viteAllowedHost(sandbox, port) {
  const host = previewHost(sandbox, port)
  if (!host) return '.vercel.run'
  if (host === 'vercel.run' || host.endsWith('.vercel.run')) return '.vercel.run'
  return host
}

function runnerEnv(sandbox, previewPort, targetPort = previewPort) {
  const host = viteAllowedHost(sandbox, previewPort)
  return {
    NODE_ENV: 'development',
    HOST: '0.0.0.0',
    PORT: String(targetPort),
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: host,
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function commandWithRunnerEnv(command, sandbox, previewPort, targetPort = previewPort) {
  const env = runnerEnv(sandbox, previewPort, targetPort)
  const exports = Object.entries(env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('; ')
  return `${exports}; ${command}`
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

  const targetPort = Number(body.port) || defaultPort
  const requestedProxyPort = Number(body.proxyPort) || defaultProxyPort
  const proxyPort = requestedProxyPort === targetPort ? targetPort + 1 : requestedProxyPort
  const timeout = Math.max(5 * 60 * 1000, Math.min(Number(body.timeoutMs) || defaultTimeoutMs, 45 * 60 * 1000))
  const requestedCommand = String(body.command || '').trim()
  const command = defaultCommand(files, requestedCommand, targetPort)
  const serverCommand = isServerCommand(command, requestedCommand)
  const sandbox = await Sandbox.create({
    runtime: body.runtime || chooseRuntime(files, requestedCommand),
    ports: [proxyPort],
    timeout,
    resources: { vcpus: 2 },
    env: {
      CI: '1',
      HOST: '0.0.0.0',
      PORT: String(targetPort),
    },
  })

  const logs = [`Cloud sandbox ${sandbox.sandboxId} created.`]
  const diagnostics = {
    mode: serverCommand ? 'preview-proxy' : 'command',
    sandboxId: sandbox.sandboxId,
    runtime: body.runtime || chooseRuntime(files, requestedCommand),
    command,
    requestedCommand,
    targetPort,
    proxyPort,
    previewUrl: serverCommand ? sandbox.domain(proxyPort) : '',
    previewHost: serverCommand ? previewHost(sandbox, proxyPort) : '',
    viteAllowedHost: serverCommand ? viteAllowedHost(sandbox, proxyPort) : '',
  }

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

  let proxyCommandId = ''
  if (serverCommand) {
    await sandbox.writeFiles([{
      path: previewProxyPath,
      content: Buffer.from(previewProxySource),
    }])
    const proxy = await sandbox.runCommand({
      cmd: 'node',
      args: [previewProxyPath],
      cwd: appRoot,
      detached: true,
      env: {
        RUNABLE_TARGET_PORT: String(targetPort),
        RUNABLE_PROXY_PORT: String(proxyPort),
      },
    })
    proxyCommandId = proxy.cmdId || ''
    diagnostics.proxyCommandId = proxyCommandId
    logs.push(`Preview proxy: public port ${proxyPort} -> app port ${targetPort}.`)
  }

  logs.push(`Allowed Vite preview host: ${viteAllowedHost(sandbox, proxyPort)}`)
  logs.push(`$ ${command}`)

  if (!serverCommand) {
    const result = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', commandWithRunnerEnv(command, sandbox, proxyPort, targetPort)],
      cwd: appRoot,
      env: runnerEnv(sandbox, proxyPort, targetPort),
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
      port: targetPort,
      targetPort,
      proxyPort: 0,
      previewUrl: '',
      logs: logs.join('\n'),
      diagnostics,
    }
  }

  const process = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', commandWithRunnerEnv(command, sandbox, proxyPort, targetPort)],
    cwd: appRoot,
    detached: true,
    env: runnerEnv(sandbox, proxyPort, targetPort),
  })

  diagnostics.commandId = process.cmdId

  return {
    sandboxId: sandbox.sandboxId,
    commandId: process.cmdId,
    proxyCommandId,
    status: sandbox.status,
    port: proxyPort,
    targetPort,
    proxyPort,
    previewUrl: sandbox.domain(proxyPort),
    logs: logs.join('\n'),
    diagnostics,
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
