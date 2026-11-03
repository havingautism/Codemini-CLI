export function splitEmojiTitle(value) {
  const fullTitle = String(value || '').trim();
  if (!fullTitle) return { emoji: '', title: '' };
  const firstGrapheme = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(fullTitle)[Symbol.iterator]().next().value?.segment || ''
    : Array.from(fullTitle)[0] || '';
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(firstGrapheme)) return { emoji: '', title: fullTitle };
  return { emoji: firstGrapheme, title: fullTitle.slice(firstGrapheme.length).trimStart() || fullTitle };
}
