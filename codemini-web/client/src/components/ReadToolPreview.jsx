import { useMemo } from 'react';
import { CodeOutputPreview } from '@/components/beautiful-ui/CodeBlockFrame.jsx';
import { parseReadToolPreview } from '@/lib/read-tool-preview.js';

export default function ReadToolPreview({ output, path }) {
  const preview = useMemo(() => parseReadToolPreview(output), [output]);
  return (
    <CodeOutputPreview
      label={preview?.header || path || "text"}
      path={path}
      content={preview?.content ?? output}
      startLine={preview?.startLine}
      showLineNumbers={Boolean(preview)}
      footer={preview?.footer}
    />
  );
}
