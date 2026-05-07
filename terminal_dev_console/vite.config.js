import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-api-routes',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = new URL(req.url || '/', 'http://localhost').pathname
          const handlers = {
            '/api/auth': () => import('./api/auth.js'),
            '/api/cloud-runner': () => import('./api/cloud-runner.js'),
            '/api/personal-runner': () => import('./api/personal-runner.js'),
            '/api/projects': () => import('./api/projects.js'),
            '/api/settings': () => import('./api/settings.js'),
          }
          const loadHandler = handlers[pathname]

          if (!loadHandler) {
            next()
            return
          }

          try {
            const { default: handler } = await loadHandler()
            await handler(req, res)
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: error.message || 'API route failed.' }))
          }
        })
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: { clientPort: 443 },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
