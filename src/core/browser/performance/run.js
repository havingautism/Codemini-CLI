import { browserError, browserOk } from '../result.js';
import { resolveBrowserConfig } from '../schema.js';
import { describeTarget, resolveLocator, resolvePageUrl, validateTarget } from '../target.js';
import { diffMetrics, disableMetrics, enableMetrics, startCpu, startTrace } from './collect.js';
import { buildPerformanceReport, performanceSummaryText } from './report.js';

const DURATION = Object.freeze({ min: 200, max: 8000, default: 2000 });
const CAPTURE = new Set(['trace', 'cpu', 'metrics']);

function message(error) {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

function normalizeCapture(value) {
  const requested = Array.isArray(value) && value.length
    ? value.filter((item) => CAPTURE.has(item))
    : ['trace', 'cpu', 'metrics'];
  return new Set(requested.length ? requested : ['trace', 'cpu', 'metrics']);
}

function normalizeDuration(value) {
  if (value == null) return DURATION.default;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < DURATION.min || parsed > DURATION.max) return DURATION.default;
  return parsed;
}

function clearPageState(session) {
  session.refs.clear();
  session.refKeys?.clear?.();
  session.roleCounts = new Map();
  session.nextRef = 1;
  session.lastSnapshotText = '';
}

async function openOrNavigate(session, raw) {
  const resolved = resolvePageUrl(session.workspaceRoot, raw);
  if (resolved.error) {
    const error = new Error(resolved.error);
    error.code = 'UNSUPPORTED_URL';
    throw error;
  }
  if (!session.page) await session.launchBrowser({});
  const timeout = resolveBrowserConfig(session.config).timeout_ms;
  await session.page.goto(resolved.url, { waitUntil: 'domcontentloaded', timeout });
  clearPageState(session);
  await session.resetCdp();
}

async function runActions(session, actions) {
  const notes = [];
  const steps = Array.isArray(actions) ? actions.slice(0, 8) : [];
  for (const step of steps) {
    const type = String(step?.type || '');
    try {
      if (type === 'wait') {
        const wait = Math.min(5000, Math.max(0, Number(step.duration) || 200));
        await session.page.waitForTimeout(wait);
      } else if (type === 'scroll') {
        await session.page.mouse.wheel(Number(step.x) || 0, Number(step.y) || 400);
      } else if (type === 'click' || type === 'type') {
        const parsed = validateTarget(step);
        if (!parsed.ok) {
          notes.push(`${type} skipped: ${parsed.error}`);
          continue;
        }
        const found = await resolveLocator(session, 'performance_profile', parsed.target);
        if (found.error) {
          notes.push(`${type} skipped: ${found.error.error}`);
          continue;
        }
        if (type === 'click') {
          await found.locator.click({ timeout: 5000 });
        } else {
          const text = typeof step.text === 'string' ? step.text : '';
          if (!text) {
            notes.push('type skipped: text is empty.');
            continue;
          }
          await found.locator.fill(text, { timeout: 5000 });
          notes.push(`Typed into ${describeTarget(parsed.target)}.`);
          continue;
        }
      } else if (type) {
        notes.push(`Skipped unknown action "${type}".`);
      }
    } catch (error) {
      notes.push(`${type || 'action'} failed: ${message(error)}`);
    }
  }
  return notes;
}

async function stopCollectors({ cpu, trace, metricsOpen, session, profileBox, traceBox, metricsBox, limitations }) {
  if (cpu) {
    try { profileBox.profile = await cpu.stop(); }
    catch (error) { limitations.push(`CPU profiler stop failed: ${message(error)}`); }
  }
  if (trace) {
    try {
      traceBox.result = await trace.stop();
      if (!traceBox.result?.complete) limitations.push('Tracing stopped before tracingComplete. The trace may be incomplete.');
      if (traceBox.result?.truncated) limitations.push('Trace event cap was reached. Later events were dropped.');
    } catch (error) {
      limitations.push(`Tracing stop failed: ${message(error)}`);
    }
  }
  if (metricsOpen && session.cdp) {
    try { metricsBox.after = await disableMetrics(session.cdp); }
    catch (error) { limitations.push(`Performance metrics read failed: ${message(error)}`); }
  }
}

export async function runPerformanceProfile(session, args = {}) {
  if (session.performanceBusy) {
    return browserError('performance_profile', 'PROFILE_BUSY', 'A performance profile is already running on this browser session.');
  }
  session.performanceBusy = true;
  const limitations = [];
  const capture = normalizeCapture(args.capture);
  const duration = normalizeDuration(args.duration);
  let trace = null;
  let cpu = null;
  let metricsOpen = false;
  let before = null;
  const profileBox = {};
  const traceBox = {};
  const metricsBox = {};
  const startedAt = Date.now();
  try {
    if (args.url) {
      try {
        await openOrNavigate(session, args.url);
      } catch (error) {
        return browserError('performance_profile', error.code || 'NAVIGATION_FAILED', message(error));
      }
    }
    if (!session.page || !session.cdp) {
      return browserError('performance_profile', 'BROWSER_NOT_OPEN', 'Open a page with browser_act, or pass url to performance_profile.');
    }
    if (capture.has('trace')) {
      try { trace = await startTrace(session.cdp); }
      catch (error) { limitations.push(`Tracing did not start: ${message(error)}`); }
    }
    if (capture.has('cpu')) {
      try { cpu = await startCpu(session.cdp); }
      catch (error) { limitations.push(`CPU profiler did not start: ${message(error)}`); }
    }
    if (capture.has('metrics')) {
      try {
        before = await enableMetrics(session.cdp);
        metricsOpen = true;
      } catch (error) {
        limitations.push(`Performance metrics did not start: ${message(error)}`);
      }
    }
    limitations.push(...await runActions(session, args.actions));
    const remain = duration - (Date.now() - startedAt);
    if (remain > 0 && session.page) {
      await session.page.waitForTimeout(remain).catch((error) => {
        limitations.push(`Wait interrupted: ${message(error)}`);
      });
    }
  } finally {
    await stopCollectors({
      cpu, trace, metricsOpen, session, profileBox, traceBox, metricsBox, limitations,
    });
    session.performanceBusy = false;
  }
  const metrics = before && metricsBox.after ? diffMetrics(before, metricsBox.after) : undefined;
  if (!traceBox.result && !profileBox.profile && !metrics) {
    return browserError(
      'performance_profile',
      'PROFILE_FAILED',
      limitations.join(' ') || 'No performance data was collected.',
      { limitations },
    );
  }
  const report = await buildPerformanceReport({
    trace: traceBox.result?.events || [],
    profile: profileBox.profile || null,
    metrics,
    limitations,
    durationMs: Date.now() - startedAt,
    resolver: session.sourceResolver(),
  });
  return browserOk('performance_profile', {
    summary: performanceSummaryText(report),
    report,
  });
}
