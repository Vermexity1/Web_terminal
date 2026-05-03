import {
  clearSessionCookie,
  createSession,
  getSessionUser,
  hashPassword,
  json,
  newId,
  normalizeEmail,
  publicUser,
  readJsonBody,
  sanitizeSettings,
  setSessionCookie,
  updateStore,
  verifyPassword,
} from './_store.js'

function validPassword(password) {
  return String(password || '').length >= 8
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { user } = await getSessionUser(req)
      json(res, 200, { user: publicUser(user) })
      return
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' })
      return
    }

    const body = await readJsonBody(req)
    const action = body.action || 'signin'

    if (action === 'signout') {
      const { sessionHash } = await getSessionUser(req)
      if (sessionHash) {
        await updateStore((store) => {
          delete store.sessions[sessionHash]
        })
      }
      clearSessionCookie(res)
      json(res, 200, { user: null })
      return
    }

    const email = normalizeEmail(body.email)
    const password = String(body.password || '')

    if (!email || !email.includes('@')) {
      json(res, 400, { error: 'Enter a valid email address.' })
      return
    }

    if (!validPassword(password)) {
      json(res, 400, { error: 'Password must be at least 8 characters.' })
      return
    }

    if (action === 'signup') {
      const result = await updateStore(async (store) => {
        if (store.emailToUserId[email]) {
          return { error: 'An account already exists for that email.' }
        }

        const id = newId('user')
        const passwordRecord = await hashPassword(password)
        const now = Date.now()
        const user = {
          id,
          email,
          name: String(body.name || '').trim(),
          salt: passwordRecord.salt,
          passwordHash: passwordRecord.hash,
          settings: sanitizeSettings(body.settings || {}),
          projectIds: [],
          createdAt: now,
          updatedAt: now,
        }
        store.users[id] = user
        store.emailToUserId[email] = id
        const token = createSession(store, id)
        return { user, token }
      })

      if (result.error) {
        json(res, 409, { error: result.error })
        return
      }

      setSessionCookie(res, result.token)
      json(res, 201, { user: publicUser(result.user) })
      return
    }

    if (action === 'signin') {
      const result = await updateStore(async (store) => {
        const userId = store.emailToUserId[email]
        const user = userId ? store.users[userId] : null
        if (!user || !(await verifyPassword(password, user))) {
          return { error: 'Email or password is incorrect.' }
        }

        user.updatedAt = Date.now()
        const token = createSession(store, user.id)
        return { user, token }
      })

      if (result.error) {
        json(res, 401, { error: result.error })
        return
      }

      setSessionCookie(res, result.token)
      json(res, 200, { user: publicUser(result.user) })
      return
    }

    json(res, 400, { error: 'Unknown auth action.' })
  } catch (error) {
    json(res, 500, { error: error.message || 'Auth request failed.' })
  }
}
