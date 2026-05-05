import { h, clear, escapeHtml } from '../utils/dom.js';

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
      { path: 'execution.mode', label: 'Mode', options: ['auto', 'normal', 'plan'] }
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

export function createConfigPanel(container, { onSave }) {
  return { container, onSave };
}

export function renderConfigPanel(panel, config) {
  const { container, onSave } = panel;
  clear(container);

  const wrapper = h('div', { className: 'panel' });
  wrapper.appendChild(h('div', { className: 'panel-title' }, 'Settings'));

  const inputs = new Map();

  for (const group of CONFIG_GROUPS) {
    const section = h('div', { className: 'config-group' });
    for (const key of group.keys) {
      const value = getNestedValue(config, key.path) ?? '';
      const row = h('div', { className: 'config-row' },
        h('label', { className: 'config-key' }, key.label)
      );

      let input;
      if (key.options) {
        input = h('select', { className: 'config-value', dataset: { path: key.path } });
        for (const opt of key.options) {
          const o = h('option', { value: opt }, opt);
          if (String(value) === opt) o.selected = true;
          input.appendChild(o);
        }
      } else {
        input = h('input', {
          className: 'config-value',
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
    wrapper.appendChild(section);
  }

  wrapper.appendChild(h('div', { className: 'action-row', style: { marginTop: '16px' } },
    h('button', { className: 'btn-primary', onClick: () => {
      const changes = [];
      for (const [path, { input, original }] of inputs) {
        const current = input.value;
        if (current !== original) {
          changes.push({ path, value: input.type === 'number' ? Number(current) : current });
        }
      }
      if (changes.length) onSave(changes);
      else alert('No changes detected.');
    } }, 'Save Changes')
  ));

  container.appendChild(wrapper);
}
