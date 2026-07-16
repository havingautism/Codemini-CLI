import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwise,
  CheckCircle,
  FloppyDisk,
  PlugsConnected,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { ResourceLibraryDialog } from '@/components/ResourceLibraryDialog.jsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.jsx';
import { SettingsField } from '@/components/settings/SettingsField.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import * as api from '@/hooks/use-api';
import { t } from '../../i18n/index.js';

function emptyServer() {
  return {
    id: '',
    name: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    timeoutMs: 30000,
    cachedTools: [],
    instructions: '',
    lastConnectedAt: '',
  };
}

function createEditor(server = emptyServer()) {
  return {
    ...emptyServer(),
    ...server,
    argsText: JSON.stringify(server.args || [], null, 2),
    envText: JSON.stringify(server.env || {}, null, 2),
    headersText: JSON.stringify(server.headers || {}, null, 2),
  };
}

function serializeEditor(editor) {
  if (!editor) return null;
  const parseJson = (text, fallback, label) => {
    try {
      return JSON.parse(String(text || '').trim() || JSON.stringify(fallback));
    } catch {
      throw new Error(t('mcpInvalidJson').replace('{{field}}', label));
    }
  };
  const args = parseJson(editor.argsText, [], t('mcpArguments'));
  const env = parseJson(editor.envText, {}, t('mcpEnvironment'));
  const headers = parseJson(editor.headersText, {}, t('mcpHeaders'));
  if (!Array.isArray(args)) throw new Error(t('mcpArgumentsArray'));
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new Error(t('mcpEnvironmentObject'));
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new Error(t('mcpHeadersObject'));
  const { argsText, envText, headersText, ...server } = editor;
  return { ...server, args, env, headers, timeoutMs: Number(editor.timeoutMs || 30000) };
}

function serverKey(server) {
  return String(server?.id || '');
}

function serverSubtitle(server) {
  if (server.transport === 'http') return server.url || t('mcpHttp');
  return [server.command, ...(server.args || [])].filter(Boolean).join(' ') || t('mcpStdio');
}

function McpPanel({ onDirtyChange }) {
  const [servers, setServers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [originalId, setOriginalId] = useState('');
  const [editor, setEditor] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  const dirty = !!editor && JSON.stringify(editor) !== baseline;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const applyServer = useCallback((server) => {
    const next = server ? createEditor(server) : null;
    setSelectedId(serverKey(server));
    setOriginalId(serverKey(server));
    setEditor(next);
    setBaseline(next ? JSON.stringify(next) : '');
    setError('');
    setNotice('');
  }, []);

  const load = useCallback(async (preferredId = '') => {
    setLoading(true);
    setError('');
    try {
      const result = await api.fetchMcpServers();
      const next = Array.isArray(result?.servers) ? result.servers : [];
      setServers(next);
      applyServer(
        next.find((server) => server.id === preferredId)
          || next.find((server) => server.id === selectedId)
          || next[0]
          || null,
      );
    } catch (err) {
      setError(err?.message || t('mcpLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [applyServer, selectedId]);

  useEffect(() => { load(); }, []);

  const selectServer = (server) => {
    if (dirty && !window.confirm(t('mcpDiscardChangesHint'))) return;
    applyServer(server);
  };

  const addServer = () => {
    if (dirty && !window.confirm(t('mcpDiscardChangesHint'))) return;
    const next = createEditor();
    setSelectedId('__new__');
    setOriginalId('');
    setEditor(next);
    setBaseline(JSON.stringify(emptyServer()));
    setError('');
    setNotice('');
  };

  const update = (patch) => {
    setEditor((current) => ({ ...current, ...patch }));
    setError('');
    setNotice('');
  };

  const testConnection = async () => {
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const server = serializeEditor(editor);
      const result = await api.testMcpServer(server);
      const next = {
        ...editor,
        cachedTools: result.tools || [],
        instructions: result.instructions || '',
        lastConnectedAt: result.connectedAt || new Date().toISOString(),
      };
      setEditor(next);
      setNotice(t('mcpTestSucceeded').replace('{{count}}', String(result.tools?.length || 0)));
    } catch (err) {
      setError(err?.message || t('mcpTestFailed'));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const server = serializeEditor(editor);
      const result = await api.saveMcpServer(server, originalId);
      await load(result?.server?.id || server.id);
      setNotice(t('mcpSaved'));
    } catch (err) {
      setError(err?.message || t('mcpSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    setError('');
    try {
      await api.deleteMcpServer(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(err?.message || t('mcpDeleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  const tools = useMemo(() => editor?.cachedTools || [], [editor?.cachedTools]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-(--border-default) p-3 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-(--text-primary)">{t('mcpServers')}</div>
            <p className="text-[11px] leading-4 text-(--text-muted)">{t('mcpServersHint')}</p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => load()} disabled={loading || saving} title={t('refresh')}>
              <ArrowClockwise className={cn(loading && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={addServer} disabled={saving} title={t('mcpAddServer')}>
              <Plus />
            </Button>
          </div>
        </div>
        <div className="min-h-[150px] flex-1 overflow-y-auto">
          {loading ? (
            <Empty className="py-10"><EmptyDescription>{t('loading')}...</EmptyDescription></Empty>
          ) : servers.length === 0 ? (
            <Empty className="rounded-lg border border-dashed border-(--border-default) py-10">
              <EmptyDescription>{t('mcpNoServers')}</EmptyDescription>
              <Button size="sm" variant="outline" onClick={addServer}><Plus />{t('mcpAddServer')}</Button>
            </Empty>
          ) : (
            <div className="grid gap-1.5">
              {servers.map((server) => (
                <button
                  type="button"
                  key={server.id}
                  onClick={() => selectServer(server)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                    selectedId === server.id
                      ? 'border-(--border-strong) bg-(--bg-active)'
                      : 'border-transparent hover:border-(--border-default) hover:bg-(--bg-hover)',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{server.name}</span>
                    <span className={cn('size-2 rounded-full', server.enabled ? 'bg-emerald-500' : 'bg-(--text-muted)')} />
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10px] text-(--text-muted)">{serverSubtitle(server)}</span>
                  <span className="mt-1.5 flex gap-1.5">
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{server.transport === 'http' ? t('mcpHttp') : t('mcpStdio')}</Badge>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{t('mcpToolCount').replace('{{count}}', String(server.cachedTools?.length || 0))}</Badge>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        {!editor ? (
          <Empty className="m-4 flex-1 rounded-lg border border-dashed border-(--border-default)">
            <PlugsConnected size={28} className="text-(--text-muted)" />
            <EmptyDescription>{t('mcpSelectServer')}</EmptyDescription>
            <Button variant="outline" onClick={addServer}><Plus />{t('mcpAddServer')}</Button>
          </Empty>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--border-default) px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold">{editor.name || t('mcpNewServer')}</div>
                <p className="text-[11px] text-(--text-muted)">{t('mcpEditorHint')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-(--text-muted)">{editor.enabled ? t('enabled') : t('disabled')}</span>
                <Switch checked={editor.enabled} onCheckedChange={(enabled) => update({ enabled })} disabled={saving || testing} />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="mx-auto grid max-w-3xl gap-5">
                {error ? <Alert variant="destructive"><WarningCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
                {notice ? <Alert><CheckCircle /><AlertDescription>{notice}</AlertDescription></Alert> : null}
                <Alert><AlertDescription>{t('mcpSecurityHint')}</AlertDescription></Alert>

                <div className="grid gap-4 sm:grid-cols-2">
                  <SettingsField id="mcp-name" label={t('name')}>
                    <Input value={editor.name} onChange={(event) => update({ name: event.target.value })} onBlur={() => {
                      if (!editor.id && editor.name) update({ id: editor.name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') });
                    }} />
                  </SettingsField>
                  <SettingsField id="mcp-id" label={t('mcpServerId')} description={t('mcpServerIdHint')}>
                    <Input value={editor.id} className="font-mono" onChange={(event) => update({ id: event.target.value })} />
                  </SettingsField>
                  <SettingsField id="mcp-transport" label={t('mcpTransport')} className="sm:col-span-2">
                    <Select value={editor.transport} onValueChange={(transport) => update({ transport })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stdio">{t('mcpStdio')} · {t('mcpStdioHint')}</SelectItem>
                        <SelectItem value="http">{t('mcpHttp')} · {t('mcpHttpHint')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsField>
                </div>

                {editor.transport === 'stdio' ? (
                  <div className="grid gap-4 rounded-xl border border-(--border-default) bg-(--bg-subtle)/40 p-4">
                    <SettingsField id="mcp-command" label={t('mcpCommand')} description={t('mcpCommandHint')}>
                      <Input value={editor.command} className="font-mono" placeholder="npx" onChange={(event) => update({ command: event.target.value })} />
                    </SettingsField>
                    <SettingsField id="mcp-args" label={t('mcpArguments')} description={t('mcpJsonArrayHint')}>
                      <Textarea value={editor.argsText} className="min-h-24 font-mono text-[12px]" onChange={(event) => update({ argsText: event.target.value })} />
                    </SettingsField>
                    <SettingsField id="mcp-cwd" label={t('mcpWorkingDirectory')}>
                      <Input value={editor.cwd} className="font-mono" onChange={(event) => update({ cwd: event.target.value })} />
                    </SettingsField>
                    <SettingsField id="mcp-env" label={t('mcpEnvironment')} description={t('mcpEnvHint')}>
                      <Textarea value={editor.envText} className="min-h-24 font-mono text-[12px]" onChange={(event) => update({ envText: event.target.value })} />
                    </SettingsField>
                  </div>
                ) : (
                  <div className="grid gap-4 rounded-xl border border-(--border-default) bg-(--bg-subtle)/40 p-4">
                    <SettingsField id="mcp-url" label={t('mcpUrl')} description={t('mcpUrlHint')}>
                      <Input value={editor.url} className="font-mono" placeholder="https://example.com/mcp" onChange={(event) => update({ url: event.target.value })} />
                    </SettingsField>
                    <SettingsField id="mcp-headers" label={t('mcpHeaders')} description={t('mcpHeadersHint')}>
                      <Textarea value={editor.headersText} className="min-h-24 font-mono text-[12px]" onChange={(event) => update({ headersText: event.target.value })} />
                    </SettingsField>
                  </div>
                )}

                <SettingsField id="mcp-timeout" label={t('mcpTimeout')} description={t('mcpTimeoutHint')}>
                  <Input type="number" min="1000" step="1000" value={editor.timeoutMs} onChange={(event) => update({ timeoutMs: event.target.value })} />
                </SettingsField>

                <div className="rounded-xl border border-(--border-default) p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-medium">{t('mcpDiscoveredTools')}</div>
                      <p className="text-[11px] text-(--text-muted)">{t('mcpDiscoveredToolsHint')}</p>
                    </div>
                    <Badge variant="secondary">{tools.length}</Badge>
                  </div>
                  {tools.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {tools.map((tool) => (
                        <div key={tool.name} className="rounded-lg bg-(--bg-subtle) px-3 py-2">
                          <div className="truncate font-mono text-[12px] font-medium">{tool.name}</div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">{tool.description || t('mcpNoDescription')}</p>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-[12px] text-(--text-muted)">{t('mcpTestToDiscover')}</p>}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-(--border-default) px-4 py-3 sm:px-5">
              {originalId ? (
                <Button variant="ghost" className="text-(--accent-red)" onClick={() => setPendingDelete({ id: originalId, name: editor.name })} disabled={saving || testing}>
                  <Trash />{t('delete')}
                </Button>
              ) : null}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" onClick={testConnection} disabled={saving || testing}>
                  <PlugsConnected />{testing ? t('mcpTesting') : t('mcpTestConnection')}
                </Button>
                <Button onClick={save} disabled={saving || testing || !dirty}>
                  <FloppyDisk />{saving ? t('saving') : t('save')}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      <ConfirmDialog
        open={!!pendingDelete}
        title={t('mcpDeleteServer')}
        description={t('mcpDeleteServerHint').replace('{{name}}', pendingDelete?.name || '')}
        confirmLabel={t('delete')}
        confirmVariant="destructive"
        loading={saving}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}

export function McpDialog({ open, onOpenChange }) {
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
        icon={PlugsConnected}
        title={t('mcp')}
        description={t('mcpDialogHint')}
      >
        <McpPanel onDirtyChange={setDirty} />
      </ResourceLibraryDialog>
      <ConfirmDialog
        open={confirmClose}
        title={t('mcpDiscardChanges')}
        description={t('mcpDiscardChangesHint')}
        confirmLabel={t('discard')}
        confirmVariant="destructive"
        onOpenChange={setConfirmClose}
        onConfirm={() => { setConfirmClose(false); onOpenChange(false); }}
      />
    </>
  );
}

