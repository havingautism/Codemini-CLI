/** Stable key so parent re-renders with a new items[] identity do not flash the banner. */
export function embedBannerContentKey(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.type !== 'image')
    .map((item) => String(item?.url || '').trim())
    .filter(Boolean)
    .join('\n');
}
