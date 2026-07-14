import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwise,
  FloppyDisk,
  Lightning,
  MagnifyingGlass,
  Package,
  WarningCircle,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsField } from '@/components/settings/SettingsField.jsx';
import { SettingsSegmentedControl } from '@/components/settings/SettingsSegmentedControl.jsx';
import { ResourceLibraryDialog } from '@/components/ResourceLibraryDialog.jsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.jsx';
import {
  HOOK_EVENTS,
  HOOK_TOOL_OPTIONS,
  emptyHooksState,
  hookEventI18nKey,
  hooksObjectToState,
  hooksStateHasInvalidCommand,
  hooksStateIsDirty,
  hooksStateToObject,
} from '@/lib/hooks-editor.js';
import { cn } from '@/lib/utils';
import * as api from '@/hooks/use-api';
import { t } from '../../i18n/index.js';

const CUSTOM_MATCHER = '__custom__';
const ANY_MATCHER = '__any__';

function skillKey(skill) {
  return `${skill?.scope || 'unknown'}:${skill?.projectDir || ''}:${skill?.name || ''}`;
}

function scopeLabel(scope) {
  if (scope === 'builtin') return t('builtin');
  if (scope === 'global') return t('globalScope');
  return t('projectScope');
}

function countActiveHooks(hooksState = {}) {
  return HOOK_EVENTS.filter((event) => {
    const entry = hooksState[event];
    return entry?.checked && String(entry.command || '').trim();
  }).length;
}

function hookEventHintKey(eventName) {
  return `hookEventHint_${eventName}`;
}

function summarizeProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') return '';
  const sources = [
    ...new Set(
      Object.values(provenance)
        .map((item) => item?.source)
        .filter(Boolean)
        .map(String),
    ),
  ];
  return sources.join(', ');
}

function MatcherSelect({ value, onChange, disabled }) {
  const known = HOOK_TOOL_OPTIONS.some((item) => item.id === value);
  const mode = !value ? ANY_MATCHER : known ? value : CUSTOM_MATCHER;
  return (
    <div className="grid gap-2">
      <Select
        value={mode}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === ANY_MATCHER) onChange('');
          else if (next === CUSTOM_MATCHER) onChange(value && !known ? value : '');
          else onChange(next);
        }}
      >
        <SelectTrigger className="h-8 w-full text-[12px]">
          <SelectValue placeholder={t('skillHookMatcherAny')} />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            <SelectItem value={ANY_MATCHER}>{t('skillHookMatcherAny')}</SelectItem>
            {HOOK_TOOL_OPTIONS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(item.labelKey)}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_MATCHER}>{t('skillHookMatcherCustom')}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {mode === CUSTOM_MATCHER ? (
        <Input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Bash|Write"
          className="h-8 text-[12px]"
        />
      ) : null}
    </div>
  );
}

export function HooksEventEditor({ hooksState, onHooksStateChange, disabled }) {
  const updateEvent = (event, patch) => {
    onHooksStateChange({
      ...hooksState,
      [event]: { ...(hooksState[event] || {}), ...patch, dirty: true },
    });
  };

  return (
    <div className="grid gap-2">
      {HOOK_EVENTS.map((event) => {
        const entry = hooksState[event] || {
          checked: false,
          matcher: '',
          command: '',
        };
        const needsMatcher = event === 'PreToolUse' || event === 'PostToolUse';
        return (
          <div
            key={event}
            className={cn(
              'rounded-lg border border-(--border-default) transition-colors',
              entry.checked
                ? 'bg-(--bg-primary)'
                : 'bg-(--bg-subtle)/40 hover:bg-(--bg-subtle)',
            )}
          >
            <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
              <Checkbox
                className="mt-0.5"
                checked={entry.checked}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  updateEvent(event, { checked: !!checked })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-(--text-primary)">
                    {t(hookEventI18nKey(event))}
                  </span>
                  {entry.checked ? (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {t('hooksEventOn')}
                    </Badge>
                  ) : null}
                  {entry.advanced ? (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      {t('hooksAdvancedPreserved')}
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-(--text-muted)">
                  {t(hookEventHintKey(event))}
                </span>
              </span>
            </label>
            {entry.checked ? (
              <div
                className={cn(
                  'grid gap-3 border-t border-(--border-default) px-3 py-3',
                  needsMatcher ? 'sm:grid-cols-2' : '',
                )}
              >
                {needsMatcher ? (
                  <SettingsField
                    id={`hook-${event}-matcher`}
                    label={t('skillHookMatcher')}
                    description={t('skillHookMatcherHint')}
                  >
                    <MatcherSelect
                      value={entry.matcher}
                      disabled={disabled}
                      onChange={(matcher) => updateEvent(event, { matcher })}
                    />
                  </SettingsField>
                ) : null}
                <SettingsField
                  id={`hook-${event}-command`}
                  label={t('skillHookCommand')}
                  description={t('skillHookCommandHint')}
                >
                  <Input
                    value={entry.command}
                    disabled={disabled}
                    onChange={(e) =>
                      updateEvent(event, { command: e.target.value })
                    }
                    placeholder={t('skillHookCommandPlaceholder')}
                    className="h-8 font-mono text-[12px]"
                  />
                  {entry.advanced ? (
                    <p className="mt-1 text-[11px] leading-4 text-(--text-muted)">
                      {t('hooksAdvancedPreservedHint')}
                    </p>
                  ) : null}
                </SettingsField>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function HooksEditorFooter({
  savedAt,
  loading,
  saving,
  disabled,
  dirty,
  invalid,
  onSave,
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--border-default) px-4 py-3 sm:px-5">
      {savedAt ? (
        <span className="mr-auto text-[11px] text-(--text-muted)">
          {t('hooksSavedAt').replace('{{time}}', savedAt)}
        </span>
      ) : null}
      <Button onClick={onSave} disabled={loading || saving || disabled || !dirty || invalid}>
        <FloppyDisk size={14} className="mr-1.5" />
        {saving ? t('saving') : t('save')}
      </Button>
    </div>
  );
}

function WorkspaceHooksPane({ onDirtyChange }) {
  const [scope, setScope] = useState('global');
  const [pendingScope, setPendingScope] = useState('');
  const [hooksState, setHooksState] = useState(() => emptyHooksState());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  const activeCount = countActiveHooks(hooksState);
  const dirty = hooksStateIsDirty(hooksState);
  const invalid = hooksStateHasInvalidCommand(hooksState);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchWorkspaceHooks(scope);
      setHooksState(hooksObjectToState(data?.hooks || {}));
      setSavedAt('');
    } catch (err) {
      setError(err?.message || t('hooksLoadFailed'));
      setHooksState(emptyHooksState());
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await api.updateWorkspaceHooks(scope, hooksStateToObject(hooksState));
      setHooksState(hooksObjectToState(data?.hooks || {}));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err?.message || t('hooksSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-(--border-default) px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-(--text-primary)">
              {t('hooksWorkspaceTitle')}
            </div>
            <p className="text-[12px] leading-5 text-(--text-muted)">
              {t('hooksWorkspacePaneHint')}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {activeCount > 0 ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                {t('hooksActiveCount').replace('{{count}}', String(activeCount))}
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={load}
              disabled={loading || saving}
              title={t('refresh')}
              aria-label={t('refresh')}
            >
              <ArrowClockwise className={cn(loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <SettingsSegmentedControl
          idPrefix="hooks-scope"
          value={scope}
          onValueChange={(nextScope) => {
            if (nextScope === scope) return;
            if (dirty) {
              setPendingScope(nextScope);
              return;
            }
            setScope(nextScope);
          }}
          options={[
            { value: 'global', label: t('globalScope') },
            { value: 'coding', label: t('skillContextCoding') },
            { value: 'daily', label: t('skillContextDaily') },
          ]}
          className="w-full max-w-sm [&_button]:text-[12px]"
        />
        {error ? (
          <Alert variant="destructive">
            <WarningCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {invalid ? (
          <Alert variant="destructive">
            <WarningCircle />
            <AlertDescription>{t('hooksCommandRequired')}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        {loading ? (
          <Empty className="rounded-lg border border-(--border-default) py-10">
            <EmptyDescription>{t('loading')}...</EmptyDescription>
          </Empty>
        ) : (
          <HooksEventEditor
            hooksState={hooksState}
            onHooksStateChange={setHooksState}
            disabled={saving}
          />
        )}
      </div>

      <HooksEditorFooter
        savedAt={savedAt}
        loading={loading}
        saving={saving}
        dirty={dirty}
        invalid={invalid}
        onSave={handleSave}
      />
      <ConfirmDialog
        open={!!pendingScope}
        title={t('hooksDiscardChanges')}
        description={t('hooksDiscardChangesHint')}
        confirmLabel={t('discard')}
        confirmVariant="destructive"
        onOpenChange={(nextOpen) => !nextOpen && setPendingScope('')}
        onConfirm={() => {
          const nextScope = pendingScope;
          setPendingScope('');
          if (nextScope) setScope(nextScope);
        }}
      />
    </div>
  );
}

function SkillHooksListItem({ skill, selected, hookCount, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(skill)}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-(--border-strong) bg-(--bg-subtle)'
          : 'border-transparent hover:border-(--border-default) hover:bg-(--bg-subtle)/60',
      )}
    >
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-(--bg-primary) text-(--text-muted)">
        <Package size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-(--text-primary)">
            {skill.name}
          </span>
          {hookCount > 0 ? (
            <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
              {hookCount}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {scopeLabel(skill.scope)}
          </Badge>
          {skill.disableModelInvocation ? (
            <span className="text-[10px] text-(--text-muted)">
              {t('hooksSkillNoAutoInvoke')}
            </span>
          ) : null}
        </div>
        {skill.description ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">
            {skill.description}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function SkillHooksPane({ projectDirs = [], onDirtyChange }) {
  const [skills, setSkills] = useState([]);
  const [hookCounts, setHookCounts] = useState({});
  const [selectedKey, setSelectedKey] = useState('');
  const [pendingSelectedKey, setPendingSelectedKey] = useState('');
  const [query, setQuery] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [hooksState, setHooksState] = useState(() => emptyHooksState());
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [provenance, setProvenance] = useState('');

  const projectKey = useMemo(
    () =>
      Array.isArray(projectDirs)
        ? projectDirs.map((item) => String(item || '').trim()).filter(Boolean).join('\n')
        : '',
    [projectDirs],
  );
  const requestProjectDirs = useMemo(
    () => (projectKey ? projectKey.split('\n') : []),
    [projectKey],
  );

  const editableSkills = useMemo(
    () => skills.filter((skill) => skill?.scope !== 'builtin'),
    [skills],
  );

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return editableSkills;
    return editableSkills.filter((skill) => {
      const hay = `${skill.name || ''} ${skill.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [editableSkills, query]);

  const selectedSkill = useMemo(
    () => editableSkills.find((skill) => skillKey(skill) === selectedKey) || null,
    [editableSkills, selectedKey],
  );

  const loadSkills = useCallback(async () => {
    setListLoading(true);
    setError('');
    try {
      const list = await api.fetchSkills(requestProjectDirs);
      const next = Array.isArray(list) ? list : [];
      setSkills(next);
      const editable = next.filter((skill) => skill?.scope !== 'builtin');
      const counts = Object.fromEntries(
        editable.map((skill) => [
          skillKey(skill),
          Array.isArray(skill.hookEvents) ? skill.hookEvents.length : 0,
        ]),
      );
      setHookCounts(counts);
      setSelectedKey((prev) => {
        if (prev && editable.some((skill) => skillKey(skill) === prev)) return prev;
        return editable[0] ? skillKey(editable[0]) : '';
      });
    } catch (err) {
      setError(err?.message || t('hooksLoadFailed'));
      setSkills([]);
      setHookCounts({});
      setSelectedKey('');
    } finally {
      setListLoading(false);
    }
  }, [requestProjectDirs]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!selectedSkill) {
      setHooksState(emptyHooksState());
      setDisableModelInvocation(false);
      setMetadataDirty(false);
      setProvenance('');
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setError('');
    setNotice('');
    api
      .fetchSkillHooks(selectedSkill.name, selectedSkill.projectDir)
      .then((data) => {
        if (cancelled) return;
        const nextState = hooksObjectToState(data?.hooks || {});
        setHooksState(nextState);
        setDisableModelInvocation(data?.disableModelInvocation === true);
        setMetadataDirty(false);
        setProvenance(summarizeProvenance(data?.provenance));
        setHookCounts((prev) => ({
          ...prev,
          [skillKey(selectedSkill)]: countActiveHooks(nextState),
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || t('hooksLoadFailed'));
        setHooksState(emptyHooksState());
        setMetadataDirty(false);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSkill]);

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const originalHooks = hooksState.__rawHooks || {};
      const hookData = await api.updateSkillHooks(
        selectedSkill.name,
        hooksStateToObject(hooksState),
        selectedSkill.projectDir,
      );
      try {
        await api.updateSkillMetadata(
          selectedSkill.name,
          { disableModelInvocation },
          selectedSkill.projectDir,
        );
      } catch (metadataError) {
        await api.updateSkillHooks(
          selectedSkill.name,
          originalHooks,
          selectedSkill.projectDir,
        ).catch(() => null);
        throw metadataError;
      }
      setHooksState(hooksObjectToState(hookData?.hooks || {}));
      setMetadataDirty(false);
      const nextCount = countActiveHooks(hooksState);
      setHookCounts((prev) => ({
        ...prev,
        [skillKey(selectedSkill)]: nextCount,
      }));
      setSavedAt(new Date().toLocaleTimeString());
      setNotice(t('hooksSkillSaved'));
    } catch (err) {
      setError(err?.message || t('hooksSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const activeCount = countActiveHooks(hooksState);
  const hooksDirty = hooksStateIsDirty(hooksState);
  const invalid = hooksStateHasInvalidCommand(hooksState);
  const dirty = hooksDirty || metadataDirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-3 border-b border-(--border-default) p-3 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-(--text-primary)">
              {t('hooksSkillsTitle')}
            </div>
            <p className="text-[11px] leading-4 text-(--text-muted)">
              {t('hooksSkillsListHint')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={loadSkills}
            disabled={listLoading || saving}
            title={t('refresh')}
            aria-label={t('refresh')}
          >
            <ArrowClockwise className={cn(listLoading && 'animate-spin')} />
          </Button>
        </div>

        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-muted)"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchSkills')}
            className="h-9 pl-8 text-[13px]"
          />
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
          {listLoading ? (
            <Empty className="rounded-lg py-8">
              <EmptyDescription>{t('loading')}...</EmptyDescription>
            </Empty>
          ) : filteredSkills.length === 0 ? (
            <Empty className="rounded-lg py-8">
              <EmptyDescription className="text-[13px] text-(--text-primary)">
                {query.trim() ? t('noMatches') : t('hooksNoEditableSkills')}
              </EmptyDescription>
              <EmptyDescription className="text-[11px] text-(--text-muted)">
                {t('hooksNoEditableSkillsHint')}
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filteredSkills.map((skill) => {
                const key = skillKey(skill);
                return (
                  <SkillHooksListItem
                    key={key}
                    skill={skill}
                    selected={key === selectedKey}
                    hookCount={hookCounts[key] || 0}
                    onSelect={(next) => {
                      const nextKey = skillKey(next);
                      if (nextKey === selectedKey) return;
                      if (dirty) {
                        setPendingSelectedKey(nextKey);
                        return;
                      }
                      setSelectedKey(nextKey);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        {!selectedSkill ? (
          <Empty className="m-4 flex-1 rounded-lg border border-dashed border-(--border-default)">
            <Lightning size={22} className="mb-2 text-(--text-muted)" />
            <EmptyDescription>{t('hooksSelectSkillHint')}</EmptyDescription>
          </Empty>
        ) : (
          <>
            <div className="flex shrink-0 flex-col gap-3 border-b border-(--border-default) px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[14px] font-medium text-(--text-primary)">
                      {selectedSkill.name}
                    </h3>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {scopeLabel(selectedSkill.scope)}
                    </Badge>
                    {activeCount > 0 ? (
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {t('hooksActiveCount').replace(
                          '{{count}}',
                          String(activeCount),
                        )}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-(--text-muted)">
                    {t('hooksSkillPaneHint')}
                  </p>
                  {provenance ? (
                    <p className="mt-1 text-[11px] text-(--text-muted)">
                      {t('hooksProvenance').replace('{{source}}', provenance)}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-(--border-default) bg-(--bg-subtle) px-3 py-2.5">
                <div className="min-w-0 pr-3">
                  <div className="text-[13px] font-medium text-(--text-primary)">
                    {t('skillDisableModelInvocation')}
                  </div>
                  <p className="text-[11px] leading-4 text-(--text-muted)">
                    {t('skillDisableModelInvocationHint')}
                  </p>
                </div>
                <Switch
                  checked={disableModelInvocation}
                  onCheckedChange={(checked) => {
                    setDisableModelInvocation(checked);
                    setMetadataDirty(true);
                  }}
                  disabled={detailLoading || saving}
                  aria-label={t('skillDisableModelInvocation')}
                />
              </div>

              {error ? (
                <Alert variant="destructive">
                  <WarningCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {invalid ? (
                <Alert variant="destructive">
                  <WarningCircle />
                  <AlertDescription>{t('hooksCommandRequired')}</AlertDescription>
                </Alert>
              ) : null}
              {notice ? (
                <Alert aria-live="polite">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              {detailLoading ? (
                <Empty className="rounded-lg border border-(--border-default) py-10">
                  <EmptyDescription>{t('loading')}...</EmptyDescription>
                </Empty>
              ) : (
                <HooksEventEditor
                  hooksState={hooksState}
                  onHooksStateChange={setHooksState}
                  disabled={saving}
                />
              )}
            </div>

            <HooksEditorFooter
              savedAt={savedAt}
              loading={detailLoading}
              saving={saving}
              disabled={!selectedSkill}
              dirty={dirty}
              invalid={invalid}
              onSave={handleSave}
            />
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!pendingSelectedKey}
        title={t('hooksDiscardChanges')}
        description={t('hooksDiscardChangesHint')}
        confirmLabel={t('discard')}
        confirmVariant="destructive"
        onOpenChange={(nextOpen) => !nextOpen && setPendingSelectedKey('')}
        onConfirm={() => {
          const nextKey = pendingSelectedKey;
          setPendingSelectedKey('');
          if (nextKey) setSelectedKey(nextKey);
        }}
      />
    </div>
  );
}

/** @deprecated Prefer WorkspaceHooksPane via HooksDialog tabs */
export function HooksPanel() {
  return <WorkspaceHooksPane />;
}

export function HooksDialog({ open, onOpenChange, projectDirs = [] }) {
  const [tab, setTab] = useState('workspace');
  const [visitedSkills, setVisitedSkills] = useState(false);
  const [dirtyTabs, setDirtyTabs] = useState({ workspace: false, skills: false });
  const [confirmClose, setConfirmClose] = useState(false);
  const setWorkspaceDirty = useCallback(
    (dirty) => setDirtyTabs((current) => current.workspace === dirty ? current : { ...current, workspace: dirty }),
    [],
  );
  const setSkillsDirty = useCallback(
    (dirty) => setDirtyTabs((current) => current.skills === dirty ? current : { ...current, skills: dirty }),
    [],
  );
  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && (dirtyTabs.workspace || dirtyTabs.skills)) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <>
    <ResourceLibraryDialog
      open={open}
      onOpenChange={handleOpenChange}
      icon={Lightning}
      title={t('hooks')}
      description={t('hooksDialogHint')}
    >
      <Tabs
        value={tab}
        onValueChange={(nextTab) => {
          if (nextTab === 'skills') setVisitedSkills(true);
          setTab(nextTab);
        }}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <div className="flex shrink-0 items-center border-b border-(--border-default) px-3 py-2">
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="workspace">{t('hooksTabWorkspace')}</TabsTrigger>
            <TabsTrigger value="skills">{t('hooksTabSkills')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent forceMount value="workspace" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <WorkspaceHooksPane onDirtyChange={setWorkspaceDirty} />
        </TabsContent>
        <TabsContent forceMount value="skills" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          {visitedSkills ? (
            <SkillHooksPane projectDirs={projectDirs} onDirtyChange={setSkillsDirty} />
          ) : null}
        </TabsContent>
      </Tabs>
    </ResourceLibraryDialog>
    <ConfirmDialog
      open={confirmClose}
      title={t('hooksDiscardChanges')}
      description={t('hooksDiscardChangesHint')}
      confirmLabel={t('discard')}
      confirmVariant="destructive"
      onOpenChange={setConfirmClose}
      onConfirm={() => {
        setConfirmClose(false);
        onOpenChange(false);
      }}
    />
    </>
  );
}
