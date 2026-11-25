import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DEV_SCRIPT_NAMES = Object.freeze(['dev', 'start', 'serve', 'develop', 'web', 'frontend'])
const DEV_SCRIPT_RE = /\b(vite|next\s+dev|webpack(?:-dev-server)?|webpack\s+serve|nuxt\s+dev|astro\s+dev|remix\s+vite:dev|ng\s+serve|parcel|rsbuild(?:\s+dev)?|rspack(?:\s+dev)?|turbo\s+dev|react-scripts\s+start)\b/i
const FRONTEND_TOOL_RE = /\b(vite|next|webpack|nuxt|astro|remix|parcel|rsbuild|rspack|react-scripts|@vitejs|@rsbuild|@rspack)\b/i
const PORT_RE = /(?:--port(?:-number)?|-p|PORT=)\s*(\d{2,5})\b|:(\d{2,5})\b/
const CONFIG_PORT_RE = /\bport(?:Number)?\s*[:=]\s*['"]?(\d{2,5})\b/gi
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9.-]+)(?::\d{2,5})?(?:\/[^\s"'\\]*)?/gi
const FRONTEND_LOG_RE = /\b(vite|rsbuild|rspack|webpack|next\.js|nuxt|astro|parcel|frontend|client|web ui|local:)\b/i
const AIRPLAY_RE = /\b(AirTunes|AirPlay|AirPlayWebServer|MediaControl\/|ControlCenter)\b/i
const DEV_CLIENT_RE = /@vite\/client|\/@vite\/|\/@fs\/|\/@id\/|webpack-dev-server|__webpack_dev_server__|webpack-hmr|webpackHotUpdate|@rsbuild\/|@rspack\/|rsbuild-hmr|__rsbuild|rspack-dev-server|\/_next\/webpack-hmr|next\/dist\/client|@parcel\/runtime|parcel-runtime|svelte-hmr|vite-plugin-svelte|\$RefreshReg\$/i
const SOURCEMAP_RE = /[@#]\s*sourceMappingURL=|sourceMappingURL/
const DEV_ASSET_NAME_RE = /cssExtractHmr|node_modules_rspack|rspack_core|webpackHotUpdate|webpack-dev-server|__webpack_dev_server__/i
const ASSET_SNIPPET = 4000
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'target', 'vendor',
  '.next', '.nuxt', '.output', '.cache', '.turbo', '.venv', 'venv', '__pycache__',
  'Pods', 'tmp', '.tmp', '.scratch',
])
const CONFIG_FILES = Object.freeze([
  'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs',
  'rsbuild.config.js', 'rsbuild.config.ts', 'rsbuild.config.mjs', 'rsbuild.config.cjs',
  'rspack.config.js', 'rspack.config.ts', 'webpack.config.js', 'webpack.dev.js',
  'angular.json',
])
const FRONTEND_DIR_NAMES = new Set(['frontend', 'client', 'web', 'app', 'ui', 'www'])

export const DEV_SERVER_USER_HINT = "Start your project's development server yourself, then enter the frontend URL. Auto-discovery only reuses a page that looks like a frontend dev server (HTML with sourcemaps, HMR, or a known dev client such as Vite, webpack, rsbuild, or Next). A listening port is not enough."

const DEV_JS_FILE_RE = /(?:^|[\\/\s])(?:scripts[\\/])?dev\.(js|ts|mjs|cjs)\b/i
const PACKAGE_DEV_RUN_RE = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?dev\b/i
const DEV_HTTP_HINT_RE = /\b(?:uvicorn|gunicorn|daphne|granian|waitress|flask\s+run|django(?:-admin)?\s+runserver|manage\.py\s+runserver|spring-boot:run|bootRun|php\s+artisan\s+serve|rails\s+s(?:erver)?|wrangler\s+dev|snowpack\s+dev|live-server|browser-sync|webpack-dev-server|http-server)\b/i
const PRODUCTION_PREVIEW_RE = /\b(?:vite\s+preview|next\s+start|nuxt\s+(?:start|preview))\b/i
const BUILD_COMMAND_RE = /\b(?:vite|next|nuxt|webpack|rsbuild|rspack|astro|remix|ng|parcel)\s+build\b/i
const BUILD_SCRIPT_NAMES = new Set(['build', 'compile', 'bundle', 'preview', 'pack'])
const NODE_SERVER_JS_RE = /\bnode(?:\s+--[\w.-=]+)*\s+(?:\.\/)?(?:dist\/|build\/)?server\.(js|mjs|cjs|ts)\b/i
const ELECTRON_APP_RE = /\belectron(?:-builder)?(?:\s|$)/i
const BIN_ENTRY_RE = /\b(?:node(?:\s+--[\w.-=]+)*\s+)?(?:\.\/)?bin\/[\w.-]+\.(js|mjs|cjs|ts)\b/i

function hasDevHttpSignals(command) {
  const value = String(command || '')
  if (!value.trim()) return false
  return DEV_SCRIPT_RE.test(value)
    || FRONTEND_TOOL_RE.test(value)
    || DEV_JS_FILE_RE.test(value)
    || DEV_HTTP_HINT_RE.test(value)
    || PACKAGE_DEV_RUN_RE.test(value)
}

export function looksLikeProductionPreview(command, name = '') {
  const value = String(command || '')
  if (PRODUCTION_PREVIEW_RE.test(value) || BUILD_COMMAND_RE.test(value)) return true
  if (BUILD_SCRIPT_NAMES.has(name) && !/\bdev\b/i.test(value)) return true
  if ((name === 'start' || name === 'serve')
    && NODE_SERVER_JS_RE.test(value)
    && !hasDevHttpSignals(value)
    && !/\b(?:--watch|nodemon|tsx\s+watch)\b/i.test(value)) {
    return true
  }
  return false
}

export function looksLikeDevHttpServer(command, name = '') {
  const value = String(command || '')
  if (!value.trim() || looksLikeProductionPreview(value, name)) return false
  return hasDevHttpSignals(value)
}

export function looksLikeNonHttpEntrypoint(command) {
  const value = String(command || '')
  if (!value.trim() || looksLikeDevHttpServer(value)) return false
  if (/\belectron-builder\b/i.test(value)) return true
  if (ELECTRON_APP_RE.test(value) && !/\b(?:electron-vite|electron-dev|vite|webpack)\b/i.test(value)) return true
  if (BIN_ENTRY_RE.test(value) && !/\b(?:server|listen|http|port|dev)\b/i.test(value)) return true
  return false
}

function entryScriptSource(entry) {
  if (!entry) return ''
  if (entry.scriptCommand) return String(entry.scriptCommand)
  if (entry.kind && entry.kind !== 'npm-script') return String(entry.commandText || '')
  return ''
}

export function isViableStartEntry(entry) {
  if (!entry) return false
  const source = entryScriptSource(entry)
  if (BUILD_SCRIPT_NAMES.has(entry.name) || BUILD_COMMAND_RE.test(source) || PRODUCTION_PREVIEW_RE.test(source)) return false
  if (looksLikeNonHttpEntrypoint(source)) return false
  if (entry.frontend || looksLikeDevHttpServer(source, entry.name)) return true
  const kind = String(entry.kind || '')
  if (kind.startsWith('python') || kind.startsWith('java')) return true
  if (DEV_SCRIPT_NAMES.includes(entry.name)) return true
  return false
}

function devServerError(code, message) {
  const error = new Error(message)
  error.code = code
  error.hint = DEV_SERVER_USER_HINT
  return error
}

function uniqueNumbers(values) {
  const seen = new Set()
  const ports = []
  for (const value of values) {
    const port = Number(value)
    if (!Number.isInteger(port) || port <= 0 || port >= 65536 || seen.has(port)) continue
    seen.add(port)
    ports.push(port)
  }
  return ports
}

function isSameOrInside(dir, root) {
  const relative = path.relative(path.resolve(root), path.resolve(dir))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function lockfileManager(dir) {
  if (existsSync(path.join(dir, 'package-lock.json')) || existsSync(path.join(dir, 'npm-shrinkwrap.json'))) {
    return { bin: 'npm', run: ['npm', 'run'] }
  }
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return { bin: 'pnpm', run: ['pnpm', 'run'] }
  if (existsSync(path.join(dir, 'yarn.lock'))) return { bin: 'yarn', run: ['yarn'] }
  if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) {
    return { bin: 'bun', run: ['bun', 'run'] }
  }
  return null
}

export function packageManagerCommand(workspaceRoot, { boundary } = {}) {
  const start = path.resolve(workspaceRoot || '.')
  const root = path.resolve(boundary || start)
  const home = path.resolve(os.homedir())
  let dir = start
  while (true) {
    const found = lockfileManager(dir)
    if (found) return found
    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    if (parent === home && root !== home) break
    if (!isSameOrInside(parent, root) && parent !== root) break
    dir = parent
  }
  return { bin: 'npm', run: ['npm', 'run'] }
}

export function readWorkspacePackage(workspaceRoot) {
  const file = path.join(path.resolve(workspaceRoot || '.'), 'package.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readText(file) {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

export function parsePortFromScript(script) {
  const match = String(script || '').match(PORT_RE)
  if (!match) return null
  const port = Number(match[1] || match[2])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

export function defaultPortsForScript(script) {
  const value = String(script || '')
  if (/\bvite\b/i.test(value)) return [5173, 5174, 4173]
  if (/\brsbuild\b|\brspack\b/i.test(value)) return [3000, 3001]
  if (/\bnext\b/i.test(value)) return [3000, 3001]
  if (/\bastro\b/i.test(value)) return [4321]
  if (/\bng\s+serve\b/i.test(value)) return [4200]
  if (/\bnuxt\b/i.test(value)) return [3000]
  if (/\bparcel\b/i.test(value)) return [1234, 3000]
  if (/\breact-scripts\b/i.test(value)) return [3000]
  if (/\bwebpack/i.test(value)) return [8080, 8081]
  return []
}

function portsForCommand(command, extra = []) {
  const parsed = parsePortFromScript(command)
  const defaults = defaultPortsForScript(command)
  return uniqueNumbers([parsed, ...defaults, ...extra])
}

function scanConfigPorts(dir) {
  const ports = []
  for (const name of CONFIG_FILES) {
    const text = readText(path.join(dir, name))
    if (!text) continue
    CONFIG_PORT_RE.lastIndex = 0
    let match
    while ((match = CONFIG_PORT_RE.exec(text))) ports.push(Number(match[1]))
  }
  return uniqueNumbers(ports)
}

export function listDevScripts(packageJson, { cwd = '', extraPorts = [] } = {}) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {}
  const found = []
  const seen = new Set()
  const configPorts = cwd ? scanConfigPorts(cwd) : []
  const add = (name, reason) => {
    const command = String(scripts[name] || '').trim()
    if (!command || seen.has(name)) return
    seen.add(name)
    found.push({
      name,
      command,
      port: parsePortFromScript(command),
      ports: portsForCommand(command, [...configPorts, ...extraPorts]),
      reason,
      frontend: looksLikeDevHttpServer(command, name),
    })
  }
  for (const name of DEV_SCRIPT_NAMES) {
    if (scripts[name]) add(name, 'preferred-name')
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (DEV_SCRIPT_RE.test(String(command))) add(name, 'dev-command')
  }
  return found
}

function walkDirs(root, { maxDepth = 3, limit = 40 } = {}) {
  const results = []
  const visit = (dir, depth) => {
    if (results.length >= limit || depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const next = path.join(dir, entry.name)
      try {
        if (!statSync(next).isDirectory()) continue
      } catch {
        continue
      }
      results.push(next)
      visit(next, depth + 1)
      if (results.length >= limit) return
    }
  }
  visit(path.resolve(root), 0)
  return results
}

function pythonBin(cwd) {
  const posix = path.join(cwd, '.venv', 'bin', 'python')
  const win = path.join(cwd, '.venv', 'Scripts', 'python.exe')
  if (existsSync(posix)) return posix
  if (existsSync(win)) return win
  return process.platform === 'win32' ? 'python' : 'python3'
}

function pythonDeps(cwd) {
  return [
    readText(path.join(cwd, 'requirements.txt')),
    readText(path.join(cwd, 'pyproject.toml')),
    readText(path.join(cwd, 'Pipfile')),
  ].join('\n')
}

function listPythonDevEntries(cwd) {
  const deps = pythonDeps(cwd)
  const py = pythonBin(cwd)
  const entries = []
  if (existsSync(path.join(cwd, 'manage.py'))) {
    entries.push({
      kind: 'python-django',
      cwd,
      name: 'runserver',
      command: [py, 'manage.py', 'runserver'],
      commandText: `${py} manage.py runserver`,
      ports: [8000],
      reason: 'django-manage',
      frontend: false,
    })
  }
  if (/\bflask\b/i.test(deps) && ['app.py', 'wsgi.py', 'asgi.py', path.join('src', 'app.py')].some((file) => existsSync(path.join(cwd, file)))) {
    entries.push({
      kind: 'python-flask',
      cwd,
      name: 'flask',
      command: [py, '-m', 'flask', 'run'],
      commandText: `${py} -m flask run`,
      ports: [5000],
      reason: 'flask',
      frontend: false,
    })
  }
  if (/\b(fastapi|uvicorn)\b/i.test(deps) && ['main.py', 'app.py', path.join('src', 'main.py')].some((file) => existsSync(path.join(cwd, file)))) {
    const module = existsSync(path.join(cwd, 'main.py')) ? 'main:app' : existsSync(path.join(cwd, 'app.py')) ? 'app:app' : 'src.main:app'
    entries.push({
      kind: 'python-fastapi',
      cwd,
      name: 'uvicorn',
      command: [py, '-m', 'uvicorn', module, '--reload'],
      commandText: `${py} -m uvicorn ${module} --reload`,
      ports: [8000],
      reason: 'fastapi-uvicorn',
      frontend: false,
    })
  }
  return entries
}

function listJavaDevEntries(cwd) {
  const pom = readText(path.join(cwd, 'pom.xml'))
  const gradle = `${readText(path.join(cwd, 'build.gradle'))}\n${readText(path.join(cwd, 'build.gradle.kts'))}`
  const entries = []
  if (pom.includes('spring-boot')) {
    const mvnw = existsSync(path.join(cwd, 'mvnw.cmd')) && process.platform === 'win32'
      ? path.join(cwd, 'mvnw.cmd')
      : existsSync(path.join(cwd, 'mvnw'))
        ? path.join(cwd, 'mvnw')
        : ''
    entries.push({
      kind: 'java-spring',
      cwd,
      name: 'spring-boot:run',
      command: mvnw ? [mvnw, 'spring-boot:run'] : ['mvn', 'spring-boot:run'],
      commandText: mvnw ? `${mvnw} spring-boot:run` : 'mvn spring-boot:run',
      ports: [8080],
      reason: 'spring-boot',
      frontend: false,
    })
  }
  if (/\borg\.springframework\.boot\b|\bbootRun\b/.test(gradle)) {
    const gradlew = existsSync(path.join(cwd, 'gradlew.bat')) && process.platform === 'win32'
      ? path.join(cwd, 'gradlew.bat')
      : existsSync(path.join(cwd, 'gradlew'))
        ? path.join(cwd, 'gradlew')
        : ''
    entries.push({
      kind: 'java-spring',
      cwd,
      name: 'bootRun',
      command: gradlew ? [gradlew, 'bootRun'] : ['gradle', 'bootRun'],
      commandText: gradlew ? `${gradlew} bootRun` : 'gradle bootRun',
      ports: [8080],
      reason: 'spring-boot',
      frontend: false,
    })
  }
  return entries
}

function npmEntriesForDir(cwd, { root = false, workspaceRoot = cwd } = {}) {
  const pkg = readWorkspacePackage(cwd)
  if (!pkg) return []
  const manager = packageManagerCommand(cwd, { boundary: workspaceRoot })
  const scripts = listDevScripts(pkg, { cwd })
  return scripts.map((script) => ({
    kind: 'npm-script',
    cwd,
    name: script.name,
    command: [...manager.run, script.name],
    commandText: `${manager.run.join(' ')} ${script.name}`,
    scriptCommand: script.command,
    ports: script.ports,
    reason: root ? script.reason : `nested-${script.reason}`,
    frontend: script.frontend === true,
    root: root === true,
    dirName: path.basename(cwd),
  }))
}

export function listProjectDevEntries(workspaceRoot) {
  const root = path.resolve(workspaceRoot || '.')
  const entries = [...npmEntriesForDir(root, { root: true, workspaceRoot: root }), ...listPythonDevEntries(root), ...listJavaDevEntries(root)]
  for (const dir of walkDirs(root)) {
    entries.push(...npmEntriesForDir(dir, { workspaceRoot: root }), ...listPythonDevEntries(dir), ...listJavaDevEntries(dir))
  }
  const seen = new Set()
  return entries.filter((entry) => {
    const key = `${entry.cwd}::${entry.kind}::${entry.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function collectCandidatePorts(entries) {
  return uniqueNumbers((entries || []).flatMap((entry) => entry.ports || []))
}

const execFileAsync = promisify(execFile)
const LOOPBACK_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|::1)$/i
const LOGIN_OPEN_PARAM_RE = /(?:^|[?#&])(?:token|access_token|auth_token|authToken|id_token|auth|code|magic_link|magic|otp)=/i

export function isLoopbackHost(host) {
  return LOOPBACK_HOST_RE.test(String(host || '').replace(/^\[|\]$/g, '').trim()) || LOOPBACK_HOST_RE.test(String(host || '').trim())
}

export function isPathInsideRoot(root, target) {
  const base = path.resolve(String(root || ''))
  const value = path.resolve(String(target || ''))
  if (!base || !value || base === path.sep) return false
  return value === base || value.startsWith(`${base}${path.sep}`)
}

export function isAppLoginOpenUrl(url) {
  const value = String(url || '').trim()
  if (!value) return false
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (!/^https?:$/i.test(parsed.protocol)) return false
  if (!isLoopbackHost(parsed.hostname)) return false
  return LOGIN_OPEN_PARAM_RE.test(parsed.hash) || LOGIN_OPEN_PARAM_RE.test(parsed.search)
}

const AUTH_PATH_SEGMENT_RE = /(?:^|[^a-z0-9])(?:log-?in|sign-?in|sign-?up|sign-?out|logout|auth|authenticate|authentication|authorize|authorization|sso|oauth|otp|password|passwd|forgot)(?:[^a-z0-9]|$)/i
const AUTH_PATH_SEGMENTS = new Set([
  'login', 'signin', 'signup', 'signout', 'logout', 'auth', 'authenticate',
  'authentication', 'authorize', 'authorization', 'sso', 'oauth', 'otp',
  'password', 'passwd', 'forgot',
])

export function isLikelyAuthPage(url) {
  const value = String(url || '').trim()
  if (!value) return false
  if (isAppLoginOpenUrl(value)) return true
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  const haystack = `${parsed.pathname} ${parsed.hash}`
  if (AUTH_PATH_SEGMENT_RE.test(haystack)) return true
  const segments = haystack.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return segments.some((segment) => AUTH_PATH_SEGMENTS.has(segment))
}

export function extractLoginOpenUrls(text) {
  const urls = []
  const seen = new Set()
  for (const match of String(text || '').matchAll(LOCAL_URL_RE)) {
    const raw = match[0].replace(/[),.;]+$/, '')
    let href = raw
    try {
      href = new URL(raw).href
    } catch {
      // Keep the raw match when URL parsing fails.
    }
    if (!isAppLoginOpenUrl(href) || seen.has(href)) continue
    seen.add(href)
    urls.push(href)
  }
  return urls
}

export function pickLoginOpenUrl(text, { origin = '' } = {}) {
  const urls = extractLoginOpenUrls(text)
  if (!urls.length) return ''
  if (origin) {
    try {
      const wanted = new URL(origin).origin
      const same = urls.find((item) => new URL(item).origin === wanted)
      if (same) return same
    } catch {
      // Ignore unparsable origins.
    }
  }
  return urls[0]
}

export function parseLsofListenTable(text) {
  const rows = []
  const seen = new Set()
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^\S+\s+(\d+)\s+.*\sTCP\s+(\[::1\]|127\.0\.0\.1|localhost|0\.0\.0\.0|\*|::):(\d+)\s+\(LISTEN\)\s*$/i)
    if (!match) continue
    const pid = Number(match[1])
    const port = Number(match[3])
    if (!Number.isInteger(pid) || !Number.isInteger(port) || port <= 0) continue
    const key = `${pid}:${port}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ pid, port, host: match[2] })
  }
  return rows
}

export function parseLsofCwd(text) {
  const cwds = new Map()
  let pid = 0
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1))
      continue
    }
    if (line.startsWith('n') && pid) cwds.set(pid, line.slice(1).trim())
  }
  return cwds
}

export function parsePsCommands(text) {
  const commands = new Map()
  for (const line of String(text || '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/)
    if (!match) continue
    commands.set(Number(match[1]), match[2].trim())
  }
  return commands
}

async function runCommand(command, args, timeoutMs = 2500) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 2_000_000,
    })
    return String(stdout || '')
  } catch {
    return ''
  }
}

export async function discoverLoopbackListeners() {
  const listenOut = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])
  const listeners = parseLsofListenTable(listenOut)
  if (!listeners.length) return []
  const pids = [...new Set(listeners.map((item) => item.pid))]
  const cwdOut = await runCommand('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn'])
  const cwds = parseLsofCwd(cwdOut)
  const psOut = await runCommand('ps', ['-o', 'pid=,command=', '-p', pids.join(',')])
  const commands = parsePsCommands(psOut)
  return listeners.map((item) => ({
    ...item,
    cwd: cwds.get(item.pid) || '',
    command: commands.get(item.pid) || '',
  }))
}

export function listenersInWorkspace(listeners, workspaceRoot) {
  return (Array.isArray(listeners) ? listeners : []).filter((item) => (
    item && item.port && item.cwd && isPathInsideRoot(workspaceRoot, item.cwd)
  ))
}

export function reusePortsFromListeners(listeners, workspaceRoot) {
  return uniqueNumbers(listenersInWorkspace(listeners, workspaceRoot).map((item) => Number(item.port)))
}

export function loginUrlFromListeners(listeners, workspaceRoot, { origin = '' } = {}) {
  const text = listenersInWorkspace(listeners, workspaceRoot)
    .map((item) => String(item.command || ''))
    .join('\n')
  return pickLoginOpenUrl(text, { origin })
}

async function resolveListeners(discoverListeners) {
  try {
    if (typeof discoverListeners === 'function') return (await discoverListeners()) || []
    return await discoverLoopbackListeners()
  } catch {
    return []
  }
}


export function startRank(entry) {
  const source = entryScriptSource(entry)
  const devName = entry.name === 'dev' || entry.name === 'develop'
  const startName = entry.name === 'start' || entry.name === 'serve'
  const httpDev = entry.frontend === true || looksLikeDevHttpServer(source, entry.name)
  const productionLike = looksLikeProductionPreview(source, entry.name)
  const frontendDir = FRONTEND_DIR_NAMES.has(entry.dirName)
  let score = 0
  if (looksLikeNonHttpEntrypoint(source)) score -= 100
  if (httpDev && devName && entry.root) score += 100
  else if (httpDev && devName && frontendDir) score += 94
  else if (httpDev && devName) score += 90
  else if (httpDev && startName && !productionLike && entry.root) score += 70
  else if (httpDev && frontendDir) score += 80
  else if (httpDev && entry.root) score += 65
  else if (httpDev) score += 60
  else if (devName && entry.root) score += 50
  else if (devName && frontendDir) score += 48
  else if (devName) score += 44
  else if (startName && entry.root) score += 8
  else score += 6
  if (devName) score += 10
  if (productionLike) score -= 25
  if (startName && productionLike) score -= 10
  return score
}

export function rankStartEntries(entries) {
  return (Array.isArray(entries) ? [...entries] : [])
    .filter((entry) => isViableStartEntry(entry))
    .sort((a, b) => startRank(b) - startRank(a) || String(a.cwd || '').localeCompare(String(b.cwd || '')))
}

export function chooseStartEntry(entries) {
  return rankStartEntries(entries)[0] || null
}

export async function canConnect(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const finish = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export function normalizeProbeUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    if (parsed.hostname === '0.0.0.0' || parsed.hostname === '[::]' || parsed.hostname === '::') {
      parsed.hostname = '127.0.0.1'
    }
    return parsed.href
  } catch {
    return value.endsWith('/') ? value : `${value}/`
  }
}

export async function probeHttp(url, timeoutMs = 2000) {
  const target = normalizeProbeUrl(url)
  if (!target) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(target, { signal: controller.signal, redirect: 'follow' })
    const headers = Object.fromEntries(response.headers.entries())
    const text = await response.text().catch(() => '')
    const probe = {
      status: response.status,
      url: response.url || target,
      headers,
      body: String(text || '').slice(0, 8000),
    }
    return qualifyDevProbe(probe, { timeoutMs })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function isRejectedResponder(probe) {
  if (!probe) return true
  const headers = probe.headers || {}
  const server = String(headers.server || headers.Server || '')
  const body = String(probe.body || '')
  return AIRPLAY_RE.test(server) || AIRPLAY_RE.test(body)
}

function headerText(probe) {
  return Object.entries(probe?.headers || {}).map(([key, value]) => `${key}: ${value}`).join('\n')
}

export function looksLikeHtml(probe) {
  if (!probe) return false
  const type = String(probe.headers?.['content-type'] || probe.headers?.['Content-Type'] || '')
  if (/text\/html/i.test(type)) return true
  return /<!doctype html|<html[\s>]/i.test(String(probe.body || '').trim())
}

export function looksLikeAppDocument(probe) {
  if (!probe || isRejectedResponder(probe) || !looksLikeHtml(probe)) return false
  const body = String(probe.body || '')
  return /<script[\s>]/i.test(body)
    || /<link\b[^>]+rel=["'](?:stylesheet|modulepreload|preload)["']/i.test(body)
    || /<(?:div|main|app)\b[^>]*\bid=["']?(?:root|app|__next|__nuxt)/i.test(body)
}

export function hasDevSignals(text, headers = '', url = '') {
  const body = `${String(text || '')}\n${String(url || '')}`
  const header = typeof headers === 'string' ? headers : headerText({ headers })
  return SOURCEMAP_RE.test(body)
    || DEV_CLIENT_RE.test(body)
    || DEV_ASSET_NAME_RE.test(body)
    || /source-?map/i.test(header)
    || DEV_CLIENT_RE.test(header)
    || DEV_ASSET_NAME_RE.test(header)
}

export function looksLikeDevResponse(probe) {
  if (!probe || isRejectedResponder(probe) || !looksLikeHtml(probe)) return false
  return hasDevSignals(probe.body, headerText(probe), probe.url)
}

export function extractSameOriginAssets(html, pageUrl, { limit = 6 } = {}) {
  const scripts = []
  const styles = []
  let page
  try {
    page = new URL(pageUrl)
  } catch {
    return []
  }
  const add = (list, raw) => {
    const value = String(raw || '').trim()
    if (!value || /^(data:|blob:|javascript:)/i.test(value)) return
    let resolved
    try {
      resolved = new URL(value, page)
    } catch {
      return
    }
    if (resolved.origin !== page.origin) return
    if (list.includes(resolved.href)) return
    list.push(resolved.href)
  }
  const scriptRe = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  let match
  while ((match = scriptRe.exec(String(html || '')))) add(scripts, match[1])
  const linkRe = /<link\b[^>]*>/gi
  while ((match = linkRe.exec(String(html || '')))) {
    const tag = match[0]
    if (!/\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(tag) && !/\bas\s*=\s*["'](?:script|style)["']/i.test(tag)) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)
    if (href) add(styles, href[1])
  }
  return [...scripts, ...styles].slice(0, limit)
}

async function fetchAssetSnippet(url, timeoutMs = 2000) {
  const target = normalizeProbeUrl(url)
  if (!target) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(target, { signal: controller.signal, redirect: 'follow' })
    const headers = Object.fromEntries(response.headers.entries())
    const type = String(headers['content-type'] || headers['Content-Type'] || '')
    if (/text\/html/i.test(type)) return null
    const text = String(await response.text().catch(() => ''))
    const head = text.slice(0, ASSET_SNIPPET)
    const tail = text.slice(-ASSET_SNIPPET)
    const body = text.length <= ASSET_SNIPPET * 2 ? text : `${head}\n${tail}`
    return {
      status: response.status,
      url: response.url || target,
      headers,
      body,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function qualifyDevProbe(probe, { timeoutMs = 2000 } = {}) {
  if (!probe || isRejectedResponder(probe)) return probe ? { ...probe, ok: false } : null
  if (looksLikeDevResponse(probe)) return { ...probe, ok: true }
  if (!looksLikeAppDocument(probe)) return { ...probe, ok: false }
  for (const assetUrl of extractSameOriginAssets(probe.body, probe.url)) {
    const asset = await fetchAssetSnippet(assetUrl, timeoutMs)
    if (!asset) continue
    if (hasDevSignals(asset.body, headerText(asset), asset.url || assetUrl)) {
      return { ...probe, ok: true, assetUrl: asset.url || assetUrl }
    }
  }
  return { ...probe, ok: false }
}

export function resolveUrlFromPort(port, host = '127.0.0.1') {
  return `http://${host}:${port}/`
}

export function extractUrlsFromOutput(chunk) {
  const text = String(chunk || '')
  const urls = []
  const seen = new Set()
  for (const match of text.matchAll(LOCAL_URL_RE)) {
    const url = normalizeProbeUrl(match[0].replace(/[),.;]+$/, ''))
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push({
      url,
      hint: FRONTEND_LOG_RE.test(text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80)) ? 'frontend-log' : 'log',
    })
  }
  return urls
}

export function scoreDevProbe(probe, { preferredPorts = [], logHint = '' } = {}) {
  if (!probe || isRejectedResponder(probe)) return -1
  const htmlSignals = looksLikeDevResponse(probe)
  if (!htmlSignals && !probe.ok) return -1
  let score = 10
  const body = `${String(probe.body || '')}\n${String(probe.assetUrl || '')}`
  if (DEV_CLIENT_RE.test(body)) score += 8
  if (SOURCEMAP_RE.test(body)) score += 4
  if (/@vite\/client|\/@vite\//i.test(body)) score += 3
  if (/@rsbuild\/|@rspack\/|rsbuild-hmr|cssExtractHmr|node_modules_rspack|rspack_core/i.test(body)) score += 3
  if (probe.ok && !htmlSignals) score += 3
  if (logHint === 'frontend-log') score += 5
  try {
    const port = Number(new URL(probe.url || '').port)
    if (preferredPorts.includes(port)) score += 4
  } catch {
    // Ignore unparsable probe URLs.
  }
  return score
}

export function chooseFrontendProbe(candidates = []) {
  let best = null
  let bestScore = -1
  for (const candidate of candidates) {
    const probe = candidate?.probe || candidate
    const score = scoreDevProbe(probe, {
      preferredPorts: candidate.preferredPorts || [],
      logHint: candidate.hint || '',
    })
    if (score > bestScore) {
      best = { url: probe.url || candidate.url, probe, reused: candidate.reused === true, score }
      bestScore = score
    }
  }
  return best
}

async function firstQualified(urls, { preferredPorts = [], hint = '' } = {}) {
  const candidates = []
  for (const item of urls) {
    const url = typeof item === 'string' ? item : item?.url
    if (!url) continue
    const probe = await probeHttp(url)
    if (probe?.ok) {
      candidates.push({
        url: probe.url || url,
        probe,
        hint: (typeof item === 'object' && item.hint) || hint,
        preferredPorts,
        reused: true,
      })
    }
  }
  return chooseFrontendProbe(candidates)
}

export async function findReusableDevServer({ workspaceRoot, preferredUrl, discoverListeners } = {}) {
  const preferred = normalizeProbeUrl(preferredUrl)
  const listeners = await resolveListeners(discoverListeners)
  const workspaceLogin = loginUrlFromListeners(listeners, workspaceRoot)
  let preferredRejected = false
  if (preferred) {
    const probe = await probeHttp(preferred)
    if (isAcceptableManualPage(probe)) {
      const loginUrl = pickLoginOpenUrl([workspaceLogin, loginUrlFromListeners(listeners, workspaceRoot, { origin: probe.url || preferred })].filter(Boolean).join('\n'), { origin: probe.url || preferred })
      return {
        url: probe.url || preferred,
        probe,
        reused: true,
        loginUrl: loginUrl || '',
        limitedCapabilities: probe.ok !== true,
      }
    }
    preferredRejected = Boolean(probe || preferred)
  }
  const entries = listProjectDevEntries(workspaceRoot)
  const scriptPorts = collectCandidatePorts(entries)
  const frontendPorts = collectCandidatePorts(entries.filter((entry) => entry.frontend))
  const workspacePorts = reusePortsFromListeners(listeners, workspaceRoot)
  const ports = uniqueNumbers([...workspacePorts, ...scriptPorts])
  const urls = []
  for (const port of ports) {
    if (await canConnect('127.0.0.1', port)) urls.push(resolveUrlFromPort(port))
  }
  const found = await firstQualified(urls, { preferredPorts: [...workspacePorts, ...frontendPorts] })
  if (found) {
    const loginUrl = pickLoginOpenUrl(
      [workspaceLogin, loginUrlFromListeners(listeners, workspaceRoot, { origin: found.url })].filter(Boolean).join('\n'),
      { origin: found.url },
    )
    return { ...found, reused: true, loginUrl: loginUrl || '' }
  }
  return preferredRejected
    ? { url: '', probe: null, reused: false, preferredRejected: true, preferredUrl: preferred, loginUrl: '' }
    : null
}


export function resolveSpawnInvocation(command, {
  platform = process.platform,
  pathEnv = process.env.PATH,
  pathExt = process.env.PATHEXT,
  pathDelimiter,
  cwd = '',
  exists = existsSync,
} = {}) {
  const file = String(command?.[0] || '')
  const args = Array.isArray(command) ? command.slice(1) : []
  if (!file) return { file: '', args, shell: false }
  if (platform !== 'win32') return { file, args, shell: false }

  const pathImpl = path.win32
  const delimiter = pathDelimiter || pathImpl.delimiter
  const resolved = resolveWindowsCommand(file, {
    pathEnv,
    pathExt,
    pathDelimiter: delimiter,
    cwd,
    exists,
    pathImpl,
  })
  if (resolved) return { file: resolved, args, shell: false }
  return { file, args, shell: true }
}

function resolveWindowsCommand(bin, { pathEnv, pathExt, pathDelimiter, cwd, exists, pathImpl }) {
  const extList = String(pathExt || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
  const hasExt = Boolean(pathImpl.extname(bin))
  const names = hasExt ? [bin] : [bin, ...extList.map((ext) => (ext.startsWith('.') ? bin + ext : `${bin}.${ext}`))]
  if (pathImpl.isAbsolute(bin)) {
    for (const name of names) {
      if (exists(name)) return name
    }
    return null
  }
  const dirs = []
  if (cwd) dirs.push(cwd)
  for (const dir of String(pathEnv || '').split(pathDelimiter)) {
    if (dir) dirs.push(dir)
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = pathImpl.join(dir, name)
      if (exists(candidate)) return candidate
      const extLower = candidate.replace(/(\.[^.\\]+)$/, (match) => match.toLowerCase())
      if (extLower !== candidate && exists(extLower)) return extLower
    }
  }
  return null
}

export function spawnProjectCommand(command, {
  cwd,
  env,
  stdio = ['ignore', 'pipe', 'pipe'],
  spawnImpl = spawn,
  platform = process.platform,
  pathEnv = process.env.PATH,
  pathExt = process.env.PATHEXT,
  pathDelimiter,
  exists = existsSync,
} = {}) {
  const invocation = resolveSpawnInvocation(command, {
    platform,
    pathEnv,
    pathExt,
    pathDelimiter,
    cwd,
    exists,
  })
  const child = spawnImpl(invocation.file, invocation.args, {
    cwd,
    env,
    stdio,
    shell: invocation.shell,
  })
  const result = { child, invocation, error: null }
  if (child && typeof child.on === 'function') {
    child.on('error', (error) => {
      result.error = error
    })
  }
  return result
}

function isAcceptableManualPage(probe) {
  return Boolean(probe && !isRejectedResponder(probe) && looksLikeHtml(probe))
}

async function stopSpawnedProcess(child) {
  if (!child || child.killed || child.exitCode != null) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      resolve()
    }, 1500)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

async function startOneDevServer(chosen, { timeoutMs, frontendPorts } = {}) {
  const spawned = spawnProjectCommand(chosen.command, {
    cwd: chosen.cwd,
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const child = spawned.child
  let output = ''
  const logUrls = []
  const onData = (chunk) => {
    output += chunk.toString()
    if (output.length > 20000) output = output.slice(-12000)
    for (const found of extractUrlsFromOutput(chunk)) {
      if (!logUrls.some((item) => item.url === found.url)) logUrls.push(found)
    }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (spawned.error) {
      throw devServerError('DEV_SERVER_SPAWN_FAILED', spawned.error.message || 'Failed to start the project command.')
    }
    if (child.exitCode != null) {
      throw devServerError('DEV_SERVER_EXITED', 'The project command exited before a frontend dev server came up.')
    }
    const unique = []
    const seen = new Set()
    for (const item of logUrls) {
      const url = normalizeProbeUrl(item.url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      unique.push({ ...item, url })
    }
    const reached = await firstQualified(unique, { preferredPorts: frontendPorts })
    if (reached) {
      return {
        url: reached.url,
        reused: false,
        started: true,
        script: chosen.name,
        cwd: chosen.cwd,
        command: chosen.commandText || chosen.command.join(' '),
        child,
        output,
        probe: reached.probe,
        loginUrl: pickLoginOpenUrl(output, { origin: reached.url }) || '',
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await stopSpawnedProcess(child)
  throw devServerError('DEV_SERVER_TIMEOUT', 'Timed out waiting for the project\'s frontend dev server.')
}

export async function startDevServer({ workspaceRoot, scriptName, timeoutMs = 30000 } = {}) {
  const waitMs = Math.max(1000, Number(timeoutMs) || 30000)
  const entries = listProjectDevEntries(workspaceRoot)
  const ranked = rankStartEntries(entries)
  const named = scriptName ? ranked.filter((entry) => entry.name === scriptName) : []
  const ordered = named.length
    ? [...named, ...ranked.filter((entry) => !named.includes(entry))]
    : ranked
  if (!ordered.length) {
    throw devServerError('DEV_SERVER_SCRIPT_MISSING', 'No frontend dev server entry was found in this project.')
  }

  const frontendPorts = collectCandidatePorts(entries.filter((entry) => entry.frontend))
  let lastError = null
  for (const [index, chosen] of ordered.entries()) {
    const hasNext = index < ordered.length - 1
    try {
      return await startOneDevServer(chosen, { timeoutMs: waitMs, frontendPorts })
    } catch (error) {
      lastError = error
      const retryable = error?.code === 'DEV_SERVER_EXITED' || error?.code === 'DEV_SERVER_TIMEOUT'
      if (!retryable || !hasNext) throw error
    }
  }
  throw lastError || devServerError('DEV_SERVER_SCRIPT_MISSING', 'No frontend dev server entry was found in this project.')
}

export async function ensureDevServer({ workspaceRoot, preferredUrl, startIfMissing = true, timeoutMs = 30000, discoverListeners } = {}) {
  const reused = await findReusableDevServer({ workspaceRoot, preferredUrl, discoverListeners })
  if (reused?.url) {
    return {
      url: reused.url,
      reused: true,
      started: false,
      script: '',
      command: '',
      child: null,
      probe: reused.probe,
      loginUrl: reused.loginUrl || '',
      limitedCapabilities: reused.limitedCapabilities === true,
    }
  }
  if (!startIfMissing) {
    throw devServerError('DEV_SERVER_NOT_FOUND', reused?.preferredRejected
      ? `The URL ${reused.preferredUrl} does not look like a frontend development server.`
      : 'No running frontend development server was found, and auto-start was disabled.')
  }
  try {
    return await startDevServer({ workspaceRoot, timeoutMs })
  } catch (error) {
    if (reused?.preferredRejected) {
      error.message = `The URL ${reused.preferredUrl} does not look like a frontend development server. ${error.message}`
    }
    throw error
  }
}
