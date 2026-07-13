import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skillPanelSource = readFileSync(
  new URL('../codemini-web/client/src/components/SkillPanel.jsx', import.meta.url),
  'utf8',
);
const webStyles = readFileSync(
  new URL('../codemini-web/client/style.css', import.meta.url),
  'utf8',
);

test('skill content editing uses the same bottom action bar as routing', () => {
  assert.match(
    skillPanelSource,
    /modeView === "edit" && \([\s\S]*?border-t border-\(--border-default\)[\s\S]*?t\("cancel"\)[\s\S]*?handleContentSave[\s\S]*?t\("save"\)/,
  );
});

test('skill Markdown preview is tighter and has a scoped transparent surface', () => {
  assert.match(
    skillPanelSource,
    /modeView === "view" \? "px-5 py-4" : "p-5"/,
  );
  assert.match(
    skillPanelSource,
    /<MarkdownPreview[\s\S]*?value=\{content\}[\s\S]*?className="skill-md-preview flex-1"[\s\S]*?\/>/,
  );
  assert.match(
    webStyles,
    /\.skill-md-preview \.wmde-markdown\s*\{\s*background:\s*transparent;\s*\}/,
  );
});
