import { useMemo } from 'react';
import { FilePreviewCode } from '@/components/FilePreviewCode.jsx';
import { parseReadToolPreview } from '@/lib/read-tool-preview.js';

export default function ReadToolPreview({ output, path }) {
  const preview = useMemo(() => parseReadToolPreview(output), [output]);
  if (!preview) {
    return <div className="codemini-disclosure-payload codemini-disclosure-scroll mt-1"><pre className="m-0 max-h-100 overflow-auto whitespace-pre p-3 font-mono text-xs leading-relaxed text-(--text-primary)">{output}</pre></div>;
  }
  return (
    <div className="codemini-read-tool-preview mt-1">
      <div className="codemini-read-tool-meta">{preview.header}</div>
      <FilePreviewCode path={path} content={preview.content} startLine={preview.startLine} />
      {preview.footer ? <div className="codemini-read-tool-footer">{preview.footer}</div> : null}
    </div>
  );
}
