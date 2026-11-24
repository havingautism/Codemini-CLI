import sharp from 'sharp'

export const VISUAL_FEEDBACK_SCREENSHOT = {
  padding: 16,
  minSize: 96,
  maxSize: 800,
  maxBytes: 180_000,
  quality: 72,
}

function positive(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

export function computeScreenshotClip(box, viewport, options = {}) {
  if (!box || !viewport) return null
  const padding = options.padding ?? VISUAL_FEEDBACK_SCREENSHOT.padding
  const minSize = options.minSize ?? VISUAL_FEEDBACK_SCREENSHOT.minSize
  const maxSize = options.maxSize ?? VISUAL_FEEDBACK_SCREENSHOT.maxSize
  const vw = positive(viewport.width)
  const vh = positive(viewport.height)
  if (!vw || !vh) return null

  const boxWidth = Math.max(0, Number(box.width) || 0)
  const boxHeight = Math.max(0, Number(box.height) || 0)
  if (boxWidth < 1 && boxHeight < 1) return null

  const centerX = Number(box.x) + boxWidth / 2
  const centerY = Number(box.y) + boxHeight / 2
  let width = Math.min(maxSize, Math.max(boxWidth + padding * 2, boxWidth < minSize ? minSize : boxWidth + padding * 2))
  let height = Math.min(maxSize, Math.max(boxHeight + padding * 2, boxHeight < minSize ? minSize : boxHeight + padding * 2))

  let x = centerX - width / 2
  let y = centerY - height / 2
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x + width > vw) x = Math.max(0, vw - width)
  if (y + height > vh) y = Math.max(0, vh - height)
  width = Math.min(width, vw - x)
  height = Math.min(height, vh - y)
  if (width < 1 || height < 1) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export function unionElementRects(elements) {
  const rects = (Array.isArray(elements) ? elements : [])
    .map((item) => item?.rect || item)
    .filter((rect) => rect && (Number(rect.width) > 0 || Number(rect.height) > 0))
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => Number(rect.x ?? rect.left) || 0))
  const top = Math.min(...rects.map((rect) => Number(rect.y ?? rect.top) || 0))
  const right = Math.max(...rects.map((rect) => (Number(rect.x ?? rect.left) || 0) + (Number(rect.width) || 0)))
  const bottom = Math.max(...rects.map((rect) => (Number(rect.y ?? rect.top) || 0) + (Number(rect.height) || 0)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function shouldUseGroupScreenshot(elements, viewport = {}) {
  if (!Array.isArray(elements) || elements.length < 2) return false
  const union = unionElementRects(elements)
  if (!union || union.width < 1 || union.height < 1) return false
  const vw = Number(viewport.width) || 0
  const vh = Number(viewport.height) || 0
  if (vw && vh) {
    if (union.width > vw * 0.7 && union.height > vh * 0.7) return false
    if ((union.width * union.height) > vw * vh * 0.4) return false
  }
  const sum = (Array.isArray(elements) ? elements : []).reduce((total, item) => {
    const rect = item?.rect || item
    return total + Math.max(0, Number(rect?.width) || 0) * Math.max(0, Number(rect?.height) || 0)
  }, 0)
  if (sum > 0 && (union.width * union.height) > sum * 3.5) return false
  return true
}

function noteElements(note) {
  if (Array.isArray(note?.elements) && note.elements.length) {
    return note.elements.filter((item) => item && typeof item === 'object')
  }
  return note?.element ? [note.element] : []
}

export function formatVisualFeedbackScreenshotLine(screenshot) {
  if (screenshot?.data) {
    const size = screenshot.width && screenshot.height
      ? ` (${screenshot.width}×${screenshot.height})`
      : ''
    return `Screenshot: attached${size}`
  }
  const reason = String(screenshot?.reason || '').trim()
  return `Screenshot: unavailable${reason ? ` (${reason})` : ''}`
}

function collectNoteScreenshots(note, index) {
  const collected = []
  const seen = new Set()
  const push = (screenshot, name, id) => {
    if (!screenshot?.data || seen.has(screenshot.data)) return
    seen.add(screenshot.data)
    collected.push({ screenshot, name, id })
  }
  push(note?.screenshot, `visual-feedback-note-${index + 1}.jpg`, `vf-shot-${note?.id || index + 1}`)
  noteElements(note).forEach((element, offset) => {
    push(
      element?.screenshot,
      `visual-feedback-note-${index + 1}-el-${offset + 1}.jpg`,
      `vf-shot-${note?.id || index + 1}-el-${offset + 1}`,
    )
  })
  return collected
}

export function visualFeedbackScreenshotAttachments(notes = []) {
  const modelImages = []
  const attachments = []
  notes.forEach((note, index) => {
    for (const item of collectNoteScreenshots(note, index)) {
      const screenshot = item.screenshot
      const mime = screenshot.mime || 'image/jpeg'
      modelImages.push({
        mime,
        data: screenshot.data,
        name: item.name,
        filename: item.name,
      })
      attachments.push({
        id: item.id,
        name: item.name,
        mime,
        kind: 'image',
        size: Math.round((String(screenshot.data).length * 3) / 4),
        width: screenshot.width || 0,
        height: screenshot.height || 0,
        url: `data:${mime};base64,${screenshot.data}`,
      })
    }
  })
  return { modelImages, attachments }
}

async function readViewportSize(page) {
  const size = typeof page.viewportSize === 'function' ? page.viewportSize() : null
  if (positive(size?.width) && positive(size?.height)) {
    return { width: size.width, height: size.height }
  }
  if (!page.evaluate) return null
  return page.evaluate(() => ({
    width: window.visualViewport?.width || window.innerWidth,
    height: window.visualViewport?.height || window.innerHeight,
  })).catch(() => null)
}

export async function setVisualFeedbackCaptureHidden(session, hidden) {
  const page = session?.page
  if (!page || page.isClosed?.() || typeof page.evaluate !== 'function') return
  await page.evaluate((value) => {
    window.__codeminiVisualFeedbackApi?.setCaptureHidden?.(value)
  }, hidden === true).catch(() => {})
}

export async function encodeVisualFeedbackScreenshot(buffer, options = {}) {
  const maxSize = options.maxSize ?? VISUAL_FEEDBACK_SCREENSHOT.maxSize
  const maxBytes = options.maxBytes ?? VISUAL_FEEDBACK_SCREENSHOT.maxBytes
  let quality = options.quality ?? VISUAL_FEEDBACK_SCREENSHOT.quality
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  if (!input.length) {
    const error = new Error('empty screenshot')
    throw error
  }
  try {
    const resize = { width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true }
    let data = await sharp(input, { animated: false })
      .rotate()
      .resize(resize)
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    while (data.length > maxBytes && quality > 40) {
      quality -= 12
      data = await sharp(input, { animated: false })
        .rotate()
        .resize(resize)
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
    }
    if (data.length > maxBytes) {
      data = await sharp(data)
        .resize({
          width: Math.max(160, Math.round(maxSize * 0.65)),
          height: Math.max(160, Math.round(maxSize * 0.65)),
          fit: 'inside',
        })
        .jpeg({ quality: 50, mozjpeg: true })
        .toBuffer()
    }
    const meta = await sharp(data).metadata()
    return {
      mime: 'image/jpeg',
      data: data.toString('base64'),
      width: meta.width || 0,
      height: meta.height || 0,
    }
  } catch {
    return {
      mime: 'image/jpeg',
      data: input.toString('base64'),
      width: 0,
      height: 0,
    }
  }
}

export async function captureVisualFeedbackNoteScreenshot(session, note, options = {}) {
  const page = session?.page
  if (!page || page.isClosed?.()) return { unavailable: true, reason: 'page-unavailable' }
  const selector = String(note?.element?.selector || '').trim()
  if (!selector) return { unavailable: true, reason: 'no-selector' }
  try {
    const locator = page.locator(selector).first()
    const count = await locator.count()
    if (!count) return { unavailable: true, reason: 'not-found' }
    await locator.scrollIntoViewIfNeeded?.().catch(() => {})
    const box = await locator.boundingBox()
    if (!box || (box.width < 1 && box.height < 1)) return { unavailable: true, reason: 'not-visible' }
    const viewport = await readViewportSize(page)
    const clip = computeScreenshotClip(box, viewport, options)
    if (!clip) return { unavailable: true, reason: 'not-visible' }
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      clip,
      scale: 'css',
      caret: 'hide',
      animations: 'disabled',
    })
    return await encodeVisualFeedbackScreenshot(buffer, options)
  } catch {
    return { unavailable: true, reason: 'capture-failed' }
  }
}

export async function captureVisualFeedbackGroupScreenshot(session, elements, options = {}) {
  const page = session?.page
  if (!page || page.isClosed?.()) return { unavailable: true, reason: 'page-unavailable' }
  const boxes = []
  for (const element of elements || []) {
    const selector = String(element?.selector || '').trim()
    if (!selector) continue
    try {
      const locator = page.locator(selector).first()
      const count = await locator.count()
      if (!count) continue
      const box = await locator.boundingBox()
      if (box && (box.width >= 1 || box.height >= 1)) boxes.push(box)
    } catch {
      // Keep gathering other boxes; a missing one should not block the group crop.
    }
  }
  if (boxes.length < 2) return { unavailable: true, reason: 'group-not-visible' }
  const union = unionElementRects(boxes)
  const viewport = await readViewportSize(page)
  const clip = computeScreenshotClip(union, viewport, options)
  if (!clip) return { unavailable: true, reason: 'not-visible' }
  try {
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      clip,
      scale: 'css',
      caret: 'hide',
      animations: 'disabled',
    })
    return await encodeVisualFeedbackScreenshot(buffer, options)
  } catch {
    return { unavailable: true, reason: 'capture-failed' }
  }
}

async function captureOne(capture, session, note, element, options) {
  try {
    return await capture(session, { ...note, element: element || note.element }, options)
  } catch {
    return { unavailable: true, reason: 'capture-failed' }
  }
}

export async function captureVisualFeedbackScreenshots(session, notes, options = {}) {
  const list = Array.isArray(notes) ? notes : []
  const capture = options.captureScreenshot || captureVisualFeedbackNoteScreenshot
  const captureGroup = options.captureGroupScreenshot || captureVisualFeedbackGroupScreenshot
  await setVisualFeedbackCaptureHidden(session, true)
  try {
    const captured = []
    for (const note of list) {
      const elements = noteElements(note)
      if (elements.length > 1) {
        const viewport = await readViewportSize(session?.page).catch(() => null)
        const preferGroup = options.captureScreenshot
          ? false
          : shouldUseGroupScreenshot(elements, viewport || {})
        let groupShot = null
        if (preferGroup) {
          try {
            groupShot = await captureGroup(session, elements, options)
          } catch {
            groupShot = { unavailable: true, reason: 'capture-failed' }
          }
        }
        const useGroup = Boolean(groupShot?.data)
        const nextElements = []
        if (!useGroup) {
          for (const element of elements) {
            const screenshot = await captureOne(capture, session, note, element, options)
            nextElements.push({ ...element, screenshot })
          }
        } else {
          for (const element of elements) nextElements.push({ ...element })
        }
        captured.push({
          ...note,
          shared: true,
          groupScreenshot: useGroup,
          elements: nextElements,
          element: nextElements[0] || note.element,
          screenshot: useGroup ? groupShot : undefined,
        })
        continue
      }
      try {
        const screenshot = await capture(session, note, options)
        captured.push({ ...note, screenshot })
      } catch {
        captured.push({ ...note, screenshot: { unavailable: true, reason: 'capture-failed' } })
      }
    }
    return captured
  } finally {
    await setVisualFeedbackCaptureHidden(session, false)
  }
}
