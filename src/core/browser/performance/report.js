import { isLibraryPath } from '../sourcemap.js';
import { analyzeCpuProfile } from './cpu-analyze.js';
import { analyzeTrace } from './trace-analyze.js';

const NON_APP_URL = /^(chrome-extension:|devtools:|node:|native\b|wasm:)/;

function nonApp(file, url) {
  const value = `${file || ''} ${url || ''}`;
  return isLibraryPath(value) || NON_APP_URL.test(String(url || '')) || NON_APP_URL.test(String(file || ''));
}

async function mapFrame(resolver, frame) {
  if (!frame || (!frame.url && !frame.scriptId)) return null;
  const located = resolver ? await resolver.locate({
    scriptId: frame.scriptId || '',
    url: frame.url || '',
    line: frame.lineNumber ?? 0,
    column: frame.columnNumber ?? 0,
    oneBased: false,
  }) : null;
  if (!located) {
    return {
      file: frame.url || '',
      line: (frame.lineNumber ?? 0) + 1,
      column: (frame.columnNumber ?? 0) + 1,
      generatedUrl: frame.url || '',
      attribution: 'unmapped',
    };
  }
  const generatedUrl = located.generatedUrl || frame.url || '';
  const mapped = Boolean(located.file) && located.file !== generatedUrl && !/^[a-z]+:/i.test(located.file);
  return {
    file: located.file || generatedUrl,
    line: located.line,
    column: located.column,
    generatedUrl,
    attribution: nonApp(located.file, generatedUrl) ? 'third-party' : (mapped ? 'app' : 'unmapped'),
  };
}

function sourceOf(mapped) {
  if (!mapped?.file) return undefined;
  return { file: mapped.file, line: mapped.line, column: mapped.column };
}

function issuesFrom(longTasks, hotspots) {
  const issues = [];
  for (const task of longTasks) {
    issues.push({
      type: 'long-task',
      severity: task.duration >= 180 ? 'high' : 'medium',
      description: `Main-thread ${task.name || 'task'} lasted ${task.duration}ms in this window. This is a lead, not a confirmed root cause.`,
      ...(task.source ? { source: task.source } : {}),
    });
  }
  for (const hotspot of hotspots) {
    if (hotspot.attribution === 'third-party') continue;
    if (hotspot.selfTime < 15 || hotspot.percentage < 8) continue;
    issues.push({
      type: 'hot-function',
      severity: hotspot.percentage >= 30 ? 'high' : 'medium',
      description: `${hotspot.functionName} accounts for about ${hotspot.percentage}% of sampled JavaScript time. Sampled self time is ${hotspot.selfTime}ms. Inspect the mapped source before changing it.`,
      ...(hotspot.source ? { source: hotspot.source } : {}),
    });
    if (issues.length >= 10) break;
  }
  return issues.slice(0, 10);
}

export async function buildPerformanceReport({
  trace = [],
  profile = null,
  metrics,
  limitations = [],
  durationMs = 0,
  resolver = null,
} = {}) {
  const analyzed = analyzeTrace(trace);
  const cpu = profile ? analyzeCpuProfile(profile) : { hotspots: [] };
  const longTasks = [];
  for (const task of analyzed.longTasks) {
    const mapped = await mapFrame(resolver, task.frame);
    longTasks.push({
      startTime: task.startTime,
      duration: task.duration,
      ...(mapped ? { source: sourceOf(mapped) } : {}),
    });
  }
  const hotspots = [];
  for (const hotspot of cpu.hotspots) {
    const mapped = await mapFrame(resolver, hotspot.frame);
    hotspots.push({
      functionName: hotspot.functionName,
      selfTime: hotspot.selfTime,
      totalTime: hotspot.totalTime,
      percentage: hotspot.percentage,
      sampled: true,
      attribution: mapped?.attribution || 'unmapped',
      ...(mapped?.generatedUrl ? { generatedUrl: mapped.generatedUrl } : {}),
      ...(sourceOf(mapped) ? { source: sourceOf(mapped) } : {}),
    });
  }
  const notes = [
    'CPU self time and total time are sampled estimates, not exact function durations.',
    'estimatedBlockingTime covers this requested interaction window. It is not Lighthouse total blocking time.',
    'A hotspot or long task is an investigation lead, not a confirmed root cause.',
    ...limitations,
  ];
  return {
    summary: {
      duration: durationMs,
      longTaskCount: longTasks.length,
      ...(analyzed.estimatedBlockingTime != null
        ? { estimatedBlockingTime: analyzed.estimatedBlockingTime }
        : {}),
    },
    ...(metrics && Object.keys(metrics).length ? { metrics } : {}),
    longTasks,
    hotspots,
    issues: issuesFrom(longTasks.map((task, index) => ({
      ...task,
      name: analyzed.longTasks[index]?.name,
    })), hotspots),
    limitations: notes,
  };
}

export function performanceSummaryText(report) {
  const count = report?.summary?.longTaskCount || 0;
  const blocking = report?.summary?.estimatedBlockingTime;
  const top = (report?.hotspots || []).find((item) => item.attribution !== 'third-party') || report?.hotspots?.[0];
  const taskText = count
    ? `${count} main-thread task${count === 1 ? '' : 's'} over 50ms${blocking != null ? ` (estimated blocking ${blocking}ms)` : ''}`
    : 'No main-thread task over 50ms in this window';
  const hotText = top
    ? ` Top sampled hotspot ${top.functionName} ${top.selfTime}ms self${top.source?.file ? ` at ${top.source.file}:${top.source.line}` : ''}.`
    : '.';
  return `${taskText}.${hotText} CPU times are samples. Blocking time is for this window only, not Lighthouse TBT.`.replace('..', '.');
}
