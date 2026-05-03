import {
  getSessionUser,
  json,
  publicUser,
  readJsonBody,
  sanitizeSettings,
  updateStore,
} from './_store.js'

export default async function handler(req, res) {
  try {
    const { user } = await getSessionUser(req)
    if (!user) {
      json(res, 401, { error: 'Unauthorized' })
      return
    }

    if (req.method === 'GET') {
      json(res, 200, { settings: user.settings || {} })
      return
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' })
      return
    }

    const body = await readJsonBody(req)
    const settings = sanitizeSettings(body.settings || {})
    const result = await updateStore((store) => {
      const nextUser = store.users[user.id]
      nextUser.settings = settings
      nextUser.updatedAt = Date.now()
      return { user: publicUser(nextUser), settings }
    })

    json(res, 200, result)
  } catch (error) {
    json(res, 500, { error: error.message || 'Settings request failed.' })
  }
}
