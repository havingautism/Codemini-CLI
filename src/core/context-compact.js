function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const message of messages || []) {
    const roleOverhead = 6;
    const text = textFromContent(message.content);
    total += roleOverhead + Math.ceil(text.length / 4);
  }
  return total;
}

function modeToKeepRecent(mode) {
  if (mode === 'aggressive') return 4;
  if (mode === 'conservative') return 10;
  return 6;
}

function buildLocalSummary(messages) {
  const lines = [];
  const limit = 12;
  for (const msg of messages.slice(-limit)) {
    const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const clipped = text.length > 160 ? `${text.slice(0, 160)}...` : text;
    lines.push(`- ${msg.role}: ${clipped}`);
  }
  return `Context Summary\n${lines.join('\n')}`.trim();
}

export function compactMessagesLocally(messages, { mode = 'default' } = {}) {
  const keepRecent = modeToKeepRecent(mode);
  if (!Array.isArray(messages) || messages.length <= keepRecent + 1) {
    return {
      compacted: [...(messages || [])],
      changed: false
    };
  }

  const older = messages.slice(0, Math.max(0, messages.length - keepRecent));
  const recent = messages.slice(Math.max(0, messages.length - keepRecent));
  const summary = buildLocalSummary(older);
  const compacted = [{ role: 'assistant', content: summary }, ...recent];

  return {
    compacted,
    changed: true,
    summary
  };
}

export function parseCompactArgs(args = []) {
  const parsed = {
    mode: 'default',
    preview: false,
    restore: false,
    auto: undefined,
    threshold: undefined
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--preview') parsed.preview = true;
    if (arg === '--restore') parsed.restore = true;
    if (arg === '--aggressive') parsed.mode = 'aggressive';
    if (arg === '--conservative') parsed.mode = 'conservative';
    if (arg === '--default') parsed.mode = 'default';
    if (arg === '--auto-on') parsed.auto = 'on';
    if (arg === '--auto-off') parsed.auto = 'off';
    if (arg === '--threshold') {
      const n = Number(args[i + 1]);
      if (!Number.isNaN(n)) parsed.threshold = n;
      i += 1;
    }
  }

  return parsed;
}
