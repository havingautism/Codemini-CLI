import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinTools } from '../src/core/tools.js';
import {
  collectOriginDevSignals,
  collectPageDevSignals,
  isDevEnvironment,
  originSignalsFromResponse,
} from '../src/core/browser/environment.js';
import {
  defaultPortsForScript,
  listDevScripts,
  packageManagerCommand,
  parsePortFromScript,
} from '../src/core/browser/dev-server.js';
import http from 'node:http';
import { createBrowserSession, getSharedBrowserSession, disposeSharedBrowserSession, headedWindowBounds, isUsableBrowserPage } from '../src/core/browser/session.js';
import {
  enrichVisualFeedbackPayload,
  formatVisualFeedbackMessage,
  formatVisualFeedbackSourceLine,
  formatVisualFeedbackSourceLocations,
  formatVisualFeedbackVerificationContract,
  formatVisualFeedbackVisibleText,
  isSharedVisualFeedbackNote,
  isVisualFeedbackInteractiveElement,
  noteElements,
  presentVisualFeedbackLogin,
  shouldUseGroupScreenshot,
  unionElementRects,
  getVisualFeedbackInitScript,
  getVisualFeedbackOverlayStrings,
  isVisualFeedbackInProgress,
  isVisualFeedbackNoteStale,
  openVisualFeedback,
  createVisualFeedbackController,
  visualFeedbackChildLabels,
  visualFeedbackInteractiveAncestorName,
  visualFeedbackOwnName,
  VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT,
  VISUAL_FEEDBACK_CHILD_LABEL_LIMIT,
  VISUAL_FEEDBACK_MARKUP_LIMIT,
  VISUAL_FEEDBACK_OVERLAY_KEYS,
  VISUAL_FEEDBACK_PROMPT,
  VISUAL_FEEDBACK_SCREENSHOT,
  computeScreenshotClip,
  encodeVisualFeedbackScreenshot,
  visualFeedbackScreenshotAttachments,
} from '../src/core/browser/visual-feedback.js';
import sharp from 'sharp';
import {
  formatVisualFeedbackPanelError,
  isVisualFeedbackUserMessage,
  visualFeedbackUserMessageFields,
} from '../codemini-web/client/src/lib/visual-feedback-message.js';
import { en } from '../codemini-web/client/i18n/en.js';
import { zh } from '../codemini-web/client/i18n/zh.js';
import {
  createSourceResolver,
  isGeneratedBundlePath,
  isLibraryPath,
  isOriginalSourcePath,
  mapGeneratedPosition,
  normalizeSourcePath,
  resolveMappedFile,
} from '../src/core/browser/sourcemap.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { axNodeName } from '../src/core/browser/snapshot.js';
import {
  createSessionState,
  reduceSessionEvent,
} from '../codemini-web/client/src/lib/session-state.js';

function withDom(html, href = 'http://127.0.0.1:5173/') {
  const scripts = [];
  const doc = {
    scripts,
    styleSheets: [],
    title: 'App',
    querySelector: (selector) => (html.includes(selector.replace('#', 'id="')) ? {} : null),
    querySelectorAll: () => [],
  };
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>|<script([^>]*)\s*\/>/gi;
  let match;
  while ((match = scriptRe.exec(html))) {
    const attrs = `${match[1] || ''} ${match[3] || ''}`
    const src = /src="([^"]+)"/.exec(attrs)
    scripts.push({ src: src ? src[1] : '', textContent: match[2] || '' })
  }
  const location = new URL(href)
  const windowObj = { location, document: doc }
  const fn = new Function('window', 'document', 'location', `return (${collectPageDevSignals.toString()})()`)
  return fn(windowObj, doc, location)
}

test('localhost alone is not a development environment', () => {
  const report = withDom('<html><body><h1>Hello</h1></body></html>', 'http://localhost:3000/')
  assert.equal(isDevEnvironment(report), false)
  assert.ok(report.weak.some((item) => item.id === 'loopback-host'))
})

test('vite client and sourcemap comments are strong dev signals', () => {
  const vite = withDom('<script src="http://127.0.0.1:5173/@vite/client"></script>', 'https://preview.example.dev/')
  assert.equal(isDevEnvironment(vite), true)
  assert.ok(vite.strong.some((item) => item.id === 'vite-client'))
  const mapped = withDom('<script>console.log(1)\n//# sourceMappingURL=app.js.map</script>', 'https://app.example.com/')
  assert.equal(isDevEnvironment(mapped), true)
  assert.ok(mapped.strong.some((item) => item.id === 'script-sourcemap'))
})

test('same-origin dev clients qualify a weak login document and not a static page', async () => {
  const loginHtml = '<!doctype html><html><head><title>Sign in</title></head><body><form><input name="token"></form><script>document.body.append("ok")</script></body></html>'
  const loginPage = withDom(loginHtml, 'http://127.0.0.1:5180/signin')
  assert.equal(isDevEnvironment(loginPage), false)

  const originDoc = originSignalsFromResponse({
    url: 'http://127.0.0.1:5180/',
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<!doctype html><html><head></head><body><script type="module" src="/@vite/client"></script></body></html>',
  })
  assert.ok(originDoc.some((item) => item.id === 'origin-dev-document'))

  const viteClient = originSignalsFromResponse({
    url: 'http://127.0.0.1:5180/@vite/client',
    status: 200,
    headers: { 'content-type': 'text/javascript' },
    body: 'import "/@fs/tmp/node_modules/vite/dist/client/env.mjs"; export const vite = true;',
  })
  assert.ok(viteClient.some((item) => item.id === 'origin-vite-client'))

  const production = originSignalsFromResponse({
    url: 'http://127.0.0.1:5180/',
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<!doctype html><html><body><h1>Login</h1><script>void 0</script></body></html>',
  })
  assert.equal(production.length, 0)

  const htmlFallback = originSignalsFromResponse({
    url: 'http://127.0.0.1:5180/@vite/client',
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<!doctype html><html><body>spa fallback</body></html>',
  })
  assert.equal(htmlFallback.length, 0)

  const found = await collectOriginDevSignals('http://127.0.0.1:5180/signin', {
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.endsWith('/@vite/client')) {
        return {
          status: 200,
          url: href,
          headers: { 'content-type': 'application/javascript' },
          text: async () => 'import { createHotContext } from "/@vite/client";',
        }
      }
      if (href.endsWith('/')) {
        return {
          status: 200,
          url: href,
          headers: { 'content-type': 'text/html' },
          text: async () => loginHtml,
        }
      }
      return { status: 404, url: href, headers: {}, text: async () => 'not found' }
    },
  })
  assert.ok(found.some((item) => item.id === 'origin-vite-client'))
  assert.equal(isDevEnvironment({ strong: found, weak: [] }), true)

  const missing = await collectOriginDevSignals('http://127.0.0.1:5180/signin', {
    fetchImpl: async (url) => ({
      status: 200,
      url: String(url),
      headers: { 'content-type': 'text/html' },
      text: async () => loginHtml,
    }),
  })
  assert.equal(missing.length, 0)
})

test('dev server script discovery prefers known names and ports', () => {
  const scripts = listDevScripts({
    scripts: {
      lint: 'eslint .',
      start: 'node server.js --port 4000',
      dev: 'vite',
    },
  })
  assert.equal(scripts[0].name, 'dev')
  assert.deepEqual(scripts[0].ports, [5173, 5174, 4173])
  assert.equal(parsePortFromScript('next dev --port 3005'), 3005)
  assert.equal(packageManagerCommand('/tmp/does-not-exist-codemini-vf').bin, 'npm')
  assert.deepEqual(defaultPortsForScript('rsbuild dev'), [3000, 3001])
  assert.equal(defaultPortsForScript('rsbuild dev').includes(5000), false)
  assert.deepEqual(defaultPortsForScript('concurrently "npm run frontend" "npm run backend"'), [])
})

test('rsbuild client scripts are a strong development-environment signal', () => {
  const report = withDom('<script src="http://127.0.0.1:3000/@rsbuild/core/hmr"></script>', 'http://127.0.0.1:3000/')
  assert.equal(isDevEnvironment(report), true)
  assert.ok(report.strong.some((item) => item.id === 'rsbuild-dev'))
  const hashed = withDom('<script src="http://127.0.0.1:3000/static/js/vendors-node_modules_rspack_core_dist_cssExtractHmr_js-abc123.js"></script><script src="http://127.0.0.1:3000/static/js/index.js"></script>', 'http://127.0.0.1:3000/')
  assert.equal(isDevEnvironment(hashed), true)
  assert.ok(hashed.strong.some((item) => item.id === 'rsbuild-dev'))
})

test('structured feedback message includes notes, source hints, and verification contract', () => {
  const message = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:5173/settings',
    title: 'Settings',
    environment: { ok: true, strong: [{ id: 'vite-client' }] },
    notes: [
      {
        kind: 'visual',
        text: 'The save button is too close to the edge.',
        element: {
          selector: '#save',
          tag: 'button',
          id: 'save',
          role: 'button',
          name: 'Save',
          text: 'Save',
          rect: { x: 10, y: 20, width: 80, height: 32 },
          styles: { color: 'rgb(0, 0, 0)', display: 'inline-block' },
        },
        sourceLocations: [{ file: 'src/Settings.tsx', line: 42, framework: 'react' }],
      },
      {
        kind: 'functional',
        text: 'This button does not open the dialog.',
        element: { selector: 'button.open', tag: 'button' },
      },
    ],
  })
  assert.match(message.text, /2 notes/)
  assert.match(message.text, /The save button is too close to the edge/)
  assert.match(message.text, /#save/)
  assert.match(message.text, /This button does not open the dialog/)
  assert.match(message.text, /button\.open/)
  assert.doesNotMatch(message.text, /\[stale\]/)
  assert.match(message.modelText, /The save button is too close to the edge/)
  assert.match(message.modelText, /src\/Settings\.tsx:42/)
  assert.match(message.modelText, /This button does not open the dialog/)
  assert.match(message.modelText, /Verification contract/)
  assert.match(message.modelText, /BrowserSession/)
  assert.match(message.modelText, /browser_inspect/)
  assert.match(message.modelText, /browser_act/)
  assert.match(message.modelText, /do not curl localhost/i)
  assert.match(message.modelText, /Do not call browser_act open/i)
  assert.match(VISUAL_FEEDBACK_PROMPT, /Do not close/)
  const stale = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:5173/settings',
    notes: [{
      text: 'Old label',
      stale: true,
      element: { selector: '#save' },
      sourceLocations: [
        { file: 'static/js/lib-react.js', line: 29320, framework: 'react' },
        { file: 'frontend/src/views/LoginView.jsx', line: 123, framework: 'react', component: 'LoginView' },
      ],
    }],
  })
  assert.match(stale.text, /Old label — #save \[stale\]/)
  assert.match(stale.modelText, /frontend\/src\/views\/LoginView\.jsx:123 \(LoginView, react\)/)
  assert.doesNotMatch(stale.modelText, /lib-react/)
})

test('overlay init script is idempotent and persists mode across refresh', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /开始框选/)
  assert.match(source, /视觉反馈/)
  assert.doesNotMatch(source, /Start Visual Feedback/)
  assert.match(source, /role="toolbar"/)
  assert.match(source, /class="toolbar"/)
  assert.match(source, /sessionStorage/)
  assert.match(source, /MutationObserver/)
  assert.match(source, /addEventListener\('click', onPanelClick\)/)
  assert.match(source, /composedPath/)
  assert.match(source, /history\[method\]/)
  assert.match(source, /pageshow/)
  assert.match(source, /popstate/)
  assert.match(source, /visualViewport/)
  assert.match(source, /max-height: min\(240px, 42vh\)/)
  assert.match(source, /function isNoteStale\(note\)/)
  assert.match(source, /function refreshNoteStaleness\(\)/)
  assert.match(source, /note\.stale/)
  assert.match(source, /outerHTML/)
  assert.match(source, /setStrings\(next\)/)
  assert.doesNotThrow(() => new Function(source))
})

test('panel click handler looks through the composed path, not the retargeted host', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function eventPathTarget\(event\)/)
  assert.match(source, /composedPath/)
  assert.match(source, /const target = eventPathTarget\(event\)/)
  assert.match(source, /target\.closest/)
  assert.match(source, /root\.addEventListener\('click', onPanelClick\)/)
  assert.doesNotMatch(source, /host\.addEventListener\('click', onPanelClick\)/)
})

test('headed window bounds fit inside a 13-inch work area', () => {
  const bounds = headedWindowBounds({ availWidth: 1440, availHeight: 800, availLeft: 0, availTop: 25 }, { width: 1280, height: 800 })
  assert.ok(bounds.width <= 1440 - 16)
  assert.ok(bounds.height <= 800 - 16)
  assert.equal(bounds.width, 1280)
  assert.equal(bounds.height, 784)
  assert.equal(bounds.top, 25 + 8)
  assert.equal(bounds.windowState, 'normal')
  const small = headedWindowBounds({ availWidth: 1200, availHeight: 700, availLeft: 0, availTop: 0 }, { width: 1280, height: 800 })
  assert.equal(small.width, 1184)
  assert.equal(small.height, 684)
  assert.ok(small.left + small.width <= 1200)
  assert.ok(small.top + small.height <= 700)
})

test('a closed Playwright page is not treated as an open session', () => {
  assert.equal(isUsableBrowserPage({ page: null }), false)
  assert.equal(isUsableBrowserPage({ page: { isClosed: () => true }, browser: { isConnected: () => true } }), false)
  assert.equal(isUsableBrowserPage({ page: { isClosed: () => false }, browser: { isConnected: () => false } }), false)
  assert.equal(isUsableBrowserPage({ page: { isClosed: () => false }, browser: { isConnected: () => true } }), true)
  const session = createBrowserSession({ config: { browser: { headless: true } } })
  session.page = { isClosed: () => true }
  session.browser = { isConnected: () => false }
  assert.equal(session.isOpen(), false)
})

test('coding and normal tool bundles share a browser session for the same chat session id', async () => {
  const sessionId = `vf-share-${Date.now()}`
  const first = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { execution: { mode: 'coding' } },
    sessionId,
  })
  const second = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { execution: { mode: 'coding' } },
    sessionId,
  })
  try {
    assert.equal(first.browserSession, second.browserSession)
    assert.equal(getSharedBrowserSession({ sessionId }), first.browserSession)
    assert.equal(typeof first.handlers.browser_act, 'function')
  } finally {
    await first.dispose?.()
    await second.dispose?.()
    await disposeSharedBrowserSession({ sessionId })
  }
})

test('normal mode still omits browser tools but keeps a session object for Visual Feedback', async () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { execution: { mode: 'normal' } },
  })
  try {
    assert.ok(bundle.browserSession)
    assert.equal(bundle.handlers.browser_act, undefined)
    assert.equal(bundle.isOpen, undefined)
    assert.equal(bundle.browserSession.isOpen(), false)
  } finally {
    await bundle.dispose?.()
  }
})



const live = process.env.CODEMINI_BROWSER_TESTS === '1';

function startHtmlServer(html) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

test('live Visual Feedback installs the overlay and submits structured notes', { skip: !live, timeout: 180000 }, async () => {
  const html = `<!doctype html><html><head><title>VF fixture</title></head>
    <body>
      <button id="save" type="button">Save</button>
      <script>console.log('dev');//# sourceMappingURL=app.js.map</script>
    </body></html>`;
  const hosted = await startHtmlServer(html);
  const session = createBrowserSession({
    config: { execution: { mode: 'coding' }, browser: { headless: true, channel: process.env.CODEMINI_BROWSER_CHANNEL || 'auto' } },
    workspaceRoot: process.cwd(),
  });
  const submitted = [];
  try {
    const opened = await openVisualFeedback(session, {
      url: hosted.url,
      headless: true,
      hooks: { onSubmit: async (payload) => { submitted.push(payload); return { ok: true }; } },
    });
    assert.equal(opened.ok, true, JSON.stringify(opened.environment));
    assert.ok(opened.environment.strong.length > 0);
    const hasOverlay = await session.page.evaluate(() => Boolean(document.getElementById('codemini-visual-feedback-root')));
    assert.equal(hasOverlay, true);
    const result = await session.page.evaluate(async () => {
      return window.__codeminiVisualFeedback({
        type: 'submit',
        payload: {
          url: location.href,
          title: document.title,
          environment: window.__codeminiVisualFeedbackApi.refreshEnvironment(),
          notes: [{
            id: 'n1',
            kind: 'visual',
            text: 'Move the save button.',
            element: { selector: '#save', tag: 'button', id: 'save', text: 'Save' },
          }],
        },
      });
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].notes[0].text, 'Move the save button.');
    const enriched = await enrichVisualFeedbackPayload(session, submitted[0]);
    assert.equal(enriched.environment.ok, true);
  } finally {
    await session.dispose();
    await new Promise((resolve) => hosted.server.close(resolve));
  }
});

test('visible bubble lists each note and stale flag', () => {
  const visible = formatVisualFeedbackVisibleText({
    url: 'http://localhost:3000/login',
    notes: [
      { text: 'Email field is too narrow', element: { selector: '#login-email' } },
      { text: 'Button contrast is low', stale: true, element: { selector: 'button.submit' } },
    ],
  })
  assert.match(visible, /2 notes on http:\/\/localhost:3000\/login/)
  assert.match(visible, /1\. Email field is too narrow — #login-email/)
  assert.match(visible, /2\. Button contrast is low — button\.submit \[stale\]/)
})

test('stale notes are detected when tag, id, or text no longer match', () => {
  const note = { element: { selector: '#login-email', tag: 'input', id: 'login-email', text: 'Email' } }
  assert.equal(isVisualFeedbackNoteStale(note, { tag: 'input', id: 'login-email', text: 'Email' }), false)
  assert.equal(isVisualFeedbackNoteStale(note, { tag: 'input', id: 'login-email', text: 'Email address' }), true)
  assert.equal(isVisualFeedbackNoteStale(note, { tag: 'div', id: 'login-email', text: 'Email' }), true)
  assert.equal(isVisualFeedbackNoteStale(note, { tag: 'input', id: 'other', text: 'Email' }), true)
  assert.equal(isVisualFeedbackNoteStale(note, null), true)
  assert.equal(isVisualFeedbackNoteStale({ element: { tag: 'input', text: '' } }, { tag: 'input', id: '', text: 'anything' }), false)
})

test('library path filter rejects rsbuild bundles and keeps project sources', () => {
  assert.equal(isLibraryPath('static/js/lib-react.js'), true)
  assert.equal(isLibraryPath('static/js/lib-react.js:29320'), true)
  assert.equal(isLibraryPath('/static/js/node_modules_rspack_core_dist_cssExtractHmr_js-abc.js'), true)
  assert.equal(isLibraryPath('frontend/src/views/LoginView.jsx'), false)
  assert.equal(isOriginalSourcePath('frontend/src/views/LoginView.jsx'), true)
  assert.equal(isGeneratedBundlePath('static/js/index.js'), true)
  assert.equal(isGeneratedBundlePath('static/js/lib-react.js'), true)
  assert.equal(isGeneratedBundlePath('frontend/src/views/LoginView.jsx'), false)
  assert.equal(
    formatVisualFeedbackSourceLocations([
      { file: 'static/js/lib-react.js', line: 29320, framework: 'react' },
      { file: 'static/js/index.js', line: 2014, framework: 'react' },
      { file: 'frontend/src/views/LoginView.jsx', line: 123, framework: 'react', component: 'LoginView' },
    ]),
    'frontend/src/views/LoginView.jsx:123 (LoginView, react)',
  )
  assert.equal(formatVisualFeedbackSourceLocations([{ file: 'static/js/lib-react.js', line: 1 }]), 'not resolved')
})

test('resolveMappedFile maps webpack sources onto nested frontend/src files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vf-src-'))
  try {
    const file = path.join(root, 'frontend/src/views/LoginView.jsx')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'export default function LoginView() { return null }\n')
    assert.equal(normalizeSourcePath('webpack://scrapbook/./src/views/LoginView.jsx'), 'src/views/LoginView.jsx')
    const resolved = resolveMappedFile('webpack://scrapbook/./src/views/LoginView.jsx', { workspaceRoot: root })
    assert.equal(path.resolve(resolved), path.resolve(file))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('source resolver maps a generated bundle frame to the original file', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vf-map-'))
  try {
    const file = path.join(root, 'frontend/src/views/LoginView.jsx')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'export default function LoginView() { return null }\n')
    const sourceMap = {
      version: 3,
      file: 'index.js',
      sources: ['webpack://scrapbook/./src/views/LoginView.jsx'],
      names: [],
      mappings: 'AAAA',
    }
    const mapped = await mapGeneratedPosition({ sourceMap, line: 1, column: 0, oneBased: true })
    assert.match(String(mapped.source), /src\/views\/LoginView\.jsx/)
    assert.equal(path.resolve(resolveMappedFile(mapped.source, { workspaceRoot: root })), path.resolve(file))
    const resolver = createSourceResolver({
      workspaceRoot: root,
      getScript: (id) => (id === '1'
        ? { scriptId: '1', url: 'http://localhost:3000/static/js/index.js', sourceMapURL: 'http://localhost:3000/static/js/index.js.map' }
        : null),
      readText: async (url) => {
        if (String(url).endsWith('.map')) return JSON.stringify(sourceMap)
        return '//# sourceMappingURL=index.js.map'
      },
    })
    const located = await resolver.locate({ scriptId: '1', line: 1, column: 0, oneBased: true })
    assert.equal(located.file, 'frontend/src/views/LoginView.jsx')
    assert.equal(located.line, 1)
    assert.equal(located.workspaceSource, 'frontend/src/views/LoginView.jsx')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('coding mode exposes browser tools during Visual Feedback and tool_search browser resolves them', async () => {
  const repoRoot = process.cwd()
  const coding = getBuiltinTools({ workspaceRoot: repoRoot, config: { execution: { mode: 'plan' } } })
  try {
    const found = await coding.handlers.tool_search({ query: 'browser' })
    assert.equal(found.error, undefined, found.error)
    assert.ok(found.loaded.includes('browser_act'))
    assert.ok(found.loaded.includes('browser_inspect'))
    assert.match(found.message, /browser_act/)
  } finally {
    await coding.dispose?.()
  }

  const sessionId = 'vf-tools-test-session'
  const session = getSharedBrowserSession({
    config: { execution: { mode: 'coding' } },
    workspaceRoot: repoRoot,
    sessionId,
  })
  session.visualFeedback = { bindingInstalled: true, active: true }
  assert.equal(isVisualFeedbackInProgress(session), true)
  const vfTools = getBuiltinTools({
    workspaceRoot: repoRoot,
    sessionId,
    config: { execution: { mode: 'coding' } },
  })
  try {
    const names = vfTools.definitions.map((item) => item.function.name)
    assert.equal(names.includes('browser_inspect'), true)
    assert.equal(names.includes('browser_act'), true)
    assert.equal(names.includes('browser_diagnose'), false)
    const search = await vfTools.handlers.tool_search({ query: 'browser' })
    assert.ok(search.loaded.includes('browser_inspect') || search.loaded.includes('browser_act'))
    assert.doesNotMatch(search.error || '', /Unknown tool/)
  } finally {
    await vfTools.dispose?.()
    await disposeSharedBrowserSession({ sessionId })
  }

  const crew = getBuiltinTools({ workspaceRoot: repoRoot, config: { execution: { mode: 'crew' } } })
  try {
    const found = await crew.handlers.tool_search({ query: 'browser' })
    assert.match(String(found.error || ''), /not available|Unknown tool/)
    assert.equal(crew.handlers.browser_act, undefined)
    assert.equal(crew.deferredDefinitions.browser_act, undefined)
  } finally {
    await crew.dispose?.()
  }
})

test('successful submit clears notes, selection, and pathname sessionStorage', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /result\?\.ok/)
  assert.match(source, /state\.notes = \[\]/)
  assert.match(source, /state\.mode = false/)
  assert.match(source, /sessionStorage\.removeItem\(storageId\(\)\)/)
  const submitAt = source.indexOf('async function submitNotes')
  const submit = source.slice(submitAt, source.indexOf('function bindPanel', submitAt))
  const okAt = submit.indexOf('if (result?.ok)')
  const okBlock = submit.slice(okAt, submit.indexOf('} else {', okAt))
  assert.match(okBlock, /state\.notes = \[\]/)
  assert.match(okBlock, /state\.draft = null/)
  assert.match(okBlock, /state\.mode = false/)
  assert.match(okBlock, /removeItem/)
  assert.match(okBlock, /type:\s*['"]state['"]/)
  assert.match(okBlock, /payload:\s*snapshot\(\)/)
  assert.doesNotMatch(okBlock, /^\s*sync\(\)/m)
  assert.doesNotThrow(() => new Function(source))
})

test('status reports live overlay notes and drops leftover counts when empty or closed', async () => {
  const live = { notes: [{ id: 'a' }, { id: 'b' }], mode: true, url: 'http://127.0.0.1:3000/login' }
  let open = true
  const session = {
    isOpen: () => open,
    visualFeedback: {
      lastState: { notes: [{ id: 'stale-1' }, { id: 'stale-2' }], mode: true },
      active: true,
    },
    launch: { headless: false },
    page: {
      isClosed: () => !open,
      url: () => 'http://127.0.0.1:3000/login',
      title: async () => 'Login',
      evaluate: async (fn) => {
        if (typeof fn === 'function' && /__codeminiVisualFeedbackApi/.test(String(fn))) {
          return live
        }
        if (typeof fn === 'function') {
          return { url: 'http://127.0.0.1:3000/login', title: 'Login', strong: [{ id: 'vite-client' }], weak: [] }
        }
        return undefined
      },
    },
  }
  const controller = createVisualFeedbackController({
    getSession: () => session,
    workspaceRoot: process.cwd(),
  })

  let status = await controller.status()
  assert.equal(status.open, true)
  assert.equal(status.state.notes.length, 2)
  assert.equal(status.state.notes[0].id, 'a')
  assert.equal(session.visualFeedback.lastState.notes[0].id, 'a')

  live.notes = []
  live.mode = false
  status = await controller.status()
  assert.equal(status.state.notes.length, 0)
  assert.equal(session.visualFeedback.lastState.notes.length, 0)

  open = false
  session.visualFeedback.lastState = { notes: [{ id: 'stale' }], mode: true }
  status = await controller.status()
  assert.equal(status.open, false)
  assert.equal(status.state, null)
  assert.equal(session.visualFeedback.lastState, null)
})

test('overlay note list uses note text and selector, not the note object', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function noteLabel\(note\)/)
  assert.match(source, /function noteText\(note\)/)
  assert.match(source, /aria-label="\$\{escapeHtml\(noteLabel\(note\)\)\}"/)
  assert.match(source, /\$\{escapeHtml\(noteText\(note\) \|\| tx\('visualFeedbackOverlayNoText'\)\)\}/)
  assert.match(source, /\$\{escapeHtml\(noteSelector\(note\)\)\}/)
  assert.doesNotMatch(source, /<p>\$\{escapeHtml\(note\)\}<\/p>/)
  assert.doesNotMatch(source, /aria-label="\$\{escapeHtml\(note\)\}"/)
})

test('overlay inject guards a missing parent and does not block page clicks', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /if \(!parent \|\| typeof parent\.appendChild !== 'function'\) return null/)
  assert.match(source, /if \(!host \|\| !ui\.shadow\) return/)
  assert.match(source, /:host \{[^}]*pointer-events: none/)
  assert.match(source, /\.toolbar, \.tray \{ pointer-events: auto/)
  assert.doesNotMatch(source, /\.panel \{ pointer-events: auto/)
  assert.match(source, /\.mark \{[^}]*pointer-events: none/)
  assert.match(source, /\.hover \{[^}]*pointer-events: none/)
})

test('AX node names do not stringify name objects as [object Object]', () => {
  assert.equal(axNodeName({ name: { type: 'computedString' } }), '')
  assert.equal(axNodeName({ name: { type: 'computedString', value: '圆角太大，可以优化一下吗？ — #login-password' } }), '圆角太大，可以优化一下吗？ — #login-password')
  assert.equal(axNodeName({ name: '登录' }), '登录')
  assert.doesNotMatch(axNodeName({ name: { type: 'none' } }), /\[object Object\]/)
})

test('ui:message events append a Visual Feedback user bubble without a refresh', () => {
  const sessionId = 'vf-live-bubble'
  const text = 'Visual Feedback: 2 notes on http://localhost:3000/login\n1. 圆角太大 — #login-password\n2. 登陆按钮也太大 — button.submit'
  const first = reduceSessionEvent(
    createSessionState({
      currentSessionId: sessionId,
      sessionMessagesById: { [sessionId]: [] },
    }),
    {
      type: 'ui:message',
      sessionId,
      message: {
        id: 'ui-vf-1',
        role: 'you',
        text,
        kind: 'visual-feedback',
        visualFeedback: true,
        modelText: '# Visual Feedback\n\nURL: http://localhost:3000/login\nNotes: 2\n',
        timestamp: '2026-11-24T14:00:00.000Z',
      },
    },
  )
  const messages = first.sessionMessagesById[sessionId]
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'you')
  assert.equal(messages[0].text, text)
  assert.equal(messages[0].kind, 'visual-feedback')
  assert.equal(messages[0].visualFeedback, true)
  assert.match(messages[0].modelText, /# Visual Feedback/)
  assert.match(messages[0].segments[0].text, /#login-password/)
  assert.equal(isVisualFeedbackUserMessage(messages[0]), true)
  const again = reduceSessionEvent(first, {
    type: 'ui:message',
    sessionId,
    message: { id: 'ui-vf-1', role: 'you', text },
  })
  assert.equal(again.sessionMessagesById[sessionId].length, 1)
})

test('runtime bridge publishes ui:message when a user bubble is added', () => {
  const source = readFileSync(new URL('../codemini-web/lib/runtime-bridge.js', import.meta.url), 'utf8')
  const start = source.indexOf('#addUiMessage(message)')
  const fn = source.slice(start, source.indexOf('#updateUiMessage', start))
  assert.match(fn, /type: 'ui:message'/)
  assert.match(fn, /next\.role === 'you'/)
  assert.match(fn, /#publish\(\{ type: 'ui:message', message: next \}\)/)
})

test('overlay strings follow the Codemini locale, not the page language', () => {
  const zh = getVisualFeedbackOverlayStrings('zh')
  const en = getVisualFeedbackOverlayStrings('en')
  for (const key of VISUAL_FEEDBACK_OVERLAY_KEYS) {
    assert.equal(typeof zh[key], 'string')
    assert.ok(zh[key].length > 0, key)
    assert.equal(typeof en[key], 'string')
    assert.ok(en[key].length > 0, key)
  }
  assert.equal(zh.visualFeedbackOverlayStart, '开始框选')
  assert.equal(en.visualFeedbackOverlayStart, 'Start selecting')
  const zhScript = getVisualFeedbackInitScript('zh')
  const enScript = getVisualFeedbackInitScript('en')
  assert.match(zhScript, /开始框选/)
  assert.match(zhScript, /"visualFeedbackOverlayStart":"开始框选"/)
  assert.match(zhScript, /"visualFeedbackOverlaySubmit":"提交 \{\{count\}\}"/)
  assert.match(enScript, /"visualFeedbackOverlayStart":"Start selecting"/)
  assert.doesNotMatch(enScript, /开始框选/)
  assert.doesNotThrow(() => new Function(enScript))
})

test('Visual Feedback user bubbles can disclose the exact agent payload', () => {
  const message = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:5173/settings',
    title: 'Settings',
    environment: { ok: true, strong: [{ id: 'vite-client' }] },
    notes: [{
      kind: 'visual',
      text: 'The save button is too close to the edge.',
      stale: true,
      element: { selector: '#save', tag: 'button' },
      sourceLocations: [{ file: 'src/Settings.tsx', line: 42 }],
    }],
  })
  const uiMessage = {
    role: 'you',
    text: message.text,
    ...visualFeedbackUserMessageFields(message.modelText),
  }
  assert.equal(isVisualFeedbackUserMessage(uiMessage), true)
  assert.equal(isVisualFeedbackUserMessage({ role: 'you', text: message.text, modelText: message.modelText }), false)
  assert.equal(isVisualFeedbackUserMessage({ role: 'you', text: 'hello', modelText: 'secret composer context' }), false)
  assert.match(uiMessage.text, /1 note/)
  assert.match(uiMessage.text, /The save button is too close to the edge/)
  assert.match(uiMessage.modelText, /Selector: `#save`/)
  assert.match(uiMessage.modelText, /src\/Settings\.tsx:42/)
  assert.match(uiMessage.modelText, /stale/)
  assert.match(uiMessage.modelText, /Verification contract/)

  const bubble = readFileSync(new URL('../codemini-web/client/src/components/MessageBubble.jsx', import.meta.url), 'utf8')
  assert.match(bubble, /function VisualFeedbackUserContent/)
  assert.match(bubble, /isVisualFeedbackUserMessage\(message\)/)
  assert.match(bubble, /message\.modelText/)
  assert.doesNotMatch(bubble, /isVisualFeedbackUserMessage\(.*role/)

  const host = readFileSync(new URL('../codemini-web/lib/visual-feedback-host.js', import.meta.url), 'utf8')
  assert.match(host, /visualFeedbackUserMessageFields\(message\.modelText\)/)
  const bridge = readFileSync(new URL('../codemini-web/lib/runtime-bridge.js', import.meta.url), 'utf8')
  const submitAt = bridge.indexOf('handleSubmitMessage(message = {})')
  const submit = bridge.slice(submitAt, bridge.indexOf('handleRetryMessage(messageId)', submitAt))
  assert.match(submit, /isVisualFeedbackUserMessage\(message\)/)
  assert.match(submit, /visualFeedbackUserMessageFields\(message\.modelText\)/)
})

test('navigation reinject uses the session locale, not an undeclared binding', () => {
  const source = readFileSync(new URL('../src/core/browser/visual-feedback.js', import.meta.url), 'utf8')
  const hookAt = source.indexOf('function hookVisualFeedbackNavigation')
  const hook = source.slice(hookAt, source.indexOf('async function applyEnvironmentToPage', hookAt))
  assert.match(hook, /overlayInitScript\(session\)/)
  assert.doesNotMatch(hook, /overlayInitScript\(session, locale\)/)
})

test('overlay pins sit on the element, stay inside the viewport, and stay clickable only themselves', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function paintMarks\(\)/)
  assert.match(source, /function clampPinPosition\(/)
  assert.match(source, /function isRectVisible\(/)
  assert.match(source, /className = `pin\$\{note\.stale \? ' stale' : ''\}/)
  assert.match(source, /data-pin-id/)
  assert.match(source, /\.pin \{[^}]*pointer-events: auto/)
  assert.match(source, /\.mark \{[^}]*pointer-events: none/)
  assert.match(source, /if \(!note\.stale\) \{/)
  assert.match(source, /querySelectorAll\('\.mark, \.pin, \.check-pin'\)/)
  assert.match(source, /state\.listOpen = true/)
  assert.match(source, /state\.expandedNoteId = pinId/)
  const scrollAt = source.indexOf('function onScroll()')
  const scroll = source.slice(scrollAt, source.indexOf('function bindPage', scrollAt))
  assert.match(scroll, /paintMarks\(\)/)
  assert.doesNotMatch(scroll, /if \(state\.mode\) paintMarks/)
  assert.match(source, /setCaptureHidden\(hidden\)/)
  assert.doesNotThrow(() => new Function(source))
})

test('ArrowUp and ArrowDown walk parent or child except when typing in the composer', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function walkParent\(/)
  assert.match(source, /function walkChild\(/)
  assert.match(source, /function isTypingTarget\(/)
  assert.match(source, /function retarget\(/)
  assert.match(source, /event\.key === 'ArrowUp'/)
  assert.match(source, /event\.key === 'ArrowDown'/)
  assert.match(source, /isTypingTarget\(event\)/)
  assert.match(source, /data-action="retarget-parent"/)
  assert.match(source, /data-action="retarget-child"/)
  assert.match(source, /visualFeedbackOverlayRetargetHint/)
  const en = getVisualFeedbackOverlayStrings('en')
  const zh = getVisualFeedbackOverlayStrings('zh')
  assert.match(en.visualFeedbackOverlaySelecting, /↑/)
  assert.match(zh.visualFeedbackOverlaySelecting, /↑/)
  assert.ok(en.visualFeedbackOverlayParent)
  assert.ok(zh.visualFeedbackOverlayChild)
})

test('walking parent or child remeasures the highlight box and updates the current target', () => {
  const source = getVisualFeedbackInitScript()
  const applyAt = source.indexOf('function applyRetarget')
  const apply = source.slice(applyAt, source.indexOf('function retarget(direction)', applyAt))
  assert.match(apply, /state\.target = element/)
  assert.match(apply, /state\.hover = element/)
  const renderAt = apply.indexOf('render()')
  assert.ok(renderAt >= 0)
  assert.match(apply.slice(renderAt), /setHover\(element, \{ announce: true \}\)/)
  assert.doesNotMatch(apply, /if \(state\.draft\) \{[\s\S]*render\(\)[\s\S]*\} else \{[\s\S]*setHover/)

  const hoverAt = source.indexOf('function setHover')
  const hover = source.slice(hoverAt, source.indexOf('function refreshEnvironment', hoverAt))
  assert.match(hover, /getBoundingClientRect\(\)/)
  assert.match(hover, /ui\.hover\.style\.left/)
  assert.match(hover, /ui\.hover\.style\.top/)
  assert.match(hover, /ui\.hover\.style\.width/)
  assert.match(hover, /ui\.hover\.style\.height/)
  assert.match(hover, /elementHighlightLabel\(element\)/)
  assert.match(hover, /is-retarget/)
  assert.match(source, /function elementHighlightLabel\(/)

  const renderStart = source.indexOf('function render()')
  const render = source.slice(renderStart, source.indexOf('function positionOverlay', renderStart))
  assert.match(render, /setHover\(highlight\)/)
})

test('screenshot clips add padding, expand tiny targets, and stay inside the viewport', () => {
  const viewport = { width: 1280, height: 800 }
  const padded = computeScreenshotClip({ x: 100, y: 80, width: 200, height: 120 }, viewport)
  assert.equal(padded.x, 100 - VISUAL_FEEDBACK_SCREENSHOT.padding)
  assert.equal(padded.y, 80 - VISUAL_FEEDBACK_SCREENSHOT.padding)
  assert.equal(padded.width, 200 + VISUAL_FEEDBACK_SCREENSHOT.padding * 2)
  assert.equal(padded.height, 120 + VISUAL_FEEDBACK_SCREENSHOT.padding * 2)

  const tiny = computeScreenshotClip({ x: 40, y: 40, width: 12, height: 10 }, viewport)
  assert.ok(tiny.width >= VISUAL_FEEDBACK_SCREENSHOT.minSize)
  assert.ok(tiny.height >= VISUAL_FEEDBACK_SCREENSHOT.minSize)

  const nearEdge = computeScreenshotClip({ x: 1260, y: 790, width: 30, height: 20 }, viewport)
  assert.ok(nearEdge.x >= 0)
  assert.ok(nearEdge.y >= 0)
  assert.ok(nearEdge.x + nearEdge.width <= viewport.width)
  assert.ok(nearEdge.y + nearEdge.height <= viewport.height)

  const huge = computeScreenshotClip({ x: 0, y: 0, width: 4000, height: 3000 }, { width: 1440, height: 800 })
  assert.ok(huge.width <= VISUAL_FEEDBACK_SCREENSHOT.maxSize)
  assert.ok(huge.height <= 800)

  assert.equal(computeScreenshotClip(null, viewport), null)
  assert.equal(computeScreenshotClip({ x: 0, y: 0, width: 0, height: 0 }, viewport), null)
})

test('screenshot encoding caps dimensions and bytes', async () => {
  const raw = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).png().toBuffer()
  const encoded = await encodeVisualFeedbackScreenshot(raw, { maxSize: 400, maxBytes: 40_000, quality: 80 })
  assert.equal(encoded.mime, 'image/jpeg')
  assert.ok(encoded.width <= 400)
  assert.ok(encoded.height <= 400)
  const bytes = Buffer.from(encoded.data, 'base64')
  assert.ok(bytes.length <= 40_000, bytes.length)
  assert.ok(bytes.length > 100)
})

test('submit payload attaches available screenshots and records missing ones', async () => {
  const payload = await enrichVisualFeedbackPayload(
    { page: { url: () => 'http://127.0.0.1:5173/settings', title: async () => 'Settings' } },
    {
      url: 'http://127.0.0.1:5173/settings',
      title: 'Settings',
      environment: { ok: true, strong: [{ id: 'vite-client' }] },
      notes: [
        { id: 'n1', text: 'The save button is too close to the edge.', element: { selector: '#save' } },
        { id: 'n2', text: 'Missing control', element: { selector: '#gone' } },
      ],
    },
    {
      captureScreenshot: async (_session, note) => (
        note.element.selector === '#save'
          ? { mime: 'image/jpeg', data: 'QUJD', width: 160, height: 80 }
          : { unavailable: true, reason: 'not-found' }
      ),
    },
  )
  assert.equal(payload.notes[0].screenshot.data, 'QUJD')
  assert.equal(payload.notes[1].screenshot.unavailable, true)
  const message = formatVisualFeedbackMessage(payload)
  assert.match(message.modelText, /Screenshot: attached \(160×80\)/)
  assert.match(message.modelText, /Screenshot: unavailable \(not-found\)/)
  assert.doesNotMatch(message.modelText, /QUJD/)
  assert.equal(message.modelImages.length, 1)
  assert.equal(message.modelImages[0].data, 'QUJD')
  assert.equal(message.attachments.length, 1)
  assert.equal(message.attachments[0].kind, 'image')
  assert.match(message.attachments[0].url, /^data:image\/jpeg;base64,QUJD/)
  const media = visualFeedbackScreenshotAttachments(payload.notes)
  assert.equal(media.modelImages.length, 1)

  const host = readFileSync(new URL('../codemini-web/lib/visual-feedback-host.js', import.meta.url), 'utf8')
  assert.match(host, /modelImages: message\.modelImages/)
  assert.match(host, /attachments: message\.attachments/)
  const bubble = readFileSync(new URL('../codemini-web/client/src/components/MessageBubble.jsx', import.meta.url), 'utf8')
  assert.match(bubble, /function VisualFeedbackScreenshotThumbs/)
  assert.match(bubble, /attachments=\{attachments\}/)
})

test('render and sync during an open draft keep the #vf-note node and focus', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function preserveOpenDraftNote\(/)
  assert.match(source, /function liveNoteField\(/)
  assert.match(source, /function patchOpenDraftChrome\(/)
  const renderAt = source.indexOf('function render()')
  const render = source.slice(renderAt, source.indexOf('function liveNoteField()', renderAt))
  assert.match(render, /const preservedNote = preserveOpenDraftNote\(\)/)
  assert.match(render, /if \(preservedNote\) \{/)
  assert.match(render, /patchOpenDraftChrome\(/)
  const innerAt = render.indexOf('root.innerHTML')
  assert.ok(innerAt >= 0)
  const preservedBranch = render.slice(render.indexOf('if (preservedNote)'), innerAt)
  assert.doesNotMatch(preservedBranch, /root\.innerHTML\s*=/)
  const patchAt = source.indexOf('function patchOpenDraftChrome')
  const patch = source.slice(patchAt, source.indexOf('function positionOverlay', patchAt))
  assert.match(patch, /preservedNote/)
  assert.doesNotMatch(patch, /preservedNote\.blur\(/)
  assert.doesNotMatch(patch, /preservedNote\.value\s*=/)
  assert.doesNotThrow(() => new Function(source))
})

test('IME composition and isComposing key events do not retarget or cancel the draft', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function isImeComposing\(event\)/)
  assert.match(source, /event\?\.isComposing/)
  assert.match(source, /event\?\.key === 'Process'/)
  assert.match(source, /event\?\.keyCode === 229/)
  assert.match(source, /compositionstart/)
  assert.match(source, /compositionend/)
  assert.match(source, /state\.composing = true/)
  const keyAt = source.indexOf('function onKey(event)')
  const onKey = source.slice(keyAt, source.indexOf('function onScroll()', keyAt))
  assert.match(onKey, /if \(isImeComposing\(event\)\) return/)
  const escapeAt = onKey.indexOf("event.key === 'Escape'")
  assert.ok(escapeAt > onKey.indexOf('isImeComposing(event)'))
  assert.match(onKey, /isTypingTarget\(event\)/)
  assert.match(source, /function isNoteFieldActive\(/)
  assert.match(source, /node\.id === 'vf-note'/)
})


test('panel dev-server errors are short and localized without a command dump', () => {
  const tEn = (key) => en[key];
  const tZh = (key) => zh[key];
  const dumped = new Error('Dev server exited early (code 0). > codemini-cli@0.15.6-beta.0 start\n> node bin/coder.js\ncodemini> Start your project');
  dumped.code = 'DEV_SERVER_EXITED';
  const english = formatVisualFeedbackPanelError(dumped, tEn);
  assert.equal(english.includes('coder.js'), false);
  assert.equal(english.includes('codemini>'), false);
  assert.match(english, /exited before a frontend dev server/);
  assert.match(english, /Start the project's development server yourself/);
  assert.ok(english.length < 400);
  const chinese = formatVisualFeedbackPanelError(dumped, tZh);
  assert.match(chinese, /项目命令/);
  assert.match(chinese, /请先自行启动/);
  assert.equal(chinese.includes('coder.js'), false);
  const panel = readFileSync(new URL('../codemini-web/client/src/components/VisualFeedbackPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /formatVisualFeedbackPanelError\(err, t\)/);
});

function extractOverlayFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `missing function ${name}`)
  let index = start + `function ${name}`.length
  let parens = 0
  let seenParen = false
  for (; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') {
      parens += 1
      seenParen = true
    } else if (char === ')') {
      parens -= 1
      if (seenParen && parens === 0) {
        index += 1
        break
      }
    }
  }
  const brace = source.indexOf('{', index)
  let depth = 0
  for (index = brace; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unclosed function ${name}`)
}

test('stopping select mode clears the hover highlight and label', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function exitSelectMode\(/)
  const exit = extractOverlayFunction(source, 'exitSelectMode')
  assert.match(exit, /state\.mode = false/)
  assert.match(exit, /state\.draft = null/)
  assert.match(exit, /state\.boxSelect = null/)
  assert.match(exit, /clearHighlight\(/)

  const toggleAt = source.indexOf("if (action === 'toggle')")
  assert.ok(toggleAt >= 0)
  const toggle = source.slice(toggleAt, source.indexOf("if (action === 'toggle-list')", toggleAt))
  assert.match(toggle, /exitSelectMode\(/)

  const apiAt = source.indexOf('window.__codeminiVisualFeedbackApi')
  assert.ok(apiAt >= 0)
  const api = source.slice(apiAt)
  assert.match(api, /stop\(\)\s*\{[^}]*exitSelectMode\(/)
  assert.match(api, /setEnvironment\([^)]*\)\s*\{[\s\S]*?exitSelectMode\(/)

  const renderStart = source.indexOf('function render()')
  const render = source.slice(renderStart, source.indexOf('function liveNoteField()', renderStart))
  assert.match(render, /state\.mode \|\| state\.draft/)
  assert.match(render, /setHover\(null\)/)

  const scroll = extractOverlayFunction(source, 'onScroll')
  assert.match(scroll, /state\.mode \|\| state\.draft/)
  assert.match(scroll, /setHover\(null\)/)

  const refresh = extractOverlayFunction(source, 'refreshEnvironment')
  assert.match(refresh, /exitSelectMode\(/)
  assert.doesNotThrow(() => new Function(source))
})

test('unchecking a selected note does not highlight html, body, or a root wrapper', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function isRootWrapper\(/)
  assert.match(source, /function retargetHighlightAfterRemoval\(/)
  assert.match(source, /function uncheckNote\(/)
  assert.match(source, /function clearHighlight\(/)
  assert.match(source, /data-uncheck/)
  const uncheck = extractOverlayFunction(source, 'uncheckNote')
  assert.match(uncheck, /retargetHighlightAfterRemoval\(/)
  const removeAt = source.indexOf("target.closest('[data-remove]')")
  assert.ok(removeAt >= 0)
  const removeBlock = source.slice(removeAt, source.indexOf("target.closest('[data-note-id]')", removeAt))
  assert.match(removeBlock, /uncheckNote\(/)
  const after = extractOverlayFunction(source, 'retargetHighlightAfterRemoval')
  assert.match(after, /pickRemainingHighlight\(/)
  assert.match(after, /clearHighlight\(/)
  const hover = extractOverlayFunction(source, 'setHover')
  assert.match(hover, /isRootWrapper\(element\)/)
  const renderStart = source.indexOf('function render()')
  const render = source.slice(renderStart, source.indexOf('function liveNoteField()', renderStart))
  assert.match(render, /!isRootWrapper\(highlight\)/)
  assert.match(render, /setHover\(null\)/)

  const factory = new Function('ROOT_ID', 'document', 'window', `${extractOverlayFunction(source, 'isRootWrapper')}\nreturn isRootWrapper;`)
  const html = { nodeType: 1, tagName: 'HTML', id: '', parentElement: null }
  const body = { nodeType: 1, tagName: 'BODY', id: '', parentElement: html }
  const root = {
    nodeType: 1,
    tagName: 'DIV',
    id: 'root',
    parentElement: body,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
  }
  const app = {
    nodeType: 1,
    tagName: 'DIV',
    id: 'app',
    parentElement: body,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
  }
  const button = {
    nodeType: 1,
    tagName: 'BUTTON',
    id: 'save',
    parentElement: root,
    getBoundingClientRect: () => ({ left: 40, top: 80, width: 80, height: 32 }),
  }
  const isRootWrapper = factory('codemini-visual-feedback-root', {
    documentElement: html,
    body,
  }, { innerWidth: 1280, innerHeight: 800 })
  assert.equal(isRootWrapper(null), false)
  assert.equal(isRootWrapper(html), true)
  assert.equal(isRootWrapper(body), true)
  assert.equal(isRootWrapper(root), true)
  assert.equal(isRootWrapper(app), true)
  assert.equal(isRootWrapper(button), false)
  const pick = extractOverlayFunction(source, 'pickRemainingHighlight')
  assert.match(pick, /isRootWrapper/)
  assert.doesNotMatch(pick, /document\.documentElement/)
  assert.doesNotThrow(() => new Function(source))
})

test('Shift-click and area-box selection add elements without replacing notes', () => {
  const source = getVisualFeedbackInitScript()
  assert.match(source, /function onPointerDown\(/)
  assert.match(source, /function onPointerUp\(/)
  assert.match(source, /function elementsInBox\(/)
  assert.match(source, /function addToSelection\(/)
  assert.match(source, /function paintBox\(/)
  assert.match(source, /event\.shiftKey/)
  assert.match(source, /className = 'box'/)
  assert.match(source, /data-uncheck-kind="selection"/)
  const clickAt = source.indexOf('function onClick(event)')
  const click = source.slice(clickAt, source.indexOf('function onKey(event)', clickAt))
  assert.match(click, /event\.shiftKey/)
  assert.match(click, /addToSelection\(element\)/)
  const down = extractOverlayFunction(source, 'onPointerDown')
  assert.match(down, /state\.boxSelect/)
  const up = extractOverlayFunction(source, 'onPointerUp')
  assert.match(up, /elementsInBox\(box\)/)
  assert.match(up, /box\.shift/)
  assert.match(up, /addToSelection/)
  const inBox = extractOverlayFunction(source, 'elementsInBox')
  assert.match(inBox, /isRootWrapper\(node\)/)
  assert.match(inBox, /isRetargetable\(node\)/)
  const en = getVisualFeedbackOverlayStrings('en')
  const zh = getVisualFeedbackOverlayStrings('zh')
  assert.match(en.visualFeedbackOverlaySelecting, /drag/i)
  assert.match(en.visualFeedbackOverlaySelecting, /Shift/)
  assert.match(zh.visualFeedbackOverlaySelecting, /拖拽/)
  assert.match(zh.visualFeedbackOverlaySelecting, /Shift/)
  assert.equal(en.visualFeedbackOverlayUncheck.includes('html'), false)
  assert.ok(zh.visualFeedbackOverlayUncheck)
  assert.doesNotThrow(() => new Function(source))
})

test('shared notes submit as one instruction covering every element', async () => {
  const shared = {
    id: 'n-shared',
    kind: 'visual',
    text: 'make them the same width',
    shared: true,
    element: {
      selector: '#save',
      tag: 'button',
      id: 'save',
      className: 'primary',
      text: 'Save',
      rect: { x: 10, y: 20, width: 80, height: 32 },
    },
    elements: [
      {
        selector: '#save',
        tag: 'button',
        id: 'save',
        className: 'primary',
        text: 'Save',
        rect: { x: 10, y: 20, width: 80, height: 32 },
        sourceLocations: [{ file: 'src/Toolbar.tsx', line: 12 }],
      },
      {
        selector: '#cancel',
        tag: 'button',
        id: 'cancel',
        className: 'ghost',
        text: 'Cancel',
        rect: { x: 100, y: 20, width: 96, height: 32 },
      },
    ],
  }
  assert.equal(isSharedVisualFeedbackNote(shared), true)
  assert.equal(noteElements(shared).length, 2)
  assert.equal(shouldUseGroupScreenshot(shared.elements, { width: 1280, height: 800 }), true)
  const scattered = [
    { rect: { x: 0, y: 0, width: 40, height: 20 } },
    { rect: { x: 900, y: 700, width: 40, height: 20 } },
  ]
  assert.equal(shouldUseGroupScreenshot(scattered, { width: 1280, height: 800 }), false)
  assert.deepEqual(unionElementRects(shared.elements), { x: 10, y: 20, width: 186, height: 32 })

  const payload = await enrichVisualFeedbackPayload(
    { page: { url: () => 'http://127.0.0.1:5173/settings', title: async () => 'Settings' } },
    {
      url: 'http://127.0.0.1:5173/settings',
      title: 'Settings',
      environment: { ok: true, strong: [{ id: 'vite-client' }] },
      notes: [shared],
    },
    {
      captureScreenshot: async (_session, note) => (
        note.element.selector === '#save'
          ? { mime: 'image/jpeg', data: 'U0FWRQ==', width: 120, height: 48 }
          : { unavailable: true, reason: 'not-found' }
      ),
    },
  )
  assert.equal(payload.notes.length, 1)
  assert.equal(payload.notes[0].shared, true)
  assert.equal(payload.notes[0].elements.length, 2)
  assert.equal(payload.notes[0].elements[0].screenshot.data, 'U0FWRQ==')
  assert.equal(payload.notes[0].elements[1].screenshot.unavailable, true)
  const message = formatVisualFeedbackMessage(payload)
  assert.match(message.text, /1 note/)
  assert.match(message.text, /make them the same width/)
  assert.match(message.text, /2 elements selected together/)
  assert.match(message.text, /#save/)
  assert.match(message.text, /#cancel/)
  assert.match(message.modelText, /make them the same width/)
  assert.match(message.modelText, /2 elements selected together/)
  assert.match(message.modelText, /These elements were selected together/)
  assert.match(message.modelText, /### Element 1/)
  assert.match(message.modelText, /### Element 2/)
  assert.match(message.modelText, /Selector: `#save`/)
  assert.match(message.modelText, /Selector: `#cancel`/)
  assert.match(message.modelText, /class: primary/)
  assert.match(message.modelText, /Text: Save/)
  assert.match(message.modelText, /src\/Toolbar\.tsx:12/)
  assert.match(message.modelText, /Source: not resolved \(no original source location was found for this element\)/)
  assert.match(message.modelText, /Screenshot: attached \(120×48\)/)
  assert.match(message.modelText, /Screenshot: unavailable \(not-found\)/)
  assert.doesNotMatch(message.modelText, /Group screenshot/)
  assert.equal(message.modelImages.length, 1)
  assert.doesNotMatch(message.modelText, /U0FWRQ==/)
  const missingSource = formatVisualFeedbackSourceLine([])
  assert.match(missingSource, /not resolved/)
  assert.match(missingSource, /no original source location was found/)

  const bubble = readFileSync(new URL('../codemini-web/client/src/components/MessageBubble.jsx', import.meta.url), 'utf8')
  assert.match(bubble, /function VisualFeedbackUserContent/)
  assert.match(bubble, /\{payload\}/)
  assert.match(bubble, /modelText=\{message\.modelText\}/)
  assert.match(bubble, /attachments=\{attachments\}/)
})

test('unchecking one element from a shared note keeps the others and does not highlight the root', () => {
  const source = getVisualFeedbackInitScript()
  const uncheck = extractOverlayFunction(source, 'uncheckNote')
  assert.match(uncheck, /wanted/)
  assert.match(uncheck, /normalizeNoteTargets\(/)
  assert.match(uncheck, /retargetHighlightAfterRemoval\(/)
  const normalize = extractOverlayFunction(source, 'normalizeNoteTargets')
  assert.match(normalize, /note\.shared = false/)
  assert.match(normalize, /note\.elements = undefined/)
  const clickAt = source.indexOf("target.closest('[data-uncheck]')")
  const click = source.slice(clickAt, source.indexOf("target.closest('[data-remove]')", clickAt))
  assert.match(click, /data-uncheck-selector/)
  assert.match(click, /uncheckNote\(id, selector\)/)
  assert.match(source, /function syncSharedDraft\(/)
  assert.match(source, /visualFeedbackOverlaySharedNote/)
  const saveAt = source.indexOf("action === 'save-note'")
  const save = source.slice(saveAt, source.indexOf("action === 'submit'", saveAt))
  assert.match(save, /shared/)
  assert.match(save, /elements: shared \? unique : undefined/)
  const en = getVisualFeedbackOverlayStrings('en')
  const zh = getVisualFeedbackOverlayStrings('zh')
  assert.match(en.visualFeedbackOverlaySharedNote, /One note/)
  assert.match(zh.visualFeedbackOverlaySharedNoteHint, /所有选中/)
  assert.doesNotThrow(() => new Function(source))
})


function mockElement(tag, attrs = {}, children = []) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: { ...attrs },
    children: [],
    parentElement: null,
    ownerDocument: { documentElement: { tagName: 'HTML' }, body: { tagName: 'BODY' } },
    isContentEditable: false,
    getAttribute(name) {
      const key = String(name);
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
    },
    get innerText() {
      if (this.attrs.text != null) return this.attrs.text;
      return this.children.map((child) => child.innerText || '').join(' ');
    },
    get textContent() {
      return this.innerText;
    },
    get outerHTML() {
      if (this.attrs.outerHTML) return this.attrs.outerHTML;
      const parts = Object.entries(this.attrs)
        .filter(([key]) => key !== 'text' && key !== 'outerHTML')
        .map(([key, value]) => ` ${key}="${value}"`)
        .join('');
      const inner = this.attrs.text || this.children.map((child) => child.outerHTML).join('');
      const name = String(tag).toLowerCase();
      return `<${name}${parts}>${inner}</${name}>`;
    },
    querySelectorAll(selector) {
      const groups = String(selector || '').split(',').map((item) => item.trim()).filter(Boolean);
      const matches = [];
      const walk = (el) => {
        for (const child of el.children) {
          if (groups.some((group) => mockMatchesSelector(child, group))) matches.push(child);
          walk(child);
        }
      };
      walk(this);
      return matches;
    },
  };
  for (const child of children) {
    child.parentElement = node;
    child.ownerDocument = node.ownerDocument;
    node.children.push(child);
  }
  return node;
}

function mockMatchesSelector(node, selector) {
  const value = String(selector || '').trim();
  const role = value.match(/^\[role=["']([^"']+)["']\]$/i);
  if (role) return String(node.getAttribute('role') || '') === role[1];
  return String(node.tagName || '').toLowerCase() === value.toLowerCase();
}

test('verification contract leaves inspect optional and does not forbid it', () => {
  const identify = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:3000/app',
    title: 'App',
    environment: { ok: true, strong: [{ id: 'vite-client' }] },
    notes: [{
      kind: 'visual',
      text: '你能看到我框选了什么吗？你能定位到它所在的位置吗？例如代码所在位置。',
      element: {
        selector: '#root svg',
        tag: 'svg',
        sourceLocations: [{ file: 'src/Sidebar.jsx', line: 12 }],
      },
    }],
  });
  assert.match(identify.modelText, /Verification contract/);
  assert.match(identify.modelText, /meant to be sufficient/);
  assert.match(identify.modelText, /You may use browser_inspect and browser_act/);
  assert.match(identify.modelText, /not required to re-check DOM, layout, or computed style/);
  assert.doesNotMatch(identify.modelText, /Do not call browser_inspect/);
  assert.doesNotMatch(identify.modelText, /Do not call browser_act,/);
  assert.doesNotMatch(identify.modelText, /Re-inspect DOM, layout, and computed style for each visual note/);
  assert.match(identify.modelText, /not required to re-check DOM, layout, or computed style just to confirm/);
  assert.doesNotMatch(identify.modelText, /For functional notes/);
  assert.match(VISUAL_FEEDBACK_PROMPT, /Do not close/);
  assert.doesNotMatch(VISUAL_FEEDBACK_PROMPT, /Call browser_inspect and browser_act to inspect and verify/);
  assert.doesNotMatch(VISUAL_FEEDBACK_PROMPT, /re-check DOM, layout, and computed style for visual notes/);

  const englishLocate = formatVisualFeedbackVerificationContract([
    { kind: 'visual', text: 'Can you see what I selected? Where is the code location?' },
  ]);
  assert.match(englishLocate, /You may use browser_inspect/);
  assert.doesNotMatch(englishLocate, /Do not call browser_inspect/);

  const mixed = formatVisualFeedbackVerificationContract([
    { kind: 'visual', text: 'The save button is too close to the edge.' },
    { kind: 'functional', text: 'This button does not open the dialog.' },
  ]);
  assert.match(mixed, /You may use browser_inspect and browser_act/);
  assert.match(mixed, /After you make edits/);
  assert.match(mixed, /For functional notes/);
  assert.match(mixed, /click the element/);
  assert.doesNotMatch(mixed, /Do not call browser_inspect/);
  assert.doesNotMatch(mixed, /Re-inspect DOM, layout, and computed style for each visual note/);
});

test('closest interactive ancestor name is sent only when the node itself has no name or role', () => {
  const icon = mockElement('svg', { width: '15', height: '15' });
  const about = mockElement('button', { 'aria-label': '关于', title: '关于' }, [icon]);
  icon.parentElement = about;
  assert.equal(visualFeedbackOwnName(icon), '');
  assert.equal(visualFeedbackInteractiveAncestorName(icon), 'button "关于"');
  assert.ok(visualFeedbackInteractiveAncestorName(icon).length <= VISUAL_FEEDBACK_ANCESTOR_NAME_LIMIT);

  const labeled = mockElement('button', { 'aria-label': 'Save', role: 'button' });
  assert.equal(visualFeedbackOwnName(labeled), 'Save');
  assert.equal(visualFeedbackInteractiveAncestorName(labeled), '');

  const roleOnly = mockElement('div', { role: 'button', text: 'Continue' }, [mockElement('span')]);
  const inner = roleOnly.children[0];
  inner.parentElement = roleOnly;
  assert.equal(visualFeedbackInteractiveAncestorName(roleOnly), '');
  assert.equal(visualFeedbackInteractiveAncestorName(inner), 'button "Continue"');

  const message = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:3000/app',
    notes: [{
      text: 'What is this?',
      element: {
        selector: 'button > svg',
        tag: 'svg',
        name: '',
        role: '',
        ancestorName: 'button "关于"',
        html: '<svg width="15" height="15"></svg>',
      },
    }],
  });
  assert.match(message.modelText, /Closest interactive ancestor: button "关于"/);
  const alreadyNamed = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:3000/app',
    notes: [{
      text: 'What is this?',
      element: {
        selector: '#save',
        tag: 'button',
        name: 'Save',
        role: 'button',
        ancestorName: 'div "toolbar"',
      },
    }],
  });
  assert.doesNotMatch(alreadyNamed.modelText, /Closest interactive ancestor/);
  assert.doesNotMatch(alreadyNamed.modelText, /toolbar/);

  const source = getVisualFeedbackInitScript();
  assert.match(source, /function visualFeedbackInteractiveAncestorName\(/);
  assert.match(source, /function visualFeedbackOwnName\(/);
  const describe = extractOverlayFunction(source, 'describeElement');
  assert.match(describe, /ancestorName/);
  assert.match(describe, /visualFeedbackInteractiveAncestorName\(/);
  assert.doesNotThrow(() => new Function(source));
});

test('truncated markup adds a short child-label line without lengthening Markup', () => {
  assert.equal(VISUAL_FEEDBACK_MARKUP_LIMIT, 280);
  assert.equal(VISUAL_FEEDBACK_CHILD_LABEL_LIMIT, 160);
  const tab = (label) => mockElement('button', { role: 'tab', text: label });
  const children = [
    mockElement('button', { 'aria-label': 'Open sidebar' }),
    mockElement('span', { text: '普通会话' }),
    tab('对话'),
    tab('轨迹'),
    tab('上下文'),
    mockElement('button', { 'aria-label': '展开右侧栏' }),
    mockElement('button', { text: '视觉反馈' }),
  ];
  const bar = mockElement('div', {
    class: 'flex items-center justify-between h-12',
    outerHTML: `<div class="flex items-center justify-between h-12">${'x'.repeat(400)}</div>`,
  }, children);
  const labels = visualFeedbackChildLabels(bar, bar.outerHTML, VISUAL_FEEDBACK_MARKUP_LIMIT, VISUAL_FEEDBACK_CHILD_LABEL_LIMIT);
  assert.ok(labels);
  assert.ok(labels.length <= VISUAL_FEEDBACK_CHILD_LABEL_LIMIT);
  assert.match(labels, /Open sidebar/);
  assert.match(labels, /对话/);
  assert.match(labels, /视觉反馈/);

  const icon = mockElement('svg', { outerHTML: '<svg width="15" height="15"></svg>' }, []);
  assert.equal(visualFeedbackChildLabels(icon, icon.outerHTML), '');
  assert.ok(icon.outerHTML.length <= VISUAL_FEEDBACK_MARKUP_LIMIT);

  const longHtml = `<div class="toolbar">${'n'.repeat(400)}</div>`;
  const message = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:3000/app',
    notes: [{
      text: 'What is this title bar?',
      element: {
        selector: 'div.toolbar',
        tag: 'div',
        html: longHtml,
        childLabels: 'button "Open sidebar", tab "对话", button "视觉反馈"',
      },
    }],
  });
  const markupLine = message.modelText.split('\n').find((line) => line.startsWith('- Markup:'));
  assert.ok(markupLine);
  assert.ok(markupLine.length <= '- Markup: '.length + 280);
  assert.equal(markupLine.slice('- Markup: '.length).length, 280);
  assert.match(message.modelText, /Child labels: button "Open sidebar", tab "对话", button "视觉反馈"/);
  const childLine = message.modelText.split('\n').find((line) => line.startsWith('- Child labels:'));
  assert.ok(childLine.length <= '- Child labels: '.length + 160);

  const short = formatVisualFeedbackMessage({
    url: 'http://127.0.0.1:3000/app',
    notes: [{
      text: 'What is this icon?',
      element: { selector: 'svg', tag: 'svg', html: '<svg width="15"></svg>' },
    }],
  });
  assert.match(short.modelText, /Markup: <svg width="15"><\/svg>/);
  assert.doesNotMatch(short.modelText, /Child labels:/);

  const source = getVisualFeedbackInitScript();
  const describe = extractOverlayFunction(source, 'describeElement');
  assert.match(describe, /VISUAL_FEEDBACK_MARKUP_LIMIT/);
  assert.match(describe, /visualFeedbackChildLabels\(/);
  assert.match(describe, /childLabels/);
});

test('the panel reveals a login URL only on an auth page and never invents one', () => {
  const secret = 'http://127.0.0.1:3000/signin#token=s3cret-token-value';
  assert.deepEqual(presentVisualFeedbackLogin({}), { usedLoginUrl: false, revealLoginUrl: false, loginUrl: '' });
  assert.deepEqual(presentVisualFeedbackLogin({ loginUrl: '', pageUrl: 'http://127.0.0.1:3000/signin', open: true }), {
    usedLoginUrl: false,
    revealLoginUrl: false,
    loginUrl: '',
  });

  const onAuth = presentVisualFeedbackLogin({
    loginUrl: secret,
    pageUrl: 'http://127.0.0.1:3000/signin',
    open: true,
  });
  assert.equal(onAuth.usedLoginUrl, true);
  assert.equal(onAuth.revealLoginUrl, true);
  assert.equal(onAuth.loginUrl, secret);

  const pastLogin = presentVisualFeedbackLogin({
    loginUrl: secret,
    pageUrl: 'http://127.0.0.1:3000/chat/session-1',
    open: true,
  });
  assert.equal(pastLogin.usedLoginUrl, true);
  assert.equal(pastLogin.revealLoginUrl, false);
  assert.equal(pastLogin.loginUrl, '');
  assert.doesNotMatch(pastLogin.loginUrl, /s3cret/);

  const closed = presentVisualFeedbackLogin({
    loginUrl: secret,
    pageUrl: 'http://127.0.0.1:3000/signin',
    open: false,
  });
  assert.equal(closed.usedLoginUrl, true);
  assert.equal(closed.revealLoginUrl, false);
  assert.equal(closed.loginUrl, '');

  const controllerSource = readFileSync(new URL('../src/core/browser/visual-feedback.js', import.meta.url), 'utf8');
  assert.match(controllerSource, /\.\.\.presentVisualFeedbackLogin\(/);
  const statusAt = controllerSource.indexOf('async status(options');
  const statusFn = controllerSource.slice(statusAt, controllerSource.indexOf('async close(', statusAt));
  assert.match(statusFn, /presentVisualFeedbackLogin\(/);
  assert.doesNotMatch(statusFn, /loginUrl: lastOpen\?\.loginUrl \|\| '',\s*active:/);

  const panel = readFileSync(new URL('../codemini-web/client/src/components/VisualFeedbackPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /status\?\.loginUrl/);
  assert.match(panel, /status\?\.usedLoginUrl/);
  assert.match(panel, /visualFeedbackLoginUrlUsedHint/);
  assert.equal(en.visualFeedbackLoginUrlUsedHint.includes('token'), false);
  assert.match(en.visualFeedbackLoginUrlUsedHint, /Used a login URL from the dev-server logs/);
  assert.match(zh.visualFeedbackLoginUrlUsedHint, /已使用开发服务器日志里的一键登录链接/);
  assert.doesNotMatch(en.visualFeedbackLoginUrlUsedHint, /#token=/);
  assert.doesNotMatch(zh.visualFeedbackLoginUrlUsedHint, /#token=/);
});


test('the Visual Feedback panel footer includes a short scope note beside the existing hint', () => {
  const panel = readFileSync(new URL('../codemini-web/client/src/components/VisualFeedbackPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /visualFeedbackHint/);
  assert.match(panel, /visualFeedbackScopeHint/);
  assert.doesNotMatch(panel, /<dialog/);
  assert.match(en.visualFeedbackScopeHint, /frontend dev server/);
  assert.match(en.visualFeedbackScopeHint, /React or Vue/);
  assert.match(en.visualFeedbackScopeHint, /sourcemaps/);
  assert.match(en.visualFeedbackScopeHint, /Production and preview pages are not supported/);
  assert.match(zh.visualFeedbackScopeHint, /前端开发服务器/);
  assert.match(zh.visualFeedbackScopeHint, /React\/Vue/);
  assert.match(zh.visualFeedbackScopeHint, /sourcemap/);
  assert.match(zh.visualFeedbackScopeHint, /不支持生产或预览页面/);
  assert.ok(en.visualFeedbackScopeHint.length < 280);
  assert.ok(zh.visualFeedbackScopeHint.length < 160);
});
