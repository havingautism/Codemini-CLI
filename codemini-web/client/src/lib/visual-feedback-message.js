export const VISUAL_FEEDBACK_MESSAGE_KIND = 'visual-feedback'

export function isVisualFeedbackUserMessage(message) {
  if (!message || typeof message !== 'object') return false
  return message.kind === VISUAL_FEEDBACK_MESSAGE_KIND
    || message.visualFeedback === true
    || message.source === VISUAL_FEEDBACK_MESSAGE_KIND
}

export function visualFeedbackUserMessageFields(modelText = '') {
  return {
    kind: VISUAL_FEEDBACK_MESSAGE_KIND,
    visualFeedback: true,
    modelText: typeof modelText === 'string' ? modelText : String(modelText || ''),
  }
}


export const VISUAL_FEEDBACK_DEV_SERVER_ERROR_KEYS = {
  DEV_SERVER_EXITED: 'visualFeedbackDevServerExited',
  DEV_SERVER_SCRIPT_MISSING: 'visualFeedbackDevServerMissing',
  DEV_SERVER_TIMEOUT: 'visualFeedbackDevServerTimeout',
  DEV_SERVER_NOT_FOUND: 'visualFeedbackDevServerNotFound',
}

export function formatVisualFeedbackPanelError(error, translate) {
  const t = typeof translate === 'function' ? translate : (key) => key
  const code = error?.code
  const key = VISUAL_FEEDBACK_DEV_SERVER_ERROR_KEYS[code]
  const raw = String(error?.message || '').trim()
  const looksLikeDump = /codemini>|exited early|npm ERR!|\n\s*>/i.test(raw) || raw.length > 240
  const message = key
    ? t(key)
    : (looksLikeDump || !raw ? t('visualFeedbackError') : raw)
  const showHint = Boolean(key) || looksLikeDump || String(code || '').startsWith('DEV_SERVER_')
  return showHint ? `${message} ${t('visualFeedbackDevServerHint')}` : message
}
