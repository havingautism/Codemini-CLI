import { locateSource } from './diagnostics.js'
import { ensureDevServer, isLikelyAuthPage } from './dev-server.js'
import { probeDevEnvironment } from './environment.js'
import { isGeneratedBundlePath, isLibraryPath, isOriginalSourcePath } from './sourcemap.js'
import {
  getVisualFeedbackInitScript,
  groupVisualFeedbackNotesByPage,
  isVisualFeedbackNoteOnPage,
  visualFeedbackPageKey,
  VISUAL_FEEDBACK_BINDING,
} from './visual-feedback-overlay.js'
import { normalizeVisualFeedbackLocale } from './visual-feedback-i18n.js'
import {
  captureVisualFeedbackScreenshots,
  formatVisualFeedbackScreenshotLine,
  visualFeedbackScreenshotAttachments,
} from './visual-feedback-screenshot.js'

export { ensureDevServer, extractLoginOpenUrls, findReusableDevServer, isAppLoginOpenUrl, isLikelyAuthPage, listDevScripts, listProjectDevEntries, looksLikeDevResponse, pickLoginOpenUrl } from './dev-server.js'
export { collectPageDevSignals, collectOriginDevSignals, isDevEnvironment, originSignalsFromResponse, probeDevEnvironment } from './environment.js'
export {
  VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT,
  VISUAL_FEEDBACK_BINDING,
  VISUAL_FEEDBACK_CHILD_LABEL_LIMIT,
  VISUAL_FEEDBACK_MARKUP_LIMIT,
  VISUAL_FEEDBACK_MAX_PENDING_NOTES,
  VISUAL_FEEDBACK_STORAGE_KEY,
  VISUAL_FEEDBACK_STORAGE_KEY_V1,
  getVisualFeedbackInitScript,
  groupVisualFeedbackNotesByPage,
  isVisualFeedbackInteractiveElement,
  isVisualFeedbackNoteOnPage,
  visualFeedbackChildLabels,
  visualFeedbackInteractiveAncestorName,
  visualFeedbackOwnName,
  visualFeedbackPageKey,
  visualFeedbackPageLabel,
} from './visual-feedback-overlay.js'
export { getVisualFeedbackOverlayStrings, normalizeVisualFeedbackLocale, VISUAL_FEEDBACK_OVERLAY_KEYS } from './visual-feedback-i18n.js'
export {
  VISUAL_FEEDBACK_SCREENSHOT,
  captureVisualFeedbackNoteScreenshot,
  captureVisualFeedbackScreenshots,
  computeScreenshotClip,
  encodeVisualFeedbackScreenshot,
  formatVisualFeedbackScreenshotLine,
  shouldUseGroupScreenshot,
  unionElementRects,
  visualFeedbackScreenshotAttachments,
} from './visual-feedback-screenshot.js'

function resolveOverlayLocale(session, locale) {
  const resolved = normalizeVisualFeedbackLocale(locale || session?.visualFeedback?.locale)
  if (session) {
    session.visualFeedback = { ...(session.visualFeedback || {}), locale: resolved }
  }
  return resolved
}

function overlayInitScript(session, locale) {
  return getVisualFeedbackInitScript(resolveOverlayLocale(session, locale))
}

export async function applyVisualFeedbackLocale(session, locale) {
  if (!session) return
  const script = overlayInitScript(session, locale)
  if (!session.page || session.page.isClosed?.()) return
  await session.page.evaluate(script).catch(() => {})
}


export const VISUAL_FEEDBACK_PROMPT = [
  "A Visual Feedback session is already open in Codemini's controlled browser.",
  'Reuse this same headed BrowserSession; it is already bound to this chat.',
  'Do not call browser_act open, do not start a second browser, and do not curl localhost or fetch the page over the network.',
  "Do not close the session, and do not open the user's daily Chrome profile.",
  'Screenshots are optional because not every model can see images.',
].join(' ')

export function formatVisualFeedbackVerificationContract(notes = []) {
  const list = Array.isArray(notes) ? notes.filter((note) => note && typeof note === 'object') : []
  const hasFunctional = list.some((note) => note.kind === 'functional')
  const lines = [
    '## Verification contract',
    '',
    '- Stay in the open Visual Feedback BrowserSession and reuse that session id.',
    '- Do not call browser_act open, and do not curl localhost.',
    '- The selected-element information and cited source locations below are meant to be sufficient. You may use browser_inspect and browser_act if you need to inspect or verify (or tool_search "browser" if those tools are not already in your list), but you are not required to re-check DOM, layout, or computed style just to confirm what was selected or where the code is.',
    '- After you make edits, run existing project tests if present, and verify the change in this same session.',
  ]
  if (hasFunctional) {
    lines.push('- For functional notes that need a click or live check, click the element and inspect the resulting route, dialog, console, and network. Do not rely on screenshots alone.')
  }
  return lines.join('\n')
}

export function presentVisualFeedbackLogin({ loginUrl = '', pageUrl = '', open = false } = {}) {
  const stored = String(loginUrl || '').trim()
  if (!stored) {
    return { usedLoginUrl: false, revealLoginUrl: false, loginUrl: '' }
  }
  const reveal = open === true && isLikelyAuthPage(pageUrl)
  return {
    usedLoginUrl: true,
    revealLoginUrl: reveal,
    loginUrl: reveal ? stored : '',
  }
}

export function isVisualFeedbackInProgress(session) {
  const visualFeedback = session?.visualFeedback
  if (!visualFeedback) return false
  return Boolean(
    visualFeedback.bindingInstalled
    || visualFeedback.active
    || visualFeedback.lastState
    || visualFeedback.lastPayload
    || visualFeedback.lastEnvironment,
  )
}

export function isVisualFeedbackNoteStale(note, current) {
  if (!current) return true
  const expected = note?.element || {}
  const expectedTag = String(expected.tag || '').toLowerCase()
  const currentTag = String(current.tag || '').toLowerCase()
  if (expectedTag && currentTag && expectedTag !== currentTag) return true
  if (expected.id && expected.id !== String(current.id || '')) return true
  const expectedText = String(expected.text || '').replace(/\s+/g, ' ').trim()
  const currentText = String(current.text || '').replace(/\s+/g, ' ').trim()
  if (expectedText && currentText !== expectedText) return true
  return false
}

export function noteElements(note) {
  if (!note || typeof note !== 'object') return []
  if (Array.isArray(note.elements) && note.elements.length) {
    return note.elements.filter((item) => item && typeof item === 'object')
  }
  return note.element ? [note.element] : []
}

export function isSharedVisualFeedbackNote(note) {
  return noteElements(note).length > 1
}

export function formatVisualFeedbackSourceLocations(locations) {
  const items = Array.isArray(locations) ? locations.filter((item) => item?.file) : []
  const preferred = items.filter((item) => isOriginalSourcePath(item.file) || (!isLibraryPath(item.file) && !isGeneratedBundlePath(item.file)))
  if (!preferred.length) return 'not resolved'
  return preferred.map((item) => {
    const loc = `${item.file}${item.line ? `:${item.line}` : ''}`
    const extras = [item.component, item.framework].filter(Boolean)
    return extras.length ? `${loc} (${extras.join(', ')})` : loc
  }).join(', ')
}

export function formatVisualFeedbackSourceLine(locations) {
  const sources = formatVisualFeedbackSourceLocations(locations)
  if (!sources || sources === 'not resolved') {
    return 'Source: not resolved (no original source location was found for this element)'
  }
  return `Source: ${sources}`
}

function formatElementIdentityLines(element, { sourceLocations, screenshot } = {}) {
  const node = element || {}
  const className = String(node.className || node.class || '').replace(/\s+/g, ' ').trim()
  const rect = node.rect
    ? `${node.rect.width}×${node.rect.height} at (${node.rect.x}, ${node.rect.y})`
    : 'n/a'
  const styles = node.styles
    ? Object.entries(node.styles).map(([key, value]) => `${key}: ${value}`).join('; ')
    : ''
  const lines = [
    `- Selector: \`${node.selector || ''}\``,
    `- Tag: ${node.tag || ''}  id: ${node.id || ''}${className ? `  class: ${className}` : ''}  role: ${node.role || ''}  name: ${node.name || ''}`,
  ]
  if (node.text) lines.push(`- Text: ${String(node.text).slice(0, 200)}`)
  if (!node.name && !node.role && node.ancestorName) {
    lines.push(`- Closest interactive ancestor: ${String(node.ancestorName).slice(0, 80)}`)
  }
  if (node.html) lines.push(`- Markup: ${String(node.html).slice(0, 280)}`)
  if (node.childLabels) lines.push(`- Child labels: ${String(node.childLabels).slice(0, 160)}`)
  lines.push(`- Layout: ${rect}`)
  if (styles) lines.push(`- Computed style: ${styles.slice(0, 500)}`)
  lines.push(`- ${formatVisualFeedbackSourceLine(sourceLocations || node.sourceLocations)}`)
  const shot = screenshot || node.screenshot
  if (shot) lines.push(`- ${formatVisualFeedbackScreenshotLine(shot)}`)
  return lines
}

function formatVisibleNoteLine(note, index) {
  const elements = noteElements(note)
  const selectors = elements.map((item) => item.selector).filter(Boolean)
  const selector = selectors.length > 1
    ? `${selectors.length} elements selected together (${selectors.join(', ')})`
    : (selectors[0] || note.element?.selector || '(no selector)')
  const text = String(note.text || '').trim() || '(no text)'
  const stale = note.stale ? ' [stale]' : ''
  return `${index}. ${text} — ${selector}${stale}`
}

export function formatVisualFeedbackVisibleText(payload) {
  const notes = Array.isArray(payload?.notes) ? payload.notes : []
  const groups = groupVisualFeedbackNotesByPage(notes)
  const fallbackUrl = payload?.url || payload?.environment?.url || ''
  if (groups.length <= 1) {
    const url = groups[0]?.url || fallbackUrl
    const lines = [`Visual Feedback: ${notes.length} note${notes.length === 1 ? '' : 's'} on ${url || 'the open page'}`]
    notes.forEach((note, index) => {
      lines.push(formatVisibleNoteLine(note, index + 1))
    })
    return lines.join('\n')
  }
  const lines = [`Visual Feedback: ${notes.length} notes across ${groups.length} pages`]
  let index = 1
  for (const group of groups) {
    lines.push(group.url || group.pageKey)
    for (const note of group.notes) {
      lines.push(formatVisibleNoteLine(note, index))
      index += 1
    }
  }
  return lines.join('\n')
}

export function formatVisualFeedbackMessage(payload) {
  const notes = Array.isArray(payload?.notes) ? payload.notes : []
  const groups = groupVisualFeedbackNotesByPage(notes)
  const url = payload?.url || payload?.environment?.url || ''
  const envIds = (payload?.environment?.strong || []).map((item) => item.id || item).join(', ')
  const lines = [
    '# Visual Feedback',
    '',
    VISUAL_FEEDBACK_PROMPT,
    '',
    `URL: ${url || '(unknown)'}`,
    `Title: ${payload?.title || ''}`,
    `Environment: ${payload?.environment?.ok ? 'development' : 'not development'}${envIds ? ` (${envIds})` : ''}`,
    `Notes: ${notes.length}${groups.length > 1 ? ` across ${groups.length} pages` : ''}`,
    '',
  ]
  let noteIndex = 0
  const renderNote = (note, pageUrl) => {
    noteIndex += 1
    const elements = noteElements(note)
    const shared = elements.length > 1
    const stale = note.stale ? ' (stale: selector, tag, id, or text no longer matches)' : ''
    const title = shared
      ? `## ${noteIndex}. ${note.kind === 'functional' ? 'Functional' : 'Visual'} note (${elements.length} elements selected together)${stale}`
      : `## ${noteIndex}. ${note.kind === 'functional' ? 'Functional' : 'Visual'} note${stale}`
    lines.push(title)
    lines.push('')
    lines.push(String(note.text || '').trim() || '(no text)')
    lines.push('')
    if (shared) {
      lines.push('These elements were selected together, and the instruction above applies to all of them.')
      lines.push('')
      elements.forEach((element, offset) => {
        lines.push(`### Element ${offset + 1}`)
        lines.push('')
        lines.push(...formatElementIdentityLines(element, {
          sourceLocations: element.sourceLocations,
          screenshot: element.screenshot,
        }))
        lines.push('')
      })
      if (note.groupScreenshot && note.screenshot) {
        lines.push(`- Group screenshot: ${formatVisualFeedbackScreenshotLine(note.screenshot).replace(/^Screenshot: /, '')}`)
        lines.push('')
      }
    } else {
      const element = elements[0] || note.element || {}
      lines.push(...formatElementIdentityLines(element, {
        sourceLocations: element.sourceLocations || note.sourceLocations,
        screenshot: element.screenshot || note.screenshot,
      }))
    }
    const noteUrl = note.url || pageUrl
    if (noteUrl && noteUrl !== url && groups.length <= 1) lines.push(`- Note URL: ${noteUrl}`)
    lines.push('')
  }
  if (groups.length > 1) {
    groups.forEach((group, offset) => {
      const heading = group.title
        ? `# Page ${offset + 1}. ${group.url || group.pageKey} (${group.title})`
        : `# Page ${offset + 1}. ${group.url || group.pageKey}`
      lines.push(heading)
      lines.push(`${group.notes.length} note${group.notes.length === 1 ? '' : 's'}`)
      lines.push('')
      for (const note of group.notes) renderNote(note, group.url)
    })
  } else {
    notes.forEach((note) => renderNote(note, groups[0]?.url || url))
  }
  lines.push(formatVisualFeedbackVerificationContract(notes))
  const media = visualFeedbackScreenshotAttachments(notes)
  return {
    text: formatVisualFeedbackVisibleText(payload),
    modelText: lines.join('\n'),
    modelImages: media.modelImages,
    attachments: media.attachments,
  }
}

async function locateElementSource(session, element) {
  const selector = element?.selector
  if (!selector || !session?.cdp) return []
  try {
    return await locateSource(session.cdp, session, selector)
  } catch {
    return []
  }
}

function preserveOffPageNoteMedia(note) {
  const elements = noteElements(note)
  const withShot = (item, fallback) => {
    if (item?.screenshot?.data || item?.screenshot?.unavailable) return item
    if (fallback?.data || fallback?.unavailable) return item
    return { ...item, screenshot: { unavailable: true, reason: 'not-captured' } }
  }
  if (elements.length > 1) {
    const nextElements = elements.map((element) => withShot({ ...element }))
    const hasAny = nextElements.some((item) => item.screenshot?.data) || note.screenshot?.data
    return {
      ...note,
      shared: true,
      elements: nextElements,
      element: nextElements[0] || note.element,
      screenshot: note.screenshot || (hasAny ? note.screenshot : { unavailable: true, reason: 'not-captured' }),
    }
  }
  if (note.screenshot?.data || note.screenshot?.unavailable) return { ...note }
  const element = elements[0] || note.element
  if (element?.screenshot?.data || element?.screenshot?.unavailable) {
    return { ...note, screenshot: element.screenshot }
  }
  return { ...note, screenshot: { unavailable: true, reason: 'not-captured' } }
}

export async function enrichVisualFeedbackPayload(session, payload = {}, options = {}) {
  const currentUrl = payload.url || session?.page?.url?.() || ''
  const notes = []
  const captureList = []
  const captureIndex = []
  for (const note of payload.notes || []) {
    const onCurrentPage = isVisualFeedbackNoteOnPage(note, currentUrl)
    const elements = noteElements(note)
    const enrichedElements = []
    for (const element of elements) {
      if (onCurrentPage) {
        const located = await locateElementSource(session, element)
        const sourceLocations = located.length ? located : (element.sourceLocations || [])
        enrichedElements.push({ ...element, sourceLocations })
      } else {
        // Do not re-query the live DOM on a different page. Keep annotation-time context.
        enrichedElements.push({ ...element })
      }
    }
    const shared = enrichedElements.length > 1
    const enriched = {
      ...note,
      shared,
      element: enrichedElements[0] || note.element,
      elements: shared ? enrichedElements : undefined,
      sourceLocations: enrichedElements[0]?.sourceLocations || note.sourceLocations || [],
    }
    if (onCurrentPage) {
      captureIndex.push(notes.length)
      captureList.push(enriched)
      notes.push(enriched)
    } else {
      notes.push(preserveOffPageNoteMedia(enriched))
    }
  }
  const captured = captureList.length
    ? await captureVisualFeedbackScreenshots(session, captureList, options)
    : []
  captureIndex.forEach((index, offset) => {
    notes[index] = captured[offset] || notes[index]
  })
  const environment = payload.environment?.strong
    ? payload.environment
    : await probeDevEnvironment(session).catch(() => payload.environment || { ok: false, strong: [], weak: [] })
  return {
    ...payload,
    url: payload.url || session?.page?.url?.() || currentUrl,
    title: payload.title || (session?.page ? await session.page.title().catch(() => '') : ''),
    environment,
    notes,
  }
}

export async function installVisualFeedback(session, hooks = {}, { locale } = {}) {
  if (!session?.context || !session?.page) {
    const error = new Error('Open the controlled browser before installing Visual Feedback.')
    error.code = 'BROWSER_NOT_OPEN'
    throw error
  }
  session.visualFeedback = session.visualFeedback || {
    bindingInstalled: false,
    active: false,
    lastState: null,
    lastPayload: null,
    hooks: {},
  }
  session.visualFeedback.hooks = hooks || {}
  if (!session.visualFeedback.bindingInstalled) {
    await session.context.exposeBinding(VISUAL_FEEDBACK_BINDING, async (_source, message) => {
      const currentHooks = session.visualFeedback?.hooks || {}
      const type = message?.type
      if (type === 'state') {
        session.visualFeedback.lastState = message.payload || null
        session.visualFeedback.active = message.payload?.mode === true
        currentHooks.onState?.(message.payload)
        return { ok: true }
      }
      if (type === 'enrich-note') {
        const note = message.payload?.note
        if (!note) return { ok: false, code: 'NO_NOTES' }
        const pageUrl = message.payload?.url || session?.page?.url?.() || ''
        const current = session?.page?.url?.() || ''
        if (current && pageUrl && visualFeedbackPageKey(current) !== visualFeedbackPageKey(note.url || pageUrl)) {
          return { ok: false, code: 'PAGE_CHANGED' }
        }
        const enriched = await enrichVisualFeedbackPayload(session, {
          notes: [note],
          url: pageUrl || current,
          title: message.payload?.title,
          environment: message.payload?.environment,
        })
        return { ok: true, note: enriched.notes?.[0] || null }
      }
      if (type === 'submit') {
        const enriched = await enrichVisualFeedbackPayload(session, message.payload || {})
        if (!enriched.notes?.length) {
          return { ok: false, code: 'NO_NOTES' }
        }
        session.visualFeedback.lastPayload = enriched
        session.visualFeedback.active = true
        const result = await currentHooks.onSubmit?.(enriched)
        if (result && result.ok === false) return result
        const cleared = {
          ...(message.payload || session.visualFeedback.lastState || {}),
          notes: [],
          mode: false,
        }
        session.visualFeedback.lastState = cleared
        currentHooks.onState?.(cleared)
        return { ok: true, ...(result || {}) }
      }
      return { ok: false, error: `Unknown Visual Feedback message: ${type || 'empty'}` }
    })
    await session.context.addInitScript({ content: overlayInitScript(session, locale) })
    session.visualFeedback.bindingInstalled = true
  }
  hookVisualFeedbackNavigation(session)
  await session.page.evaluate(overlayInitScript(session, locale)).catch(() => {})
}

function hookVisualFeedbackNavigation(session) {
  const page = session?.page
  if (!page || page.__codeminiVfNavHooked) return
  page.__codeminiVfNavHooked = true
  const reinject = async () => {
    if (!session?.page || session.page.isClosed?.()) return
    await session.page.evaluate(overlayInitScript(session)).catch(() => {})
    const environment = await probeDevEnvironment(session).catch(() => session.visualFeedback?.lastEnvironment)
    if (environment) {
      session.visualFeedback = { ...(session.visualFeedback || {}), lastEnvironment: environment }
      await applyEnvironmentToPage(session, environment)
    }
  }
  page.on('domcontentloaded', () => { void reinject() })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) void reinject()
  })
}

async function applyEnvironmentToPage(session, environment) {
  if (!session?.page) return
  await session.page.evaluate((report) => {
    window.__codeminiVisualFeedbackApi?.setEnvironment?.(report)
  }, environment).catch(() => {})
}

export async function openVisualFeedback(session, {
  url = '',
  headless = false,
  timeoutMs = 30000,
  hooks = {},
  locale,
} = {}) {
  const launched = await session.launchBrowser({
    headless: headless === true,
    timeout_ms: timeoutMs,
  })
  await installVisualFeedback(session, hooks, { locale })
  const target = String(url || '').trim()
  const current = session.page.url()
  if (target && current !== target) {
    await session.page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    await session.resetCdp()
  }
  // Always re-inject, including when the URL is unchanged or the previous overlay was lost.
  await session.page.evaluate(overlayInitScript(session, locale)).catch(() => {})
  const environment = await probeDevEnvironment(session)
  await applyEnvironmentToPage(session, environment)
  session.visualFeedback = {
    ...(session.visualFeedback || {}),
    active: true,
    lastEnvironment: environment,
  }
  const title = await session.page.title().catch(() => '')
  return {
    ok: true,
    reused: launched?.reused === true,
    url: session.page.url(),
    title,
    headless: session.launch?.headless === true,
    channel: session.lastChannel || '',
    environment,
    limitedCapabilities: environment?.ok !== true,
  }
}

export async function readVisualFeedbackOverlayState(session) {
  if (!session?.isOpen?.() || !session.page || session.page.isClosed?.()) return null
  return session.page.evaluate(() => (
    window.__codeminiVisualFeedbackApi?.snapshot?.() || null
  )).catch(() => null)
}

export function createVisualFeedbackController({ getSession, workspaceRoot, onSubmit } = {}) {
  let devServer = null
  let lastOpen = null

  async function resolveSession() {
    const session = typeof getSession === 'function' ? getSession() : getSession
    if (!session) {
      const error = new Error('The chat runtime does not have a browser session yet.')
      error.code = 'BROWSER_SESSION_MISSING'
      throw error
    }
    return session
  }

  return {
    async open(options = {}) {
      const session = await resolveSession()
      if (session.isOpen() && session.launch?.headless === true && options.headless !== true) {
        await session.dispose()
      }
      const server = await ensureDevServer({
        workspaceRoot,
        preferredUrl: options.url,
        startIfMissing: options.startIfMissing !== false,
        timeoutMs: options.timeoutMs,
      })
      if (server.child) devServer = server.child
      const opened = await openVisualFeedback(session, {
        url: server.loginUrl || server.url,
        headless: options.headless === true,
        timeoutMs: options.timeoutMs,
        locale: options.locale,
        hooks: {
          onState: (state) => { lastOpen = { ...(lastOpen || {}), state } },
          onSubmit: async (payload) => onSubmit?.(payload),
        },
      })
      lastOpen = {
        ...opened,
        loginUrl: server.loginUrl || '',
        limitedCapabilities: server.limitedCapabilities === true || opened.limitedCapabilities === true,
        devServer: {
          url: server.url,
          reused: server.reused === true,
          started: server.started === true,
          script: server.script || '',
        },
        state: session.visualFeedback?.lastState || null,
      }
      return lastOpen
    },
    async status(options = {}) {
      const session = await resolveSession().catch(() => null)
      const open = Boolean(session?.isOpen?.())
      if (session && options.locale) {
        await applyVisualFeedbackLocale(session, options.locale)
      }
      const environment = open
        ? await probeDevEnvironment(session).catch(() => lastOpen?.environment || null)
        : lastOpen?.environment || null
      const liveState = open ? await readVisualFeedbackOverlayState(session) : null
      if (liveState) {
        if (session?.visualFeedback) session.visualFeedback.lastState = liveState
        if (lastOpen) lastOpen.state = liveState
      }
      if (!open) {
        if (session?.visualFeedback) session.visualFeedback.lastState = null
        if (lastOpen) lastOpen.state = null
      }
      return {
        open,
        url: session?.page?.url?.() || lastOpen?.url || '',
        title: lastOpen?.title || '',
        headless: session?.launch?.headless === true,
        environment,
        devServer: lastOpen?.devServer || null,
        state: open
          ? (liveState || session?.visualFeedback?.lastState || lastOpen?.state || null)
          : null,
        ...presentVisualFeedbackLogin({
          loginUrl: lastOpen?.loginUrl || '',
          pageUrl: session?.page?.url?.() || lastOpen?.url || '',
          open,
        }),
        active: session?.visualFeedback?.active === true,
        limitedCapabilities: Boolean(
          lastOpen?.limitedCapabilities === true
          || (open && environment && environment.ok !== true)
        ),
      }
    },
    async close({ stopDevServer = false } = {}) {
      const session = await resolveSession().catch(() => null)
      if (session?.isOpen?.()) await session.dispose()
      if (stopDevServer && devServer && devServer.exitCode == null) {
        devServer.kill('SIGTERM')
      }
      lastOpen = null
      return { ok: true }
    },
    getDevServerProcess: () => devServer,
  }
}
