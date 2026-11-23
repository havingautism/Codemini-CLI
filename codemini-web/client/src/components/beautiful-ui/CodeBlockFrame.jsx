// The header glyph comes from Beautiful UI's CodeBlock. See LICENSE.
import { CodeBlockCopyButton, defaultComponents } from "streamdown";
import { useHorizontalScrollEdges } from "@/hooks/use-horizontal-scroll-edges.js";
import { cn } from "@/lib/utils";
import { FilePreviewCode } from "@/components/FilePreviewCode.jsx";
import { t } from "../../../i18n/index.js";

function FileIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-(--text-muted)">
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

export function CodeBlockFrame(props) {
  const Pre = defaultComponents.pre;
  const scrollEdges = useHorizontalScrollEdges('[data-streamdown="code-block-body"]', "pre");
  return (
    <div className="codemini-code-frame" {...scrollEdges}>
      <span className="codemini-code-frame-icon" aria-hidden="true"><FileIcon /></span>
      <Pre {...props} />
    </div>
  );
}

export function CodePreviewFrame({ label, copyText, actions, className, children }) {
  const scrollEdges = useHorizontalScrollEdges(".codemini-file-preview-scroll", ".codemini-file-preview-code");
  return (
    <div className={cn("codemini-code-preview", className)} {...scrollEdges}>
      <div className="codemini-code-preview-header">
        <FileIcon />
        <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        {actions}
        {typeof copyText === "string" && (
          <CodeBlockCopyButton code={copyText} title={t("copyCode")} />
        )}
      </div>
      {children}
    </div>
  );
}

export function CodeOutputPreview({
  label = "text",
  path,
  content,
  startLine,
  showLineNumbers,
  footer,
  wrap = false,
}) {
  return (
    <CodePreviewFrame label={label} copyText={content} className={wrap ? "codemini-code-preview-wrap" : undefined}>
      <FilePreviewCode
        path={path}
        content={content}
        startLine={startLine}
        showLineNumbers={showLineNumbers}
      />
      {footer && <div className="codemini-code-preview-footer">{footer}</div>}
    </CodePreviewFrame>
  );
}
