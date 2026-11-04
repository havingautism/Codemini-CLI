import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProjectSelector } from '@/components/ProjectSelector.jsx';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { projectOptions, timeZoneOptions } from '@/lib/workspace-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialog } from '@/components/ConfirmDialog.jsx';
import { CheckCircle, Clock, DotsThreeVertical, FolderSimple, GridFour, Info, ListBullets, MagnifyingGlass, PencilSimple, Play, Plus, Trash, WarningCircle } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { getApprovalModeOptions } from '@/lib/settings-options';
import { splitEmojiTitle } from '@/lib/emoji-title';
import {
  createScheduledTaskForm, latestScheduledRuns, scheduledFrequencyLabel, scheduledTaskFormPayload,
  scheduledTaskNeedsReschedule, scheduledTaskState, scheduledTaskTone, visibleScheduledRuns, visibleScheduledTasks, scheduledAttentionKey,
} from '@/lib/scheduled-task-ui';
import * as api from '@/hooks/use-api';
import { getLocale, t } from '../../i18n/index.js';

const FILTERS = ['all', 'enabled', 'paused', 'attention', 'history'];
const dateLabel = value => value ? new Date(value).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—';
const fullDateLabel = value => value ? new Date(value).toLocaleString() : '—';
const frequencyLabel = schedule => scheduledFrequencyLabel(schedule, t, dateLabel);
const isActive = run => ['queued', 'running'].includes(run?.status);

function TaskStatus({ status }) {
  const Icon = status === 'completed' ? CheckCircle
    : ['failed', 'needs_attention', 'interrupted'].includes(status) ? WarningCircle : Clock;
  const label = status === 'enabled' ? t('scheduledEnabled') : status === 'paused' ? t('scheduledPaused') : t(`scheduledStatus_${status}`);
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium leading-4',
      status === 'completed' ? 'bg-(--accent-green-bg) text-(--accent-green)'
        : status === 'failed' ? 'bg-(--accent-red-bg) text-(--accent-red)'
          : ['needs_attention', 'interrupted'].includes(status) ? 'bg-(--accent-orange-bg) text-(--accent-orange)'
            : isActive({ status }) ? 'bg-(--accent-blue-bg) text-(--accent-blue)'
              : 'bg-(--bg-primary)/40 text-(--text-secondary)')}>
      <Icon size={12} aria-hidden="true" /><span className="truncate">{label}</span>
    </span>
  );
}

function TaskChoice({ id, value, onChange, options }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function TaskEditor({ task, projectDir, busy, error, onSave, onCancel }) {
  const prefix = useId();
  const [form, setForm] = useState(() => createScheduledTaskForm(task, projectDir));
  const [validationError, setValidationError] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectError, setProjectError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.fetchWebuiActiveProjects().then(result => { if (!cancelled) setProjects(result.active || []); })
      .catch(err => { if (!cancelled) setProjectError(err.message); });
    return () => { cancelled = true; };
  }, []);
  const locale = getLocale();
  const zones = useMemo(() => timeZoneOptions(locale, form.timeZone), [locale, form.timeZone]);
  const workspaces = [{ value: '', label: t('scheduledGeneral') }, ...projectOptions(projects, form.projectDir)];
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const field = (key, label, control) => (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={`${prefix}-${key}`} className="text-[12px] font-medium text-(--text-secondary)">{label}</label>
      {control}
    </div>
  );
  const submit = event => {
    event.preventDefault();
    setValidationError('');
    try { onSave(scheduledTaskFormPayload(form, task)); }
    catch { setValidationError(t('scheduledInvalidTime')); }
  };
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <fieldset disabled={busy} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-1">
        {(error || validationError) && <p role="alert" className="rounded-xl bg-(--accent-red-bg) px-4 py-3 text-[12px] text-(--accent-red)">{validationError || error}</p>}
        {field('prompt', t('scheduledPrompt'), <Textarea id={`${prefix}-prompt`} value={form.prompt} rows={5} required autoFocus maxLength={50000} placeholder={t('scheduledPromptHint')} onChange={event => set('prompt', event.target.value)} />)}
        <p className="text-[12px] leading-5 text-(--text-muted)">{t('scheduledAutoTitleHint')}</p>
        {field('approval', t('approvalMode'), <TaskChoice id={`${prefix}-approval`} value={form.approvalMode} onChange={value => set('approvalMode', value)} options={getApprovalModeOptions().map(option => [option.value, option.label])} />)}
        <p className="text-[12px] leading-5 text-(--text-muted)">{getApprovalModeOptions().find(option => option.value === form.approvalMode)?.description} {t('scheduledApprovalHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('mode', t('executionMode'), <TaskChoice id={`${prefix}-mode`} value={form.mode} onChange={value => set('mode', value)} options={['normal', 'plan'].map(mode => [mode, t(`scheduledMode_${mode}`)])} />)}
          {field('project', t('scheduledProject'), <SearchableSelect id={`${prefix}-project`} value={form.projectDir} options={workspaces} onChange={value => set('projectDir', value)} searchPlaceholder={t('projectSearch')} emptyText={t('scheduledNoResults')} footer={{ label: t('projectBrowse'), onClick: () => setProjectPickerOpen(true) }} />)}
        </div>
        <div className="border-t border-(--separator) pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('repeat', t('scheduledFrequency'), <TaskChoice id={`${prefix}-repeat`} value={form.type} onChange={value => set('type', value)} options={['once', 'interval', 'daily', 'weekly'].map(type => [type, t(`scheduledFrequency_${type}`)])} />)}
            {form.type === 'once' ? field('at', t('scheduledAt'), <Input id={`${prefix}-at`} type="datetime-local" value={form.at} required onChange={event => set('at', event.target.value)} />)
              : form.type === 'interval' ? field('minutes', t('scheduledMinutes'), <Input id={`${prefix}-minutes`} type="number" min={1} max={525600} step={1} required value={form.minutes} onChange={event => set('minutes', event.target.value)} />)
                : field('time', t('scheduledTime'), <Input id={`${prefix}-time`} type="time" required value={form.time} onChange={event => set('time', event.target.value)} />)}
          </div>
          {form.type === 'weekly' && (
            <fieldset className="mt-4 space-y-2">
              <legend className="mb-2 text-[12px] font-medium text-(--text-secondary)">{t('scheduledDays')}</legend>
              <div className="grid grid-cols-7 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7].map(day => (
                  <button key={day} type="button" aria-pressed={form.days.includes(day)}
                    onClick={() => set('days', form.days.includes(day) ? form.days.filter(item => item !== day) : [...form.days, day])}
                    className={cn('h-9 rounded-lg text-[12px] font-medium transition-colors', form.days.includes(day) ? 'bg-primary/16 text-(--text-primary)' : 'bg-(--bg-secondary) text-(--text-secondary) hover:bg-(--bg-hover)')}>
                    {t(`scheduledDay${day}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {['daily', 'weekly'].includes(form.type) && <div className="mt-4">{field('zone', t('scheduledTimezone'), <SearchableSelect id={`${prefix}-zone`} value={form.timeZone} options={zones} onChange={value => set('timeZone', value)} searchPlaceholder={t('timezoneSearch')} emptyText={t('scheduledNoResults')} />)}</div>}
        </div>
      </fieldset>
      {projectError && <p role="status" className="px-6 pb-2 text-[12px] text-(--accent-orange)">{t('projectListFailed')} {projectError}</p>}
      <ProjectSelector open={projectPickerOpen} initialPath={form.projectDir} onOpenChange={setProjectPickerOpen} onOpenProject={path => { set('projectDir', path); }} />
      <DialogFooter className="shrink-0 px-6 py-4">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" disabled={busy || (form.type === 'weekly' && !form.days.length)}>{busy ? t('loading') : t('save')}</Button>
      </DialogFooter>
    </form>
  );
}

function TaskCard({ task, run, viewMode, busy, menuOpen, onMenuChange, onOpen, onEdit, onToggle, onRun, onDelete }) {
  const list = viewMode === 'list';
  const titleParts = splitEmojiTitle(task.name);
  const tone = scheduledTaskTone(task.id);
  const state = scheduledTaskState(task, run);
  const menuAction = action => { onMenuChange(''); action(task); };
  return (
    <article className={cn('group relative isolate rounded-2xl border border-transparent text-left transition-colors hover:border-(--border-strong)', list ? 'min-h-28' : 'min-h-56')}
      style={{ '--task-tint': tone, backgroundColor: 'color-mix(in srgb, var(--task-tint) 22%, var(--bg-secondary))' }}>
      <button type="button" onClick={() => onOpen(task.id)} className="absolute inset-0 z-0 rounded-2xl" aria-label={`${t('scheduledOpenTask')}: ${task.name}`} />
      <div className={cn('pointer-events-none relative z-[1] flex h-full gap-4 px-5 py-5 pr-14', list ? 'items-center' : 'min-h-56 flex-col')}>
        {titleParts.emoji ? <span className={cn('flex shrink-0 items-center justify-center', list ? 'size-11 text-[30px]' : 'size-14 text-[42px]')} aria-hidden="true">{titleParts.emoji}</span> : <span className={cn('size-11 shrink-0 items-center justify-center rounded-xl', list ? 'hidden sm:flex' : 'flex')} style={{ color: tone, backgroundColor: 'color-mix(in srgb, var(--task-tint) 20%, transparent)' }}>
          <Clock size={25} aria-hidden="true" />
        </span>}
        <div className={cn('min-w-0 flex-1', !list && 'mt-auto')}>
          <h2 className={cn('line-clamp-2 break-words font-medium tracking-[-0.015em] text-(--text-primary)', list ? 'text-[15px] leading-5' : 'text-[18px] leading-6')}>{titleParts.title}</h2>
          <p className="mt-1.5 line-clamp-1 text-[12px] leading-5 text-(--text-secondary)">{task.prompt}</p>
          <p className="mt-3 truncate text-[11px] text-(--text-muted)" title={frequencyLabel(task.schedule)}>{t(`scheduledMode_${task.mode}`)} · {frequencyLabel(task.schedule)}</p>
          <p className="mt-1 text-[11px] text-(--text-muted)">{task.nextRunAt ? t('scheduledNext') : run ? t('scheduledLastRun') : t('scheduledPaused')} · {dateLabel(task.nextRunAt || run?.finishedAt || run?.createdAt)}</p>
        </div>
        <div className={cn('shrink-0', !list && 'mt-1')}><TaskStatus status={state} /></div>
      </div>
      <Popover open={menuOpen} onOpenChange={open => onMenuChange(open ? task.id : '')}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`${t('scheduledTaskActions')}: ${task.name}`} className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full text-(--text-secondary) hover:bg-(--bg-primary)/40 hover:text-(--text-primary)">
            <DotsThreeVertical size={18} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 rounded-md p-1">
          {[
            [Play, 'scheduledRunNow', onRun, isActive(run)],
            [PencilSimple, 'edit', onEdit, false],
            [Clock, task.enabled ? 'scheduledPause' : scheduledTaskNeedsReschedule(task) ? 'scheduledReschedule' : 'scheduledResume', onToggle, false],
            [Trash, 'delete', onDelete, isActive(run)],
          ].map(([Icon, label, action, locked]) => (
            <button key={label} type="button" disabled={busy || locked} onClick={() => menuAction(action)}
              className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] disabled:cursor-not-allowed disabled:opacity-40', label === 'delete' ? 'text-(--accent-red) hover:bg-(--accent-red-bg)' : 'text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)')}>
              <Icon size={14} />{t(label)}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </article>
  );
}

function RunList({ runs, onOpenSession }) {
  if (!runs.length) return <p className="py-8 text-[13px] leading-6 text-(--text-muted)">{t('scheduledNoRuns')}</p>;
  return (
    <div className="divide-y divide-(--border-default)">
      {runs.map(run => (
        <article key={run.id} className="flex flex-wrap items-start gap-3 py-4">
          <div className="min-w-0 flex-1 basis-40">
            <h3 className="break-words text-[13px] font-medium text-(--text-primary)">{run.task.name}</h3>
            <p className="mt-1 text-[11px] leading-5 text-(--text-muted)">{fullDateLabel(run.startedAt || run.createdAt)} · {t(`scheduledMode_${run.task.mode}`)}</p>
            {run.error && run.status !== 'continued' && <p className={cn('mt-2 whitespace-pre-wrap break-words text-[12px] leading-5', run.status === 'needs_attention' ? 'text-(--text-secondary)' : 'text-(--accent-red)')}>{run.status === 'needs_attention' ? t(scheduledAttentionKey(run.error)) : run.error}</p>}
          </div>
          <TaskStatus status={run.status} />
          {run.sessionId && !isActive(run) && <Button variant={run.status === 'needs_attention' ? 'default' : 'ghost'} size="sm" onClick={() => onOpenSession(run.sessionId)}>{t(run.status === 'needs_attention' ? 'scheduledHandleRun' : 'scheduledOpenSession')}</Button>}
        </article>
      ))}
    </div>
  );
}

function TaskDetail({ task, recentRun, revision, busy, error, onOpenSession, onRun, onToggle, onEdit }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const load = async () => {
      const request = ++requestId;
      try {
        const result = await api.fetchScheduledTasks(task.id);
        if (!cancelled && request === requestId) { setRuns(result.runs); setLoadError(''); }
      } catch (err) { if (!cancelled && request === requestId) setLoadError(err.message); }
      finally { if (!cancelled && request === requestId) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [task.id, revision]);
  const active = runs.some(isActive) || isActive(recentRun);
  return (
    <div className="min-h-0 overflow-y-auto px-6 pb-6">
      {(error || loadError) && <p role="alert" className="mb-4 rounded-xl bg-(--accent-red-bg) px-4 py-3 text-[12px] text-(--accent-red)">{error || loadError}</p>}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TaskStatus status={scheduledTaskState(task, latestScheduledRuns(runs).get(task.id))} />
        <span className="text-[12px] text-(--text-muted)">{t(`scheduledMode_${task.mode}`)}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" disabled={busy || loading || active} onClick={() => onRun(task)}><Play size={13} />{t('scheduledRunNow')}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(task)}>{t(task.enabled ? 'scheduledPause' : scheduledTaskNeedsReschedule(task) ? 'scheduledReschedule' : 'scheduledResume')}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onEdit(task)}><PencilSimple size={13} />{t('edit')}</Button>
        </div>
      </div>
      <section className="mb-6">
        <h3 className="mb-2 text-[12px] font-medium text-(--text-muted)">{t('scheduledPrompt')}</h3>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-7 text-(--text-primary)">{task.prompt}</p>
      </section>
      <dl className="grid gap-4 border-y border-(--separator) py-5 text-[12px] sm:grid-cols-2">
        {[
          ['scheduledFrequency', frequencyLabel(task.schedule)],
          ['approvalMode', getApprovalModeOptions().find(option => option.value === (task.approvalMode || 'auto'))?.label],
          ['scheduledNext', fullDateLabel(task.nextRunAt)],
          ['scheduledProject', task.projectDir],
          ['scheduledTimezone', task.schedule.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone],
        ].map(([label, value]) => <div key={label}><dt className="mb-1.5 text-(--text-muted)">{t(label)}</dt><dd className="break-words leading-5 text-(--text-primary)">{value}</dd></div>)}
      </dl>
      <section className="mt-5">
        <h3 className="text-[14px] font-medium text-(--text-primary)">{t('scheduledRuns')}</h3>
        {loading ? <Skeleton className="mt-4 h-16 w-full" /> : <RunList runs={runs} onOpenSession={onOpenSession} />}
      </section>
    </div>
  );
}

export default function ScheduledTasksPanel({ projectDir = '', onOpenSession, revision }) {
  const [data, setData] = useState({ tasks: [], runs: [], worker: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(undefined);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  const [sort, setSort] = useState('next');
  const [menuId, setMenuId] = useState('');
  const mutationRef = useRef(false);
  const requestRef = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const result = await api.fetchScheduledTasks();
      if (request === requestRef.current) setData(result);
    } catch (err) {
      if (request === requestRef.current) throw err;
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try { await refresh(); }
      catch (err) { if (!cancelled) setError(err.message); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; ++requestRef.current; };
  }, [refresh, revision]);
  const mutate = async action => {
    if (mutationRef.current) return false;
    mutationRef.current = true;
    setBusy(true); setError('');
    try { await action(); await refresh(); return true; }
    catch (err) { setError(err.message); return false; }
    finally { mutationRef.current = false; setBusy(false); }
  };
  const openEditor = task => { setError(''); setSelectedId(''); setEditor(task || null); };
  const openTask = id => { setError(''); setSelectedId(id); };
  const requestDelete = task => { setError(''); setPendingDelete(task); };
  const toggle = task => {
    if (scheduledTaskNeedsReschedule(task)) {
      openEditor({ ...task, enabled: true, schedule: { ...task.schedule, at: new Date(Date.now() + 3600000).toISOString() } });
      return;
    }
    return mutate(() => api.saveScheduledTask({ enabled: !task.enabled }, task.id));
  };
  const runNow = task => mutate(() => api.runScheduledTask(task.id));
  const save = async task => { if (await mutate(() => api.saveScheduledTask(task, editor?.id))) setEditor(undefined); };
  const latest = useMemo(() => latestScheduledRuns(data.runs), [data.runs]);
  const tasks = useMemo(() => visibleScheduledTasks(data.tasks, data.runs, { query, filter, sort }), [data.tasks, data.runs, query, filter, sort]);
  const runs = useMemo(() => visibleScheduledRuns(data.runs, query), [data.runs, query]);
  const selectedTask = data.tasks.find(task => task.id === selectedId);
  const history = filter === 'history';
  const workerNeeded = data.tasks.some(task => task.enabled) || data.runs.some(isActive);
  const newButton = (className = '') => <button type="button" disabled={busy} onClick={() => openEditor(null)} className={cn('inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-(--text-primary) px-5 text-[12px] font-semibold text-(--bg-primary) shadow-sm transition hover:opacity-90 disabled:opacity-50', className)}><Plus size={15} />{t('scheduledCreate')}</button>;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1540px] px-4 pb-12 pt-5 sm:px-7 lg:px-10 lg:pt-8">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <nav aria-label={t('scheduledFilters')} className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {FILTERS.map(item => <button key={item} type="button" onClick={() => setFilter(item)} aria-current={filter === item ? 'page' : undefined} className={cn('shrink-0 rounded-full px-4 py-2 text-[12px] font-medium transition-colors', filter === item ? 'bg-primary/16 text-(--text-primary)' : 'text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)')}>{t(`scheduledFilter_${item}`)}</button>)}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn('flex h-10 items-center overflow-hidden rounded-full border border-(--border-strong) bg-(--bg-primary) transition-[width,border-color]', searchOpen || query ? 'w-full sm:w-56' : 'w-10')}>
              <button type="button" onClick={() => setSearchOpen(current => !current)} className="flex size-10 shrink-0 items-center justify-center text-(--text-secondary) hover:text-(--text-primary)" aria-label={t('scheduledSearch')} aria-expanded={searchOpen || !!query}><MagnifyingGlass size={17} /></button>
              {(searchOpen || query) && <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('scheduledSearch')} aria-label={t('scheduledSearch')} className="min-w-0 flex-1 bg-transparent pr-3 text-[12px] text-(--text-primary) outline-none placeholder:text-(--text-muted)" autoFocus />}
            </div>
            {!history && <>
              <div className="inline-flex h-10 overflow-hidden rounded-full border border-(--border-strong)">
                {[[GridFour, 'grid'], [ListBullets, 'list']].map(([Icon, view], index) => <button key={view} type="button" onClick={() => setViewMode(view)} aria-pressed={viewMode === view} aria-label={t(view === 'grid' ? 'scheduledGridView' : 'scheduledListView')} className={cn('flex w-10 items-center justify-center transition-colors', index > 0 && 'border-l border-(--border-strong)', viewMode === view ? 'bg-primary/16 text-primary' : 'text-(--text-secondary) hover:bg-(--bg-hover)')}><Icon size={17} /></button>)}
              </div>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger aria-label={t('scheduledSort')} className="h-10 rounded-full border border-(--border-strong) bg-(--bg-primary) pl-4 pr-3 text-[12px] font-medium text-(--text-secondary)"><SelectValue /></SelectTrigger>
                <SelectContent align="end">{['next', 'recent', 'title'].map(value => <SelectItem key={value} value={value}>{t(`scheduledSort_${value}`)}</SelectItem>)}</SelectContent>
              </Select>
            </>}
            {newButton()}
          </div>
        </header>

        <section className="mt-9">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-medium tracking-[-0.025em] text-(--text-primary)">{history ? t('scheduledRuns') : t('scheduledLibraryTitle')}</h1>
              <p className="mt-1.5 text-[12px] text-(--text-muted)">{loading ? t('loading') : history ? t('scheduledRunCount').replace('{n}', String(runs.length)) : t('scheduledTaskCount').replace('{n}', String(tasks.length))}</p>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-(--text-muted)">
              <span role="status" className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={cn('size-1.5 rounded-full', data.worker.running ? 'bg-(--accent-green)' : 'bg-(--text-muted)')} />{t(data.worker.running ? 'scheduledWorkerActiveShort' : 'scheduledWorkerIdleShort')}</span>
              {!data.worker.running && workerNeeded && <Button variant="ghost" size="sm" disabled={busy} onClick={() => mutate(api.startScheduledWorker)}>{t('scheduledWorkerStart')}</Button>}
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" aria-label={t('scheduledHelp')} className="flex size-8 items-center justify-center rounded-full hover:bg-(--bg-hover) hover:text-(--text-primary)"><Info size={16} /></button>
                </PopoverTrigger>
                <PopoverContent align="end" className="max-w-[calc(100vw-2rem)] text-[12px] leading-6 text-(--text-secondary)">
                  <p className="font-medium text-(--text-primary)">{t('scheduledDescription')}</p>
                  <p className="mt-2">{t('scheduledBackgroundExplanation')}</p>
                  <p className="mt-2">{t('scheduledOfflineNote')}</p>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {error && editor === undefined && !selectedTask && <p role="alert" className="mt-5 rounded-xl bg-(--accent-red-bg) px-4 py-3 text-[12px] text-(--accent-red)">{error}</p>}
          {loading ? <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-56 rounded-2xl" />)}</div>
            : history ? <div className="mt-6"><RunList runs={runs} onOpenSession={onOpenSession} /></div>
              : !tasks.length ? (
                <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-(--border-default) px-6 py-8 text-center">
                  <Clock size={32} className="text-(--text-muted)" />
                  <h2 className="mt-3 text-[14px] font-medium text-(--text-secondary)">{query || filter !== 'all' ? t('scheduledNoResults') : t('scheduledEmpty')}</h2>
                  <p className="mt-2 max-w-md text-[12px] leading-6 text-(--text-muted)">{query || filter !== 'all' ? t('scheduledNoResultsHint') : t('scheduledEmptyHint')}</p>
                  {newButton('mt-5')}
                </div>
              ) : (
                <div className={cn('mt-6', viewMode === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4' : 'flex flex-col gap-3')}>
                  {viewMode === 'grid' && <button type="button" disabled={busy} onClick={() => openEditor(null)} className="group flex min-h-56 flex-col items-center justify-center rounded-2xl border border-(--border-strong) bg-transparent text-(--text-secondary) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-50"><span className="flex size-14 items-center justify-center rounded-full bg-primary/14 text-primary"><Plus size={23} /></span><span className="mt-4 text-[14px] font-medium">{t('scheduledCreate')}</span></button>}
                  {tasks.map(task => <TaskCard key={task.id} task={task} run={latest.get(task.id)} viewMode={viewMode} busy={busy} menuOpen={menuId === task.id} onMenuChange={setMenuId} onOpen={openTask} onEdit={openEditor} onToggle={toggle} onRun={runNow} onDelete={requestDelete} />)}
                </div>
              )}
        </section>
      </div>

      <Dialog open={editor !== undefined} onOpenChange={open => { if (!open && !busy) { setEditor(undefined); setError(''); } }}>
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden rounded-2xl p-0 sm:max-w-[640px]">
          <DialogHeader className="px-6" showCloseButton={!busy}><DialogTitle>{editor ? t('scheduledEdit') : t('scheduledCreate')}</DialogTitle><DialogDescription>{t('scheduledEditorDescription')}</DialogDescription></DialogHeader>
          {editor !== undefined && <TaskEditor key={editor?.id || 'new'} task={editor} projectDir={projectDir} busy={busy} error={error} onSave={save} onCancel={() => { setEditor(undefined); setError(''); }} />}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(selectedTask)} onOpenChange={open => { if (!open) { setSelectedId(''); setError(''); } }}>
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden rounded-2xl p-0 sm:max-w-[800px]" onCloseAutoFocus={event => { if (editor !== undefined) event.preventDefault(); }}>
          <DialogHeader className="px-6"><DialogTitle className="break-words pr-2 text-[20px] leading-7">{selectedTask?.name}</DialogTitle><DialogDescription className="flex items-center gap-1.5"><FolderSimple size={13} className="shrink-0" /><span className="truncate" title={selectedTask?.projectDir}>{selectedTask?.projectDir}</span></DialogDescription></DialogHeader>
          {selectedTask && <TaskDetail key={selectedTask.id} task={selectedTask} recentRun={latest.get(selectedTask.id)} revision={revision} busy={busy} error={error} onOpenSession={onOpenSession} onRun={runNow} onToggle={toggle} onEdit={openEditor} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={open => { if (!open && !busy) { setPendingDelete(null); setError(''); } }}
        title={t('scheduledDeleteTitle')}
        description={<><span className="block">{pendingDelete?.name}</span>{error && <span role="alert" className="mt-2 block text-(--accent-red)">{error}</span>}</>}
        confirmLabel={t('delete')}
        loading={busy}
        onConfirm={async () => { if (await mutate(() => api.deleteScheduledTask(pendingDelete.id))) setPendingDelete(null); }}
      />
    </div>
  );
}
