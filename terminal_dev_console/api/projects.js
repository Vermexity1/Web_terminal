import {
  getSessionUser,
  json,
  newId,
  projectSummary,
  publicProject,
  readJsonBody,
  sanitizeFiles,
  updateStore,
} from './_store.js'

async function requireUser(req) {
  const { user } = await getSessionUser(req)
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  return user
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req)

    if (req.method === 'GET') {
      const projectId = new URL(req.url, 'http://localhost').searchParams.get('id')
      const result = await updateStore((store) => {
        const userRecord = store.users[user.id]
        const projectIds = userRecord?.projectIds || []

        if (projectId) {
          const project = store.projects[projectId]
          if (!project || project.userId !== user.id) return { error: 'Project not found.' }
          project.lastOpenedAt = Date.now()
          return { project: publicProject(project) }
        }

        return {
          projects: projectIds
            .map((id) => projectSummary(store.projects[id]))
            .filter(Boolean)
            .sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0)),
        }
      })

      if (result.error) {
        json(res, 404, { error: result.error })
        return
      }

      json(res, 200, result)
      return
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed' })
      return
    }

    const body = await readJsonBody(req)
    const action = body.action || 'save'

    if (action === 'create') {
      const name = String(body.name || 'Untitled Project').trim().slice(0, 80) || 'Untitled Project'
      const result = await updateStore((store) => {
        const now = Date.now()
        const project = {
          id: newId('project'),
          userId: user.id,
          name,
          files: sanitizeFiles(body.files || []),
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
        }
        store.projects[project.id] = project
        store.users[user.id].projectIds = Array.from(new Set([...(store.users[user.id].projectIds || []), project.id]))
        return { project: publicProject(project) }
      })

      json(res, 201, result)
      return
    }

    if (action === 'save') {
      const projectId = String(body.id || '')
      const result = await updateStore((store) => {
        const project = store.projects[projectId]
        if (!project || project.userId !== user.id) return { error: 'Project not found.' }

        project.name = String(body.name || project.name || 'Untitled Project').trim().slice(0, 80) || 'Untitled Project'
        project.files = sanitizeFiles(body.files || [])
        project.updatedAt = Date.now()
        project.lastOpenedAt = project.updatedAt
        return { project: publicProject(project) }
      })

      if (result.error) {
        json(res, 404, { error: result.error })
        return
      }

      json(res, 200, result)
      return
    }

    if (action === 'rename') {
      const projectId = String(body.id || '')
      const name = String(body.name || '').trim().slice(0, 80)
      if (!name) {
        json(res, 400, { error: 'Project name is required.' })
        return
      }

      const result = await updateStore((store) => {
        const project = store.projects[projectId]
        if (!project || project.userId !== user.id) return { error: 'Project not found.' }
        project.name = name
        project.updatedAt = Date.now()
        return { project: publicProject(project) }
      })

      if (result.error) {
        json(res, 404, { error: result.error })
        return
      }

      json(res, 200, result)
      return
    }

    json(res, 400, { error: 'Unknown project action.' })
  } catch (error) {
    json(res, error.status || 500, { error: error.message || 'Project request failed.' })
  }
}
