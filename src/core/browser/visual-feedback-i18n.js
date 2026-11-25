import { en } from '../../../codemini-web/client/i18n/en.js'
import { zh } from '../../../codemini-web/client/i18n/zh.js'

export const VISUAL_FEEDBACK_OVERLAY_KEYS = [
  'visualFeedbackOverlayTitle',
  'visualFeedbackOverlayEnvOk',
  'visualFeedbackOverlayEnvBlocked',
  'visualFeedbackOverlayHint',
  'visualFeedbackOverlayBlocked',
  'visualFeedbackCapabilityHint',
  'visualFeedbackOverlayStart',
  'visualFeedbackOverlayStop',
  'visualFeedbackOverlaySubmit',
  'visualFeedbackOverlayNoteCount',
  'visualFeedbackOverlayNoteCountOne',
  'visualFeedbackOverlayVisual',
  'visualFeedbackOverlayFunctional',
  'visualFeedbackOverlayStale',
  'visualFeedbackOverlayRemoveNote',
  'visualFeedbackOverlayUncheck',
  'visualFeedbackOverlaySelectedCount',
  'visualFeedbackOverlaySelectedCountOne',
  'visualFeedbackOverlaySharedNote',
  'visualFeedbackOverlaySharedNoteHint',
  'visualFeedbackOverlaySharedCount',
  'visualFeedbackOverlayPlaceholder',
  'visualFeedbackOverlayAddNote',
  'visualFeedbackOverlayEditNote',
  'visualFeedbackOverlaySaveNote',
  'visualFeedbackOverlayCancel',
  'visualFeedbackOverlaySelecting',
  'visualFeedbackOverlaySubmitting',
  'visualFeedbackOverlaySubmitted',
  'visualFeedbackOverlaySubmitFailed',
  'visualFeedbackOverlayDisconnected',
  'visualFeedbackOverlayNoText',
  'visualFeedbackOverlayEmptyNotes',
  'visualFeedbackOverlayBusy',
  'visualFeedbackOverlayNoNotes',
  'visualFeedbackOverlayPin',
  'visualFeedbackOverlayPinStale',
  'visualFeedbackOverlayParent',
  'visualFeedbackOverlayChild',
  'visualFeedbackOverlayRetargetHint',
  'visualFeedbackOverlayThisPage',
  'visualFeedbackOverlayOtherPage',
  'visualFeedbackOverlayNoteLimit',
]

export function normalizeVisualFeedbackLocale(locale) {
  const value = String(locale || '').trim().toLowerCase()
  if (value.startsWith('en')) return 'en'
  if (value.startsWith('zh')) return 'zh'
  return 'zh'
}

export function interpolateVisualFeedbackString(template, vars = {}) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => (
    vars[key] == null ? '' : String(vars[key])
  ))
}

export function getVisualFeedbackOverlayStrings(locale, overrides = {}) {
  const resolved = normalizeVisualFeedbackLocale(locale)
  const dict = resolved === 'en' ? en : zh
  const fallback = en
  const strings = { locale: resolved }
  for (const key of VISUAL_FEEDBACK_OVERLAY_KEYS) {
    strings[key] = dict[key] || fallback[key] || key
  }
  for (const [key, value] of Object.entries(overrides || {})) {
    if (key !== 'locale' && value != null) strings[key] = String(value)
  }
  return strings
}
