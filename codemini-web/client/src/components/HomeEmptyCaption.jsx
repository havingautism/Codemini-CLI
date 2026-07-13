import { useEffect, useState } from "react";
import { tList } from "../../i18n/index.js";

const ROTATE_MS = 10000;

function applyTemplate(text, vars = {}) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] == null ? "" : String(vars[key]),
  );
}

export function HomeEmptyCaption({ promptKey, vars, className }) {
  const prompts = tList(promptKey);
  const list = prompts.length > 0 ? prompts : [""];
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setIndex(0);
    setVisible(true);
  }, [promptKey, list.length]);

  useEffect(() => {
    if (list.length <= 1) return undefined;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return undefined;

    let fadeTimer = null;
    const timer = window.setInterval(() => {
      setVisible(false);
      fadeTimer = window.setTimeout(() => {
        setIndex((prev) => (prev + 1) % list.length);
        setVisible(true);
      }, 220);
    }, ROTATE_MS);

    return () => {
      window.clearInterval(timer);
      if (fadeTimer) window.clearTimeout(fadeTimer);
    };
  }, [list.length]);

  const text = applyTemplate(list[index % list.length], vars);

  return (
    <h1 className={className} data-visible={visible ? "true" : "false"}>
      {text}
    </h1>
  );
}
