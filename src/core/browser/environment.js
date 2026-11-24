import { hasDevSignals } from './dev-server.js'

export function collectPageDevSignals() {
  const strong = []
  const weak = []
  const push = (list, id, detail = '') => {
    if (!list.some((item) => item.id === id)) list.push({ id, detail: String(detail || '').slice(0, 200) })
  }

  const href = String(location.href || '')
  let host = ''
  let port = ''
  try {
    const parsed = new URL(href)
    host = parsed.hostname
    port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  } catch {
    // Ignore unparsable URLs.
  }
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(host)
  if (loopback) push(weak, 'loopback-host', host)
  if (/^(3000|3001|3173|4000|4173|4200|4321|5000|5173|5174|8080|8081|8888|9000|24678)$/.test(port)) {
    push(weak, 'common-dev-port', port)
  }

  const scripts = [...document.scripts]
  const scriptSrc = scripts.map((script) => String(script.src || '')).join('\n')
  const inline = scripts.map((script) => String(script.textContent || '')).join('\n')
  const cssText = [...document.styleSheets].map((sheet) => {
    try { return [...sheet.cssRules].map((rule) => rule.cssText).join('\n') } catch { return '' }
  }).join('\n')

  const hasMapComment = (text) => /[@#]\s*sourceMappingURL=/.test(String(text || ''))
  if (scripts.some((script) => hasMapComment(script.textContent) || /\.map(\?|#|$)/.test(script.src))) {
    push(strong, 'script-sourcemap')
  }
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => hasMapComment(link.textContent))) {
    push(strong, 'css-sourcemap')
  }
  if (hasMapComment(cssText)) push(strong, 'css-rule-sourcemap')
  if (hasMapComment(inline)) push(strong, 'inline-script-sourcemap')

  if (scriptSrc.includes('@vite/client') || scriptSrc.includes('/@vite/') || scriptSrc.includes('/@fs/') || scriptSrc.includes('/@id/')) {
    push(strong, 'vite-client')
  }
  if (typeof window.__vite_plugin_react_preamble_installed__ !== 'undefined' || window.__vite__ || document.querySelector('vite-error-overlay')) {
    push(strong, 'vite-runtime')
  }
  if (typeof window.webpackHotUpdate === 'function' || typeof window.__webpack_hash__ !== 'undefined' || typeof window.__webpack_dev_server__ !== 'undefined' || /webpack-hmr|__webpack_dev_server__/.test(scriptSrc + inline)) {
    push(strong, 'webpack-hmr')
  }
  if (typeof window.__rsbuild_version !== 'undefined' || typeof window.__rsbuildHmr !== 'undefined' || /@rsbuild\/|@rspack\/|rsbuild-hmr|rspack-dev-server|__rsbuild|cssExtractHmr|node_modules_rspack|rspack_core/.test(scriptSrc + inline)) {
    push(strong, 'rsbuild-dev')
  }
  if (typeof window.$RefreshReg$ === 'function' || typeof window.$RefreshSig$ === 'function') {
    push(strong, 'react-refresh')
  }
  if (document.querySelector('#__next-build-watcher') || (scriptSrc + inline).includes('/_next/webpack-hmr') || (scriptSrc + inline).includes('next/dist/client')) {
    push(strong, 'next-dev')
  }
  if (typeof window.__PARCEL_HMR__ !== 'undefined' || /parcel-runtime|@parcel\/runtime/.test(scriptSrc + inline)) {
    push(strong, 'parcel-hmr')
  }
  if (window.__sveltekit__?.env?.DEV === true || /svelte-hmr|vite-plugin-svelte/.test(scriptSrc + inline)) {
    push(strong, 'svelte-dev')
  }
  if (/react-dom(?:\.[a-z]+)?\.development/.test(scriptSrc + inline) || /process\.env\.NODE_ENV\s*===\s*['"]development['"]/.test(inline)) {
    push(strong, 'development-bundle')
  }
  if (typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ === 'object' && window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
    const renderers = hook.renderers || hook._renderers
    let developmentRenderer = false
    try {
      const values = renderers && typeof renderers.values === 'function' ? [...renderers.values()] : Object.values(renderers || {})
      developmentRenderer = values.some((renderer) => renderer?.bundleType === 1)
    } catch {
      developmentRenderer = false
    }
    if (developmentRenderer) push(strong, 'react-dev-renderer')
    else push(weak, 'react-devtools')
  }
  if (typeof window.__VUE_DEVTOOLS_GLOBAL_HOOK__ === 'object' && window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    push(weak, 'vue-devtools')
  }
  if (window.__NEXT_DATA__ && !strong.some((item) => item.id === 'next-dev')) {
    push(weak, 'next-data')
  }

  return {
    url: href,
    title: String(document.title || ''),
    strong,
    weak,
  }
}

export function isDevEnvironment(report) {
  return Array.isArray(report?.strong) && report.strong.length > 0
}

function isAppScriptUrl(url) {
  const value = String(url || '')
  if (!value) return false
  if (value.startsWith('extensions::') || value.startsWith('chrome-extension:') || value.startsWith('devtools://')) return false
  return true
}

export async function collectCdpDevSignals(session) {
  const strong = []
  const push = (id, detail = '') => {
    if (!strong.some((item) => item.id === id)) strong.push({ id, detail: String(detail || '').slice(0, 200) })
  }
  for (const script of session?.scripts?.values?.() || []) {
    if (!isAppScriptUrl(script.url) && !isAppScriptUrl(script.sourceMapURL)) continue
    if (script.sourceMapURL) push('cdp-sourcemap', script.url || script.sourceMapURL)
    const url = String(script.url || '')
    if (url.includes('@vite/client') || url.includes('/@vite/') || url.includes('/@fs/')) push('cdp-vite-client', url)
    if (/webpack-hmr|__webpack_dev_server__/.test(url)) push('cdp-webpack-hmr', url)
    if (url.includes('@rsbuild/') || url.includes('@rspack/') || url.includes('rsbuild-hmr') || url.includes('rspack-dev-server') || /cssExtractHmr|node_modules_rspack|rspack_core/.test(url)) {
      push('cdp-rsbuild', url)
    }
  }
  return strong
}

export async function probeDevEnvironment(session) {
  const pageSignals = session?.page
    ? await session.page.evaluate(collectPageDevSignals).catch(() => ({ url: session.page.url(), title: '', strong: [], weak: [] }))
    : { url: '', title: '', strong: [], weak: [] }
  const cdpSignals = await collectCdpDevSignals(session)
  const seen = new Set(pageSignals.strong.map((item) => item.id))
  const strong = [...pageSignals.strong]
  for (const item of cdpSignals) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    strong.push(item)
  }
  if (!strong.length) {
    const pageUrl = pageSignals.url || session?.page?.url?.() || ''
    const originSignals = await collectOriginDevSignals(pageUrl).catch(() => [])
    for (const item of originSignals) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      strong.push(item)
    }
  }
  return {
    ok: strong.length > 0,
    url: pageSignals.url || session?.page?.url?.() || '',
    title: pageSignals.title || '',
    strong,
    weak: pageSignals.weak || [],
  }
}

export const ORIGIN_DEV_CLIENT_PATHS = Object.freeze([
  '/@vite/client',
  '/@vite/env',
  '/__vite_ping',
  '/@react-refresh',
  '/webpack-dev-server',
  '/__webpack_hmr',
  '/__webpack_dev_server__',
  '/_next/webpack-hmr',
])

function headerType(headers) {
  return String(headers?.['content-type'] || headers?.['Content-Type'] || '')
}

function isHtmlResponse(headers, body) {
  if (/text\/html/i.test(headerType(headers))) return true
  return /<!doctype html|<html[\s>]/i.test(String(body || '').trim())
}

export function originSignalsFromResponse({ url = '', status = 0, headers = {}, body = '' } = {}) {
  const strong = []
  if (status < 200 || status >= 400) return strong
  const href = String(url || '')
  const text = String(body || '')
  if (isHtmlResponse(headers, text)) {
    // Do not use the request URL as evidence: an HTML fallback from /@vite/client is not a dev client.
    if (hasDevSignals(text, headerType(headers), '')) {
      strong.push({ id: 'origin-dev-document', detail: href.slice(0, 200) })
    }
    return strong
  }
  const blob = `${href}\n${text}`
  if (!(hasDevSignals(text, headerType(headers), href) || /@vite\/client|\/@vite\/|webpack-dev-server|__webpack_hmr|webpack-hmr|@rsbuild\/|rsbuild-hmr|\/_next\/webpack-hmr/i.test(blob))) {
    return strong
  }
  let id = 'origin-dev-client'
  if (/@vite\/|\/@vite\//i.test(blob)) id = 'origin-vite-client'
  else if (/webpack|\/_next\/webpack-hmr/i.test(blob)) id = 'origin-webpack-hmr'
  else if (/rsbuild|rspack/i.test(blob)) id = 'origin-rsbuild'
  else if (/sourceMappingURL/i.test(text)) id = 'origin-sourcemap'
  strong.push({ id, detail: href.slice(0, 200) })
  return strong
}

export async function collectOriginDevSignals(pageUrl, { fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  const strong = []
  let origin = ''
  try {
    origin = new URL(pageUrl).origin
  } catch {
    return strong
  }
  if (!/^https?:$/i.test(new URL(origin).protocol)) return strong
  for (const pathname of ['/', ...ORIGIN_DEV_CLIENT_PATHS]) {
    const target = `${origin}${pathname}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(target, { signal: controller.signal, redirect: 'follow' })
      const headers = response.headers?.entries
        ? Object.fromEntries(response.headers.entries())
        : (response.headers || {})
      const raw = typeof response.text === 'function' ? await response.text() : (response.body || '')
      const found = originSignalsFromResponse({
        url: response.url || target,
        status: response.status,
        headers,
        body: String(raw || '').slice(0, 8000),
      })
      for (const item of found) {
        if (!strong.some((entry) => entry.id === item.id)) strong.push(item)
      }
      if (strong.length) return strong
    } catch {
      // Origin probes must not fail the page-level environment check.
    } finally {
      clearTimeout(timer)
    }
  }
  return strong
}
