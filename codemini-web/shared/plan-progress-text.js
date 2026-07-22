/** Strip injected `[plan] Step N/M -> …` progress lines from assistant text. */
export function stripPlanProgressText(text) {
  return String(text || '').replace(
    /(?:^|\n)\[plan\]\s+Step\s+\d+\/\d+\s+->[^\n]*\n?/g,
    '',
  );
}
