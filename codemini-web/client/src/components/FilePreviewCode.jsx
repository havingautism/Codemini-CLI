import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n/index.js";
import {
  highlightCodeLines,
  languageFromPath,
} from "@/lib/shiki-plugin.js";

function plainLines(code) {
  return String(code ?? "")
    .split(/\r?\n/)
    .map((line) => [{ content: line }]);
}

function tokenStyle(token) {
  if (token?.htmlStyle && typeof token.htmlStyle === "object") {
    return token.htmlStyle;
  }
  if (token?.color) {
    return { color: token.color };
  }
  return undefined;
}

export function FilePreviewCode({
  path = "",
  content = "",
  truncated = false,
}) {
  const language = useMemo(() => languageFromPath(path), [path]);
  const [lines, setLines] = useState(() => plainLines(content));

  useEffect(() => {
    let cancelled = false;
    setLines(plainLines(content));
    highlightCodeLines(content, language)
      .then((result) => {
        if (cancelled) return;
        setLines(Array.isArray(result.lines) ? result.lines : plainLines(content));
      })
      .catch(() => {
        if (!cancelled) setLines(plainLines(content));
      });
    return () => {
      cancelled = true;
    };
  }, [content, language]);

  const gutterWidth = String(Math.max(lines.length, 1)).length;

  return (
    <div className="codemini-file-preview flex min-h-0 flex-1 flex-col">
      {truncated ? (
        <div className="shrink-0 px-3 pt-2 text-[11px] text-(--text-muted)">
          {t("workspacePreviewTruncated")}
        </div>
      ) : null}
      <div className="codemini-file-preview-scroll min-h-0 flex-1 overflow-auto px-2 py-2">
        <div
          className="codemini-file-preview-code inline-block min-w-full font-mono text-[11px] leading-5"
          role="region"
          aria-label={path || t("workspacePreview")}
        >
          {lines.map((tokens, index) => (
            <div
              key={`line-${index}`}
              className="codemini-file-preview-line flex min-w-full"
            >
              <span
                className="codemini-file-preview-gutter shrink-0 select-none pr-3 text-right text-(--text-muted) tabular-nums"
                style={{ minWidth: `${gutterWidth + 1}ch` }}
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="codemini-file-preview-source min-w-0 grow whitespace-pre text-(--text-secondary)">
                {(tokens || []).length === 0 ? (
                  "\u00a0"
                ) : (
                  tokens.map((token, tokenIndex) => (
                    <span
                      key={`t-${index}-${tokenIndex}`}
                      style={tokenStyle(token)}
                    >
                      {token?.content ?? ""}
                    </span>
                  ))
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
