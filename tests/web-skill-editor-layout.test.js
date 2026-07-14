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

test('skill routing settings use a separate detail button from content edit', () => {
  assert.match(skillPanelSource, /SKILL_MODES/);
  assert.match(skillPanelSource, /skill-editor-mode/);
  assert.match(skillPanelSource, /skill-detail-mode/);
  assert.match(skillPanelSource, /SkillRoutingForm/);
  assert.match(skillPanelSource, /setModeView\("routing"\)/);
  assert.match(skillPanelSource, /t\("skillRoutingSettings"\)/);
  assert.match(skillPanelSource, /routeMode === "agent_requested"/);
  assert.match(skillPanelSource, /routeMode === "always"/);
  assert.doesNotMatch(
    skillPanelSource,
    /modeView === "edit" \? \([\s\S]*?skill-detail-mode[\s\S]*?MarkdownEditor/,
  );
});

test('skill content editing uses the same bottom action bar as routing', () => {
  assert.match(
    skillPanelSource,
    /modeView === "edit" && \([\s\S]*?border-t border-\(--border-default\)[\s\S]*?t\("cancel"\)[\s\S]*?handleContentSave[\s\S]*?t\("save"\)/,
  );
  assert.match(
    skillPanelSource,
    /modeView === "routing"/,
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

test('skill routing remains independent from the unified Hook Profiles dialog', () => {
  assert.match(hooksDialogSource, /HooksEventEditor/);
  assert.match(hooksDialogSource, /HookProfilesPane/);
  assert.match(hooksDialogSource, /fetchHookProfiles/);
  assert.doesNotMatch(hooksDialogSource, /<TabsTrigger value="workspace"/);
  assert.doesNotMatch(hooksDialogSource, /<TabsTrigger value="skills"/);
  assert.match(hooksDialogSource, /from '@\/lib\/hooks-editor\.js'/);
  assert.match(hooksDialogSource, /ConfirmDialog/);
  assert.doesNotMatch(hooksDialogSource, /window\.confirm/);
  assert.match(skillPanelSource, /skillInstallHooks/);
  assert.match(skillPanelSource, /includeHooks: installHooks/);
});

test('Hook Profiles are grouped by collapsible execution scope with add and delete actions', () => {
  assert.match(hooksDialogSource, /HOOK_PROFILE_SCOPES/);
  assert.match(hooksDialogSource, /<Collapsible/);
  assert.match(hooksDialogSource, /createProfile\(scope\.id\)/);
  assert.match(hooksDialogSource, /setPendingDelete\(profile\)/);
  assert.doesNotMatch(hooksDialogSource, /name: 'Global', nameKey: 'globalScope'/);
});

test('package batch dialog can restore routing mode for every skill in a package', () => {
  assert.match(skillPanelSource, /package-batch-mode/);
  assert.match(skillPanelSource, /mode: patch\.mode/);
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
