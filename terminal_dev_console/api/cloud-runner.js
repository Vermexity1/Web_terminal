import { Sandbox } from '@vercel/sandbox'
import {
  getSessionUser,
  json,
  readJsonBody,
  sanitizeFiles,
  updateStore,
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

const jsxStylePropertyNames = [
  'alignItems',
  'background',
  'backgroundColor',
  'border',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'color',
  'cursor',
  'display',
  'flex',
  'flexDirection',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'gap',
  'height',
  'justifyContent',
  'lineHeight',
  'margin',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'opacity',
  'overflow',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'position',
  'textAlign',
  'transform',
  'transition',
  'width',
]

const jsxStylePropertyPattern = new RegExp(`\\b(${jsxStylePropertyNames.join('|')})\\s*:`)

function rememberRepair(repairs, repair) {
  repairs.push(repair)
}

function stripAnsi(value = '') {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function repairBareJsxStyleBlocks(source, filePath, repairs) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  let changed = false

  for (let index = 0; index < lines.length; index += 1) {
    const braceIndex = lines[index].indexOf('{{')
    if (braceIndex === -1) continue

    const beforeBrace = lines[index].slice(0, braceIndex).trimEnd()
    const lastCharBeforeBrace = beforeBrace.at(-1) || ''
    const alreadyAssigned = lastCharBeforeBrace === '=' || /\bstyle\s*$/.test(beforeBrace)
    const trimmedLine = lines[index].trim()
    const bareStyleCandidate = trimmedLine === '{{'
      || (trimmedLine.startsWith('{{') && !alreadyAssigned)
      || (
        !alreadyAssigned
          && /<[\w.-]+|^\s+[A-Za-z_$:-]/.test(beforeBrace)
      )

    if (!bareStyleCandidate) continue

    const openingRemainder = lines[index].slice(braceIndex + 2)
    if (openingRemainder.includes('}}') && jsxStylePropertyPattern.test(openingRemainder)) {
      lines[index] = trimmedLine === '{{'
        ? `${lines[index].match(/^\s*/)?.[0] || ''}style={{${openingRemainder}`
        : `${lines[index].slice(0, braceIndex)}style={{${openingRemainder}`
      changed = true
      rememberRepair(repairs, {
        path: filePath,
        line: index + 1,
        message: 'Added missing style= before an inline JSX style object.',
      })
      continue
    }

    let closeIndex = -1
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 60); cursor += 1) {
      const trimmed = lines[cursor].trim()
      if (trimmed === '}}' || trimmed.startsWith('}}>') || trimmed.endsWith('}}')) {
        closeIndex = cursor
        break
      }
      if (/^[<>]/.test(trimmed)) break
    }

    if (closeIndex === -1) continue

    const body = lines.slice(index + 1, closeIndex).join('\n')
    if (!jsxStylePropertyPattern.test(`${openingRemainder}\n${body}`)) continue

    const indent = lines[index].match(/^\s*/)?.[0] || ''
    lines[index] = trimmedLine === '{{'
      ? `${indent}style={{`
      : `${lines[index].slice(0, braceIndex)}style={{${lines[index].slice(braceIndex + 2)}`
    changed = true
    rememberRepair(repairs, {
      path: filePath,
      line: index + 1,
      message: 'Added missing style= before a JSX style object.',
    })
    index = closeIndex
  }

  return changed ? lines.join(newline) : source
}

export function repairCommonJsxMistakes(files) {
  const repairs = []

  const repairedFiles = files.map((file) => {
    if (!/\.(jsx|tsx)$/i.test(file.path || '')) return file

    const original = fileContent(file).toString('utf8')
    let repaired = repairBareJsxStyleBlocks(original, file.path, repairs)

    repaired = repaired.replace(
      /(^[ \t]*)\{\{\s*\r?\n((?:[ \t]+[A-Za-z_$][\w$]*\s*:\s*[^;\n]+,?\s*\r?\n){2,})(^[ \t]*)\}\}/gm,
      (match, indent, body, closeIndent) => {
        if (!jsxStylePropertyPattern.test(body)) return match
        rememberRepair(repairs, {
          path: file.path,
          message: 'Converted a bare JSX style object into a style prop.',
        })
        return `${indent}style={{\n${body}${closeIndent}}}`
      },
    )

    repaired = repaired.replace(/\bstyle\s*\{\{/g, () => {
      rememberRepair(repairs, {
        path: file.path,
        message: 'Fixed style{{ to style={{.',
      })
      return 'style={{'
    })

    return repaired === original
      ? file
      : { ...file, data: repaired, encoding: 'utf8' }
  })

  const uniqueRepairs = repairs.filter((repair, index) => (
    repairs.findIndex((item) => (
      item.path === repair.path
        && item.message === repair.message
        && item.line === repair.line
    )) === index
  ))

  return { files: repairedFiles, repairs: uniqueRepairs }
}

export function parseBabelUnexpectedToken(output = '') {
  const cleanOutput = stripAnsi(output)
  const patterns = [
    /\/vercel\/sandbox\/([^"'\s:]+?\.(?:jsx|tsx))["']?\s*:?\s*Unexpected token\s*\((\d+):(\d+)\)/i,
    /\[plugin:vite:react-babel\]\s+\/vercel\/sandbox\/([^"'\s:]+?\.(?:jsx|tsx)):\s*Unexpected token\s*\((\d+):(\d+)\)/i,
    /\/vercel\/sandbox\/([^"'\s:]+?\.(?:jsx|tsx)):(\d+):(\d+):\s*ERROR:\s*([^\r\n]+)/i,
    /file:\s*\/vercel\/sandbox\/([^"'\s:]+?\.(?:jsx|tsx)):(\d+):(\d+)/i,
    /\/vercel\/sandbox\/([^"'\s:]+?\.(?:jsx|tsx)):(\d+):(\d+)/i,
  ]

  for (const pattern of patterns) {
    const match = cleanOutput.match(pattern)
    if (match) {
      return {
        path: match[1].replaceAll('\\', '/').replace(/^\/+/, ''),
        line: Number(match[2]) || 0,
        column: Number(match[3]) || 0,
        message: match[4] || '',
      }
    }
  }

  return null
}

function findFileIndex(files, targetPath) {
  const normalizedTarget = String(targetPath || '').replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase()
  return files.findIndex((file) => String(file.path || '').toLowerCase() === normalizedTarget)
}

function braceBalance(source) {
  let balance = 0
  let quote = ''
  let escaped = false

  for (const char of source) {
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if (char === '{') {
      balance += 1
    } else if (char === '}') {
      balance -= 1
    }
  }

  return balance
}

function parenBalance(source) {
  let balance = 0
  let quote = ''
  let escaped = false

  for (const char of source) {
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if (char === '(') {
      balance += 1
    } else if (char === ')') {
      balance -= 1
    }
  }

  return balance
}

const jsxVoidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

function unclosedJsxTags(source) {
  const stack = []
  const tagPattern = /<\/?([A-Za-z][\w.:-]*)([^<>]*)>/g
  let match = tagPattern.exec(source)

  while (match) {
    const fullMatch = match[0]
    const tagName = match[1]
    const lowerTagName = tagName.toLowerCase()
    const isClosing = fullMatch.startsWith('</')
    const isSelfClosing = /\/\s*>$/.test(fullMatch) || jsxVoidTags.has(lowerTagName)

    if (isClosing) {
      const openIndex = stack.map((item) => item.name).lastIndexOf(tagName)
      if (openIndex !== -1) stack.splice(openIndex, stack.length - openIndex)
    } else if (!isSelfClosing) {
      stack.push({ name: tagName })
    }

    match = tagPattern.exec(source)
  }

  return stack.map((item) => item.name)
}

function repairIncompleteJsxAtEof(file, source, lines, errorIndex, output) {
  const cleanOutput = stripAnsi(output)
  if (!/(Expected\s+">"\s+but\s+found\s+end of file|Unexpected\s+end of file before a closing\s+"[^"]+"\s+tag)/i.test(cleanOutput)) {
    return { file, repairs: [] }
  }

  let lastContentIndex = lines.length - 1
  while (lastContentIndex >= 0 && !lines[lastContentIndex].trim()) lastContentIndex -= 1
  if (lastContentIndex < 0) {
    return { file, repairs: [] }
  }

  const searchStart = Math.max(0, lastContentIndex - 80)
  let openingTagIndex = -1
  for (let index = lastContentIndex; index >= searchStart; index -= 1) {
    if (/<[A-Za-z][\w.:-]*\b/.test(lines[index]) && !lines[index].includes('>')) {
      openingTagIndex = index
      break
    }
  }

  if (openingTagIndex === -1) return { file, repairs: [] }

  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const nextLines = [...lines]

  if (/^\}\}\s*$/.test(nextLines[lastContentIndex].trim())) {
    nextLines[lastContentIndex] = `${nextLines[lastContentIndex]} />`
  }

  const unclosedTags = unclosedJsxTags(nextLines.join(newline))
  for (const tagName of unclosedTags.reverse()) {
    nextLines.push(`    </${tagName}>`)
  }

  const currentSource = nextLines.join(newline)
  const openParens = Math.max(0, parenBalance(currentSource))
  const openBraces = Math.max(0, braceBalance(currentSource))

  for (let index = 0; index < Math.min(openParens, 4); index += 1) {
    nextLines.push(index === 0 ? '  )' : ')')
  }

  for (let index = 0; index < Math.min(openBraces, 4); index += 1) {
    nextLines.push('}')
  }

  if (!/\bexport\s+default\b/.test(source) && /\bfunction\s+App\s*\(/.test(source)) {
    nextLines.push('')
    nextLines.push('export default App')
  }

  return {
    file: { ...file, data: nextLines.join(newline), encoding: 'utf8' },
    repairs: [{
      path: file.path,
      line: lastContentIndex + 1,
      message: 'Closed an incomplete JSX tag and component at end of file.',
    }],
  }
}

function recoveryBackupPath(filePath) {
  if (/\.(jsx|tsx)$/i.test(filePath)) {
    return filePath.replace(/\.(jsx|tsx)$/i, '.broken.$1')
  }

  return `${filePath}.broken`
}

function recoveryReactSource(originalPath, backupPath) {
  return `import React from 'react'

export default function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#030712',
        color: '#dbeafe',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        padding: 32,
      }}
    >
      <section
        style={{
          width: 'min(720px, 100%)',
          border: '1px solid #1d4ed8',
          borderRadius: 12,
          background: '#07111f',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
          padding: 28,
        }}
      >
        <p style={{ margin: 0, color: '#60a5fa', fontWeight: 700 }}>Preview recovered</p>
        <h1 style={{ margin: '10px 0 12px', color: '#f8fafc', fontSize: 34 }}>
          Your project is running.
        </h1>
        <p style={{ margin: 0, lineHeight: 1.7, color: '#b6c7de' }}>
          The previous ${originalPath} file ended before its JSX was complete, so Runable backed it up to ${backupPath} and started this safe preview.
        </p>
      </section>
    </main>
  )
}
`
}

export function recoverBrokenReactEntry(files, output) {
  const errorLocation = parseBabelUnexpectedToken(output)
  const repairs = []
  if (!errorLocation?.path || !/src\/App\.(jsx|tsx)$/i.test(errorLocation.path)) return { files, repairs }

  const fileIndex = findFileIndex(files, errorLocation.path)
  if (fileIndex === -1) return { files, repairs }

  const file = files[fileIndex]
  const backupPath = recoveryBackupPath(file.path)
  const hasBackup = files.some((item) => String(item.path || '').toLowerCase() === backupPath.toLowerCase())
  const recoveredFile = {
    ...file,
    data: recoveryReactSource(file.path, backupPath),
    encoding: 'utf8',
  }

  const nextFiles = files.map((item, index) => (index === fileIndex ? recoveredFile : item))
  if (!hasBackup) {
    nextFiles.push({
      path: backupPath,
      data: fileContent(file).toString('utf8'),
      encoding: 'utf8',
    })
  }

  repairs.push({
    path: file.path,
    line: errorLocation.line,
    message: `Recovered an incomplete React entry and backed up the original to ${backupPath}.`,
  })

  return { files: nextFiles, repairs }
}

export function repairJsxFromErrorLocation(files, output) {
  const errorLocation = parseBabelUnexpectedToken(output)
  const repairs = []
  if (!errorLocation?.path || !errorLocation.line) return { files, repairs }

  const fileIndex = findFileIndex(files, errorLocation.path)
  if (fileIndex === -1) return { files, repairs }

  const file = files[fileIndex]
  const source = fileContent(file).toString('utf8')
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const errorIndex = Math.max(0, Math.min(lines.length - 1, errorLocation.line - 1))
  const eofRepair = repairIncompleteJsxAtEof(file, source, lines, errorIndex, output)
  if (eofRepair.repairs.length) {
    return {
      files: files.map((item, index) => (index === fileIndex ? eofRepair.file : item)),
      repairs: eofRepair.repairs,
    }
  }

  const searchStart = Math.max(0, errorIndex - 80)
  let openingIndex = -1

  for (let index = errorIndex; index >= searchStart; index -= 1) {
    const braceIndex = lines[index].indexOf('{{')
    if (braceIndex === -1) continue

    const beforeBrace = lines[index].slice(0, braceIndex).trimEnd()
    const alreadyAssigned = beforeBrace.endsWith('=') || /\bstyle\s*$/.test(beforeBrace)
    if (!alreadyAssigned) {
      openingIndex = index
      break
    }
  }

  if (openingIndex === -1) return { files, repairs }

  const braceIndex = lines[openingIndex].indexOf('{{')
  const blockText = lines.slice(openingIndex, Math.min(lines.length, errorIndex + 1)).join('\n')
  if (!/:/.test(blockText)) return { files, repairs }

  const indent = lines[openingIndex].match(/^\s*/)?.[0] || ''
  lines[openingIndex] = lines[openingIndex].trim() === '{{'
    ? `${indent}style={{`
    : `${lines[openingIndex].slice(0, braceIndex)}style={{${lines[openingIndex].slice(braceIndex + 2)}`

  repairs.push({
    path: file.path,
    line: openingIndex + 1,
    message: 'Used the Vite compile error to add missing style= before a JSX object.',
  })

  const repairedFile = { ...file, data: lines.join(newline), encoding: 'utf8' }
  return {
    files: files.map((item, index) => (index === fileIndex ? repairedFile : item)),
    repairs,
  }
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

async function saveRepairedProjectFiles(user, projectId, files) {
  if (!user?.id || !projectId) return false

  const result = await updateStore((store) => {
    const project = store.projects[String(projectId)]
    if (!project || project.userId !== user.id) return { saved: false }

    const now = Date.now()
    project.files = sanitizeFiles(files)
    project.updatedAt = now
    project.lastOpenedAt = now
    return { saved: true }
  })

  return Boolean(result.saved)
}

async function readProjectFilesForRunner(user, projectId) {
  if (!user?.id || !projectId) return []

  const result = await updateStore((store) => {
    const project = store.projects[String(projectId)]
    if (!project || project.userId !== user.id) return { files: [] }

    project.lastOpenedAt = Date.now()
    return { files: sanitizeFiles(project.files || []) }
  })

  return result.files || []
}

function hasScript(packageJson, script) {
  return Boolean(packageJson?.scripts?.[script])
}

function hasDependency(packageJson, dependencyName) {
  return Boolean(
    packageJson?.dependencies?.[dependencyName]
      || packageJson?.devDependencies?.[dependencyName]
      || packageJson?.peerDependencies?.[dependencyName],
  )
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

function compileCheckCommand(files) {
  const packageJson = packageJsonFromFiles(files)
  if (!packageJson) return null
  if (hasScript(packageJson, 'build')) return { cmd: 'npm', args: ['run', 'build'], label: 'npm run build' }

  const looksLikeViteProject = hasDependency(packageJson, 'vite')
    || files.some((file) => file.path === 'index.html')
  if (looksLikeViteProject) return { cmd: 'npx', args: ['vite', 'build'], label: 'npx vite build' }

  return null
}

async function runBuildCheck(sandbox, logs, files) {
  const compileCommand = compileCheckCommand(files)
  if (!compileCommand) {
    logs.push('Compile check skipped: no build script or Vite project detected.')
    return { exitCode: 0, output: '', skipped: true }
  }

  logs.push(`$ ${compileCommand.label} (compile check)`)
  const result = await sandbox.runCommand({
    cmd: compileCommand.cmd,
    args: compileCommand.args,
    cwd: appRoot,
    env: { NODE_ENV: 'development' },
  })
  const output = await commandOutput(result)
  logs.push(output)
  return { exitCode: result.exitCode, output }
}

async function startRunner(body, user) {
  const clientFiles = sanitizeFiles(body.files || [])
  const storedFiles = body.useStoredFiles
    ? await readProjectFilesForRunner(user, body.projectId).catch(() => [])
    : []
  const sourceFiles = storedFiles.length ? storedFiles : clientFiles
  let repairResult = repairCommonJsxMistakes(sourceFiles)
  let files = repairResult.files
  const repairs = [...repairResult.repairs]
  if (files.length === 0) throw Object.assign(new Error('Cloud Runner needs saved project files.'), { status: 400 })
  let repairsPersisted = false

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
    fileSource: storedFiles.length ? 'project-store' : 'browser-upload',
    targetPort,
    proxyPort,
    previewUrl: serverCommand ? sandbox.domain(proxyPort) : '',
    previewHost: serverCommand ? previewHost(sandbox, proxyPort) : '',
    viteAllowedHost: serverCommand ? viteAllowedHost(sandbox, proxyPort) : '',
    repairs,
    repairsPersisted,
    compileCheck: 'not run',
  }

  for (const dir of directoryPaths(files)) {
    await sandbox.mkDir(dir).catch(() => {})
  }

  await sandbox.writeFiles(files.map((file) => ({
    path: file.path,
    content: fileContent(file),
  })))
  logs.push(`Uploaded ${files.length} project files.`)
  if (repairs.length) {
    logs.push(`Auto repair applied before install: ${repairs.map((repair) => `${repair.path}${repair.line ? `:${repair.line}` : ''} (${repair.message})`).join('; ')}`)
  }

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

  if (serverCommand && body.verify !== false) {
    let buildCheck = await runBuildCheck(sandbox, logs, files)
    diagnostics.compileCheck = buildCheck.skipped
      ? 'skipped'
      : (buildCheck.exitCode === 0 ? 'passed' : 'failed')

    if (!buildCheck.skipped && buildCheck.exitCode !== 0) {
      for (let attempt = 1; attempt <= 4 && buildCheck.exitCode !== 0; attempt += 1) {
        const locationRepair = repairJsxFromErrorLocation(files, buildCheck.output)
        if (!locationRepair.repairs.length) {
          logs.push('Compile check failed, but no safe JSX auto-repair matched the error.')
          break
        }

        files = locationRepair.files
        repairs.push(...locationRepair.repairs)
        diagnostics.repairs = repairs
        logs.push(`Compile repair attempt ${attempt} applied: ${locationRepair.repairs.map((repair) => `${repair.path}:${repair.line} (${repair.message})`).join('; ')}`)
        await sandbox.writeFiles(files.map((file) => ({
          path: file.path,
          content: fileContent(file),
        })))

        buildCheck = await runBuildCheck(sandbox, logs, files)
        diagnostics.compileCheck = buildCheck.exitCode === 0 ? 'repaired' : `repair attempt ${attempt} failed`
      }

      if (buildCheck.exitCode !== 0 && parseBabelUnexpectedToken(buildCheck.output)) {
        const recovery = recoverBrokenReactEntry(files, buildCheck.output)
        if (recovery.repairs.length) {
          files = recovery.files
          repairs.push(...recovery.repairs)
          diagnostics.repairs = repairs
          logs.push(`Recovery fallback applied: ${recovery.repairs.map((repair) => `${repair.path}:${repair.line} (${repair.message})`).join('; ')}`)
          await sandbox.writeFiles(files.map((file) => ({
            path: file.path,
            content: fileContent(file),
          })))

          buildCheck = await runBuildCheck(sandbox, logs, files)
          diagnostics.compileCheck = buildCheck.exitCode === 0 ? 'recovered' : 'failed after recovery'
        }

        if (buildCheck.exitCode !== 0 && parseBabelUnexpectedToken(buildCheck.output)) {
          await sandbox.stop({ blocking: false }).catch(() => {})
          throw Object.assign(new Error('Vite still cannot compile this project after JSX auto-repair.'), {
            status: 500,
            details: logs.join('\n'),
          })
        }
      }
    }
  }

  if (repairs.length) {
    repairsPersisted = await saveRepairedProjectFiles(user, body.projectId, files).catch(() => false)
    diagnostics.repairsPersisted = repairsPersisted
    logs.push(repairsPersisted ? 'Auto repair saved back to the project.' : 'Auto repair used for this run only.')
  }
  console.log('[cloud-runner] start diagnostics', {
    sandboxId: sandbox.sandboxId,
    fileSource: diagnostics.fileSource,
    compileCheck: diagnostics.compileCheck,
    repairs: repairs.length,
    repairsPersisted,
    command,
  })

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
    const user = await requireUser(req)

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
      json(res, 200, await startRunner(body, user))
      return
    }

    if (action === 'stop') {
      json(res, 200, await stopRunner(body))
      return
    }

    json(res, 400, { error: 'Unknown cloud runner action.' })
  } catch (error) {
    console.error('[cloud-runner] request failed', {
      message: error.message || 'Cloud runner failed.',
      status: error.status || 500,
      details: error.details ? String(error.details).slice(-2000) : '',
    })
    json(res, error.status || 500, {
      error: error.message || 'Cloud runner failed.',
      details: error.details || '',
    })
  }
}
