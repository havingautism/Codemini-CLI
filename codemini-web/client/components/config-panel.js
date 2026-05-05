import { h, clear, escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

const CONFIG_GROUPS = [
  {
    title: 'Gateway',
    keys: [
      { path: 'gateway.base_url', label: 'Base URL', placeholder: 'http://127.0.0.1:8000/v1' },
      { path: 'gateway.api_key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { path: 'gateway.timeout_ms', label: 'Timeout (ms)', type: 'number' },
      { path: 'gateway.max_retries', label: 'Max Retries', type: 'number' }
    ]
  },
  {
    title: 'Model',
    keys: [
      { path: 'model.name', label: 'Model Name', placeholder: 'gpt-4.1-mini' },
      { path: 'model.fast_name', label: 'Fast Model Name', placeholder: 'fallback to Model Name when empty' },
      { path: 'model.max_context_tokens', label: 'Max Context Tokens', type: 'number' }
    ]
  },
  {
    title: 'SDK',
    keys: [
      { path: 'sdk.provider', label: 'Provider', options: ['openai-compatible', 'anthropic'] }
    ]
  },
  {
    title: 'Execution',
    keys: [
      { path: 'execution.mode', label: 'Mode', options: ['normal', 'auto', 'plan'] }
    ]
  },
  {
    title: 'Shell',
    keys: [
      { path: 'shell.default', label: 'Default Shell', options: ['bash', 'powershell', 'zsh', 'cmd'] }
    ]
  },
  {
    title: 'UI',
    keys: [
      { path: 'ui.language', label: 'UI Language', options: ['zh', 'en'] },
      { path: 'ui.reply_language', label: 'Reply Language', options: ['zh', 'en'] }
    ]
  }
];

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function createConfigPanel(container, { onSave, onClose }) {
  return { container, onSave, onClose };
}

export function renderConfigPanel(panel, config) {
  const { container, onSave, onClose } = panel;
  clear(container);

  const backdrop = h('div', { className: 'config-backdrop' });
  const dialog = h('div', { className: 'config-dialog' });

  const header = h('div', { className: 'config-dialog-header' },
    h('span', { className: 'config-dialog-title' }, '设置'),
    h('button', { className: 'config-dialog-close', type: 'button', onClick: () => onClose?.() },
      icon('X', { size: 18 })
    )
  );

  const body = h('div', { className: 'config-dialog-body' });
  const inputs = new Map();

  for (const group of CONFIG_GROUPS) {
    const section = h('div', { className: 'config-section' },
      h('div', { className: 'config-section-title' }, group.title)
    );
    for (const key of group.keys) {
      const value = getNestedValue(config, key.path) ?? '';
      const row = h('div', { className: 'config-field' },
        h('label', { className: 'config-field-label' }, key.label)
      );
      let input;
      if (key.options) {
        input = h('select', { className: 'config-field-input config-field-select', dataset: { path: key.path } });
        for (const opt of key.options) {
          const o = h('option', { value: opt }, opt);
          if (String(value) === opt) o.selected = true;
          input.appendChild(o);
        }
      } else {
        input = h('input', {
          className: 'config-field-input',
          type: key.type || 'text',
          value: String(value),
          placeholder: key.placeholder || '',
          dataset: { path: key.path }
        });
      }
      inputs.set(key.path, { input, original: String(value) });
      row.appendChild(input);
      section.appendChild(row);
    }
    body.appendChild(section);
  }

  const footer = h('div', { className: 'config-dialog-footer' },
    h('button', { className: 'btn-secondary', type: 'button', onClick: () => onClose?.() }, '取消'),
    h('button', { className: 'btn-primary config-save-btn', type: 'button', onClick: () => {
      const changes = [];
      for (const [path, { input, original }] of inputs) {
        const current = input.value;
        if (current !== original) {
          changes.push({ path, value: input.type === 'number' ? Number(current) : current });
        }
      }
      if (changes.length) { onSave(changes); onClose?.(); }
    } }, '保存更改')
  );

  dialog.append(header, body, footer);
  backdrop.appendChild(dialog);
  container.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) onClose?.();
  });
}
