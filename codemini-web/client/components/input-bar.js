import { h } from '../utils/dom.js';
import { t } from '../i18n/index.js';

export function createInputBar(container, { onSubmit, onAbort, onCompletionRequest }) {
  const wrapper = h('div', { className: 'input-wrapper' });
  const textarea = h('textarea', {
    className: 'input-field',
    placeholder: t('inputPlaceholder'),
    rows: '1',
    onKeyDown: handleKeyDown,
    onInput: handleInput
  });
  const abortBtn = h('button', {
    className: 'btn-abort',
    title: t('abort'),
    onClick: () => onAbort(),
    disabled: 'true'
  },
    h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none' },
      h('rect', { x: '3', y: '7', width: '10', height: '2', rx: '1', fill: 'currentColor' })
    )
  );
  const hint = h('div', { className: 'input-hint' });

  wrapper.append(textarea, abortBtn);
  container.className = 'input-area';
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
      const val = textarea.value.trim();
      if (!val) return;
      onSubmit(val);
      textarea.value = '';
      textarea.style.height = 'auto';
      historyIndex = -1;
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

  function setBusy(v) {
    busy = v;
    textarea.disabled = v;
    abortBtn.disabled = !v;
    textarea.placeholder = v ? t('inputDisabled') : t('inputPlaceholder');
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

  function focus() {
    textarea.focus();
  }

  return { setBusy, setHistory, setSuggestions, clearSuggestions, setHint, focus, get textarea() { return textarea; } };
}
