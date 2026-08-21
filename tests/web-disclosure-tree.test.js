import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('conversation folds use a disclosure tree instead of nested surface cards', async () => {
  const css = await fs.readFile('codemini-web/client/style.css', 'utf8');
  const toolCard = await fs.readFile(
    'codemini-web/client/src/components/ToolCard.jsx',
    'utf8',
  );
  const bubble = await fs.readFile(
    'codemini-web/client/src/components/MessageBubble.jsx',
    'utf8',
  );
  const trajectory = await fs.readFile(
    'codemini-web/client/src/components/TrajectoryPanel.jsx',
    'utf8',
  );
  const todo = await fs.readFile(
    'codemini-web/client/src/components/TodoList.jsx',
    'utf8',
  );
  const plan = await fs.readFile(
    'codemini-web/client/src/components/PlanToolCard.jsx',
    'utf8',
  );

  assert.match(
    css,
    /\.codemini-disclosure-row \{[\s\S]*?color: var\(--text-process\);[\s\S]*?font-size: 13px;/,
  );
  assert.match(css, /\.codemini-disclosure-tree \{/);
  assert.match(
    css,
    /\.codemini-disclosure-tree \{[\s\S]*?padding-left: 16px;/,
  );
  assert.match(css, /border-left: 1px solid var\(--border-default\)/);
  assert.match(css, /\.codemini-disclosure-payload \{/);
  assert.match(
    css,
    /\.codemini-disclosure-payload\.codemini-disclosure-scroll \{[\s\S]*?overflow-y: auto;/,
  );
  assert.match(
    css,
    /\.codemini-disclosure-row:hover,\s*\.codemini-disclosure-row:active,\s*\.codemini-disclosure-row:focus-visible \{\s*background: transparent;\s*color: var\(--text-process-hover\);/,
  );
  assert.match(css, /--text-process-hover:/);

  assert.match(toolCard, /FILE_PATH_ARG_TOOLS/);
  assert.match(toolCard, /codemini-disclosure/);
  assert.doesNotMatch(
    toolCard,
    /embedded \? "rounded-md" : "codemini-message-surface"/,
    'tool rows must not wrap in message-surface cards',
  );

  assert.match(bubble, /codemini-disclosure-tree/);
  assert.match(
    toolCard,
    /card\.status === "running" \? \(\s*<Spinner/,
    'running tools use an inline dots loader instead of a trailing status layer',
  );
  assert.doesNotMatch(
    toolCard,
    /runningLabel/,
    'running tools should not render a text status layer under the row',
  );
  assert.match(css, /\.loading-dots--tool \{/);
  assert.match(css, /\.loading-dots--tool \{[\s\S]*?color: var\(--text-primary\);/);
  assert.match(
    bubble,
    /status === "running"\) \{\s*return <Spinner className="loading-dots--tool"/,
    'collapsed running tool groups use the same inline dots loader',
  );
  assert.match(bubble, /formatToolGroupSummaryLabel/);
  assert.match(plan, /formatToolGroupSummaryLabel/);
  assert.match(
    bubble,
    /codemini-answer-fold codemini-disclosure my-2", PROCESS_META_CLASS/,
  );
  assert.doesNotMatch(
    bubble,
    /before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px/,
    'nested process folds should use the shared tree rail, not per-box borders',
  );

  assert.match(trajectory, /w-\[7\.5rem\]/);
  assert.doesNotMatch(trajectory, /trajectoryTokens/);
  assert.doesNotMatch(trajectory, /codemini-trajectory-cell/);
  assert.doesNotMatch(trajectory, /<ToolCard/);
  assert.doesNotMatch(trajectory, /conversationVisual/);
  assert.match(trajectory, /inspectToolName/);
  assert.match(trajectory, /sourceCard\?\.name/);
  assert.match(trajectory, /codemini-inspect-pane/);

  assert.match(todo, /DisclosureRowButton/);
  assert.match(todo, /variant === "dock"/);
  assert.match(todo, /codemini-message-surface/);
  assert.match(plan, /DisclosureRowButton/);
  assert.doesNotMatch(plan, /codemini-message-surface/);
  assert.doesNotMatch(
    plan,
    /flex items-start gap-2 px-1 text-\[12px\] leading-relaxed/,
    'task details should stack label above payload, not sit inline',
  );
  assert.match(
    plan,
    /function SubagentTaskDetails[\s\S]*?planStepTask[\s\S]*?codemini-disclosure-scroll mt-1 max-h-48/,
  );
  assert.match(plan, /codemini-disclosure-scroll mt-1 max-h-64/);
});
