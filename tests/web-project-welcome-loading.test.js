import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('new project welcome waits for messages but not Git metadata', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/context/app-context.jsx',
    'utf8',
  );
  const openProject = source.slice(
    source.indexOf('openProject: async'),
    source.indexOf('switchView:', source.indexOf('openProject: async')),
  );

  const startBackground = openProject.indexOf('const backgroundTasks = [');
  const waitForMessages = openProject.indexOf('await msgPromise;');
  const revealWelcome = openProject.indexOf(
    'if (nextView === "chat") update({ messagesLoading: false });',
  );
  const waitForBackground = openProject.indexOf(
    'await Promise.all(backgroundTasks);',
  );

  assert.ok(startBackground >= 0, 'project metadata should start in parallel');
  assert.ok(
    startBackground < waitForMessages,
    'background requests should start before waiting for messages',
  );
  assert.ok(
    waitForMessages < revealWelcome,
    'the welcome page should appear after message hydration',
  );
  assert.ok(
    revealWelcome < waitForBackground,
    'Git metadata must not block the welcome page',
  );
});
