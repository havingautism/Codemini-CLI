import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skillPanelSource = readFileSync(
  new URL('../codemini-web/client/src/components/SkillPanel.jsx', import.meta.url),
  'utf8',
);
const hooksDialogSource = readFileSync(
  new URL('../codemini-web/client/src/components/HooksDialog.jsx', import.meta.url),
  'utf8',
);
const webStyles = readFileSync(
  new URL('../codemini-web/client/style.css', import.meta.url),
  'utf8',
);
const enSource = readFileSync(
  new URL('../codemini-web/client/i18n/en.js', import.meta.url),
  'utf8',
);
const zhSource = readFileSync(
  new URL('../codemini-web/client/i18n/zh.js', import.meta.url),
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

test('the package/context browse toggle has been removed in favor of coding/daily tabs', () => {
  assert.doesNotMatch(skillPanelSource, /BROWSE_MODES/);
  assert.doesNotMatch(skillPanelSource, /skillBrowse_/);
  assert.doesNotMatch(skillPanelSource, /browseMode/);
});

test('SkillPanel renders coding/daily Tabs and always folds skills by package', () => {
  assert.match(
    skillPanelSource,
    /import \{ Tabs, TabsContent, TabsList, TabsTrigger \} from "@\/components\/ui\/tabs"/,
  );
  assert.match(skillPanelSource, /<Tabs\s/);
  assert.match(skillPanelSource, /<TabsTrigger key=\{tabValue\} value=\{tabValue\}>/);
  assert.match(skillPanelSource, /SKILL_TABS = \["coding", "daily"\]/);
  assert.match(skillPanelSource, /skillContextCoding/);
  assert.match(skillPanelSource, /skillContextDaily/);
  assert.match(skillPanelSource, /groupSkillsByPackage\(filteredSkills\)/);
  // The old context-grouped browse list (SkillContextGlobal/CodingMode/DailyMode
  // group headers) must no longer be rendered.
  assert.doesNotMatch(skillPanelSource, /skillContextCodingMode/);
  assert.doesNotMatch(skillPanelSource, /skillContextDailyMode/);
});

test('legacy skill mode routing controls are replaced by the dedicated Hooks dialog', () => {
  assert.doesNotMatch(skillPanelSource, /SKILL_MODES/);
  assert.doesNotMatch(skillPanelSource, /SkillRoutingForm/);
  assert.match(hooksDialogSource, /HooksEventEditor/);
  assert.match(hooksDialogSource, /skillDisableModelInvocation/);
  assert.match(hooksDialogSource, /disableModelInvocation/);
  assert.match(hooksDialogSource, /from '@\/lib\/hooks-editor\.js'/);
  assert.match(hooksDialogSource, /\.fetchSkillHooks\(/);
  assert.match(hooksDialogSource, /api\.updateSkillHooks\(/);
  assert.match(hooksDialogSource, /value: 'global'/);
  assert.match(hooksDialogSource, /value: 'coding'/);
  assert.match(hooksDialogSource, /value: 'daily'/);
  assert.match(hooksDialogSource, /ConfirmDialog/);
  assert.doesNotMatch(hooksDialogSource, /window\.confirm/);
});

test('package batch dialog drops the mode selector for a hooks-are-per-skill note', () => {
  assert.doesNotMatch(skillPanelSource, /package-batch-mode/);
  assert.match(skillPanelSource, /skillPackageBatchHooksNote/);
});

test('hooks i18n keys exist in English and Chinese locales', () => {
  for (const source of [enSource, zhSource]) {
    assert.match(source, /skillHooksSettings:/);
    assert.match(source, /skillDisableModelInvocation:/);
    assert.match(source, /hookEvent_SessionStart:/);
    assert.match(source, /hookEvent_UserPromptSubmit:/);
    assert.match(source, /hookEvent_PreToolUse:/);
    assert.match(source, /hookEvent_PostToolUse:/);
    assert.match(source, /hookEvent_Stop:/);
    assert.match(source, /skillHookMatcher:/);
    assert.match(source, /skillHookCommand:/);
    assert.match(source, /hooks:/);
    assert.match(source, /hookTool_run:/);
  }
});

test('sidebar and App expose a Hooks dialog entry below Skills', () => {
  const sidebarSource = readFileSync(
    new URL('../codemini-web/client/src/components/Sidebar.jsx', import.meta.url),
    'utf8',
  );
  const appSource = readFileSync(
    new URL('../codemini-web/client/src/App.jsx', import.meta.url),
    'utf8',
  );
  assert.match(sidebarSource, /onOpenHooks/);
  assert.match(sidebarSource, /t\("hooks"\)/);
  assert.match(appSource, /HooksDialog/);
  assert.match(appSource, /setHooksOpen/);
});
