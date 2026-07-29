import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('scrapbook ask action opens a new general chat without auto-submitting', async () => {
  const source = await fs.readFile('codemini-web/client/src/context/app-context.jsx', 'utf8');
  assert.match(source, /askScrapbookEntry:\s*async/);
  assert.match(source, /api\.openProject\("__codemini_general__",\s*\{\s*newSession:\s*true\s*\}\)/);
  assert.doesNotMatch(source, /askScrapbookEntry[\s\S]{0,500}actionsRef\.current\.submit/);
  assert.match(source, /pendingScrapbookContext/);
  assert.doesNotMatch(
    source,
    /askScrapbookEntry[\s\S]{0,400}runtimeState\?\.cwd|askScrapbookEntry[\s\S]{0,400}projectDir/,
    'scrapbook ask should not derive a project path from the current runtime',
  );
});

test('input bar supports selecting scrapbook context alongside normal attachments', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/InputBar.jsx', 'utf8');
  assert.match(source, /buildScrapbookAskPayload/);
  assert.match(source, /fetchScrapbookEntries/);
  assert.match(source, /scrapbook/i);
  assert.match(source, /pendingScrapbookContext/);
  assert.match(source, /PopoverContent[\s\S]{0,120}w-96|max-h-96|rounded-xl/);
  assert.match(source, /line-clamp-2 min-w-0 w-full break-words/);
  assert.match(source, /appearance-none|inputMode="search"|type="text"/);
  const pickerCard = source.match(
    /filteredScrapbookEntries\.map\(\(entry\) => \([\s\S]*?onClick=\{\(\) => selectScrapbookEntry\(entry\.id\)\}/,
  )?.[0] || '';
  assert.doesNotMatch(pickerCard, /hover:border-\(--border-strong\)/);
  assert.doesNotMatch(pickerCard, /inset_3px_0_0_0/);
  assert.match(pickerCard, /border-transparent hover:-translate-y-px hover:bg-\(--bg-subtle\)\/80/);
});

test('chat submission forwards extra modelText context for scrapbook attachments', async () => {
  const source = await fs.readFile('codemini-web/server.js', 'utf8');
  assert.match(source, /body\.modelText/);
  assert.match(source, /handleSubmitMessage\(\{/);
  assert.doesNotMatch(source, /<uploaded_attachments>[\s\S]{0,120}scrapbook/);
  assert.match(source, /parseScrapbookAttachmentFromModelContent/);
});

test('assistant replies can be saved into scrapbook and jumped back by message id', async () => {
  const messageBubble = await fs.readFile('codemini-web/client/src/components/MessageBubble.jsx', 'utf8');
  const appContext = await fs.readFile('codemini-web/client/src/context/app-context.jsx', 'utf8');
  const chatPanel = await fs.readFile('codemini-web/client/src/components/ChatPanel.jsx', 'utf8');
  assert.match(messageBubble, /scrapbookSaveAnswer/);
  assert.match(messageBubble, /saveAssistantReplyToScrapbook/);
  assert.match(appContext, /createChatAnswerScrapbookEntry/);
  assert.match(appContext, /openChatMessage/);
  assert.match(appContext, /targetMessageId/);
  assert.match(chatPanel, /scrollIntoView/);
  assert.doesNotMatch(chatPanel, /highlightedMessageId/);
  assert.doesNotMatch(
    chatPanel,
    /disableVirtualization=\{hasPendingScrollTarget\}/,
    'scrapbook jump should keep message virtualization enabled',
  );
  assert.match(
    chatPanel,
    /scrollToMessage\(anchorId\)/,
    'scrapbook jump should reuse the same smooth scroll path as quick jump',
  );
  assert.match(
    chatPanel,
    /scrollend/,
    'scrapbook jump should wait for scroll completion before clearing the target',
  );
});
