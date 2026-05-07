#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const runnerVersion = '0.1.0'
const defaultPollMs = 2500
const configDir = path.join(os.homedir(), '.runable-runner')
const configPath = path.join(configDir, 'config.json')
const workspaceRoot = path.join(configDir, 'workspaces')

function parseArgs(argv) {
  const args = {}
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = next
    index += 1
  }
  return args
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeServerUrl(url) {
  return String(url || '').replace(/\/+$/, '')
}

function shellParts(command) {
  if (process.platform === 'win32') return { cmd: 'cmd.exe', args: ['/d', '/s', '/c', command] }
  return { cmd: 'bash', args: ['-lc', command] }
}

function safeJoin(root, filePath) {
  const safePath = String(filePath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (!safePath || safePath.includes('..')) return ''
  const resolved = path.resolve(root, safePath)
  const resolvedRoot = path.resolve(root)
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) return ''
  return resolved
}

function decodeFile(file) {
  return file.encoding === 'base64'
    ? Buffer.from(String(file.data || ''), 'base64')
    : Buffer.from(String(file.data || ''), 'utf-8')
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath, 'utf-8'))
  } catch {
    return {}
  }
}

async function writeConfig(config) {
  await mkdir(configDir, { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2))
}

async function apiRequest(serverUrl, token, body) {
  const response = await fetch(`${serverUrl}/api/personal-runner`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Runner API failed (${response.status})`)
  return data
}

async function registerRunner(serverUrl, pairingToken, name) {
  const result = await apiRequest(serverUrl, pairingToken, {
    action: 'register',
    pairingToken,
    name,
    version: runnerVersion,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    nodeVersion: process.version,
  })
  await writeConfig({
    serverUrl,
    runnerToken: result.runnerToken,
    runnerId: result.runner?.id || '',
    name: result.runner?.name || name,
  })
  return result.runnerToken
}

async function writeJobFiles(workspace, files) {
  await rm(workspace, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })
  for (const file of files || []) {
    const target = safeJoin(workspace, file.path)
    if (!target) continue
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, decodeFile(file))
  }
}

function fileExists(workspace, filePath) {
  const target = safeJoin(workspace, filePath)
  return target ? existsSync(target) : false
}

function commandNeedsInstall(command) {
  return !/^\s*(npm\s+(install|i|ci)|pnpm\s+(install|i)|yarn\s+(install|add))\b/i.test(String(command || ''))
}

function parseTunnelUrl(text) {
  return String(text || '').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0]
    || String(text || '').match(/https:\/\/[^\s"'<>]+\.loca\.lt\b/i)?.[0]
    || ''
}

function spawnProcess(cmd, args, options = {}) {
  return spawn(cmd, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

async function launchTunnelAttempt(label, command, port, onLog, onPreviewUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const shell = shellParts(command)
    const child = spawnProcess(shell.cmd, shell.args)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`${label} did not provide a public URL in time.`))
    }, timeoutMs)

    const handleData = (chunk) => {
      const text = chunk.toString()
      onLog(text)
      const url = parseTunnelUrl(text)
      if (url && !settled) {
        settled = true
        clearTimeout(timer)
        onPreviewUrl(url)
        resolve(child)
      }
    }

    child.stdout.on('data', handleData)
    child.stderr.on('data', handleData)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`${label} exited before opening a tunnel (code ${code}).`))
    })

    onLog(`Starting ${label} tunnel for http://localhost:${port}\n`)
  })
}

async function startTunnel(port, onLog, onPreviewUrl) {
  const attempts = [
    {
      label: 'cloudflared',
      command: `cloudflared tunnel --url http://localhost:${port} --no-autoupdate`,
      timeoutMs: 18000,
    },
    {
      label: 'localtunnel',
      command: `npx --yes localtunnel --port ${port}`,
      timeoutMs: 35000,
    },
  ]

  for (const attempt of attempts) {
    try {
      return await launchTunnelAttempt(
        attempt.label,
        attempt.command,
        port,
        onLog,
        onPreviewUrl,
        attempt.timeoutMs,
      )
    } catch (error) {
      onLog(`${attempt.label} tunnel failed: ${error.message}\n`)
    }
  }

  onLog('No public tunnel opened. Install cloudflared for best results: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n')
  return null
}

function runShell(command, cwd, onLog) {
  const shell = shellParts(command)
  const child = spawnProcess(shell.cmd, shell.args, { cwd, env: { ...process.env, PORT: process.env.PORT || '5173' } })
  child.stdout.on('data', (chunk) => onLog(chunk.toString()))
  child.stderr.on('data', (chunk) => onLog(chunk.toString()))
  return child
}

async function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(typeof code === 'number' ? code : 1))
    child.on('error', () => resolve(1))
  })
}

async function runPersonalJob(serverUrl, runnerToken, job, state) {
  const workspace = safeJoin(workspaceRoot, job.projectId || job.id)
  if (!workspace) throw new Error('Could not create a safe workspace path.')

  let pendingLogs = ''
  let lastFlush = 0
  let mainProcess = null
  let tunnelProcess = null

  const postStatus = async (status, extra = {}) => {
    const logs = pendingLogs
    pendingLogs = ''
    lastFlush = Date.now()
    await apiRequest(serverUrl, runnerToken, {
      action: 'jobStatus',
      jobId: job.id,
      status,
      logs,
      ...extra,
    }).catch((error) => {
      console.error(`Could not update job status: ${error.message}`)
    })
  }

  const onLog = (text) => {
    pendingLogs += text
    process.stdout.write(text)
    if (Date.now() - lastFlush > 1400) {
      postStatus('running').catch(() => {})
    }
  }

  state.stopCurrentJob = async () => {
    onLog('\nStop requested. Killing job processes...\n')
    mainProcess?.kill()
    tunnelProcess?.kill()
    await postStatus('stopped')
  }

  try {
    await postStatus('running', { startedAt: Date.now() })
    onLog(`\nPreparing workspace: ${workspace}\n`)
    await writeJobFiles(workspace, job.files || [])
    onLog(`Wrote ${(job.files || []).length} files.\n`)

    if (job.install && fileExists(workspace, 'package.json') && commandNeedsInstall(job.command)) {
      await postStatus('installing')
      onLog('\n$ npm install\n')
      const installProcess = runShell('npm install', workspace, onLog)
      mainProcess = installProcess
      const installCode = await waitForExit(installProcess)
      mainProcess = null
      onLog(`npm install exited with code ${installCode}.\n`)
      if (installCode !== 0) {
        await postStatus('error', { exitCode: installCode, error: 'npm install failed.' })
        return
      }
    }

    if (job.expectsPreview) {
      tunnelProcess = await startTunnel(Number(job.port) || 5173, onLog, (url) => {
        onLog(`Public preview URL: ${url}\n`)
        postStatus('running', { previewUrl: url }).catch(() => {})
      })
    }

    onLog(`\n$ ${job.command}\n`)
    mainProcess = runShell(job.command, workspace, onLog)
    const exitCode = await waitForExit(mainProcess)
    mainProcess = null
    tunnelProcess?.kill()
    tunnelProcess = null
    onLog(`Command exited with code ${exitCode}.\n`)
    await postStatus(exitCode === 0 ? 'finished' : 'error', {
      exitCode,
      error: exitCode === 0 ? '' : `Command exited with code ${exitCode}.`,
    })
  } catch (error) {
    mainProcess?.kill()
    tunnelProcess?.kill()
    pendingLogs += `\nRunner error: ${error.message}\n`
    await postStatus('error', { error: error.message })
  } finally {
    state.stopCurrentJob = null
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const saved = await readConfig()
  const serverUrl = normalizeServerUrl(args.server || saved.serverUrl)
  const suppliedToken = args.token || ''
  const name = args.name || saved.name || `${os.hostname()} Personal Runner`

  if (!serverUrl || (!suppliedToken && !saved.runnerToken)) {
    console.log('Runable Personal Runner')
    console.log('')
    console.log('Usage:')
    console.log('  node personal-runner.mjs --server https://your-site.vercel.app --token PAIRING_TOKEN')
    console.log('')
    console.log('Create a pairing token from the Personal Runner tab in the website.')
    process.exit(1)
  }

  await mkdir(workspaceRoot, { recursive: true })

  let runnerToken = saved.runnerToken || suppliedToken
  if (suppliedToken.startsWith('pr_')) {
    console.log('Pairing this device...')
    runnerToken = await registerRunner(serverUrl, suppliedToken, name)
    console.log(`Paired as ${name}. Runner token saved to ${configPath}`)
  }

  console.log(`Runable Personal Runner ${runnerVersion}`)
  console.log(`Server: ${serverUrl}`)
  console.log(`Device: ${name}`)
  console.log('Keep this window open while using the Chromebook site.')
  console.log('Warning: only run projects you trust on your own computer.')

  const state = { currentJobId: '', stopCurrentJob: null }

  for (;;) {
    try {
      const result = await apiRequest(serverUrl, runnerToken, {
        action: 'heartbeat',
        status: state.currentJobId ? 'busy' : 'online',
        version: runnerVersion,
        platform: `${os.type()} ${os.release()} ${os.arch()}`,
        nodeVersion: process.version,
      })

      if (state.currentJobId && result.cancelJobIds?.includes(state.currentJobId)) {
        await state.stopCurrentJob?.()
        state.currentJobId = ''
      }

      if (!state.currentJobId && result.job) {
        state.currentJobId = result.job.id
        console.log(`\nAccepted job ${result.job.id}: ${result.job.command}`)
        runPersonalJob(serverUrl, runnerToken, result.job, state)
          .finally(() => {
            state.currentJobId = ''
          })
      }
    } catch (error) {
      console.error(`Runner connection error: ${error.message}`)
      if (/token|Unauthorized/i.test(error.message)) {
        console.error(`Delete ${configPath} and pair again if this keeps happening.`)
      }
    }

    await sleep(defaultPollMs)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
