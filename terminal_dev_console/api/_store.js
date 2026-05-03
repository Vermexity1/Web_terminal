import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const storeKey = 'web-terminal-store-v1'
const sessionCookieName = 'wts_session'
const sessionMaxAgeSeconds = 60 * 60 * 24 * 14
const localDataDir = path.join(process.cwd(), '.web-terminal-data')
const localDataPath = path.join(localDataDir, 'store.json')

function emptyStore() {
  return {
    users: {},
    emailToUserId: {},
    sessions: {},
    projects: {},
  }
}

function isUpstashEnabled() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

async function upstashCommand(command) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Upstash request failed (${response.status})`)
  return data.result
}

async function readLocalStore() {
  try {
    const text = await fs.readFile(localDataPath, 'utf-8')
    return { ...emptyStore(), ...JSON.parse(text) }
  } catch {
    return emptyStore()
  }
}

async function writeLocalStore(store) {
  if (process.env.VERCEL) {
    throw new Error('Persistent storage is not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.')
  }

  await fs.mkdir(localDataDir, { recursive: true })
  await fs.writeFile(localDataPath, JSON.stringify(store, null, 2))
}

export async function readStore() {
  if (isUpstashEnabled()) {
    const raw = await upstashCommand(['GET', storeKey])
    return raw ? { ...emptyStore(), ...JSON.parse(raw) } : emptyStore()
  }

  return readLocalStore()
}

export async function writeStore(store) {
  const nextStore = { ...emptyStore(), ...store }
  if (isUpstashEnabled()) {
    await upstashCommand(['SET', storeKey, JSON.stringify(nextStore)])
    return
  }

  await writeLocalStore(nextStore)
}

export async function updateStore(mutator) {
  const store = await readStore()
  cleanupExpiredSessions(store)
  const result = await mutator(store)
  await writeStore(store)
  return result
}

export function json(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}')

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf-8')
  return text ? JSON.parse(text) : {}
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    createdAt: user.createdAt,
    settings: user.settings || {},
  }
}

export function publicProject(project) {
  if (!project) return null
  return {
    id: project.id,
    name: project.name,
    files: Array.isArray(project.files) ? project.files : [],
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
  }
}

export function projectSummary(project) {
  if (!project) return null
  return {
    id: project.id,
    name: project.name,
    fileCount: Array.isArray(project.files) ? project.files.length : 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
  }
}

export function sanitizeSettings(settings = {}) {
  const aiSettings = settings.aiSettings || {}
  return {
    theme: settings.theme || 'blackblue',
    layoutMode: settings.layoutMode || 'agentCode',
    autosaveEnabled: settings.autosaveEnabled !== false,
    aiSettings: {
      provider: aiSettings.provider || 'gemini',
      models: aiSettings.models || {},
      customEndpoint: aiSettings.customEndpoint || '',
      customModel: aiSettings.customModel || '',
      priceMode: aiSettings.priceMode || 'free',
      thinkingLevel: aiSettings.thinkingLevel || 'deep',
      dailyRequestLimit: Number(aiSettings.dailyRequestLimit) || 20,
      dailyTokenLimit: Number(aiSettings.dailyTokenLimit) || 50000,
      dailyBudgetUsd: Number(aiSettings.dailyBudgetUsd) || 0,
      maxOutputTokens: Number(aiSettings.maxOutputTokens) || 3200,
    },
  }
}

export function sanitizeFiles(files = []) {
  let totalBytes = 0
  const maxFiles = 800
  const maxBytes = 10 * 1024 * 1024

  return (Array.isArray(files) ? files : []).reduce((acceptedFiles, file) => {
    if (acceptedFiles.length >= maxFiles) return acceptedFiles

    const path = String(file.path || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    if (!path || path.includes('..')) return acceptedFiles

    const encoding = file.encoding === 'base64' ? 'base64' : 'utf8'
    const data = String(file.data ?? '')
    const byteLength = encoding === 'base64'
      ? Math.ceil((data.length * 3) / 4)
      : Buffer.byteLength(data, 'utf-8')

    if (totalBytes + byteLength > maxBytes) return acceptedFiles
    totalBytes += byteLength
    acceptedFiles.push({ path, data, encoding })
    return acceptedFiles
  }, [])
}

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(String(password), salt, 64)
  return {
    salt,
    hash: key.toString('hex'),
  }
}

export async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false
  const { hash } = await hashPassword(password, user.salt)
  const actual = Buffer.from(hash, 'hex')
  const expected = Buffer.from(user.passwordHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(store, userId) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashSessionToken(token)
  const now = Date.now()
  store.sessions[tokenHash] = {
    userId,
    createdAt: now,
    expiresAt: now + sessionMaxAgeSeconds * 1000,
  }
  return token
}

export function cleanupExpiredSessions(store) {
  const now = Date.now()
  for (const [tokenHash, session] of Object.entries(store.sessions || {})) {
    if (!session?.expiresAt || session.expiresAt < now) delete store.sessions[tokenHash]
  }
}

export function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=')
        return index === -1
          ? [decodeURIComponent(item), '']
          : [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))]
      }),
  )
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}${secure}`)
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
}

export async function getSessionUser(req, store = null) {
  const activeStore = store || await readStore()
  cleanupExpiredSessions(activeStore)
  const token = parseCookies(req)[sessionCookieName]
  if (!token) return { store: activeStore, user: null, sessionHash: null }

  const sessionHash = hashSessionToken(token)
  const session = activeStore.sessions?.[sessionHash]
  const user = session ? activeStore.users?.[session.userId] : null
  return { store: activeStore, user: user || null, sessionHash }
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`
}
