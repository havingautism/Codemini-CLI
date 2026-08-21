import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  FloppyDisk,
  Folder,
  Lightning,
  MagnifyingGlass,
  Package,
  Plus,
  Trash,
  WarningCircle,
} from '@/lib/icons';
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
import { skillRoutingAuthorLocked } from '@/lib/skill-display.js';
import { cn } from '@/lib/utils';
import * as api from '@/hooks/use-api';
import { t } from '../../i18n/index.js';

const CUSTOM_MATCHER = '__custom__';
const ANY_MATCHER = '__any__';

function skillKey(skill) {
  return `${skill?.scope === 'builtin' ? 'builtin' : 'installed'}:${skill?.name || ''}`;
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
                : 'bg-(--bg-subtle)/40 hover:bg-(--bg-hover)',
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
          ? 'border-(--border-strong) bg-(--selected-bg)'
          : 'border-transparent hover:border-(--border-default) hover:bg-(--bg-hover)',
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

function SkillHooksPane({ onDirtyChange }) {
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
      const list = await api.fetchSkills();
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
  }, []);

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
      .fetchSkillHooks(selectedSkill.name)
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
      );
      try {
        if (!skillRoutingAuthorLocked(selectedSkill)) {
          await api.updateSkillMetadata(
            selectedSkill.name,
            { disableModelInvocation },
          );
        }
      } catch (metadataError) {
        await api.updateSkillHooks(
          selectedSkill.name,
          originalHooks,
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
                    {skillRoutingAuthorLocked(selectedSkill)
                      ? t('skillRoutingAuthorLockedHint')
                      : t('skillDisableModelInvocationHint')}
                  </p>
                </div>
                <Switch
                  checked={disableModelInvocation}
                  onCheckedChange={(checked) => {
                    setDisableModelInvocation(checked);
                    setMetadataDirty(true);
                  }}
                  disabled={detailLoading || saving || skillRoutingAuthorLocked(selectedSkill)}
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

const HOOK_PROFILE_SCOPES = [
  { id: 'always', labelKey: 'hooksProfileAlways' },
  { id: 'coding', labelKey: 'skillContextCoding' },
  { id: 'daily', labelKey: 'skillContextDaily' },
];

function profileListSubtitle(profile) {
  if (profile.kind === 'skill') {
    return `${t('hooksProfileSkillActivation')} · ${scopeLabel(profile.scope)}`;
  }
  if (profile.kind === 'workspace') return t('hooksLegacyProfile');
  if (profile.kind === 'package') return t('hooksProfilePackageHint');
  return t('hooksProfileCustom');
}
function HookProfilesPane({ onDirtyChange }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [hooksState, setHooksState] = useState(() => emptyHooksState());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [pendingSelection, setPendingSelection] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [expandedScopes, setExpandedScopes] = useState(
    () => new Set(HOOK_PROFILE_SCOPES.map((scope) => scope.id)),
  );

  const toggleScope = useCallback((scopeId) => {
    setExpandedScopes((current) => {
      const next = new Set(current);
      if (next.has(scopeId)) next.delete(scopeId);
      else next.add(scopeId);
      return next;
    });
  }, []);

  const selected = profiles.find((profile) => profile.id === selectedId) || null;
  const isNew = draft?._isNew === true;
  const metadataDirty = !!draft && !!selected && (
    draft.name !== selected.name ||
    draft.scope !== selected.scope ||
    draft.activation !== selected.activation ||
    draft.enabled !== selected.enabled
  );
  const dirty = hooksStateIsDirty(hooksState) || metadataDirty || isNew;
  const invalid = hooksStateHasInvalidCommand(hooksState);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const applyProfile = useCallback((profile) => {
    setSelectedId(profile?.id || '');
    setDraft(profile ? { ...profile } : null);
    setHooksState(hooksObjectToState(profile?.hooks || {}));
    setSavedAt('');
    setError('');
  }, []);

  const load = useCallback(async (preferredId = '') => {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetchHookProfiles();
      const next = Array.isArray(data?.profiles) ? data.profiles : [];
      setProfiles(next);
      applyProfile(
        next.find((profile) => profile.id === preferredId)
          || next.find((profile) => profile.id === selectedId)
          || next[0]
          || null,
      );
    } catch (err) {
      setError(err?.message || t('hooksLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [applyProfile, selectedId]);

  useEffect(() => { load(); }, []);

  const selectProfile = (id) => {
    if (id === selectedId) return;
    if (dirty) {
      setPendingSelection(id);
      return;
    }
    applyProfile(profiles.find((profile) => profile.id === id) || null);
  };

  const createProfile = (activation = 'always') => {
    const profile = {
      id: `profile-${Date.now()}`,
      name: t('hooksNewProfile'),
      kind: 'custom',
      scope: 'project',
      activation,
      enabled: true,
      editable: true,
      hooks: {},
      _isNew: true,
    };
    if (dirty) {
      setPendingSelection(`__new__:${activation}`);
      return;
    }
    applyProfile(profile);
  };

  const save = async () => {
    if (!draft || invalid) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...draft,
        originalScope: selected?.scope,
        hooks: hooksStateToObject(hooksState),
      };
      const result = isNew
        ? await api.createHookProfile(payload)
        : await api.updateHookProfile(payload);
      await load(result?.profile?.id || payload.id);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err?.message || t('hooksSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    try {
      await api.deleteHookProfile(pendingDelete);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(err?.message || t('hooksDeleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-(--border-default) p-3 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-(--text-primary)">{t('hooksProfiles')}</div>
            <p className="text-[11px] leading-4 text-(--text-muted)">{t('hooksProfilesHint')}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => load()} disabled={loading || saving} aria-label={t('refresh')}>
            <ArrowClockwise className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
        <div className="min-h-[160px] flex-1 overflow-y-auto">
          <div className="grid gap-2">
            {HOOK_PROFILE_SCOPES.map((scope) => {
              const scopedProfiles = profiles.filter((profile) => profile.activation === scope.id);
              const collapsed = !expandedScopes.has(scope.id);
              return (
                <div key={scope.id} className="grid gap-1">
                  <div className="flex h-8 w-full items-center gap-1 rounded-lg px-1 text-[12px] font-medium text-foreground hover:bg-muted/50">
                    <button
                      type="button"
                      onClick={() => toggleScope(scope.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left"
                      title={t(scope.labelKey)}
                      aria-expanded={!collapsed}
                    >
                      <Folder size={14} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t(scope.labelKey)}</span>
                      <span className="shrink-0 text-muted-foreground">{scopedProfiles.length}</span>
                      {collapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}
                    </button>
                    <div
                      className="flex shrink-0 items-center gap-0.5 pr-0.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => createProfile(scope.id)}
                        disabled={saving}
                        aria-label={`${t('hooksNewProfile')} · ${t(scope.labelKey)}`}
                        title={t('hooksNewProfile')}
                      >
                        <Plus size={13} />
                      </Button>
                    </div>
                  </div>
                  {!collapsed ? (
                    <div className="grid gap-1 pl-1">
                      {scopedProfiles.length === 0 ? (
                        <p className="px-2 py-2 text-[11px] text-(--text-muted)">
                          {t('hooksNoProfilesInScope')}
                        </p>
                      ) : (
                        scopedProfiles.map((profile) => (
                          <div
                            key={profile.id}
                            className={cn(
                              'group flex items-center gap-1 rounded-lg border px-1 transition-[background-color,border-color,box-shadow]',
                              selectedId === profile.id
                                ? 'border-transparent bg-(--bg-active)'
                                : 'border-transparent bg-transparent hover:bg-(--bg-hover)',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => selectProfile(profile.id)}
                              className="min-w-0 flex-1 px-2 py-2 text-left outline-none focus-visible:shadow-[0_0_0_3px_var(--control-focus-ring)]"
                            >
                              <span className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {profile.nameKey ? t(profile.nameKey) : profile.name}
                                </span>
                                {profile.kind === 'skill' ? (
                                  <Badge variant="outline" className="h-5 shrink-0 rounded-md px-1.5 text-[11px]">
                                    {t('hooksProfileSkill')}
                                  </Badge>
                                ) : null}
                                {profile.kind === 'package' ? (
                                  <Badge variant="outline" className="h-5 shrink-0 rounded-md px-1.5 text-[11px]">
                                    {t('hooksProfilePackage')}
                                  </Badge>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {profileListSubtitle(profile)}
                              </span>
                            </button>
                            {profile.editable !== false || profile.kind === 'package' ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="mr-0.5 text-(--accent-red) opacity-70 hover:bg-(--accent-red-bg) hover:text-(--accent-red) group-hover:opacity-100"
                                onClick={() => setPendingDelete(profile)}
                                disabled={saving}
                                aria-label={`${t('delete')} ${profile.name}`}
                                title={t('delete')}
                              >
                                <Trash size={13} />
                              </Button>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        {!draft ? (
          <Empty className="m-4 flex-1 rounded-lg border border-dashed border-(--border-default)">
            <EmptyDescription>{t('hooksSelectProfile')}</EmptyDescription>
          </Empty>
        ) : (
          <>
            <div className="grid shrink-0 gap-3 border-b border-(--border-default) px-4 py-3 sm:grid-cols-2 sm:px-5">
              <SettingsField id="hook-profile-name" label={t('name')}>
                <Input value={draft.nameKey ? t(draft.nameKey) : draft.name} disabled={draft.kind !== 'custom'} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </SettingsField>
              <SettingsField id="hook-profile-activation" label={t('hooksProfileScope')}>
                <Select
                  value={draft.activation}
                  disabled={draft.kind !== 'custom' && draft.kind !== 'package'}
                  onValueChange={(activation) => setDraft((current) => ({ ...current, activation }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">{t('hooksProfileAlways')}</SelectItem>
                    <SelectItem value="coding">{t('skillContextCoding')}</SelectItem>
                    <SelectItem value="daily">{t('skillContextDaily')}</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsField>
              <div className="flex items-center justify-between rounded-lg border border-(--border-default) bg-(--bg-subtle) px-3 py-2">
                <span className="text-[13px] font-medium text-(--text-primary)">{t('enabled')}</span>
                <Switch checked={draft.enabled !== false} disabled={draft.kind !== 'custom' && draft.kind !== 'package'} onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
              </div>
              <Alert className="sm:col-span-2"><AlertDescription>{t('hooksCommandOnlyHint')}</AlertDescription></Alert>
              {error ? <Alert variant="destructive" className="sm:col-span-2"><WarningCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
              {invalid ? <Alert variant="destructive" className="sm:col-span-2"><WarningCircle /><AlertDescription>{t('hooksCommandRequired')}</AlertDescription></Alert> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              <HooksEventEditor hooksState={hooksState} onHooksStateChange={setHooksState} disabled={saving || draft.editable === false || draft.kind === 'package'} />
            </div>
            <div className="flex items-center border-t border-(--border-default)">
              {(draft.editable !== false || draft.kind === 'package') && !isNew ? (
                <Button variant="ghost" className="ml-4 text-(--accent-red)" onClick={() => setPendingDelete(draft)} disabled={saving}>
                  <Trash />{t('delete')}
                </Button>
              ) : null}
              <div className="ml-auto">
                <HooksEditorFooter savedAt={savedAt} loading={loading} saving={saving} disabled={draft.editable === false && draft.kind !== 'package'} dirty={dirty} invalid={invalid} onSave={save} />
              </div>
            </div>
          </>
        )}
      </section>
      <ConfirmDialog
        open={!!pendingSelection}
        title={t('hooksDiscardChanges')}
        description={t('hooksDiscardChangesHint')}
        confirmLabel={t('discard')}
        onOpenChange={(open) => !open && setPendingSelection('')}
        onConfirm={() => {
          if (pendingSelection.startsWith('__new__:')) {
            const activation = pendingSelection.slice('__new__:'.length);
            setPendingSelection('');
            applyProfile({
              id: `profile-${Date.now()}`,
              name: t('hooksNewProfile'),
              kind: 'custom',
              scope: 'project',
              activation,
              enabled: true,
              editable: true,
              hooks: {},
              _isNew: true,
            });
            return;
          }
          const next = profiles.find((profile) => profile.id === pendingSelection) || null;
          setPendingSelection('');
          applyProfile(next);
        }}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title={t('hooksDeleteProfile')}
        description={t('hooksDeleteProfileHint')}
        confirmLabel={t('delete')}
        loading={saving}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}

/** @deprecated Prefer HookProfilesPane via HooksDialog */
export function HooksPanel() {
  return <HookProfilesPane />;
}

export function HooksDialog({ open, onOpenChange, projectDirs = [] }) {
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && dirty) {
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
      title={t('hooks')}
      description={t('hooksDialogHint')}
    >
      <HookProfilesPane projectDirs={projectDirs} onDirtyChange={setDirty} />
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
