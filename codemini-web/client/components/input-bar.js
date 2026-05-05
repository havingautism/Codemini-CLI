import { h } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { icon } from '../utils/icons.js';

export function createInputBar(container, { onSubmit, onAbort, onCompletionRequest }) {
  const wrapper = h('div', { className: 'input-wrapper' });
  const topRow = h('div', { className: 'input-top-row' });
  const textarea = h('textarea', {
    className: 'input-field',
    placeholder: '可向 CodeMini 询问任何事。输入 @ 使用插件或提及文件',
    rows: '1',
    onKeyDown: handleKeyDown,
    onInput: handleInput
  });
  const toolbar = h('div', { className: 'input-toolbar' });
  const leftTools = h('div', { className: 'input-tool-group' },
    h('button', { className: 'input-icon-button', type: 'button', title: '添加上下文' },
      icon('Plus')
    ),
    h('button', { className: 'permission-button', type: 'button', title: '权限' },
      icon('ShieldCheck', { size: 16 }),
      h('span', { className: 'permission-label' }, '默认权限'),
      icon('ChevronDown', { size: 12 })
    )
  );
  const rightTools = h('div', { className: 'input-tool-group input-tool-group-right' },
    h('button', { className: 'model-button', type: 'button', title: '模型' },
      h('span', { className: 'model-loading' }, '正在加载模型'),
      icon('ChevronDown', { size: 12 })
    ),
    h('button', { className: 'input-icon-button', type: 'button', title: '语音输入' },
      icon('Mic')
    )
  );
  const sendBtn = h('button', {
    className: 'btn-send',
    title: '发送',
    type: 'button',
    onClick: () => submitCurrent()
  },
    icon('ArrowUp')
  );
  const abortBtn = h('button', {
    className: 'btn-abort',
    title: t('abort'),
    onClick: () => onAbort(),
    disabled: 'true'
  },
    icon('Minus', { size: 16 })
  );
  const hint = h('div', { className: 'input-hint' });
  const modelLabel = rightTools.querySelector('.model-loading');
  const permissionLabel = leftTools.querySelector('.permission-label');

  topRow.append(textarea);
  toolbar.append(leftTools, rightTools, sendBtn, abortBtn);
  wrapper.append(topRow, toolbar);
  container.classList.add('input-bar');
  container.append(wrapper, hint);

  let history = [];
  let historyIndex = -1;
  let draftBeforeHistory = '';
  let busy = false;
  let suggestions = [];
  let selectedSuggestion = -1;

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCurrent();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (suggestions.length > 0) return;
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIndex === -1) draftBeforeHistory = textarea.value;
      historyIndex = Math.min(historyIndex + 1, history.length - 1);
      textarea.value = history[historyIndex];
      return;
    }
    if (e.key === 'ArrowDown') {
      if (suggestions.length > 0) return;
      if (historyIndex === -1) return;
      e.preventDefault();
      historyIndex--;
      if (historyIndex < 0) {
        textarea.value = draftBeforeHistory;
        historyIndex = -1;
      } else {
        textarea.value = history[historyIndex];
      }
      return;
    }
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      const idx = selectedSuggestion >= 0 ? selectedSuggestion : 0;
      textarea.value = suggestions[idx].value + ' ';
      clearSuggestions();
      return;
    }
    if (e.key === 'Escape') {
      clearSuggestions();
    }
  }

  function handleInput() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    const val = textarea.value;
    if (val.startsWith('/')) {
      onCompletionRequest(val);
    } else {
      clearSuggestions();
    }
  }

  function submitCurrent() {
    const val = textarea.value.trim();
    if (!val || busy) return;
    onSubmit(val);
    textarea.value = '';
    textarea.style.height = 'auto';
    historyIndex = -1;
  }

  function setBusy(v) {
    busy = v;
    textarea.disabled = v;
    abortBtn.disabled = !v;
    sendBtn.disabled = v;
    textarea.placeholder = v ? t('inputDisabled') : '可向 CodeMini 询问任何事。输入 @ 使用插件或提及文件';
  }

  function setHistory(h) {
    history = Array.isArray(h) ? [...h].reverse() : [];
    historyIndex = -1;
  }

  function setSuggestions(opts) {
    suggestions = opts || [];
    selectedSuggestion = -1;
  }

  function clearSuggestions() {
    suggestions = [];
    selectedSuggestion = -1;
  }

  function setHint(text) {
    hint.textContent = text || '';
  }

  function setRuntimeState(rs) {
    if (!rs) return;
    if (modelLabel) modelLabel.textContent = rs.model || '未选择模型';
    if (permissionLabel) {
      const mode = rs.mode || 'auto';
      permissionLabel.textContent = mode === 'plan' ? '计划权限' : mode === 'normal' ? '普通权限' : '默认权限';
    }
  }

  function focus() {
    textarea.focus();
  }

  return { setBusy, setHistory, setSuggestions, clearSuggestions, setHint, setRuntimeState, focus, get textarea() { return textarea; } };
}
