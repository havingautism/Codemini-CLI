import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, ShieldCheck, ChevronDown, ArrowUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '../../i18n/index.js';

export function InputBar({ onSubmit, onAbort, busy, runtimeState, history: externalHistory, onCompletionRequest }) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState('');
  const textareaRef = useRef(null);

  const rs = runtimeState || {};
  const mode = rs.mode || 'normal';

  useEffect(() => {
    if (externalHistory && externalHistory.length && history.length === 0) {
      setHistory([...externalHistory].reverse());
    }
  }, [externalHistory]);

  const submitCurrent = useCallback(() => {
    const val = value.trim();
    if (!val || busy) return;
    onSubmit(val);
    setValue('');
    setHistoryIndex(-1);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, busy, onSubmit]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCurrent();
      return;
    }
    if (e.key === 'ArrowUp' && history.length > 0) {
      e.preventDefault();
      if (historyIndex === -1) setDraftBeforeHistory(value);
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setValue(history[next]);
      return;
    }
    if (e.key === 'ArrowDown' && historyIndex !== -1) {
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setValue(next < 0 ? draftBeforeHistory : history[next]);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
    }
  }, [value, history, historyIndex, draftBeforeHistory, submitCurrent]);

  const handleInput = useCallback((e) => {
    const val = e.target.value;
    setValue(val);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
    if (val.startsWith('/') && onCompletionRequest) {
      onCompletionRequest(val);
    }
  }, [onCompletionRequest]);

  return (
    <div className="w-full">
      <div
        className="flex flex-col gap-2 p-[12px_14px_10px] border border-(--border-strong) rounded-2xl bg-(--bg-input)"
        style={{ boxShadow: 'var(--shadow-default)' }}
      >
        <div className="flex min-h-[32px]">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={busy ? t('inputDisabled') : '可向 CodeMini 询问任何事。输入 @ 使用插件或提及文件'}
            disabled={busy}
            rows={1}
            className="flex-1 resize-none border-0 outline-none bg-transparent text-(--text-primary) min-h-[32px] max-h-[160px] p-0 leading-[1.5] text-[14px] placeholder:text-(--text-muted) disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ height: 'auto' }}
          />
        </div>
        <div className="flex items-center gap-1.5 min-h-[30px] flex-wrap">
          <div className="flex items-center gap-1">
            <button type="button" className="border-0 bg-transparent text-(--text-muted) min-w-[30px] h-[30px] rounded-lg inline-flex items-center justify-center shrink-0 cursor-pointer hover:bg-(--bg-hover) hover:text-(--text-primary)" title="添加上下文">
              <Plus size={16} />
            </button>
            <button type="button" className="border-0 bg-transparent text-(--text-muted) w-auto px-2 h-[30px] rounded-lg inline-flex items-center justify-center gap-1 shrink-0 cursor-pointer text-[12px] whitespace-nowrap hover:bg-(--bg-hover) hover:text-(--text-primary)" title="权限">
              <ShieldCheck size={14} />
              <span className="truncate">{mode === 'plan' ? '计划' : mode === 'normal' ? '普通' : '自动'}</span>
              <ChevronDown size={11} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <button type="button" className="border-0 bg-transparent text-(--text-muted) w-auto px-2 h-[30px] rounded-lg inline-flex items-center justify-center gap-1 shrink-0 cursor-pointer text-[12px] whitespace-nowrap hover:bg-(--bg-hover) hover:text-(--text-primary)" title="模型">
              <span className={cn('truncate', !rs.model && 'opacity-50')}>{rs.model || '加载中'}</span>
              <ChevronDown size={11} />
            </button>
            {busy ? (
              <button type="button" className="border-0 text-(--accent-red) min-w-[32px] h-[32px] rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer bg-(--accent-red-bg) hover:opacity-80" onClick={onAbort} title={t('abort')}>
                <Minus size={14} />
              </button>
            ) : (
              <button type="button" className={cn('border-0 min-w-[34px] w-[34px] h-[34px] rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition-all', value.trim() ? 'bg-(--text-primary) text-(--bg-primary) hover:opacity-90' : 'bg-(--text-muted)/30 text-(--bg-primary) cursor-not-allowed')} onClick={submitCurrent} disabled={!value.trim()} title="发送">
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
