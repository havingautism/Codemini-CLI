# CodeWiki WebUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CodeWiki-style WebUI view that can generate, list, display, and ask questions about the current project's `project-requirements` report.

**Architecture:** The backend exposes safe report listing/serving endpoints and submits `/project-requirements` through the existing runtime bridge. The frontend adds a `codewiki` route/view with a three-column layout: reports/navigation, embedded report, and a compact repository Q&A panel that reuses `actions.submit`.

**Tech Stack:** Node HTTP server in `codemini-web/server.js`, React 19 + Vite + Tailwind CSS v4 in `codemini-web/client`, existing RuntimeBridge chat pipeline.

---

### Task 1: Backend CodeWiki API

**Files:**
- Modify: `codemini-web/server.js`

- [ ] **Step 1: Add report filename helpers near other utility functions**

Add constants and helpers after `existingDirectoryForHint`:

```js
const CODEWIKI_REPORT_RE = /^[^/\\]+-project-requirements\.html$/;

function getRequirementsDir(projectDir) {
  return path.join(projectDir, 'docs', 'requirements');
}

function isCodeWikiReportFile(fileName) {
  return CODEWIKI_REPORT_RE.test(String(fileName || ''));
}

function codeWikiReportTitle(fileName) {
  return String(fileName || '')
    .replace(/-project-requirements\.html$/, '')
    .replace(/-/g, ' ');
}
```

- [ ] **Step 2: Add `GET /api/codewiki/reports`**

Inside the request handler after `/api/session/messages`, add:

```js
if (req.method === 'GET' && url.pathname === '/api/codewiki/reports') {
  const requirementsDir = getRequirementsDir(currentProjectDir);
  try {
    const entries = await fs.readdir(requirementsDir, { withFileTypes: true });
    const reports = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isCodeWikiReportFile(entry.name)) continue;
      const reportPath = path.join(requirementsDir, entry.name);
      const stat = await fs.stat(reportPath);
      reports.push({
        file: entry.name,
        title: codeWikiReportTitle(entry.name),
        size: stat.size,
        mtime: stat.mtime.toISOString()
      });
    }
    reports.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    jsonResponse(res, { reports });
  } catch (err) {
    if (err?.code === 'ENOENT') jsonResponse(res, { reports: [] });
    else jsonResponse(res, { error: true, message: err.message }, 500);
  }
  return;
}
```

- [ ] **Step 3: Add `GET /api/codewiki/report/:file`**

Add after the reports endpoint:

```js
if (req.method === 'GET' && url.pathname.startsWith('/api/codewiki/report/')) {
  const fileName = decodeURIComponent(url.pathname.slice('/api/codewiki/report/'.length));
  if (!isCodeWikiReportFile(fileName)) {
    jsonResponse(res, { error: true, message: 'Invalid report file' }, 400);
    return;
  }
  const requirementsDir = path.resolve(getRequirementsDir(currentProjectDir));
  const reportPath = path.resolve(requirementsDir, fileName);
  if (!reportPath.startsWith(`${requirementsDir}${path.sep}`)) {
    jsonResponse(res, { error: true, message: 'Invalid report path' }, 403);
    return;
  }
  await serveStatic(res, reportPath);
  return;
}
```

- [ ] **Step 4: Add `POST /api/codewiki/generate`**

Add after the report-serving endpoint:

```js
if (req.method === 'POST' && url.pathname === '/api/codewiki/generate') {
  const state = bridge.getState();
  if (state?.busy) {
    jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
    return;
  }
  const result = bridge.handleSubmit('/project-requirements');
  jsonResponse(res, result);
  return;
}
```

- [ ] **Step 5: Verify syntax**

Run:

```bash
node --check codemini-web/server.js
```

Expected: exits 0 with no syntax errors.

### Task 2: Frontend API and Routing

**Files:**
- Modify: `codemini-web/client/src/hooks/use-api.js`
- Modify: `codemini-web/client/src/context/app-context.jsx`

- [ ] **Step 1: Add API helpers**

Append to `use-api.js`:

```js
export async function fetchCodeWikiReports() {
  const res = await api('/api/codewiki/reports');
  return res.json();
}

export async function generateCodeWikiReport() {
  const res = await api('/api/codewiki/generate', { method: 'POST' });
  return res.json();
}
```

- [ ] **Step 2: Add `/codewiki` route parsing**

In `parseRoute`, add before the default chat return:

```js
if (path === '/codewiki') return { view: 'codewiki' };
```

In `routeFor`, add before the chat return:

```js
if (view === 'codewiki') return '/codewiki';
```

- [ ] **Step 3: Let `switchView` route to CodeWiki**

Replace the current `switchView` action with:

```js
switchView: (view) => {
  update({ currentView: view });
  if (view === 'sessions' || view === 'codewiki') updateRoute(view);
  if (view === 'chat') {
    const rs = stateRef.current.runtimeState;
    updateRoute('chat', rs?.sessionId);
  }
},
```

### Task 3: CodeWiki Panel UI

**Files:**
- Create: `codemini-web/client/src/components/CodeWikiPanel.jsx`
- Modify: `codemini-web/client/src/App.jsx`
- Modify: `codemini-web/client/src/components/Sidebar.jsx`

- [ ] **Step 1: Create `CodeWikiPanel.jsx`**

Implement a focused component with local report state, generation state, an iframe report surface, and right-side question form. It imports `BookOpenText`, `RefreshCw`, `SendHorizontal`, `Sparkles`, `FileText`, `AlertCircle`, `Loader2`, and `MessageSquareText` from `lucide-react`, plus `fetchCodeWikiReports` and `generateCodeWikiReport`.

The component props are:

```js
export function CodeWikiPanel({ projectCwd, busy, onAsk })
```

The ask handler submits:

```js
onAsk(`请基于当前项目的 CodeWiki / project-requirements 报告回答这个问题：${trimmed}`);
```

The report URL is:

```js
`/api/codewiki/report/${encodeURIComponent(selected.file)}`
```

- [ ] **Step 2: Wire `CodeWikiPanel` into `App.jsx`**

Import the component:

```js
import { CodeWikiPanel } from "@/components/CodeWikiPanel.jsx";
```

Render it when `state.currentView === "codewiki"` and pass:

```jsx
<CodeWikiPanel
  projectCwd={state.projectCwd}
  busy={state.busy}
  onAsk={actions.submit}
/>
```

- [ ] **Step 3: Add Sidebar entry**

In `Sidebar.jsx`, import `BookOpenText`, accept `currentView` and `onSwitchView`, and add a button labelled `CodeWiki` that calls `onSwitchView("codewiki")`. Use the existing sidebar button visual language and active background when `currentView === "codewiki"`.

In `App.jsx`, pass:

```jsx
currentView={state.currentView}
onSwitchView={actions.switchView}
```

### Task 4: Verification

**Files:**
- No code files unless verification reveals a bug.

- [ ] **Step 1: Run syntax check**

Run:

```bash
node --check codemini-web/server.js
```

Expected: exits 0.

- [ ] **Step 2: Run WebUI build**

Run:

```bash
npm run build
```

from `codemini-web`.

Expected: Vite build succeeds.

- [ ] **Step 3: Start WebUI**

Run:

```bash
npm run dev -- --no-open
```

from `codemini-web`, keep the server running long enough to confirm the local URL.

- [ ] **Step 4: Smoke test CodeWiki endpoints**

Use the running server:

```bash
curl -s http://localhost:<port>/api/codewiki/reports
curl -i http://localhost:<port>/api/codewiki/report/..%2Fbad.html
```

Expected: reports returns JSON and malformed report returns 400.

