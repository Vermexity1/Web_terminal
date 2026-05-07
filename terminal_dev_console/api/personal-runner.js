import { randomBytes } from 'node:crypto'
import {
  getSessionUser,
  hashSessionToken,
  json,
  newId,
  readJsonBody,
  sanitizeFiles,
  updateStore,
} from './_store.js'

const pairingTtlMs = 30 * 60 * 1000
const runnerOnlineMs = 45 * 1000
const maxJobLogLength = 90000
const defaultPersonalRunnerPort = 5173

function ensurePersonalRunnerStore(store) {
  store.personalRunnerPairings ||= {}
  store.personalRunners ||= {}
  store.personalRunnerJobs ||= {}
}

function nowIso() {
  return new Date().toISOString()
}

function requestOrigin(req) {
  const protocol = req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5173'
  return `${protocol}://${host}`
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

async function requireUser(req) {
  const { user } = await getSessionUser(req)
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  return user
}

function publicRunner(runner) {
  if (!runner) return null
  const online = Date.now() - Number(runner.lastSeenAt || 0) < runnerOnlineMs
  return {
    id: runner.id,
    name: runner.name,
    status: online ? (runner.status || 'online') : 'offline',
    lastSeenAt: runner.lastSeenAt || 0,
    createdAt: runner.createdAt || 0,
    version: runner.version || '',
    platform: runner.platform || '',
    nodeVersion: runner.nodeVersion || '',
    currentJobId: runner.currentJobId || '',
    previewUrl: runner.previewUrl || '',
  }
}

function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    runnerId: job.runnerId || '',
    projectId: job.projectId || '',
    projectName: job.projectName || '',
    command: job.command || '',
    status: job.status || 'queued',
    previewUrl: job.previewUrl || '',
    port: job.port || defaultPersonalRunnerPort,
    expectsPreview: Boolean(job.expectsPreview),
    exitCode: typeof job.exitCode === 'number' ? job.exitCode : null,
    error: job.error || '',
    logs: job.logs || '',
    createdAt: job.createdAt || 0,
    updatedAt: job.updatedAt || 0,
    startedAt: job.startedAt || 0,
    finishedAt: job.finishedAt || 0,
  }
}

function cleanupPersonalRunnerStore(store) {
  ensurePersonalRunnerStore(store)
  const now = Date.now()

  for (const [hash, pairing] of Object.entries(store.personalRunnerPairings)) {
    if (!pairing?.expiresAt || pairing.expiresAt < now || pairing.claimedAt) {
      delete store.personalRunnerPairings[hash]
    }
  }

  for (const [jobId, job] of Object.entries(store.personalRunnerJobs)) {
    const age = now - Number(job.updatedAt || job.createdAt || 0)
    if (age > 1000 * 60 * 60 * 24 * 2) delete store.personalRunnerJobs[jobId]
  }
}

function findRunnerByToken(store, token) {
  if (!token) return null
  const tokenHash = hashSessionToken(token)
  return Object.values(store.personalRunners || {}).find((runner) => runner.tokenHash === tokenHash) || null
}

function commandExpectsPreview(command = '') {
  const normalized = String(command || '').trim()
  if (!normalized) return true
  return /^\s*(npm\s+(run\s+)?(dev|start)|npm\s+start|pnpm\s+(dev|start)|yarn\s+(dev|start)|npx\s+vite|vite|next\s+dev|react-scripts\s+start|python3?\s+-m\s+http\.server|flask\s+run|uvicorn\b|streamlit\s+run)\b/i
    .test(normalized)
}

function defaultCommand(files, requestedCommand) {
  const command = String(requestedCommand || '').trim()
  if (command) return command
  const packageFile = files.find((file) => file.path === 'package.json')
  if (packageFile) {
    try {
      const data = packageFile.encoding === 'base64'
        ? Buffer.from(packageFile.data, 'base64').toString('utf-8')
        : String(packageFile.data || '')
      const packageJson = JSON.parse(data)
      if (packageJson.scripts?.dev) return 'npm run dev'
      if (packageJson.scripts?.start) return 'npm start'
    } catch {
      return 'npm run dev'
    }
    return 'npm run dev'
  }
  if (files.some((file) => file.path === 'index.html')) return 'npx vite --host 0.0.0.0 --port 5173'
  const pythonFile = files.find((file) => /(^|\/)(main|app|server)\.py$/i.test(file.path)) || files.find((file) => /\.py$/i.test(file.path))
  return pythonFile ? `python ${JSON.stringify(pythonFile.path)}` : 'npm run dev'
}

function filesForJob(store, user, body) {
  const incomingFiles = sanitizeFiles(body.files || [])
  if (incomingFiles.length) return incomingFiles

  const projectId = String(body.projectId || '')
  const project = projectId ? store.projects?.[projectId] : null
  if (!project || project.userId !== user.id) return []
  return sanitizeFiles(project.files || [])
}

function appendLogs(existing = '', incoming = '') {
  const next = `${existing || ''}${incoming || ''}`
  return next.length > maxJobLogLength ? next.slice(next.length - maxJobLogLength) : next
}

async function handleBrowserPost(req, res, user, body) {
  const action = body.action || 'status'

  if (action === 'createPairing') {
    const result = await updateStore((store) => {
      ensurePersonalRunnerStore(store)
      cleanupPersonalRunnerStore(store)
      const token = `pr_${randomBytes(32).toString('base64url')}`
      const tokenHash = hashSessionToken(token)
      const now = Date.now()
      const name = String(body.name || `${user.name || user.email}'s Runner`).trim().slice(0, 80)
      store.personalRunnerPairings[tokenHash] = {
        userId: user.id,
        name,
        code: token.slice(3, 11).toUpperCase(),
        createdAt: now,
        expiresAt: now + pairingTtlMs,
      }
      return {
        pairing: {
          token,
          name,
          code: token.slice(3, 11).toUpperCase(),
          expiresAt: now + pairingTtlMs,
          serverUrl: requestOrigin(req),
          createdAt: now,
        },
      }
    })
    json(res, 201, result)
    return
  }

  if (action === 'enqueueJob') {
    const result = await updateStore((store) => {
      ensurePersonalRunnerStore(store)
      cleanupPersonalRunnerStore(store)
      const files = filesForJob(store, user, body)
      if (!files.length) return { error: 'Personal Runner needs project files. Open or upload a project first.' }

      const requestedRunnerId = String(body.runnerId || '')
      const availableRunner = Object.values(store.personalRunners)
        .filter((runner) => runner.userId === user.id && Date.now() - Number(runner.lastSeenAt || 0) < runnerOnlineMs)
        .find((runner) => !requestedRunnerId || runner.id === requestedRunnerId)
      if (requestedRunnerId && !availableRunner) return { error: 'Selected Personal Runner is offline.' }

      const now = Date.now()
      const command = defaultCommand(files, body.command)
      const job = {
        id: newId('prjob'),
        userId: user.id,
        runnerId: requestedRunnerId || availableRunner?.id || '',
        projectId: String(body.projectId || ''),
        projectName: String(body.projectName || 'Browser Project').slice(0, 100),
        command,
        files,
        install: body.install !== false,
        expectsPreview: body.expectsPreview === undefined ? commandExpectsPreview(command) : Boolean(body.expectsPreview),
        port: Number(body.port) || defaultPersonalRunnerPort,
        status: 'queued',
        logs: `Queued Personal Runner job at ${nowIso()}\n$ ${command}\n`,
        previewUrl: '',
        createdAt: now,
        updatedAt: now,
      }
      store.personalRunnerJobs[job.id] = job
      return { job: publicJob(job) }
    })

    if (result.error) {
      json(res, 400, { error: result.error })
      return
    }

    json(res, 201, result)
    return
  }

  if (action === 'stopJob') {
    const result = await updateStore((store) => {
      ensurePersonalRunnerStore(store)
      const job = store.personalRunnerJobs[String(body.jobId || '')]
      if (!job || job.userId !== user.id) return { error: 'Job not found.' }
      job.status = ['finished', 'error', 'stopped'].includes(job.status) ? job.status : 'cancel_requested'
      job.updatedAt = Date.now()
      job.logs = appendLogs(job.logs, '\nStop requested from browser.\n')
      return { job: publicJob(job) }
    })
    if (result.error) {
      json(res, 404, { error: result.error })
      return
    }
    json(res, 200, result)
    return
  }

  if (action === 'forgetRunner') {
    const result = await updateStore((store) => {
      ensurePersonalRunnerStore(store)
      const runnerId = String(body.runnerId || '')
      const runner = store.personalRunners[runnerId]
      if (!runner || runner.userId !== user.id) return { error: 'Runner not found.' }
      delete store.personalRunners[runnerId]
      for (const job of Object.values(store.personalRunnerJobs)) {
        if (job.runnerId === runnerId && !['finished', 'error', 'stopped'].includes(job.status)) {
          job.status = 'cancel_requested'
          job.updatedAt = Date.now()
        }
      }
      return { ok: true }
    })
    if (result.error) {
      json(res, 404, { error: result.error })
      return
    }
    json(res, 200, result)
    return
  }

  json(res, 400, { error: 'Unknown Personal Runner action.' })
}

async function handleRunnerPost(req, res, body, authToken) {
  const action = body.action || 'heartbeat'

  if (action === 'register') {
    const pairingToken = String(body.pairingToken || authToken || '')
    const result = await updateStore((store) => {
      ensurePersonalRunnerStore(store)
      cleanupPersonalRunnerStore(store)
      const pairingHash = hashSessionToken(pairingToken)
      const pairing = store.personalRunnerPairings[pairingHash]
      if (!pairing || pairing.expiresAt < Date.now()) return { error: 'Pairing token is invalid or expired.' }

      const runnerToken = `runner_${randomBytes(32).toString('base64url')}`
      const runnerTokenHash = hashSessionToken(runnerToken)
      const now = Date.now()
      const runner = {
        id: newId('runner'),
        userId: pairing.userId,
        tokenHash: runnerTokenHash,
        name: String(body.name || pairing.name || 'Personal Runner').slice(0, 80),
        status: 'online',
        version: String(body.version || ''),
        platform: String(body.platform || ''),
        nodeVersion: String(body.nodeVersion || ''),
        currentJobId: '',
        previewUrl: '',
        createdAt: now,
        lastSeenAt: now,
      }
      store.personalRunners[runner.id] = runner
      pairing.claimedAt = now
      delete store.personalRunnerPairings[pairingHash]
      return { runner: publicRunner(runner), runnerToken }
    })

    if (result.error) {
      json(res, 401, { error: result.error })
      return
    }

    json(res, 201, result)
    return
  }

  const result = await updateStore((store) => {
    ensurePersonalRunnerStore(store)
    cleanupPersonalRunnerStore(store)
    const runner = findRunnerByToken(store, authToken)
    if (!runner) return { error: 'Runner token is invalid.' }

    runner.status = String(body.status || 'online')
    runner.lastSeenAt = Date.now()
    runner.version = String(body.version || runner.version || '')
    runner.platform = String(body.platform || runner.platform || '')
    runner.nodeVersion = String(body.nodeVersion || runner.nodeVersion || '')
    if (body.previewUrl) runner.previewUrl = String(body.previewUrl)

    if (action === 'heartbeat') {
      const cancelJobIds = Object.values(store.personalRunnerJobs)
        .filter((job) => job.runnerId === runner.id && job.status === 'cancel_requested')
        .map((job) => job.id)
      const nextJob = Object.values(store.personalRunnerJobs)
        .filter((job) => job.userId === runner.userId && job.status === 'queued' && (!job.runnerId || job.runnerId === runner.id))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0]

      if (nextJob) {
        nextJob.runnerId = runner.id
        nextJob.status = 'accepted'
        nextJob.updatedAt = Date.now()
        runner.currentJobId = nextJob.id
      }

      return {
        runner: publicRunner(runner),
        job: nextJob ? { ...publicJob(nextJob), files: nextJob.files || [], install: nextJob.install !== false } : null,
        cancelJobIds,
      }
    }

    if (action === 'jobStatus') {
      const job = store.personalRunnerJobs[String(body.jobId || '')]
      if (!job || job.runnerId !== runner.id || job.userId !== runner.userId) return { error: 'Job not found.' }
      const now = Date.now()
      job.status = String(body.status || job.status || 'running')
      job.updatedAt = now
      if (body.startedAt && !job.startedAt) job.startedAt = Number(body.startedAt)
      if (['finished', 'error', 'stopped'].includes(job.status)) {
        job.finishedAt = now
        runner.currentJobId = runner.currentJobId === job.id ? '' : runner.currentJobId
      } else {
        runner.currentJobId = job.id
      }
      if (typeof body.exitCode === 'number') job.exitCode = body.exitCode
      if (body.error) job.error = String(body.error)
      if (body.previewUrl) {
        job.previewUrl = String(body.previewUrl)
        runner.previewUrl = job.previewUrl
      }
      if (body.logs) job.logs = appendLogs(job.logs, String(body.logs))
      return { runner: publicRunner(runner), job: publicJob(job) }
    }

    return { error: 'Unknown runner action.' }
  })

  if (result.error) {
    json(res, result.error.includes('token') ? 401 : 404, { error: result.error })
    return
  }

  json(res, 200, result)
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const user = await requireUser(req)
      const result = await updateStore((store) => {
        ensurePersonalRunnerStore(store)
        cleanupPersonalRunnerStore(store)
        const runners = Object.values(store.personalRunners)
          .filter((runner) => runner.userId === user.id)
          .map(publicRunner)
          .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
        const jobs = Object.values(store.personalRunnerJobs)
          .filter((job) => job.userId === user.id)
          .map(publicJob)
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
          .slice(0, 12)
        return { runners, jobs }
      })
      json(res, 200, result)
      return
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' })
      return
    }

    const body = await readJsonBody(req)
    const authToken = bearerToken(req)
    const runnerActions = new Set(['register', 'heartbeat', 'jobStatus'])
    if (runnerActions.has(body.action) || authToken.startsWith('runner_') || authToken.startsWith('pr_')) {
      await handleRunnerPost(req, res, body, authToken)
      return
    }

    const user = await requireUser(req)
    await handleBrowserPost(req, res, user, body)
  } catch (error) {
    json(res, error.status || 500, { error: error.message || 'Personal Runner request failed.' })
  }
}
