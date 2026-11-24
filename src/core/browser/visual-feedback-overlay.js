import { getVisualFeedbackOverlayStrings } from './visual-feedback-i18n.js'

export const VISUAL_FEEDBACK_BINDING = '__codeminiVisualFeedback'
export const VISUAL_FEEDBACK_MARKUP_LIMIT = 280
export const VISUAL_FEEDBACK_CHILD_LABEL_LIMIT = 160
export const VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT = 80

const INTERACTIVE_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'summary']
const INTERACTIVE_ROLES = [
  'button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'option',
  'slider', 'spinbutton',
]

export function visualFeedbackOwnName(element) {
  if (!element || typeof element.getAttribute !== 'function') return ''
  const value = element.getAttribute('aria-label')
    || element.getAttribute('name')
    || element.getAttribute('placeholder')
    || ''
  return String(value).replace(/\s+/g, ' ').trim()
}

export function isVisualFeedbackInteractiveElement(element) {
  if (!element || !element.tagName) return false
  const tag = String(element.tagName).toLowerCase()
  if (INTERACTIVE_TAGS.includes(tag)) return true
  if (element.isContentEditable) return true
  const role = String(typeof element.getAttribute === 'function' ? element.getAttribute('role') : '').toLowerCase()
  return INTERACTIVE_ROLES.includes(role)
}

export function visualFeedbackInteractiveAncestorName(element, limit = VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT) {
  if (!element) return ''
  const ownRole = typeof element.getAttribute === 'function' ? (element.getAttribute('role') || '') : ''
  const ownAria = typeof element.getAttribute === 'function' ? (element.getAttribute('aria-label') || '') : ''
  if (visualFeedbackOwnName(element) || ownRole || ownAria) return ''
  const doc = element.ownerDocument
  const stop = new Set([doc?.documentElement, doc?.body, null, undefined])
  let node = element.parentElement
  while (node && !stop.has(node)) {
    if (isVisualFeedbackInteractiveElement(node)) {
      const label = visualFeedbackOwnName(node)
        || (typeof node.getAttribute === 'function' ? (node.getAttribute('title') || '') : '')
        || String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
      const text = String(label || '').replace(/\s+/g, ' ').trim()
      if (!text) return ''
      const tag = String((typeof node.getAttribute === 'function' && node.getAttribute('role')) || node.tagName || '').toLowerCase()
      const field = tag ? `${tag} "${text.slice(0, limit)}"` : text.slice(0, limit)
      return field.slice(0, limit)
    }
    node = node.parentElement
  }
  return ''
}

export function visualFeedbackChildLabels(
  element,
  html,
  markupLimit = VISUAL_FEEDBACK_MARKUP_LIMIT,
  labelLimit = VISUAL_FEEDBACK_CHILD_LABEL_LIMIT,
) {
  const raw = html != null
    ? String(html)
    : String(element?.outerHTML || '').replace(/\s+/g, ' ').trim()
  if (!raw || raw.length <= markupLimit) return ''
  if (!element || typeof element.querySelectorAll !== 'function') return ''
  const nodes = element.querySelectorAll(
    'a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="switch"]',
  )
  const parts = []
  const seen = new Set()
  for (const node of nodes) {
    if (node === element) continue
    const tag = String((typeof node.getAttribute === 'function' && node.getAttribute('role')) || node.tagName || '').toLowerCase()
    const label = (
      visualFeedbackOwnName(node)
      || (typeof node.getAttribute === 'function' ? (node.getAttribute('title') || '') : '')
      || String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
    ).replace(/\s+/g, ' ').trim().slice(0, 32)
    const part = label ? `${tag} "${label}"` : tag
    if (!part || seen.has(part)) continue
    seen.add(part)
    parts.push(part)
    if (parts.length >= 8) break
  }
  return parts.join(', ').slice(0, labelLimit)
}

export function getVisualFeedbackInitScript(localeOrStrings = 'zh') {
  const strings = typeof localeOrStrings === 'string' || localeOrStrings == null
    ? getVisualFeedbackOverlayStrings(localeOrStrings)
    : getVisualFeedbackOverlayStrings(localeOrStrings.locale, localeOrStrings)
  return `(() => {
    const VISUAL_FEEDBACK_MARKUP_LIMIT = ${VISUAL_FEEDBACK_MARKUP_LIMIT};
    const VISUAL_FEEDBACK_CHILD_LABEL_LIMIT = ${VISUAL_FEEDBACK_CHILD_LABEL_LIMIT};
    const VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT = ${VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT};
    const INTERACTIVE_TAGS = ${JSON.stringify(INTERACTIVE_TAGS)};
    const INTERACTIVE_ROLES = ${JSON.stringify(INTERACTIVE_ROLES)};
    ${visualFeedbackOwnName.toString()}
    ${isVisualFeedbackInteractiveElement.toString()}
    ${visualFeedbackInteractiveAncestorName.toString()}
    ${visualFeedbackChildLabels.toString()}
    (${installVisualFeedbackOverlay.toString()})(${JSON.stringify(strings)});
  })();`
}

function installVisualFeedbackOverlay(inputStrings) {
  const ROOT_ID = 'codemini-visual-feedback-root'
  const STORAGE_KEY = 'codemini-visual-feedback-v1'
  const STYLE_PROPS = [
    'display', 'visibility', 'opacity', 'pointer-events', 'cursor',
    'position', 'z-index', 'overflow', 'width', 'height', 'color',
    'background-color', 'font-size', 'font-weight', 'line-height',
    'margin', 'padding', 'border', 'transform',
  ]

  let strings = inputStrings && typeof inputStrings === 'object' ? inputStrings : {}
  function tx(key, vars) {
    const template = strings[key] || key
    return String(template).replace(/\{\{(\w+)\}\}/g, (_, name) => (
      vars && vars[name] != null ? String(vars[name]) : ''
    ))
  }
  function applyStrings(next) {
    if (next && typeof next === 'object') strings = next
  }

  if (window.__codeminiVisualFeedbackApi && typeof window.__codeminiVisualFeedbackApi.ensure === 'function') {
    window.__codeminiVisualFeedbackApi.setStrings?.(strings)
    window.__codeminiVisualFeedbackApi.ensure()
    return
  }
  if (window.__codeminiVfInstalling) return
  window.__codeminiVfInstalling = true

  function cssPath(element) {
    if (!element || element.nodeType !== 1) return ''
    if (element.id && /^[A-Za-z][\w-]*$/.test(element.id)) return `#${CSS.escape(element.id)}`
    const parts = []
    let node = element
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let index = 1
      let sibling = node
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) index += 1
      }
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`)
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts[0] = `#${CSS.escape(node.id)}`
        break
      }
      if (parts.length > 8) break
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  function collectSignals() {
    const strong = []
    const weak = []
    const push = (list, id, detail) => {
      if (!list.some((item) => item.id === id)) list.push({ id, detail: String(detail || '').slice(0, 200) })
    }
    const href = String(location.href || '')
    let host = ''
    try { host = new URL(href).hostname } catch { /* ignore */ }
    if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(host)) push(weak, 'loopback-host', host)
    const scripts = [...document.scripts]
    const scriptSrc = scripts.map((script) => String(script.src || '')).join('\n')
    const inline = scripts.map((script) => String(script.textContent || '')).join('\n')
    if (scripts.some((script) => /[@#]\s*sourceMappingURL=/.test(script.textContent || '') || /\.map(\?|#|$)/.test(script.src || ''))) {
      push(strong, 'script-sourcemap')
    }
    if (scriptSrc.includes('@vite/client') || scriptSrc.includes('/@vite/') || scriptSrc.includes('/@fs/')) push(strong, 'vite-client')
    if (typeof window.__vite_plugin_react_preamble_installed__ !== 'undefined' || window.__vite__ || document.querySelector('vite-error-overlay')) {
      push(strong, 'vite-runtime')
    }
    if (typeof window.webpackHotUpdate === 'function' || typeof window.__webpack_hash__ !== 'undefined' || typeof window.__webpack_dev_server__ !== 'undefined' || /webpack-hmr|__webpack_dev_server__/.test(scriptSrc + inline)) {
      push(strong, 'webpack-hmr')
    }
    if (typeof window.__rsbuild_version !== 'undefined' || typeof window.__rsbuildHmr !== 'undefined' || /@rsbuild\/|@rspack\/|rsbuild-hmr|rspack-dev-server|__rsbuild|cssExtractHmr|node_modules_rspack|rspack_core/.test(scriptSrc + inline)) {
      push(strong, 'rsbuild-dev')
    }
    if (typeof window.$RefreshReg$ === 'function' || typeof window.$RefreshSig$ === 'function') push(strong, 'react-refresh')
    if (document.querySelector('#__next-build-watcher') || (scriptSrc + inline).includes('/_next/webpack-hmr') || (scriptSrc + inline).includes('next/dist/client')) {
      push(strong, 'next-dev')
    }
    if (/react-dom(?:\.[a-z]+)?\.development/.test(scriptSrc + inline)) push(strong, 'development-bundle')
    return { url: href, title: String(document.title || ''), strong, weak }
  }

  function styleSnapshot(element) {
    const style = getComputedStyle(element)
    const out = {}
    for (const prop of STYLE_PROPS) out[prop] = style.getPropertyValue(prop)
    return out
  }

  function describeElement(element) {
    const rect = element.getBoundingClientRect()
    const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    const name = visualFeedbackOwnName(element)
    const role = element.getAttribute('role') || ''
    const rawHtml = String(element.outerHTML || '').replace(/\s+/g, ' ').trim()
    const html = rawHtml.slice(0, VISUAL_FEEDBACK_MARKUP_LIMIT)
    const ancestorName = visualFeedbackInteractiveAncestorName(element, VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT)
    const childLabels = visualFeedbackChildLabels(element, rawHtml, VISUAL_FEEDBACK_MARKUP_LIMIT, VISUAL_FEEDBACK_CHILD_LABEL_LIMIT)
    return {
      selector: cssPath(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      className: typeof element.className === 'string' ? element.className : '',
      role,
      name,
      type: element.getAttribute('type') || '',
      href: element.getAttribute('href') || '',
      text,
      html,
      ...(ancestorName ? { ancestorName } : {}),
      ...(childLabels ? { childLabels } : {}),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      },
      styles: styleSnapshot(element),
    }
  }

  function normalizeNoteText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function currentElementState(element) {
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      text: normalizeNoteText(element.innerText || element.textContent || '').slice(0, 240),
    }
  }

  function noteTargets(note) {
    if (Array.isArray(note?.elements) && note.elements.length) return note.elements.filter(Boolean)
    return note?.element ? [note.element] : []
  }

  function isElementDescriptorStale(expected) {
    const element = expected?.selector ? document.querySelector(expected.selector) : null
    if (!element) return true
    const current = currentElementState(element)
    if (expected.tag && expected.tag !== current.tag) return true
    if (expected.id && expected.id !== current.id) return true
    const expectedText = normalizeNoteText(expected.text)
    if (expectedText && expectedText !== current.text) return true
    return false
  }

  function isNoteStale(note) {
    const targets = noteTargets(note)
    if (!targets.length) return true
    return targets.some((expected) => isElementDescriptorStale(expected))
  }

  function refreshNoteStaleness() {
    let changed = false
    for (const note of state.notes) {
      const stale = isNoteStale(note)
      if (Boolean(note.stale) !== stale) changed = true
      note.stale = stale
    }
    return changed
  }

  const state = {
    mode: false,
    blocked: false,
    environment: { ok: false, strong: [], weak: [] },
    notes: [],
    hover: null,
    draft: null,
    message: '',
    status: '',
    statusKey: '',
    listOpen: false,
    expandedNoteId: '',
    target: null,
    retargetStack: [],
    retargetLocked: false,
    captureHidden: false,
    composing: false,
    selection: [],
    boxSelect: null,
    ignoreClick: false,
  }

  function storageId() {
    return `${STORAGE_KEY}:${location.origin}${location.pathname}`
  }

  function loadState() {
    try {
      const raw = sessionStorage.getItem(storageId())
      if (!raw) return
      const saved = JSON.parse(raw)
      if (Array.isArray(saved.notes)) state.notes = saved.notes
      if (saved.mode === true) state.mode = true
    } catch {
      // Ignore damaged session state.
    }
  }

  function saveState() {
    try {
      sessionStorage.setItem(storageId(), JSON.stringify({ mode: state.mode, notes: state.notes }))
    } catch {
      // Private mode or quota.
    }
  }

  function isOverlayEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    return path.some((node) => node && node.id === ROOT_ID)
  }

  function overlayRoot() {
    return document.getElementById(ROOT_ID)
  }

  const ui = {
    shadow: null,
    host: null,
    hover: null,
    selected: new Map(),
  }

  function ensureHost() {
    let host = overlayRoot()
    if (!host) {
      host = document.createElement('div')
      host.id = ROOT_ID
      host.setAttribute('data-codemini-visual-feedback', 'true')
      const parent = document.documentElement || document.body
      if (!parent || typeof parent.appendChild !== 'function') return null
      parent.appendChild(host)
    }
    if (!host.shadowRoot) {
      ui.shadow = host.attachShadow({ mode: 'open' })
      ui.shadow.innerHTML = `${overlayStyles()}<div class="vf"></div><div class="hover" hidden></div>`
    } else {
      ui.shadow = host.shadowRoot
    }
    ui.host = host
    ui.hover = ui.shadow.querySelector('.hover')
    return host
  }

  function overlayStyles() {
    return `<style>
      :host { all: initial; position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483646; }
      .vf { position: fixed; z-index: 2147483646; pointer-events: none; display: flex; flex-direction: column; align-items: stretch; gap: 6px; width: min(420px, calc(100vw - 24px)); max-width: calc(100vw - 24px); font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #f5f5f4; }
      .toolbar, .tray { pointer-events: auto; box-sizing: border-box; background: rgba(22, 20, 19, 0.92); border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 8px 24px rgba(0,0,0,0.25); backdrop-filter: blur(14px); }
      .toolbar { display: flex; align-items: center; gap: 2px; min-height: 40px; padding: 3px 4px 3px 8px; border-radius: 10px; }
      .tray { padding: 8px 10px; border-radius: 10px; max-height: min(240px, 42vh); overflow: auto; }
      .brand { flex: 0 0 auto; font-weight: 600; font-size: 11px; letter-spacing: -0.01em; color: #c8c4be; padding: 0 8px 0 2px; white-space: nowrap; }
      .toolbar button, .tray button { font: inherit; border: 0; cursor: pointer; }
      .toolbar button { display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 8px; border-radius: 8px; background: transparent; color: #f5f5f4; font-weight: 550; white-space: nowrap; }
      .toolbar button:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
      .toolbar button[aria-pressed="true"] { background: rgba(255,255,255,0.12); }
      .toolbar button.primary { background: #f3efe7; color: #1a1614; font-weight: 600; }
      .toolbar button.primary:hover:not(:disabled) { background: #fff; }
      .toolbar button:disabled { opacity: 0.42; cursor: not-allowed; }
      .toolbar .icon { width: 13px; height: 13px; display: block; flex: none; }
      .badge { margin-left: auto; font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #2f6b3a; color: #d8ffe0; white-space: nowrap; }
      .badge.warn { background: #6b3a2f; color: #ffd8d0; }
      .status { margin: 0; color: #c9d4ff; }
      .hint, .err { margin: 0; color: #c7c4bf; }
      .err { color: #ffb4a8; }
      .notes { list-style: none; margin: 0; padding: 0; }
      .sel-head { margin: 0 0 4px; color: #c8c4be; font-weight: 650; }
      .notes li { display: flex; gap: 8px; align-items: flex-start; padding: 6px 2px; border-top: 1px solid rgba(255,255,255,0.08); cursor: pointer; }
      .notes .tick { flex: none; margin-top: 2px; display: flex; align-items: center; }
      .notes .tick input { width: 13px; height: 13px; margin: 0; accent-color: #f0b429; cursor: pointer; }
      .notes li:first-child { border-top: 0; }
      .notes li.stale { opacity: 0.62; }
      .notes .excerpt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .notes li.is-open .excerpt { white-space: normal; }
      .notes .sel { color: #b7c7ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .notes .detail { margin: 4px 0 0; color: #d8d4ce; }
      .notes .stale-flag { color: #f0b429; font-size: 10px; font-weight: 650; }
      .note-main { min-width: 0; flex: 1; }
      .x { background: transparent; color: #f5f0e8; border: 0; padding: 0 4px; line-height: 1; }
      .composer { display: flex; flex-direction: column; gap: 6px; }
      .kind { display: flex; gap: 10px; color: #d8d4ce; }
      textarea { width: 100%; min-height: 56px; max-height: 96px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); color: #fff; padding: 6px 8px; resize: vertical; box-sizing: border-box; font: inherit; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; }
      .tray button.action { border: 0; border-radius: 8px; padding: 5px 9px; cursor: pointer; background: #f3efe7; color: #1a1614; font-weight: 600; }
      .tray button.ghost { background: transparent; color: #f5f0e8; border: 1px solid rgba(255,255,255,0.16); }
      .empty { margin: 0; color: #b0aba4; }
      .hover { position: fixed; z-index: 2147483645; pointer-events: none; border: 2px solid #7ea0ff; background: rgba(126, 160, 255, 0.12); border-radius: 4px; }
      .hover .label { position: absolute; left: -2px; top: -16px; max-width: min(100%, 240px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #7ea0ff; color: #0f1728; font: 700 10px/16px ui-sans-serif, system-ui, sans-serif; padding: 0 5px; border-radius: 4px 4px 0 0; pointer-events: none; }
      .hover.label-inside .label { top: 0; border-radius: 0 0 4px 0; }
      .hover.is-retarget { animation: vf-retarget-flash 0.32s ease-out; }
      @keyframes vf-retarget-flash {
        0% { box-shadow: 0 0 0 0 rgba(126, 160, 255, 0); }
        35% { box-shadow: 0 0 0 4px rgba(126, 160, 255, 0.9); }
        100% { box-shadow: 0 0 0 0 rgba(126, 160, 255, 0); }
      }
      .mark { position: fixed; z-index: 2147483645; pointer-events: none; border: 2px solid #f0b429; background: rgba(240, 180, 41, 0.12); border-radius: 4px; }
      .mark.pending { border-color: #7ea0ff; background: rgba(126, 160, 255, 0.12); }
      .box { position: fixed; z-index: 2147483644; pointer-events: none; border: 1.5px dashed #7ea0ff; background: rgba(126, 160, 255, 0.14); border-radius: 2px; }
      .check-pin { position: fixed; z-index: 2147483647; pointer-events: auto; box-sizing: border-box; width: 16px; height: 16px; margin: 0; padding: 0; border: 0; background: transparent; display: flex; align-items: center; justify-content: center; }
      .check-pin input { width: 14px; height: 14px; margin: 0; accent-color: #f0b429; cursor: pointer; }
      .pin { position: fixed; z-index: 2147483647; pointer-events: auto; box-sizing: border-box; width: 20px; height: 20px; margin: 0; border: 0; border-radius: 999px; background: #f0b429; color: #1a1614; font: 700 10px/20px ui-sans-serif, system-ui, sans-serif; text-align: center; padding: 0; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.35); }
      .pin.stale { background: #8a7a55; color: #f5f0e8; box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
      .pin.is-open:not(.stale) { background: #fff; box-shadow: 0 0 0 2px #f0b429; }
      .retarget { display: inline-flex; gap: 4px; }
      .tray button.retarget-btn { min-width: 28px; height: 24px; padding: 0 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.16); background: transparent; color: #f5f0e8; font-weight: 650; }
    </style>`
  }

  function icon(name) {
    if (name === 'select') return '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 2.5 13 8.1 8.3 9.4 7 14.2 3 2.5Z"/></svg>'
    if (name === 'notes') return '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M3.5 3.5h9v9h-6l-3-3z"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M6 7.5h4M6 10h2.5"/></svg>'
    return '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M3 8.5h7.5M8 5.5 11.5 8.5 8 11.5"/><path fill="none" stroke="currentColor" stroke-width="1.4" d="M13 3.5v9"/></svg>'
  }

  function render() {
    const host = ensureHost()
    if (!host || !ui.shadow) return
    const root = ui.shadow.querySelector('.vf')
    if (!root) return
    const envOk = state.environment.ok === true && !state.blocked
    const count = state.notes.length
    const countLabel = count === 1
      ? tx('visualFeedbackOverlayNoteCountOne')
      : tx('visualFeedbackOverlayNoteCount', { count })
    const badge = envOk
      ? `<span class="badge">${escapeHtml(tx('visualFeedbackOverlayEnvOk'))}</span>`
      : `<span class="badge warn">${escapeHtml(tx('visualFeedbackOverlayEnvBlocked'))}</span>`
    const notes = state.notes.map((note) => {
      const open = state.expandedNoteId === note.id
      const kind = note.kind === 'functional' ? tx('visualFeedbackOverlayFunctional') : tx('visualFeedbackOverlayVisual')
      const stale = note.stale ? `<span class="stale-flag">${escapeHtml(tx('visualFeedbackOverlayStale'))}</span>` : ''
      const targets = noteTargets(note)
      const shared = targets.length > 1
      const sharedFlag = shared ? ` · ${escapeHtml(tx('visualFeedbackOverlaySharedCount', { count: targets.length }))}` : ''
      const targetRows = shared
        ? `<ul class="notes selection">${targets.map((item) => `
            <li>
              <label class="tick"><input type="checkbox" data-uncheck="${escapeHtml(String(note.id || ''))}" data-uncheck-kind="note" data-uncheck-selector="${escapeHtml(String(item.selector || ''))}" checked aria-label="${escapeHtml(tx('visualFeedbackOverlayUncheck'))}"></label>
              <div class="note-main"><div class="sel">${escapeHtml(item.selector || item.tag || '')}</div></div>
            </li>`).join('')}</ul>`
        : ''
      const detail = open
        ? `${targetRows || `<div class="sel">${escapeHtml(noteSelector(note))}</div>`}<p class="detail">${escapeHtml(noteText(note) || tx('visualFeedbackOverlayNoText'))}</p>`
        : (noteSelector(note) ? `<div class="sel">${escapeHtml(noteSelector(note))}</div>` : '')
      return `
      <li class="${note.stale ? 'stale' : ''}${open ? ' is-open' : ''}" data-note-id="${escapeHtml(String(note.id || ''))}" aria-label="${escapeHtml(noteLabel(note))}" aria-expanded="${open ? 'true' : 'false'}">
        <label class="tick"><input type="checkbox" data-uncheck="${escapeHtml(String(note.id || ''))}" data-uncheck-kind="note" checked aria-label="${escapeHtml(tx('visualFeedbackOverlayUncheck'))}"></label>
        <div class="note-main">
          <div class="excerpt">${escapeHtml(noteText(note) || tx('visualFeedbackOverlayNoText'))}${note.stale || open || shared ? ` · ${escapeHtml(kind)}` : ''}${sharedFlag}</div>
          ${detail}
        </div>
        <div>
          ${stale}
          <button class="x" data-remove="${escapeHtml(String(note.id || ''))}" type="button" aria-label="${escapeHtml(tx('visualFeedbackOverlayRemoveNote'))}">×</button>
        </div>
      </li>`
    }).join('')
    const selectionCount = state.selection.length
    const selectionItems = state.selection.map((item) => {
      const label = item.element?.selector || item.element?.tag || tx('visualFeedbackOverlayNoText')
      return `
      <li data-selection-id="${escapeHtml(String(item.id || ''))}">
        <label class="tick"><input type="checkbox" data-uncheck="${escapeHtml(String(item.id || ''))}" data-uncheck-kind="selection" checked aria-label="${escapeHtml(tx('visualFeedbackOverlayUncheck'))}"></label>
        <div class="note-main"><div class="sel">${escapeHtml(label)}</div></div>
      </li>`
    }).join('')
    const selectionBlock = selectionCount
      ? `<div class="sel-head">${escapeHtml(selectionCount === 1 ? tx('visualFeedbackOverlaySelectedCountOne') : tx('visualFeedbackOverlaySelectedCount', { count: selectionCount }))}</div><ul class="notes selection">${selectionItems}</ul>`
      : ''
    const sharedDraft = Boolean(state.draft?.shared && state.selection.length > 1)
    const composerTargets = !state.draft
      ? ''
      : sharedDraft
        ? `<p class="sel-head">${escapeHtml(tx('visualFeedbackOverlaySharedNote', { count: state.selection.length }))}</p>
        <p class="hint">${escapeHtml(tx('visualFeedbackOverlaySharedNoteHint'))}</p>
        <ul class="notes selection">${selectionItems}</ul>`
        : `<div class="sel">${escapeHtml(state.draft.element?.selector || '')}</div>`
    const composer = state.draft ? `
      <div class="composer">
        <div class="row">
          ${sharedDraft ? '' : composerTargets}
          <div class="retarget">
            <button type="button" class="retarget-btn" data-action="retarget-parent" title="${escapeHtml(tx('visualFeedbackOverlayParent'))}" aria-label="${escapeHtml(tx('visualFeedbackOverlayParent'))}">↑</button>
            <button type="button" class="retarget-btn" data-action="retarget-child" title="${escapeHtml(tx('visualFeedbackOverlayChild'))}" aria-label="${escapeHtml(tx('visualFeedbackOverlayChild'))}">↓</button>
          </div>
        </div>
        ${sharedDraft ? composerTargets : ''}
        <p class="hint">${escapeHtml(tx('visualFeedbackOverlayRetargetHint'))}</p>
        <label class="kind"><input type="radio" name="vf-kind" value="visual" ${state.draft.kind !== 'functional' ? 'checked' : ''}> ${escapeHtml(tx('visualFeedbackOverlayVisual'))}</label>
        <label class="kind"><input type="radio" name="vf-kind" value="functional" ${state.draft.kind === 'functional' ? 'checked' : ''}> ${escapeHtml(tx('visualFeedbackOverlayFunctional'))}</label>
        <textarea id="vf-note" placeholder="${escapeHtml(tx('visualFeedbackOverlayPlaceholder'))}">${escapeHtml(state.draft.text || '')}</textarea>
        <div class="row">
          <button type="button" class="action" data-action="save-note">${escapeHtml(tx('visualFeedbackOverlayAddNote'))}</button>
          <button type="button" class="ghost" data-action="cancel-note">${escapeHtml(tx('visualFeedbackOverlayCancel'))}</button>
        </div>
      </div>` : ''
    const statusText = state.statusKey ? tx(state.statusKey) : (state.status || state.message || '')
    let trayBody = ''
    if (state.draft) trayBody = composer
    else if (state.listOpen || selectionCount) {
      const parts = []
      if (selectionBlock) parts.push(selectionBlock)
      if (state.listOpen) {
        parts.push(count
          ? `<ul class="notes">${notes}</ul>`
          : (selectionCount ? '' : `<p class="empty">${escapeHtml(tx('visualFeedbackOverlayEmptyNotes'))}</p>`))
      }
      trayBody = parts.filter(Boolean).join('')
    } else if (!envOk) trayBody = `<p class="err">${escapeHtml(tx('visualFeedbackOverlayBlocked'))}</p>`
    else if (statusText) trayBody = `<p class="status">${escapeHtml(statusText)}</p>`
    const tray = trayBody ? `<div class="tray">${trayBody}</div>` : ''
    const lang = strings.locale === 'en' ? 'en' : 'zh-CN'
    root.setAttribute('lang', lang)
    const toolbarHtml = `<div class="toolbar" role="toolbar" aria-label="${escapeHtml(tx('visualFeedbackOverlayTitle'))}">
        <span class="brand">${escapeHtml(tx('visualFeedbackOverlayTitle'))}</span>
        <button type="button" data-action="toggle" ${envOk ? '' : 'disabled'} aria-pressed="${state.mode ? 'true' : 'false'}">${icon('select')}${escapeHtml(state.mode ? tx('visualFeedbackOverlayStop') : tx('visualFeedbackOverlayStart'))}</button>
        <button type="button" data-action="toggle-list" aria-pressed="${state.listOpen ? 'true' : 'false'}">${icon('notes')}${escapeHtml(countLabel)}</button>
        <button type="button" class="primary" data-action="submit" ${count ? '' : 'disabled'}>${icon('submit')}${escapeHtml(tx('visualFeedbackOverlaySubmit', { count }))}</button>
        ${badge}
      </div>`
    const preservedNote = preserveOpenDraftNote()
    if (preservedNote) {
      if (!state.composing) rememberDraftText()
      patchOpenDraftChrome(root, tray, toolbarHtml, preservedNote)
    } else {
      root.innerHTML = `
      ${tray}
      ${toolbarHtml}`
    }
    paintMarks()
    paintBox()
    positionOverlay()
    const highlight = state.target || state.hover
    if ((state.mode || state.draft) && highlight && !isRootWrapper(highlight)) setHover(highlight)
    else setHover(null)
  }

  function liveNoteField() {
    return ui.shadow?.getElementById('vf-note') || null
  }

  function preserveOpenDraftNote() {
    if (!state.draft) return null
    const area = liveNoteField()
    return area && area.isConnected ? area : null
  }

  function isNoteFieldActive() {
    const area = liveNoteField()
    if (!area) return false
    const active = area.getRootNode?.().activeElement
    return active === area
  }

  function patchOpenDraftChrome(root, tray, toolbarHtml, preservedNote) {
    const currentTray = root.querySelector('.tray')
    if (!currentTray || !root.querySelector('.composer') || !preservedNote.isConnected) {
      const holder = document.createElement('div')
      holder.innerHTML = tray
      const nextTray = holder.firstElementChild
      const placeholder = nextTray?.querySelector('#vf-note')
      if (placeholder && placeholder !== preservedNote) placeholder.replaceWith(preservedNote)
      if (currentTray) currentTray.replaceWith(nextTray)
      else root.insertBefore(nextTray, root.querySelector('.toolbar'))
    } else {
      const sel = currentTray.querySelector('.composer .sel')
      if (sel) sel.textContent = state.draft.element?.selector || ''
      const visual = currentTray.querySelector('input[name="vf-kind"][value="visual"]')
      const functional = currentTray.querySelector('input[name="vf-kind"][value="functional"]')
      if (visual) visual.checked = state.draft.kind !== 'functional'
      if (functional) functional.checked = state.draft.kind === 'functional'
      if (!state.composing) {
        preservedNote.setAttribute('placeholder', tx('visualFeedbackOverlayPlaceholder'))
      }
    }
    const holder = document.createElement('div')
    holder.innerHTML = toolbarHtml
    const toolbar = holder.firstElementChild
    const currentToolbar = root.querySelector('.toolbar')
    if (currentToolbar) currentToolbar.replaceWith(toolbar)
    else root.appendChild(toolbar)
  }

  function positionOverlay() {
    const root = ui.shadow?.querySelector('.vf')
    if (!root) return
    const viewport = window.visualViewport
    const width = Math.max(0, Number(viewport?.width || window.innerWidth) || 0)
    const height = Math.max(0, Number(viewport?.height || window.innerHeight) || 0)
    const offsetTop = Number(viewport?.offsetTop) || 0
    const offsetLeft = Number(viewport?.offsetLeft) || 0
    const margin = 12
    root.style.maxWidth = `${Math.max(200, width - margin * 2)}px`
    root.style.maxHeight = `${Math.max(120, height - margin * 2)}px`
    const barWidth = Math.min(root.offsetWidth || 420, Math.max(200, width - margin * 2))
    const barHeight = Math.min(root.offsetHeight || 0, Math.max(40, height - margin * 2))
    const left = offsetLeft + Math.max(margin, width - margin - barWidth)
    const top = offsetTop + Math.max(margin, height - margin - barHeight)
    root.style.left = `${Math.round(left)}px`
    root.style.top = `${Math.round(top)}px`
    root.style.right = 'auto'
    root.style.bottom = 'auto'
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]))
  }

  function noteText(note) {
    const text = note?.text
    if (text && typeof text === 'object') return String(text.text || text.value || '').trim()
    return String(text || '').trim()
  }

  function noteSelector(note) {
    const selectors = noteTargets(note).map((item) => {
      const selector = item?.selector
      if (selector && typeof selector === 'object') return String(selector.value || selector.selector || '').trim()
      return String(selector || '').trim()
    }).filter(Boolean)
    return selectors.join(', ')
  }

  function noteLabel(note) {
    const text = noteText(note) || tx('visualFeedbackOverlayNoText')
    const selector = noteSelector(note)
    return selector ? `${text} — ${selector}` : text
  }

  function viewportBox() {
    const viewport = window.visualViewport
    return {
      left: Number(viewport?.offsetLeft) || 0,
      top: Number(viewport?.offsetTop) || 0,
      width: Math.max(0, Number(viewport?.width || window.innerWidth) || 0),
      height: Math.max(0, Number(viewport?.height || window.innerHeight) || 0),
    }
  }

  function isRectVisible(rect, view, margin = 0) {
    return rect.right > view.left + margin
      && rect.bottom > view.top + margin
      && rect.left < view.left + view.width - margin
      && rect.top < view.top + view.height - margin
  }

  function clampPinPosition(rect, view) {
    const size = 20
    const margin = 8
    const visLeft = Math.max(rect.left, view.left + margin)
    const visTop = Math.max(rect.top, view.top + margin)
    const visRight = Math.min(rect.right, view.left + view.width - margin)
    let left = visRight - 8
    let top = visTop - 8
    const maxLeft = view.left + view.width - margin - size
    const maxTop = view.top + view.height - margin - size
    left = Math.min(Math.max(left, view.left + margin), Math.max(view.left + margin, maxLeft))
    top = Math.min(Math.max(top, view.top + margin), Math.max(view.top + margin, maxTop))
    void visLeft
    return { left: Math.round(left), top: Math.round(top) }
  }

  function paintCheck(element, id, kind, rect, selector) {
    const check = document.createElement('label')
    check.className = 'check-pin'
    check.style.left = `${Math.round(rect.left) + 4}px`
    check.style.top = `${Math.round(rect.top) + 4}px`
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = true
    input.setAttribute('data-uncheck', String(id || ''))
    input.setAttribute('data-uncheck-kind', kind)
    if (selector) input.setAttribute('data-uncheck-selector', String(selector))
    input.setAttribute('aria-label', tx('visualFeedbackOverlayUncheck'))
    check.appendChild(input)
    ui.shadow.appendChild(check)
  }

  function paintMarks() {
    if (!ui.shadow) return
    ui.shadow.querySelectorAll('.mark, .pin, .check-pin').forEach((node) => node.remove())
    if (state.captureHidden) return
    const view = viewportBox()
    const notedNodes = new Set()
    for (const [index, note] of state.notes.entries()) {
      for (const target of noteTargets(note)) {
        const element = elementFromDescriptor(target) || (target === note.element ? elementFromNote(note) : null)
        if (!element || isRootWrapper(element)) continue
        notedNodes.add(element)
        const rect = element.getBoundingClientRect()
        if (!isRectVisible(rect, view)) continue
        if (!note.stale) {
          const mark = document.createElement('div')
          mark.className = 'mark'
          mark.style.left = `${rect.left}px`
          mark.style.top = `${rect.top}px`
          mark.style.width = `${Math.max(0, rect.width)}px`
          mark.style.height = `${Math.max(0, rect.height)}px`
          ui.shadow.appendChild(mark)
          paintCheck(element, note.id, 'note', rect, target.selector)
        }
        const pin = document.createElement('button')
        const open = state.expandedNoteId === note.id
        pin.type = 'button'
        pin.className = `pin${note.stale ? ' stale' : ''}${open && !note.stale ? ' is-open' : ''}`
        pin.setAttribute('data-pin-id', String(note.id || ''))
        pin.setAttribute('aria-label', tx(note.stale ? 'visualFeedbackOverlayPinStale' : 'visualFeedbackOverlayPin', { index: index + 1 }))
        const pos = clampPinPosition(rect, view)
        pin.style.left = `${pos.left}px`
        pin.style.top = `${pos.top}px`
        pin.textContent = String(index + 1)
        ui.shadow.appendChild(pin)
      }
    }
    for (const item of state.selection) {
      const element = ui.selected.get(item.id) || elementFromDescriptor(item.element)
      if (!element || isRootWrapper(element) || notedNodes.has(element) || !document.contains(element)) continue
      const rect = element.getBoundingClientRect()
      if (!isRectVisible(rect, view)) continue
      const mark = document.createElement('div')
      mark.className = 'mark pending'
      mark.style.left = `${rect.left}px`
      mark.style.top = `${rect.top}px`
      mark.style.width = `${Math.max(0, rect.width)}px`
      mark.style.height = `${Math.max(0, rect.height)}px`
      ui.shadow.appendChild(mark)
      paintCheck(element, item.id, 'selection', rect)
    }
  }

  function elementHighlightLabel(element) {
    if (!element || element.nodeType !== 1) return ''
    const tag = String(element.tagName || '').toLowerCase()
    if (element.id) return `${tag}#${element.id}`
    const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean)[0] : ''
    return className ? `${tag}.${className}` : tag
  }

  function isRootWrapper(element) {
    if (!element || element.nodeType !== 1) return false
    if (element === document.documentElement || element === document.body) return true
    if (element.id === ROOT_ID) return true
    const tag = String(element.tagName || '')
    if (/^(HTML|BODY|HEAD)$/i.test(tag)) return true
    const parent = element.parentElement
    if (parent !== document.body && parent !== document.documentElement) return false
    const id = String(element.id || '')
    if (/^(root|app|__next|__nuxt|app-root|approot)$/i.test(id)) return true
    const rect = element.getBoundingClientRect()
    const vw = Number(window.innerWidth || document.documentElement?.clientWidth) || 0
    const vh = Number(window.innerHeight || document.documentElement?.clientHeight) || 0
    return vw > 32 && vh > 32 && rect.left <= 1 && rect.top <= 1 && rect.width >= vw - 2 && rect.height >= vh - 2
  }

  function elementFromDescriptor(descriptor) {
    const selector = descriptor?.selector
    if (!selector) return null
    try {
      const element = document.querySelector(selector)
      if (!element || isRootWrapper(element)) return null
      return element
    } catch {
      return null
    }
  }

  function elementFromNote(note) {
    return elementFromDescriptor(note?.element)
  }

  function matchesHighlight(element, current) {
    if (!element || !current) return false
    return current === element || element.contains(current) || current.contains(element)
  }

  function clearHighlight() {
    state.target = null
    state.hover = null
    state.retargetLocked = false
    state.retargetStack = []
    setHover(null)
  }

  function exitSelectMode() {
    state.mode = false
    state.draft = null
    state.boxSelect = null
    state.statusKey = ''
    state.status = ''
    clearHighlight()
  }

  function highlightElement(element, options = {}) {
    if (!element || isRootWrapper(element) || !isRetargetable(element) || (element.isConnected === false)) {
      clearHighlight()
      return false
    }
    if (typeof document.contains === 'function' && !document.contains(element)) {
      clearHighlight()
      return false
    }
    state.target = element
    state.hover = element
    setHover(element, options)
    return true
  }

  function pickRemainingHighlight(removedElement) {
    const current = (state.target && (!document.contains || document.contains(state.target))) ? state.target : state.hover
    const currentValid = current && !isRootWrapper(current) && isRetargetable(current) && (!document.contains || document.contains(current))
    if (currentValid && !matchesHighlight(removedElement, current)) return current
    for (const note of state.notes) {
      if (note.stale) continue
      for (const target of noteTargets(note)) {
        const element = elementFromDescriptor(target)
        if (element && isRetargetable(element) && !isRootWrapper(element)) return element
      }
    }
    for (const item of state.selection) {
      const element = ui.selected.get(item.id) || elementFromDescriptor(item.element)
      if (element && isRetargetable(element) && !isRootWrapper(element)) return element
    }
    return null
  }

  function retargetHighlightAfterRemoval(removedElement) {
    const next = pickRemainingHighlight(removedElement)
    if (next) highlightElement(next)
    else clearHighlight()
  }

  function normalizeNoteTargets(note) {
    const targets = noteTargets(note)
    if (targets.length > 1) {
      note.elements = targets
      note.element = targets[0]
      note.shared = true
    } else if (targets.length === 1) {
      note.element = targets[0]
      note.elements = undefined
      note.shared = false
    }
  }

  function uncheckNote(id, selector) {
    const key = String(id || '')
    const note = state.notes.find((item) => String(item.id) === key)
    if (!note) return
    const targets = noteTargets(note)
    const wanted = String(selector || '').trim()
    if (wanted && targets.length > 1) {
      const removed = targets.find((item) => String(item.selector || '') === wanted)
      const removedElement = elementFromDescriptor(removed)
      note.elements = targets.filter((item) => String(item.selector || '') !== wanted)
      normalizeNoteTargets(note)
      retargetHighlightAfterRemoval(removedElement)
      sync()
      return
    }
    const removedElement = elementFromDescriptor(targets.find((item) => !wanted || String(item.selector || '') === wanted)) || elementFromNote(note)
    state.notes = state.notes.filter((item) => String(item.id) !== key)
    if (String(state.expandedNoteId) === key) state.expandedNoteId = ''
    if (!state.notes.length) state.listOpen = false
    retargetHighlightAfterRemoval(removedElement)
    sync()
  }

  function uncheckSelection(id) {
    const key = String(id || '')
    const item = state.selection.find((entry) => String(entry.id) === key)
    const removedElement = (item && ui.selected.get(item.id)) || elementFromDescriptor(item?.element)
    state.selection = state.selection.filter((entry) => String(entry.id) !== key)
    ui.selected.delete(key)
    syncSharedDraft()
    retargetHighlightAfterRemoval(removedElement)
    render()
  }

  function syncSharedDraft() {
    rememberDraftText()
    const count = state.selection.length
    if (count < 2) {
      if (state.draft?.shared) {
        if (count === 1) {
          state.draft = {
            ...state.draft,
            shared: false,
            element: state.selection[0].element,
            elements: undefined,
          }
        } else {
          state.draft = null
        }
      }
      return
    }
    const elements = state.selection.map((item) => item.element)
    state.draft = {
      id: state.draft?.id || `n${Date.now()}`,
      kind: state.draft?.kind || 'visual',
      text: state.draft?.text || '',
      shared: true,
      element: elements[0],
      elements,
    }
  }

  function sameSelectedElement(element, item) {
    if (!element || !item) return false
    const live = ui.selected.get(item.id)
    if (live && live === element) return true
    const resolved = elementFromDescriptor(item.element)
    return resolved === element
  }

  function addToSelection(element) {
    if (!element || isRootWrapper(element) || !isRetargetable(element)) return false
    if (state.selection.some((item) => sameSelectedElement(element, item))) {
      highlightElement(element)
      return false
    }
    const noted = state.notes.find((note) => noteTargets(note).some((target) => elementFromDescriptor(target) === element))
    if (noted) {
      state.expandedNoteId = noted.id
      state.listOpen = true
      highlightElement(element)
      return false
    }
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    ui.selected.set(id, element)
    state.selection.push({ id, element: describeElement(element) })
    highlightElement(element)
    return true
  }

  function clearSelection() {
    state.selection = []
    ui.selected.clear()
  }

  function boxRect(box) {
    const left = Math.min(box.x0, box.x1)
    const top = Math.min(box.y0, box.y1)
    const right = Math.max(box.x0, box.x1)
    const bottom = Math.max(box.y0, box.y1)
    return { left, top, right, bottom, width: right - left, height: bottom - top }
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  }

  function elementsInBox(box) {
    const area = boxRect(box)
    if (area.width < 4 && area.height < 4) return []
    const scope = document.body || document.documentElement
    if (!scope || typeof scope.querySelectorAll !== 'function') return []
    const found = []
    for (const node of scope.querySelectorAll('*')) {
      if (node.id === ROOT_ID) continue
      if (typeof node.closest === 'function' && node.closest(`#${ROOT_ID}`)) continue
      if (!isRetargetable(node) || isRootWrapper(node)) continue
      const rect = node.getBoundingClientRect()
      if (rect.width < 8 && rect.height < 8) continue
      if (!rectsOverlap(area, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })) continue
      found.push(node)
    }
    return found.filter((node) => !found.some((other) => other !== node && node.contains(other))).slice(0, 40)
  }

  function paintBox() {
    if (!ui.shadow) return
    let box = ui.shadow.querySelector('.box')
    if (!state.boxSelect || state.boxSelect.dragging !== true) {
      if (box) box.remove()
      return
    }
    if (!box) {
      box = document.createElement('div')
      box.className = 'box'
      ui.shadow.appendChild(box)
    }
    const rect = boxRect(state.boxSelect)
    box.style.left = `${rect.left}px`
    box.style.top = `${rect.top}px`
    box.style.width = `${Math.max(0, rect.width)}px`
    box.style.height = `${Math.max(0, rect.height)}px`
  }

  function setHover(element, options = {}) {
    if (!ui.hover) return
    if (!element || isRootWrapper(element)) {
      ui.hover.hidden = true
      ui.hover.classList.remove('is-retarget', 'label-inside')
      ui.hover.replaceChildren()
      return
    }
    const rect = element.getBoundingClientRect()
    ui.hover.hidden = false
    ui.hover.style.left = `${rect.left}px`
    ui.hover.style.top = `${rect.top}px`
    ui.hover.style.width = `${Math.max(0, rect.width)}px`
    ui.hover.style.height = `${Math.max(0, rect.height)}px`
    let label = ui.hover.querySelector('.label')
    if (!label) {
      label = document.createElement('span')
      label.className = 'label'
      ui.hover.appendChild(label)
    }
    label.textContent = elementHighlightLabel(element)
    ui.hover.classList.toggle('label-inside', rect.top < 18)
    if (options.announce) {
      ui.hover.classList.remove('is-retarget')
      void ui.hover.offsetWidth
      ui.hover.classList.add('is-retarget')
    }
  }

  function refreshEnvironment() {
    const report = collectSignals()
    state.environment = { ...report, ok: report.strong.length > 0 }
    if (!state.environment.ok) {
      exitSelectMode()
      state.blocked = true
    } else {
      state.blocked = false
    }
    return state.environment
  }

  async function post(message) {
    const hook = window[`${'__codeminiVisualFeedback'}`]
    if (typeof hook !== 'function') return { ok: false, code: 'DISCONNECTED', error: tx('visualFeedbackOverlayDisconnected') }
    return hook(message)
  }

  function sync() {
    saveState()
    render()
    void post({ type: 'state', payload: snapshot() })
  }

  function snapshot() {
    return {
      mode: state.mode,
      blocked: state.blocked,
      environment: state.environment,
      notes: state.notes,
      url: location.href,
      title: document.title,
    }
  }

  function isRetargetable(element) {
    if (!element || element.nodeType !== 1) return false
    if (isRootWrapper(element)) return false
    if (element.id === ROOT_ID) return false
    const tag = String(element.tagName || '')
    if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|HEAD|HTML|BR|WBR|TEMPLATE)$/i.test(tag)) return false
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 && rect.height < 1) return false
    try {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    } catch {
      // Ignore styles that cannot be computed.
    }
    return true
  }

  function walkParent(element) {
    let node = element?.parentElement
    while (node && !isRetargetable(node)) node = node.parentElement
    return isRetargetable(node) ? node : null
  }

  function walkChild(element, stack) {
    if (stack.length) {
      const prev = stack[stack.length - 1]
      if (prev && element?.contains(prev) && isRetargetable(prev)) {
        stack.pop()
        return prev
      }
    }
    const children = element ? [...element.children] : []
    for (const child of children) {
      if (isRetargetable(child)) return child
    }
    if (!element || typeof element.querySelectorAll !== 'function') return null
    const descendants = element.querySelectorAll('*')
    for (const child of descendants) {
      if (isRetargetable(child)) return child
    }
    return null
  }

  function currentTarget() {
    const usable = (element) => element && document.contains(element) && !isRootWrapper(element) && isRetargetable(element)
    if (usable(state.target)) return state.target
    if (usable(state.hover)) return state.hover
    const found = elementFromDescriptor(state.draft?.element)
    if (usable(found)) return found
    return null
  }

  function rememberDraftText() {
    const area = ui.shadow?.getElementById('vf-note')
    if (area && state.draft) state.draft.text = area.value
  }

  function applyRetarget(element) {
    if (!isRetargetable(element)) return false
    const previous = currentTarget()
    state.target = element
    state.hover = element
    state.retargetLocked = true
    rememberDraftText()
    const desc = describeElement(element)
    if (state.draft) {
      if (state.draft.shared && Array.isArray(state.draft.elements)) {
        const index = state.draft.elements.findIndex((item) => {
          const live = elementFromDescriptor(item)
          return (previous && live === previous) || String(item.selector || '') === String(state.draft.element?.selector || '')
        })
        if (index >= 0) state.draft.elements[index] = desc
        else state.draft.elements.push(desc)
        state.draft.element = state.draft.elements[0]
        const selected = state.selection.find((item) => previous && (ui.selected.get(item.id) === previous || elementFromDescriptor(item.element) === previous))
        if (selected) {
          ui.selected.set(selected.id, element)
          selected.element = desc
        }
      } else {
        state.draft = { ...state.draft, element: desc }
      }
    }
    render()
    setHover(element, { announce: true })
    return true
  }

  function retarget(direction) {
    const current = currentTarget()
    if (!current) return false
    if (direction === 'parent') {
      const next = walkParent(current)
      if (!next) return false
      state.retargetStack.push(current)
      return applyRetarget(next)
    }
    const next = walkChild(current, state.retargetStack)
    return next ? applyRetarget(next) : false
  }

  function isImeComposing(event) {
    return Boolean(
      state.composing
      || event?.isComposing
      || event?.key === 'Process'
      || event?.keyCode === 229
      || event?.which === 229
    )
  }

  function isTypingTarget(event) {
    if (isNoteFieldActive()) return true
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    return path.some((node) => {
      if (!node || node.nodeType !== 1) return false
      if (node.id === 'vf-note') return true
      const tag = String(node.tagName || '')
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (tag === 'INPUT') {
        const type = String(node.type || 'text').toLowerCase()
        return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio'
      }
      return Boolean(node.isContentEditable)
    })
  }

  function onPointerDown(event) {
    if (!state.mode || state.draft || isOverlayEvent(event) || event.button !== 0) return
    if (isTypingTarget(event)) return
    state.boxSelect = {
      x0: event.clientX,
      y0: event.clientY,
      x1: event.clientX,
      y1: event.clientY,
      dragging: false,
      shift: event.shiftKey === true,
    }
  }

  function onPointerMove(event) {
    if (state.boxSelect && state.mode && !state.draft && !isOverlayEvent(event)) {
      state.boxSelect.x1 = event.clientX
      state.boxSelect.y1 = event.clientY
      const dx = Math.abs(state.boxSelect.x1 - state.boxSelect.x0)
      const dy = Math.abs(state.boxSelect.y1 - state.boxSelect.y0)
      if (!state.boxSelect.dragging && (dx > 5 || dy > 5)) state.boxSelect.dragging = true
      if (state.boxSelect.dragging) {
        event.preventDefault()
        paintBox()
      }
      return
    }
    if (!state.mode || state.draft || isOverlayEvent(event)) return
    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (state.retargetLocked && state.target) {
      if (element === state.target || (element && state.target.contains(element))) return
      state.retargetLocked = false
      state.retargetStack = []
    }
    if (!element || isRootWrapper(element) || !isRetargetable(element)) return
    state.hover = element
    state.target = element
    setHover(element)
  }

  function onPointerUp(event) {
    const box = state.boxSelect
    state.boxSelect = null
    paintBox()
    if (!box || box.dragging !== true) return
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    state.ignoreClick = true
    const elements = elementsInBox(box)
    if (!box.shift) clearSelection()
    for (const element of elements) addToSelection(element)
    syncSharedDraft()
    if (elements.length) highlightElement(elements[elements.length - 1])
    else if (!state.notes.length && !state.selection.length) clearHighlight()
    render()
  }

  function onClick(event) {
    if (state.ignoreClick) {
      state.ignoreClick = false
      if (isOverlayEvent(event)) return
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!state.mode || isOverlayEvent(event)) return
    event.preventDefault()
    event.stopPropagation()
    const pointed = document.elementFromPoint(event.clientX, event.clientY)
    const element = (state.retargetLocked && state.target && !event.shiftKey) ? state.target : pointed
    if (!element || isRootWrapper(element) || !isRetargetable(element)) return
    if (event.shiftKey) {
      addToSelection(element)
      state.retargetLocked = false
      syncSharedDraft()
      render()
      return
    }
    if (state.draft?.shared && state.selection.length > 1) return
    state.draft = { id: `n${Date.now()}`, kind: 'visual', text: '', element: describeElement(element) }
    state.target = element
    state.hover = element
    state.retargetLocked = false
    render()
    setHover(element)
    const area = ui.shadow.getElementById('vf-note')
    area?.focus()
  }

  function onKey(event) {
    if (isImeComposing(event)) return
    if (event.key === 'Escape' && state.boxSelect) {
      event.preventDefault()
      state.boxSelect = null
      paintBox()
      return
    }
    if (event.key === 'Escape' && (state.mode || state.draft)) {
      event.preventDefault()
      state.draft = null
      state.retargetLocked = false
      state.composing = false
      render()
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (state.mode || state.draft)) {
      if (isTypingTarget(event) || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      retarget(event.key === 'ArrowUp' ? 'parent' : 'child')
    }
  }

  function onScroll() {
    paintMarks()
    paintBox()
    if ((state.mode || state.draft) && state.hover && !isRootWrapper(state.hover)) setHover(state.hover)
    else setHover(null)
    positionOverlay()
  }

  function bindPage() {
    if (window.__codeminiVfBoundDocument === document) return
    window.__codeminiVfBoundDocument = document
    window.__codeminiVfBound = true
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('mousemove', onPointerMove, true)
    document.addEventListener('mouseup', onPointerUp, true)
    window.addEventListener('mouseup', onPointerUp, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('pagehide', saveState)
    if (window.visualViewport && !window.visualViewport.__codeminiVfBound) {
      window.visualViewport.__codeminiVfBound = true
      window.visualViewport.addEventListener('resize', onScroll)
      window.visualViewport.addEventListener('scroll', onScroll)
    }
  }

  function eventPathTarget(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    return path.find((node) => node && node.nodeType === 1 && typeof node.closest === 'function') || event.target
  }

  function onPanelClick(event) {
    const target = eventPathTarget(event)
    if (!target || typeof target.closest !== 'function') return
    const pinId = target.closest('[data-pin-id]')?.getAttribute('data-pin-id')
    if (pinId) {
      state.listOpen = true
      state.expandedNoteId = pinId
      const note = state.notes.find((item) => String(item.id) === String(pinId))
      if (note?.element?.selector) {
        const element = document.querySelector(note.element.selector)
        if (element) {
          state.target = element
          setHover(note.stale ? null : element)
        }
      }
      render()
      const row = ui.shadow?.querySelector(`[data-note-id="${CSS.escape(pinId)}"]`)
      row?.scrollIntoView?.({ block: 'nearest' })
      return
    }
    const uncheck = target.closest('[data-uncheck]')
    if (uncheck) {
      const id = uncheck.getAttribute('data-uncheck')
      const kind = uncheck.getAttribute('data-uncheck-kind') || 'note'
      const selector = uncheck.getAttribute('data-uncheck-selector')
      if (kind === 'selection') uncheckSelection(id)
      else uncheckNote(id, selector)
      return
    }
    const remove = target.closest('[data-remove]')?.getAttribute('data-remove')
    if (remove) {
      uncheckNote(remove)
      return
    }
    const selectionRow = target.closest('[data-selection-id]')
    if (selectionRow) {
      const id = selectionRow.getAttribute('data-selection-id')
      const item = state.selection.find((entry) => String(entry.id) === String(id))
      const element = (item && ui.selected.get(item.id)) || elementFromDescriptor(item?.element)
      if (element && !isRootWrapper(element)) {
        state.draft = { id: `n${Date.now()}`, kind: 'visual', text: '', element: describeElement(element) }
        state.target = element
        state.hover = element
        render()
        setHover(element)
        ui.shadow?.getElementById('vf-note')?.focus()
      }
      return
    }
    const noteRow = target.closest('[data-note-id]')
    if (noteRow) {
      const id = noteRow.getAttribute('data-note-id')
      state.expandedNoteId = state.expandedNoteId === id ? '' : id
      render()
      return
    }
    const button = target.closest('button')
    if (!button) return
    const action = button.getAttribute('data-action')
    if (action === 'toggle') {
      if (!state.environment.ok) return
      if (state.mode) exitSelectMode()
      else {
        state.mode = true
        state.statusKey = 'visualFeedbackOverlaySelecting'
        state.status = ''
      }
      sync()
      return
    }
    if (action === 'toggle-list') {
      state.listOpen = !state.listOpen
      if (!state.listOpen) state.expandedNoteId = ''
      render()
      return
    }
    if (action === 'retarget-parent' || action === 'retarget-child') {
      retarget(action === 'retarget-parent' ? 'parent' : 'child')
      return
    }
    if (action === 'cancel-note') {
      state.draft = null
      render()
      return
    }
    if (action === 'save-note') {
      const text = String(ui.shadow.getElementById('vf-note')?.value || '').trim()
      if (!text || !state.draft) return
      const kindInput = ui.shadow.querySelector('input[name="vf-kind"]:checked')
      const fromSelection = state.draft.shared
        ? state.selection.map((item) => item.element).filter(Boolean)
        : []
      const elements = (fromSelection.length ? fromSelection : (state.draft.elements || [state.draft.element])).filter(Boolean)
      const unique = []
      for (const element of elements) {
        if (!unique.some((item) => item.selector && item.selector === element.selector)) unique.push(element)
      }
      const shared = unique.length > 1
      state.notes.push({
        id: state.draft.id,
        kind: kindInput?.value === 'functional' ? 'functional' : 'visual',
        text,
        url: location.href,
        shared,
        element: unique[0] || state.draft.element,
        elements: shared ? unique : undefined,
      })
      state.draft = null
      clearSelection()
      state.listOpen = true
      state.statusKey = ''
      state.status = ''
      sync()
      return
    }
    if (action === 'submit') {
      void submitNotes()
    }
  }

  async function submitNotes() {
    if (!state.notes.length) return
    state.statusKey = 'visualFeedbackOverlaySubmitting'
    state.status = ''
    render()
    const result = await post({ type: 'submit', payload: snapshot() })
    if (result?.ok) {
      state.notes = []
      state.draft = null
      state.mode = false
      state.hover = null
      state.listOpen = false
      state.expandedNoteId = ''
      state.target = null
      state.retargetStack = []
      state.retargetLocked = false
      state.composing = false
      clearSelection()
      state.boxSelect = null
      state.ignoreClick = false
      state.statusKey = 'visualFeedbackOverlaySubmitted'
      state.status = ''
      try { sessionStorage.removeItem(storageId()) } catch { /* ignore */ }
      setHover(null)
      render()
      // Push the empty snapshot so the host/panel do not keep a stale note count.
      // Avoid the persist helper here so sessionStorage stays cleared.
      void post({ type: 'state', payload: snapshot() })
    } else {
      const codes = {
        NOT_DEV_ENVIRONMENT: 'visualFeedbackOverlayBlocked',
        NO_NOTES: 'visualFeedbackOverlayNoNotes',
        BUSY: 'visualFeedbackOverlayBusy',
        DISCONNECTED: 'visualFeedbackOverlayDisconnected',
      }
      state.statusKey = codes[result?.code] || (result?.error ? '' : 'visualFeedbackOverlaySubmitFailed')
      state.status = state.statusKey ? '' : (result?.error || tx('visualFeedbackOverlaySubmitFailed'))
      render()
    }
  }

  function bindPanel(host) {
    const root = ui.shadow
    if (!root || root.__vfBound) return
    root.__vfBound = true
    root.addEventListener('click', onPanelClick)
    root.addEventListener('input', (event) => {
      const target = eventPathTarget(event)
      if (target && target.id === 'vf-note' && state.draft) state.draft.text = target.value
    })
    root.addEventListener('compositionstart', (event) => {
      const target = eventPathTarget(event)
      if (target && target.id === 'vf-note') state.composing = true
    })
    root.addEventListener('compositionend', (event) => {
      const target = eventPathTarget(event)
      if (target && target.id === 'vf-note') {
        state.composing = false
        if (state.draft) state.draft.text = target.value
      }
    })
    void host
  }

  function restoreOverlay() {
    if (!overlayRoot()?.isConnected) {
      ui.host = null
      ui.shadow = null
      ui.hover = null
    }
    const host = ensureHost()
    if (!host) return null
    bindPanel(host)
    bindPage()
    watchDocument()
    if (refreshNoteStaleness()) saveState()
    render()
    return host
  }

  function watchDocument() {
    if (window.__codeminiVfDocWatch) return
    window.__codeminiVfDocWatch = true
    const observe = (node) => {
      if (!node || node.__codeminiVfObserved) return
      node.__codeminiVfObserved = true
      const observer = new MutationObserver(() => {
        if (document.body) observe(document.body)
        if (!overlayRoot()?.isConnected) {
          restoreOverlay()
          return
        }
        if (refreshNoteStaleness()) {
          saveState()
          if (!state.draft) render()
          else paintMarks()
        } else if (state.mode) {
          paintMarks()
        }
      })
      observer.observe(node, { childList: true, subtree: true })
    }
    observe(document.documentElement)
    observe(document.body)
    window.addEventListener('pageshow', restoreOverlay)
    window.addEventListener('popstate', restoreOverlay)
    window.addEventListener('hashchange', restoreOverlay)
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') restoreOverlay()
    })
    const wrapHistory = (method) => {
      const original = history[method]
      if (typeof original !== 'function' || original.__codeminiVf) return
      const wrapped = function (...args) {
        const result = original.apply(this, args)
        restoreOverlay()
        return result
      }
      wrapped.__codeminiVf = true
      history[method] = wrapped
    }
    wrapHistory('pushState')
    wrapHistory('replaceState')
  }

  function attach() {
    loadState()
    refreshEnvironment()
    restoreOverlay()
  }

  window.__codeminiVisualFeedbackApi = {
    refreshEnvironment,
    setStrings(next) {
      applyStrings(next)
      render()
    },
    setEnvironment(report) {
      state.environment = report
      state.blocked = report?.ok !== true
      if (state.blocked) exitSelectMode()
      render()
    },
    snapshot,
    ensure: restoreOverlay,
    setCaptureHidden(hidden) {
      state.captureHidden = hidden === true
      const host = overlayRoot()
      if (host) host.style.visibility = state.captureHidden ? 'hidden' : ''
      if (state.captureHidden) {
        ui.shadow?.querySelectorAll('.mark, .pin, .hover, .box, .check-pin').forEach((node) => {
          if ('hidden' in node) node.hidden = true
        })
        if (ui.hover) ui.hover.hidden = true
      }
      paintMarks()
    },
    start() {
      if (!state.environment.ok) return false
      state.mode = true
      sync()
      return true
    },
    stop() {
      exitSelectMode()
      sync()
    },
  }

  attach()
}
