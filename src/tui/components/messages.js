import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Image, Markdown, Spacer, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

import { bold, color, markdownTheme } from '../theme.js';

export function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map((part) => typeof part === 'string' ? part : part?.type === 'text' ? part.text || '' : '').join('');
}

export function linkMarkdownImages(text) {
  return String(text || '').replace(/!\[([^\]]*)\]\((<[^>\r\n]+>|[^)\r\n]+)\)/g, (_match, alt, rawTarget) => {
    let target = String(rawTarget || '').trim().replace(/^<|>$/g, '');
    target = target.replace(/\s+["'][^"']*["']$/, '');
    const label = String(alt || '').trim() || path.basename(target) || 'image';
    if (/^data:/i.test(target)) return `🖼 ${label}`;
    const href = path.isAbsolute(target)
      ? pathToFileURL(target).href
      : /^[a-z][a-z\d+.-]*:/i.test(target)
        ? target
        : pathToFileURL(path.resolve(target)).href;
    return `[🖼 ${label}](<${href}>)`;
  });
}

function messageImages(message) {
  const images = Array.isArray(message?.model_images) ? message.model_images : [];
  return images.filter((image) => image?.data).map((image) => new Image(
    image.data,
    image.mime || 'image/jpeg',
    { fallbackColor: color.muted },
    { filename: image.filename || image.path || image.name, maxWidthCells: 64, maxHeightCells: 18 }
  ));
}

export function oneLine(value, max = 120) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function toolEventKey(event, type) {
  return String(event?.id || `${String(type || '').split(':')[0]}:${event?.name || 'tool'}`);
}

function formatDuration(durationMs) {
  const value = Math.max(0, Number(durationMs) || 0);
  return value < 1000 ? `${Math.round(value)}ms` : `${Math.round(value / 100) / 10}s`;
}

function surfaceLine(text, width, background = color.surfaceBg, indent = 1) {
  const safe = wrapTextWithAnsi(text, Math.max(1, width - indent - 1));
  return safe.map((line) => background(
    `${' '.repeat(indent)}${line}${' '.repeat(Math.max(0, width - visibleWidth(line) - indent))}`
  ));
}

export class ToolCall {
  constructor(event, copy) {
    this.event = { ...event };
    this.copy = copy;
    this.state = 'pending';
    this.expanded = false;
  }

  invalidate() {}

  update(event, state) {
    this.event = { ...this.event, ...event };
    this.state = state;
  }

  setExpanded(expanded) {
    this.expanded = expanded;
  }

  render(width) {
    const icon = this.state === 'success' ? '✓' : this.state === 'error' ? '✗' : '●';
    const style = this.state === 'success' ? color.success : this.state === 'error' ? color.error : color.warning;
    const background = this.state === 'error' ? color.toolErrorBg : color.surfaceBg;
    const event = this.event;
    const name = String(event.displayName || event.name || 'tool');
    const detail = event.summary || event.arguments;
    const suffix = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : '';
    const duration = Number.isFinite(Number(event.durationMs)) ? color.dim(`  ${formatDuration(event.durationMs)}`) : '';
    const header = `${color.dim('│')} ${bold(style(`${icon} ${name}${suffix ? `  ${oneLine(suffix, 100)}` : ''}`))}${duration}`;
    const fill = (line, indent = 1) => background(
      `${' '.repeat(indent)}${line}${' '.repeat(Math.max(0, width - visibleWidth(line) - indent))}`
    );
    const lines = wrapTextWithAnsi(header, Math.max(1, width - 2)).map((line) => fill(line));
    if (!this.expanded) return lines;

    const sections = [];
    if (event.arguments != null) sections.push([this.copy?.detailArguments || 'arguments', event.arguments]);
    if (event.summary) sections.push([this.copy?.detailResult || 'result', event.summary]);
    if (event.fileChange) sections.push([this.copy?.detailChange || 'change', event.fileChange]);
    if (Array.isArray(event.fileChanges) && event.fileChanges.length) sections.push([this.copy?.detailChanges || 'changes', event.fileChanges]);
    for (const [label, value] of sections) {
      const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const body = `${color.dim(`${label}:`)} ${color.text(content)}`;
      lines.push(...wrapTextWithAnsi(body, Math.max(1, width - 4)).slice(0, 12).map((line) => fill(line, 3)));
    }
    return lines;
  }
}

export class ToolCallGroup {
  constructor(copy) {
    this.rows = [];
    this.copy = copy;
    this.expanded = false;
  }

  invalidate() {
    for (const row of this.rows) row.invalidate();
  }

  add(event) {
    const row = new ToolCall(event, this.copy);
    row.setExpanded(this.expanded);
    this.rows.push(row);
    return row;
  }

  setExpanded(expanded) {
    this.expanded = expanded;
    for (const row of this.rows) row.setExpanded(expanded);
  }

  render(width) {
    const errors = this.rows.filter((row) => row.state === 'error').length;
    const pending = this.rows.filter((row) => row.state === 'pending').length;
    const state = errors ? 'error' : pending ? 'pending' : 'success';
    const icon = state === 'error' ? '✗' : state === 'pending' ? '●' : '✓';
    const style = state === 'error' ? color.error : state === 'pending' ? color.warning : color.success;
    const count = this.rows.length;
    const counts = new Map();
    for (const row of this.rows) {
      const name = String(row.event.displayName || row.event.name || 'tool').replaceAll('_', ' ');
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const names = counts.size <= 3
      ? [...counts.entries()].map(([name, amount]) => `${name}${amount > 1 ? ` ×${amount}` : ''}`).join(' · ')
      : '';
    const suffix = errors
      ? ` · ${this.copy?.failed?.(errors) || `${errors} failed`}`
      : pending ? ` · ${this.copy?.running?.(pending) || `${pending} running`}` : '';
    const marker = this.expanded ? '▾' : '▸';
    const label = this.copy?.toolCalls?.(count) || `${count} tool call${count === 1 ? '' : 's'}`;
    const title = `${bold(style(`${marker} ${icon} ${label}${suffix}`))}${names ? color.dim(`  ${names}`) : ''}`;
    const header = surfaceLine(title, width, color.surfaceBg);
    if (!this.expanded) return [...header, ''];
    return [...header, ...this.rows.flatMap((row) => row.render(width)), ''];
  }
}

export class ReasoningBlock {
  constructor(copy, text = '', { complete = false, durationMs = 0 } = {}) {
    this.copy = copy;
    this.text = text;
    this.complete = complete;
    this.expanded = false;
    this.startedAt = Date.now() - durationMs;
    this.durationMs = durationMs;
  }

  invalidate() {}
  append(text) { this.text += String(text || ''); }
  setExpanded(expanded) { this.expanded = expanded; }
  finish() {
    if (this.complete) return;
    this.complete = true;
    this.durationMs = Math.max(this.durationMs, Date.now() - this.startedAt);
  }

  render(width) {
    const marker = this.expanded ? '▾' : '▸';
    const label = this.complete
      ? this.copy.reasoningDone(formatDuration(this.durationMs))
      : this.copy.reasoningLive;
    const preview = !this.complete && this.text ? `  ${oneLine(this.text, Math.max(20, width - 28))}` : '';
    const header = surfaceLine(`${color.purple(marker)} ${color.muted(label)}${color.dim(preview)}`, width);
    if (!this.expanded || !this.text) return [...header, ''];
    const body = wrapTextWithAnsi(color.dim(this.text.trim()), Math.max(1, width - 4)).slice(0, 24);
    return [...header, ...body.map((line) => `${color.dim('│')}  ${line}`), ''];
  }
}

export class ProcessedFold {
  constructor(copy) {
    this.copy = copy;
    this.children = [];
    this.complete = false;
    this.bodyOnly = true;
  }

  addChild(component) { this.children.push(component); }
  finish() { this.complete = true; }
  setBodyOnly(bodyOnly) { this.bodyOnly = bodyOnly; }
  invalidate() { for (const child of this.children) child.invalidate(); }

  render(width) {
    const content = this.children.flatMap((child) => child.render(width));
    if (!this.complete) return content;
    const marker = this.bodyOnly ? '▸' : '▾';
    const action = this.bodyOnly ? this.copy.showFull : this.copy.showBodyOnly;
    const header = surfaceLine(`${color.purple(marker)} ${color.muted(this.copy.processed)}  ${color.dim(action)}`, width);
    const lines = this.bodyOnly ? header : [...header, ...content];
    return lines.at(-1) === '' ? lines : [...lines, ''];
  }
}

export class PlanProgress {
  constructor(copy, event) {
    this.copy = copy;
    this.goal = String(event.goal || '');
    this.steps = (event.steps || []).map((step, index) => ({
      index: Number(step.index || index + 1),
      title: String(step.title || step.role || `Step ${index + 1}`),
      role: String(step.role || ''),
      status: String(step.status || 'pending')
    }));
  }

  invalidate() {}

  update(event) {
    const index = Number(event.step || event.index);
    const step = this.steps.find((item) => item.index === index);
    if (!step) return;
    step.status = event.type === 'plan:step_done' ? String(event.status || 'done') : String(event.status || 'running');
    if (event.title) step.title = String(event.title);
    if (event.role) step.role = String(event.role);
  }

  render(width) {
    const done = this.steps.filter((step) => step.status === 'done' || step.status === 'completed').length;
    const header = surfaceLine(`${bold(color.accent(this.copy.plan))}  ${color.muted(`${done}/${this.steps.length}`)}${this.goal ? `  ${color.dim(oneLine(this.goal, 72))}` : ''}`, width, color.surfaceRaisedBg);
    const lines = this.steps.map((step) => {
      const icon = step.status === 'running' ? color.purple('●') : step.status === 'done' || step.status === 'completed' ? color.success('✓') : step.status === 'failed' || step.status === 'error' ? color.error('✗') : color.dim('○');
      return ` ${icon} ${color.text(oneLine(step.title, Math.max(20, width - 18)))}${step.role ? color.dim(`  ${step.role}`) : ''}`;
    });
    return [...header, ...lines];
  }
}

class UserMessage {
  constructor(text) {
    this.markdown = new Markdown(text, 0, 0, markdownTheme, { color: color.text }, {
      preserveOrderedListMarkers: true,
      preserveBackslashEscapes: true
    });
  }

  invalidate() { this.markdown.invalidate(); }

  render(width) {
    const frameWidth = Math.max(8, width);
    const innerWidth = frameWidth - 4;
    const label = bold(color.accent(' YOU '));
    const top = `${color.border('╭─')}${label}${color.border(`${'─'.repeat(Math.max(0, frameWidth - visibleWidth(label) - 3))}╮`)}`;
    const body = this.markdown.render(innerWidth).map((line) => {
      const padding = ' '.repeat(Math.max(0, innerWidth - visibleWidth(line)));
      return `${color.border('│')} ${line}${padding} ${color.border('│')}`;
    });
    const bottom = color.border(`╰${'─'.repeat(frameWidth - 2)}╯`);
    return [`\u001b]133;A\u0007${top}`, ...body, bottom];
  }
}

class AssistantMessage {
  constructor(text = '') {
    this.markdown = new Markdown(linkMarkdownImages(text), 1, 0, markdownTheme, { color: color.text });
  }

  invalidate() { this.markdown.invalidate(); }
  setText(text) { this.markdown.setText(linkMarkdownImages(text)); }
  render(width) { return this.markdown.render(width); }
}

class SystemNotice {
  constructor(text, style) {
    this.text = text;
    this.style = style;
  }

  invalidate() {}
  render(width) { return wrapTextWithAnsi(`${color.dim('•')} ${this.style(this.text)}`, width); }
}

export function createUserMessage(text) {
  return new UserMessage(text);
}

export function createAssistantMessage(text = '') {
  return new AssistantMessage(text);
}

export function createSystemMessage(text, style = color.muted) {
  return new SystemNotice(text, style);
}

export function appendHistory(transcript, history, copy, { bodyOnly = true, expanded = false } = {}) {
  const processFolds = [];
  const reasoningBlocks = [];
  const toolGroups = [];
  const toolResults = new Map(history
    .filter((message) => message?.role === 'tool' && message.tool_call_id)
    .map((message) => [String(message.tool_call_id), message]));

  const appendTurn = (messages, grouped = true) => {
    if (!grouped) {
      for (const message of messages) appendTurn([message]);
      return;
    }
    if (!messages.some((message) => message?.role === 'assistant')) {
      for (const message of messages) {
        const text = message?.role === 'system' ? messageText(message.content).trim() : '';
        if (!text) continue;
        transcript.addChild(new Spacer(1));
        transcript.addChild(createSystemMessage(text));
      }
      return;
    }
    const finalAssistant = messages.findLast((message) => message?.role === 'assistant' && messageText(message.content).trim());
    const fold = new ProcessedFold(copy);
    for (const message of messages) {
      if (message?.role === 'tool') continue;
      const text = messageText(message?.content).trim();
      if (message?.role === 'system') {
        if (text) fold.addChild(createSystemMessage(text));
        continue;
      }
      if (message?.role !== 'assistant') continue;
      if (message.reasoning_content) {
        const reasoning = new ReasoningBlock(copy, String(message.reasoning_content), {
          complete: true,
          durationMs: Number(message.reasoning_duration_ms || 0)
        });
        reasoning.setExpanded(expanded);
        reasoningBlocks.push(reasoning);
        fold.addChild(reasoning);
      }
      if (message.tool_calls?.length) {
        const group = new ToolCallGroup(copy);
        group.setExpanded(expanded);
        for (const call of message.tool_calls) {
          const fn = call?.function || call || {};
          const result = toolResults.get(String(call?.id || '')) || {};
          const event = {
            id: call?.id,
            name: fn.name || call?.name || 'tool',
            arguments: fn.arguments ?? call?.arguments,
            summary: result.tool_summary || oneLine(result.content, 160),
            durationMs: result.tool_duration_ms
          };
          group.add(event).update(event, result.tool_status === 'error' ? 'error' : 'success');
        }
        toolGroups.push(group);
        fold.addChild(group);
      }
      if (text && message !== finalAssistant) {
        if (fold.children.length) fold.addChild(new Spacer(1));
        fold.addChild(createAssistantMessage(text));
      }
    }

    if (fold.children.length) {
      fold.finish();
      fold.setBodyOnly(bodyOnly);
      processFolds.push(fold);
      transcript.addChild(new Spacer(1));
      transcript.addChild(fold);
    }
    const finalText = messageText(finalAssistant?.content).trim();
    if (finalText) {
      if (!fold.children.length) transcript.addChild(new Spacer(1));
      transcript.addChild(createAssistantMessage(finalText));
    }
  };

  let turn = [];
  let hasUserBoundary = false;
  for (const message of history) {
    if (message?.role !== 'user') {
      turn.push(message);
      continue;
    }
    appendTurn(turn, hasUserBoundary);
    turn = [];
    hasUserBoundary = true;
    const text = messageText(message.content).trim();
    const images = messageImages(message);
    if (!text && !images.length) continue;
    transcript.addChild(new Spacer(1));
    transcript.addChild(createUserMessage(text || copy.imageAttachment));
    for (const image of images) transcript.addChild(image);
  }
  appendTurn(turn, hasUserBoundary);
  return { processFolds, reasoningBlocks, toolGroups };
}
