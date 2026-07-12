import { useEffect, useState } from "react";

function normalizePhrases(phrases) {
  if (Array.isArray(phrases)) {
    return phrases.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const single = String(phrases || "").trim();
  return single ? [single] : [];
}

/**
 * Rotate through status phrases with a short fade when active.
 * @param {string[]|string} phrases
 * @param {{ active?: boolean, intervalMs?: number, fadeMs?: number }} [options]
 */
export function useRotatingLabel(
  phrases,
  { active = true, intervalMs = 3000, fadeMs = 280 } = {},
) {
  const list = normalizePhrases(phrases);
  const phraseKey = list.join("\0");
  const [index, setIndex] = useState(() =>
    list.length ? Math.floor(Math.random() * list.length) : 0,
  );
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setIndex((prev) => {
      if (!list.length) return 0;
      if (prev >= list.length) {
        return Math.floor(Math.random() * list.length);
      }
      return prev;
    });
    setVisible(true);
  }, [phraseKey, list.length]);

  useEffect(() => {
    if (!active || list.length <= 1) {
      setVisible(true);
      return undefined;
    }

    let cancelled = false;
    let timeoutId = 0;

    const schedule = () => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setVisible(false);
        timeoutId = window.setTimeout(() => {
          if (cancelled) return;
          setIndex((prev) => (prev + 1) % list.length);
          setVisible(true);
          schedule();
        }, fadeMs);
      }, intervalMs);
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [active, phraseKey, list.length, intervalMs, fadeMs]);

  const label = list.length ? list[index % list.length] : "";
  return { label, visible };
}
