import { useCallback, useEffect, useState } from 'react';
import {
  ArrowClockwise,
  CheckCircle,
  FloppyDisk,
  Folder,
  PencilSimple,
  PlugsConnected,
  Plus,
  Trash,
  WarningCircle,
} from '@/lib/icons';
import { ResourceLibraryDialog } from '@/components/ResourceLibraryDialog.jsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.jsx';
import { SettingsField } from '@/components/settings/SettingsField.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { buildMcpToolDisplayLabels } from '../../../../src/core/mcp-tool-display.js';
import { setMcpToolDisplayLabels } from '../../../../src/core/tool-display.js';
import { applyMcpEditorPatch } from '@/lib/mcp-editor-state.js';
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

function createEditor(server) {
  const source = server || emptyServer();
  return {
    ...emptyServer(),
    ...source,
    argsText: JSON.stringify(source.args || [], null, 2),
    envText: JSON.stringify(source.env || {}, null, 2),
    headersText: JSON.stringify(source.headers || {}, null, 2),
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

function serverSubtitle(server) {
  if (server.transport === 'http') return server.url || t('mcpHttp');
  return [server.command, ...(server.args || [])].filter(Boolean).join(' ') || t('mcpStdio');
}

function McpServerEditorDialog({ open, server, onOpenChange, onSaved }) {
  const [editor, setEditor] = useState(() => createEditor(server));
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const originalId = String(server?.id || '');

  useEffect(() => {
    if (!open) return;
    const next = createEditor(server);
    setEditor(next);
    setBaseline(JSON.stringify(next));
    setError('');
    setNotice('');
    setConfirmClose(false);
  }, [open, server]);

  const dirty = JSON.stringify(editor) !== baseline;
  const tools = editor.cachedTools || [];

  const update = (patch) => {
    setEditor((current) => applyMcpEditorPatch(current, patch));
    setError('');
    setNotice('');
  };

  const requestClose = (nextOpen) => {
    if (!nextOpen && dirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(nextOpen);
  };

  const testConnection = async () => {
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const normalized = serializeEditor(editor);
      const result = await api.testMcpServer(normalized);
      const enabledByName = new Map(
        (editor.cachedTools || []).map((tool) => [tool.name, tool.enabled !== false]),
      );
      setEditor((current) => ({
        ...current,
        cachedTools: (result.tools || []).map((tool) => ({
          ...tool,
          enabled: enabledByName.get(tool.name) ?? true,
        })),
        instructions: result.instructions || '',
        lastConnectedAt: result.connectedAt || new Date().toISOString(),
      }));
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
      const normalized = serializeEditor(editor);
      const result = await api.saveMcpServer(normalized, originalId);
      onSaved(result?.server || normalized);
    } catch (err) {
      setError(err?.message || t('mcpSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-[780px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[780px]">
          <DialogHeader className="shrink-0 border-b border-(--border-default) px-5 py-4 sm:px-6">
            <DialogTitle>{originalId ? t('mcpEditServer') : t('mcpNewServer')}</DialogTitle>
            <DialogDescription>{t('mcpEditorHint')}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="grid gap-5">
              {error ? <Alert variant="destructive"><WarningCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
              {notice ? <Alert><CheckCircle /><AlertDescription>{notice}</AlertDescription></Alert> : null}
              <Alert><AlertDescription>{t('mcpSecurityHint')}</AlertDescription></Alert>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-(--border-default) px-4 py-3">
                <div>
                  <div className="text-[13px] font-medium">{t('enabled')}</div>
                  <p className="text-[11px] text-(--text-muted)">{t('mcpEnableHint')}</p>
                </div>
                <Switch checked={editor.enabled} onCheckedChange={(enabled) => update({ enabled })} disabled={saving || testing} />
              </div>

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
                    {tools.map((tool, index) => (
                      <div key={tool.name} className="flex items-start gap-3 rounded-lg bg-(--bg-subtle) px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] font-medium">{tool.name}</div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">{tool.description || t('mcpNoDescription')}</p>
                        </div>
                        <Switch
                          checked={tool.enabled !== false}
                          aria-label={tool.name}
                          onCheckedChange={(enabled) => update({
                            cachedTools: tools.map((item, toolIndex) => toolIndex === index ? { ...item, enabled } : item),
                          })}
                        />
                      </div>
                    ))}
                  </div>
                ) : <p className="text-[12px] text-(--text-muted)">{t('mcpTestToDiscover')}</p>}
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-(--border-default) px-5 py-4 sm:px-6">
            <Button variant="outline" onClick={() => requestClose(false)} disabled={saving || testing}>{t('cancel')}</Button>
            <Button variant="outline" onClick={testConnection} disabled={saving || testing}>
              <PlugsConnected />{testing ? t('mcpTesting') : t('mcpTestConnection')}
            </Button>
            <Button onClick={save} disabled={saving || testing || !dirty}>
              <FloppyDisk />{saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function McpToolSyncDialog({ preview, selectedNames, applying, onSelectedNamesChange, onOpenChange, onApply }) {
  const tools = preview?.tools || [];
  const existingNames = new Set((preview?.server?.cachedTools || []).map((tool) => tool.name));

  const toggle = (toolName, selected) => {
    const next = new Set(selectedNames);
    if (selected) next.add(toolName);
    else next.delete(toolName);
    onSelectedNamesChange(next);
  };

  return (
    <Dialog open={!!preview} onOpenChange={(open) => !applying && onOpenChange(open)}>
      <DialogContent className="flex max-h-[82vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="shrink-0 border-b border-(--border-default) px-5 py-4 sm:px-6">
          <DialogTitle>{t('mcpUpdateTools')}</DialogTitle>
          <DialogDescription>
            {t('mcpUpdateToolsHint').replace('{{name}}', preview?.server?.name || '')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--border-default) px-5 py-3 sm:px-6">
          <span className="text-[12px] text-(--text-muted)">
            {t('mcpSelectedToolCount').replace('{{selected}}', String(selectedNames.size)).replace('{{count}}', String(tools.length))}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSelectedNamesChange(new Set(tools.map((tool) => tool.name)))}>{t('mcpSelectAll')}</Button>
            <Button variant="ghost" size="sm" onClick={() => onSelectedNamesChange(new Set())}>{t('mcpSelectNone')}</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {tools.length ? (
            <div className="grid gap-2">
              {tools.map((tool) => {
                const existing = existingNames.has(tool.name);
                return (
                  <div key={tool.name} className="flex items-start gap-3 rounded-xl border border-(--border-default) px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-[12px] font-medium">{tool.name}</span>
                        <Badge variant={existing ? 'outline' : 'secondary'} className="h-4 px-1.5 text-[10px]">
                          {existing ? t('mcpExistingTool') : t('mcpNewTool')}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-(--text-muted)">{tool.description || t('mcpNoDescription')}</p>
                    </div>
                    <Switch checked={selectedNames.has(tool.name)} aria-label={tool.name} onCheckedChange={(selected) => toggle(tool.name, selected)} />
                  </div>
                );
              })}
            </div>
          ) : <Empty className="py-12"><EmptyDescription>{t('mcpNoRemoteTools')}</EmptyDescription></Empty>}
        </div>
        <DialogFooter className="shrink-0 border-t border-(--border-default) px-5 py-4 sm:px-6">
          <Button variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button disabled={applying || selectedNames.size === 0} onClick={onApply}>
            <ArrowClockwise className={cn(applying && 'animate-spin')} />
            {applying ? t('saving') : t('mcpApplySelectedUpdates')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function McpPanel() {
  const [servers, setServers] = useState([]);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [editorServer, setEditorServer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [syncPreview, setSyncPreview] = useState(null);
  const [selectedSyncTools, setSelectedSyncTools] = useState(() => new Set());
  const [syncingServerId, setSyncingServerId] = useState('');
  const [applyingSync, setApplyingSync] = useState(false);

  const load = useCallback(async (preferredId = '') => {
    setLoading(true);
    setError('');
    try {
      const result = await api.fetchMcpServers();
      const next = Array.isArray(result?.servers) ? result.servers : [];
      setMcpToolDisplayLabels(buildMcpToolDisplayLabels(next));
      setServers(next);
      setSelectedServerId((current) => {
        if (preferredId && next.some((server) => server.id === preferredId)) return preferredId;
        if (next.some((server) => server.id === current)) return current;
        return next[0]?.id || '';
      });
    } catch (err) {
      setError(err?.message || t('mcpLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const handleSaved = async (server) => {
    setEditorServer(null);
    await load(server.id);
    setNotice(t('mcpSaved'));
  };

  const saveServerPatch = async (server, patch) => {
    const previous = servers;
    const updated = { ...server, ...patch };
    setServers((current) => current.map((item) => item.id === server.id ? updated : item));
    setError('');
    setNotice('');
    try {
      await api.saveMcpServer(updated, server.id);
    } catch (err) {
      setServers(previous);
      setError(err?.message || t('mcpSaveFailed'));
    }
  };

  const toggleTool = (server, toolName, enabled) => {
    saveServerPatch(server, {
      cachedTools: (server.cachedTools || []).map((tool) =>
        tool.name === toolName ? { ...tool, enabled } : tool,
      ),
    });
  };

  const previewToolUpdate = async (server) => {
    setSyncingServerId(server.id);
    setError('');
    setNotice('');
    try {
      const result = await api.testMcpServer(server);
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      const existingNames = new Set((server.cachedTools || []).map((tool) => tool.name));
      setSelectedSyncTools(new Set(tools.filter((tool) => existingNames.has(tool.name)).map((tool) => tool.name)));
      setSyncPreview({ server, tools });
    } catch (err) {
      setError(err?.message || t('mcpTestFailed'));
    } finally {
      setSyncingServerId('');
    }
  };

  const applyToolUpdate = async () => {
    if (!syncPreview) return;
    setApplyingSync(true);
    const { server, tools } = syncPreview;
    const fetchedByName = new Map(tools.map((tool) => [tool.name, tool]));
    const existingNames = new Set((server.cachedTools || []).map((tool) => tool.name));
    const nextTools = (server.cachedTools || []).map((tool) => {
      if (!selectedSyncTools.has(tool.name)) return tool;
      return { ...fetchedByName.get(tool.name), enabled: tool.enabled !== false };
    });
    for (const toolName of selectedSyncTools) {
      if (!existingNames.has(toolName) && fetchedByName.has(toolName)) {
        nextTools.push({ ...fetchedByName.get(toolName), enabled: true });
      }
    }
    try {
      await api.saveMcpServer({
        ...server,
        cachedTools: nextTools,
        lastConnectedAt: new Date().toISOString(),
      }, server.id);
      setSyncPreview(null);
      await load(server.id);
      setNotice(t('mcpToolsUpdated').replace('{{count}}', String(selectedSyncTools.size)));
    } catch (err) {
      setError(err?.message || t('mcpSaveFailed'));
    } finally {
      setApplyingSync(false);
    }
  };

  const selectedServer = servers.find((server) => server.id === selectedServerId) || null;
  const selectedTools = selectedServer?.cachedTools || [];
  const selectedEnabledTools = selectedTools.filter((tool) => tool.enabled !== false).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(220px,42%)_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-1">
        <div className="flex min-h-0 flex-col border-b border-(--border-default) lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-(--border-default) px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-(--text-primary)">{t('mcpServers')}</div>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">{t('mcpServersHint')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="icon-sm" onClick={() => load()} disabled={loading || saving} title={t('refresh')}>
                <ArrowClockwise className={cn(loading && 'animate-spin')} />
              </Button>
              <Button size="sm" onClick={() => setEditorServer(emptyServer())} disabled={saving}>
                <Plus />{t('mcpAddServer')}
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 [scrollbar-gutter:stable]">
            <div className="grid min-w-0 gap-2">
              {error ? <Alert variant="destructive"><WarningCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
              {notice ? <Alert><CheckCircle /><AlertDescription>{notice}</AlertDescription></Alert> : null}
              {loading ? (
                <Empty className="py-12"><EmptyDescription>{t('loading')}...</EmptyDescription></Empty>
              ) : servers.length === 0 ? (
                <Empty className="rounded-xl border border-dashed border-(--border-default) py-12">
                  <PlugsConnected size={28} className="text-(--text-muted)" />
                  <EmptyDescription>{t('mcpNoServers')}</EmptyDescription>
                  <Button size="sm" variant="outline" onClick={() => setEditorServer(emptyServer())}><Plus />{t('mcpAddServer')}</Button>
                </Empty>
              ) : servers.map((server) => {
                const tools = server.cachedTools || [];
                const enabledTools = tools.filter((tool) => tool.enabled !== false).length;
                const selected = server.id === selectedServerId;
                return (
                  <button
                    key={server.id}
                    type="button"
                    onClick={() => setSelectedServerId(server.id)}
                    className={cn(
                      'flex w-full min-w-0 max-w-full items-start gap-3 rounded-lg border border-transparent px-3 py-3 text-left outline-none transition-[background-color,border-color,box-shadow] focus-visible:shadow-[0_0_0_3px_var(--control-focus-ring)]',
                      selected ? 'bg-(--bg-active)' : 'hover:bg-(--bg-hover)',
                      !server.enabled && 'text-(--text-muted)',
                    )}
                    aria-pressed={selected}
                    title={serverSubtitle(server)}
                  >
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', server.enabled ? 'bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.14)]' : 'bg-(--border-default)')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-(--text-primary)">{server.name}</span>
                        <Badge variant="outline" className="h-5 shrink-0 rounded-md px-1.5 text-[10px]">{server.transport === 'http' ? t('mcpHttp') : t('mcpStdio')}</Badge>
                      </span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-(--text-muted)">{serverSubtitle(server)}</span>
                      <span className="mt-1.5 block text-[11px] text-(--text-muted)">{t('mcpEnabledToolCount').replace('{{enabled}}', String(enabledTools)).replace('{{count}}', String(tools.length))}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-(--bg-primary)">
          {selectedServer ? (
            <>
              <div className="flex shrink-0 items-start gap-4 border-b border-(--border-default) px-5 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-subtle) text-(--text-secondary)">
                  <Folder size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[17px] font-semibold leading-6 text-(--text-primary)">{selectedServer.name}</h3>
                    <Badge variant="secondary" className="h-6 rounded-md px-2 text-[11px]">{selectedServer.transport === 'http' ? t('mcpHttp') : t('mcpStdio')}</Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] leading-5 text-(--text-muted)" title={serverSubtitle(selectedServer)}>{serverSubtitle(selectedServer)}</p>
                  <p className="mt-1 text-[11px] text-(--text-muted)">{t('mcpEnabledToolCount').replace('{{enabled}}', String(selectedEnabledTools)).replace('{{count}}', String(selectedTools.length))}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="outline" onClick={() => previewToolUpdate(selectedServer)} disabled={!!syncingServerId || saving}>
                    <ArrowClockwise size={14} className={cn(syncingServerId === selectedServer.id && 'animate-spin')} />
                    {t('mcpUpdateTools')}
                  </Button>
                  <Button variant="outline" onClick={() => setEditorServer(selectedServer)}><PencilSimple size={14} />{t('edit')}</Button>
                  <Button variant="ghost" size="icon-sm" className="text-(--accent-red) hover:bg-(--accent-red-bg) hover:text-(--accent-red)" onClick={() => setPendingDelete({ id: selectedServer.id, name: selectedServer.name })} title={t('delete')} disabled={saving}><Trash size={15} /></Button>
                  <Switch checked={selectedServer.enabled} aria-label={`${selectedServer.name} ${t('enabled')}`} onCheckedChange={(enabled) => saveServerPatch(selectedServer, { enabled })} disabled={saving} />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-(--text-primary)">{t('mcpDiscoveredTools')}</div>
                    <p className="mt-0.5 text-[11px] leading-4 text-(--text-muted)">{t('mcpDefaultToolsHint')}</p>
                  </div>
                  <Badge variant="secondary">{selectedTools.length}</Badge>
                </div>
                {selectedTools.length ? (
                  <div className="grid gap-2 xl:grid-cols-2">
                    {selectedTools.map((tool) => (
                      <div key={tool.name} className="flex min-w-0 items-start gap-3 rounded-xl border border-(--border-default) bg-(--bg-subtle)/30 px-3 py-3 transition-colors hover:bg-(--bg-hover)">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] font-medium">{tool.name}</div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">{tool.description || t('mcpNoDescription')}</p>
                        </div>
                        <Switch checked={tool.enabled !== false} aria-label={tool.name} onCheckedChange={(enabled) => toggleTool(selectedServer, tool.name, enabled)} disabled={!selectedServer.enabled || saving} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty className="rounded-xl border border-dashed border-(--border-default) py-14">
                    <PlugsConnected size={26} className="text-(--text-muted)" />
                    <EmptyDescription>{t('mcpTestToDiscover')}</EmptyDescription>
                    <Button variant="outline" size="sm" onClick={() => setEditorServer(selectedServer)}>{t('mcpTestConnection')}</Button>
                  </Empty>
                )}
              </div>
            </>
          ) : (
            <Empty className="h-full"><PlugsConnected size={28} className="text-(--text-muted)" /><EmptyDescription>{t('mcpSelectServer')}</EmptyDescription></Empty>
          )}
        </div>
      </div>

      <McpServerEditorDialog
        open={!!editorServer}
        server={editorServer}
        onOpenChange={(nextOpen) => { if (!nextOpen) setEditorServer(null); }}
        onSaved={handleSaved}
      />
      <McpToolSyncDialog
        preview={syncPreview}
        selectedNames={selectedSyncTools}
        applying={applyingSync}
        onSelectedNamesChange={setSelectedSyncTools}
        onOpenChange={(open) => { if (!open) setSyncPreview(null); }}
        onApply={applyToolUpdate}
      />
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
  return (
    <ResourceLibraryDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('mcp')}
      description={t('mcpDialogHint')}
    >
      <McpPanel />
    </ResourceLibraryDialog>
  );
}
