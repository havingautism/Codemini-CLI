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
const serverSource = readFileSync(
  new URL('../codemini-web/server.js', import.meta.url),
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
  assert.match(skillPanelSource, /skill-detail-user-invocable/);
  assert.match(skillPanelSource, /showUserInvocable/);
  assert.match(skillPanelSource, /routeContext/);
  assert.match(skillPanelSource, /contexts: contextsFromTab\(routeContext\)/);
  assert.match(skillPanelSource, /skillIndexEmptyGlobal/);
  assert.doesNotMatch(
    skillPanelSource,
    /modeView === "edit" \? \([\s\S]*?skill-detail-mode[\s\S]*?MarkdownEditor/,
  );
});

test('remote package skills hide content edit while local skills keep it', () => {
  assert.match(skillPanelSource, /skillPackageIsUpdatable\(skill\)/);
  assert.match(skillPanelSource, /contentReadOnly/);
  assert.match(skillPanelSource, /!contentReadOnly && \(/);
  assert.match(serverSource, /Cannot edit remote package skill content/);
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
test('skill panel can open a read-only skill index preview from the list footer', () => {
  assert.match(skillPanelSource, /previewSkillIndex/);
  assert.match(skillPanelSource, /SkillIndexPreviewDialog/);
  assert.match(skillPanelSource, /fetchSkillIndex/);
  assert.match(skillPanelSource, /setIndexPreviewOpen\(true\)/);
  assert.match(skillPanelSource, /context=\{activeTab\}/);
  assert.match(skillPanelSource, /previewTab/);
  // Raw <pre> dump — Streamdown link cards break owner/repo strings inside JSON.
  assert.match(skillPanelSource, /JSON\.stringify\(payload, null, 2\)/);
  assert.match(skillPanelSource, /<pre className="[^"]*font-mono/);
  assert.doesNotMatch(
    skillPanelSource,
    /SkillIndexPreviewDialog[\s\S]*StreamdownRenderer/,
  );
  assert.match(enSource, /previewSkillIndex:/);
  assert.match(zhSource, /previewSkillIndex:/);
  assert.match(enSource, /Developer debug dump/);
  assert.match(zhSource, /开发者调试视图/);
});

test('skill detail preview shows routing triggers separately from markdown body', () => {
  assert.match(skillPanelSource, /t\("skillTriggers"\)/);
  assert.match(skillPanelSource, /skill\.triggers\.map/);
  assert.match(
    skillPanelSource,
    /modeView === "edit" \?[\s\S]*?<MarkdownEditor[\s\S]*?: \(\s*<div className="flex min-h-0 flex-1 flex-col gap-4/,
  );
  assert.match(
    skillPanelSource,
    /<MarkdownPreview[\s\S]*?value=\{content\}[\s\S]*?className="skill-md-preview min-h-0 flex-1"[\s\S]*?\/>/,
  );
  assert.doesNotMatch(skillPanelSource, /showFrontmatter/);
});

test('skill Markdown preview is tighter and has a scoped transparent surface', () => {
  assert.match(
    skillPanelSource,
    /modeView === "view" \? "px-5 py-4" : "p-5"/,
  );
  assert.match(
    skillPanelSource,
    /<MarkdownPreview[\s\S]*?value=\{content\}[\s\S]*?className="skill-md-preview min-h-0 flex-1"[\s\S]*?\/>/,
  );
  assert.match(
    webStyles,
    /\.skill-md-preview \.wmde-markdown\s*\{\s*background:\s*transparent;\s*\}/,
  );
});

test('the package/context browse toggle has been removed in favor of global/coding/daily tabs', () => {
  assert.doesNotMatch(skillPanelSource, /BROWSE_MODES/);
  assert.doesNotMatch(skillPanelSource, /skillBrowse_/);
  assert.doesNotMatch(skillPanelSource, /browseMode/);
});

test('SkillPanel renders global/coding/daily Tabs and always folds skills by package', () => {
  assert.match(
    skillPanelSource,
    /import \{ Tabs, TabsContent, TabsList, TabsTrigger \} from "@\/components\/ui\/tabs"/,
  );
  assert.match(skillPanelSource, /<Tabs\s/);
  assert.match(skillPanelSource, /<TabsTrigger key=\{tabValue\} value=\{tabValue\}>/);
  assert.match(skillPanelSource, /SKILL_TABS = \["global", "coding", "daily"\]/);
  assert.match(skillPanelSource, /contextsFromTab/);
  assert.match(skillPanelSource, /skillMatchesTab/);
  assert.match(skillPanelSource, /skillTabLabel/);
  assert.match(skillPanelSource, /skillContextGlobal/);
  assert.match(skillPanelSource, /skillContextCoding/);
  assert.match(skillPanelSource, /skillContextDaily/);
  assert.match(skillPanelSource, /groupSkillsByPackage\(filteredSkills\)/);
  // Install / update / create must map the active tab to contexts explicitly.
  assert.match(skillPanelSource, /contextsFromTab\(installTarget \|\| activeTab/);
  assert.match(skillPanelSource, /contextsFromTab\(activeTab\)/);
  assert.match(skillPanelSource, /defaultContext=\{activeTab/);
  // Delete / update must not cascade into siblings on other context tabs.
  assert.match(
    skillPanelSource,
    /skillsInSamePackage\(skills, skill\)\.filter\(\(item\) =>\s*skillMatchesTab\(item, activeTab\)/,
  );
  assert.match(skillPanelSource, /packagePreviewSkillsForTab/);
  assert.match(
    skillPanelSource,
    /packagePreviewSkillsForTab\(rawSkills, skills, activeTab\)/,
  );
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
  assert.match(hooksDialogSource, /toggleScope/);
  assert.match(hooksDialogSource, /expandedScopes/);
  assert.match(hooksDialogSource, /bg-\(--bg-active\)/);
  assert.match(hooksDialogSource, /createProfile\(scope\.id\)/);
  assert.match(hooksDialogSource, /setPendingDelete\(profile\)/);
  assert.doesNotMatch(hooksDialogSource, /icon=\{Lightning\}/);
  assert.doesNotMatch(hooksDialogSource, /<Collapsible/);
  assert.doesNotMatch(hooksDialogSource, /name: 'Global', nameKey: 'globalScope'/);
});

test('package batch dialog can restore routing mode for every skill in a package', () => {
  assert.match(skillPanelSource, /package-batch-mode/);
  assert.match(skillPanelSource, /metadata\.mode = patch\.mode/);
  assert.match(skillPanelSource, /skillRoutingAuthorLocked/);
});

test('hooks i18n keys exist in English and Chinese locales', () => {
  for (const source of [enSource, zhSource]) {
    assert.match(source, /skillHooksSettings:/);
    assert.match(source, /skillDisableModelInvocation:/);
    assert.match(source, /skillUserInvocable:/);
    assert.match(source, /skillUserInvocableHint:/);
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

test('skill delete from coding/daily tab is context-scoped before full delete', () => {
  assert.match(skillPanelSource, /remainingContextsAfterTabRemove/);
  assert.match(
    skillPanelSource,
    /remaining\.length > 0[\s\S]*?updateSkillMetadata[\s\S]*?deleteSkill/,
  );
  assert.match(skillPanelSource, /if \(tab === "global"\) return \[\]/);
  assert.match(skillPanelSource, /deleteSkillDescriptionFromTab/);
  assert.match(skillPanelSource, /deleteSkillPackageDescriptionFromTab/);
  assert.match(enSource, /deleteSkillDescriptionFromTab:/);
  assert.match(zhSource, /deleteSkillDescriptionFromTab:/);
  assert.match(skillPanelSource, /api\.deleteSkill\(skill\.name\)/);
  assert.doesNotMatch(skillPanelSource, /skill\.projectDir/);
  assert.doesNotMatch(serverSource, /getProjectSkillsDir/);
  assert.match(serverSource, /fs\.rm\(path\.join\(getSkillsDir\(\), name\)/);
});

test('saving untested MCP connection changes cannot inherit old discovery', () => {
  assert.doesNotMatch(serverSource, /previous\?\.cachedTools/);
  assert.doesNotMatch(serverSource, /previous\?\.instructions/);
  assert.doesNotMatch(serverSource, /previous\?\.lastConnectedAt/);
});
