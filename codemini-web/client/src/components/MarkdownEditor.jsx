import { useEffect, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

const INLINE_META_KEY =
  /^(name|description|version|author|license|entry|mode|triggers|priority|enabled)\s*:/i;

export function splitMarkdownFrontmatter(value) {
  const text = String(value || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;

  if (lines[index]?.trim() === "---") {
    let end = index + 1;
    while (end < lines.length) {
      const marker = lines[end].trim();
      if (marker === "---" || marker === "...") {
        const frontmatter = lines.slice(index + 1, end).join("\n").trim();
        const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
        return {
          frontmatter: frontmatter || null,
          body: body.trim() ? body : "",
        };
      }
      end += 1;
    }
  }

  const metadataStart = index;
  while (INLINE_META_KEY.test(lines[index]?.trim() || "")) {
    index += 1;
  }
  if (index > metadataStart) {
    const frontmatter = lines.slice(metadataStart, index).join("\n").trim();
    while (index < lines.length && !lines[index].trim()) index += 1;
    return {
      frontmatter: frontmatter || null,
      body: lines.slice(index).join("\n"),
    };
  }

  return { frontmatter: null, body: text };
}

function stripMarkdownMetadata(value) {
  return splitMarkdownFrontmatter(value).body.trim();
}

function useColorMode() {
  const [mode, setMode] = useState(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  });

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const sync = () =>
      setMode(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  height = 360,
  preview = "live",
  className,
}) {
  const colorMode = useColorMode();
  return (
    <div data-color-mode={colorMode} className={cn("codemini-md-editor", className)}>
      <MDEditor
        value={value || ""}
        onChange={(next) => onChange?.(next || "")}
        height={height}
        preview={preview}
        visibleDragbar={false}
        textareaProps={{
          placeholder,
        }}
      />
    </div>
  );
}

export function MarkdownPreview({ value, className }) {
  const colorMode = useColorMode();
  const source = stripMarkdownMetadata(value) || t("noPreview");
  return (
    <div
      data-color-mode={colorMode}
      className={cn(
        "codemini-md-preview min-h-0 overflow-y-auto scroll-smooth",
        className,
      )}
    >
      <MDEditor.Markdown source={source} />
    </div>
  );
}
