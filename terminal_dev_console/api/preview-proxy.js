import { getSessionUser } from './_store.js'

const hopByHopHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-frame-options',
])

function htmlEscape(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function isAllowedPreviewUrl(targetUrl) {
  if (!['http:', 'https:'].includes(targetUrl.protocol)) return false

  const hostname = targetUrl.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return !process.env.VERCEL
  }

  return hostname === 'vercel.run'
    || hostname.endsWith('.vercel.run')
    || hostname === 'webcontainer-api.io'
    || hostname.endsWith('.webcontainer-api.io')
    || hostname === 'stackblitz.io'
    || hostname.endsWith('.stackblitz.io')
}

function errorPage(title, message) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #020617;
        color: #dbeafe;
        font: 14px system-ui, sans-serif;
      }
      main {
        width: min(620px, calc(100vw - 32px));
        border: 1px solid #1d4ed8;
        border-radius: 12px;
        background: #07111f;
        padding: 24px;
      }
      strong {
        display: block;
        margin-bottom: 8px;
        color: #fff;
      }
      p {
        margin: 0;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <strong>${htmlEscape(title)}</strong>
      <p>${htmlEscape(message)}</p>
    </main>
  </body>
</html>`
}

function injectPreviewBase(html, targetUrl) {
  const baseHref = htmlEscape(targetUrl.href)
  const cleanedHtml = String(html || '')
    .replace(/<meta\b[^>]*http-equiv=["']content-security-policy["'][^>]*>/gi, '')

  const baseMarkup = `<base href="${baseHref}">`
  if (/<head(\s[^>]*)?>/i.test(cleanedHtml)) {
    return cleanedHtml.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${baseMarkup}`)
  }

  return `<!doctype html><html><head>${baseMarkup}</head><body>${cleanedHtml}</body></html>`
}

function copySafeHeaders(response, res, fallbackType) {
  for (const [key, value] of response.headers.entries()) {
    if (hopByHopHeaders.has(key.toLowerCase())) continue
    res.setHeader(key, value)
  }

  if (!res.getHeader('content-type') && fallbackType) {
    res.setHeader('Content-Type', fallbackType)
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')
}

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end('Method not allowed')
    return
  }

  const { user } = await getSessionUser(req)
  if (!user) {
    res.statusCode = 401
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(errorPage('Sign in required', 'Sign in before loading a hosted preview on this page.'))
    return
  }

  const params = new URL(req.url, 'http://localhost').searchParams
  const rawUrl = params.get('url')

  let targetUrl
  try {
    targetUrl = new URL(rawUrl || '')
  } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(errorPage('Preview URL missing', 'The preview proxy needs a valid running preview URL.'))
    return
  }

  if (!isAllowedPreviewUrl(targetUrl)) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(errorPage('Preview host blocked', 'This preview proxy only accepts WebContainer and Vercel Sandbox preview URLs.'))
    return
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      redirect: 'follow',
      headers: {
        Accept: req.headers.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': req.headers['user-agent'] || 'RunablePreviewProxy/1.0',
      },
    })
    const contentType = response.headers.get('content-type') || ''

    res.statusCode = response.status
    copySafeHeaders(response, res, contentType || 'text/html; charset=utf-8')

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    if (contentType.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      const html = await response.text()
      res.end(injectPreviewBase(html, response.url ? new URL(response.url) : targetUrl))
      return
    }

    const body = Buffer.from(await response.arrayBuffer())
    res.end(body)
  } catch (error) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(errorPage('Preview proxy could not connect', error?.message || 'The running preview did not respond yet.'))
  }
}
