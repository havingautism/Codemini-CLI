import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowUp, ArrowRight, FolderSimple, MagnifyingGlass, Check, X, GitLogo, Plus } from '@/lib/icons';
import { parentDirectory } from '@/lib/workspace-picker';
import * as api from '@/hooks/use-api';
import { t } from '../../i18n/index.js';
import './project-selector.css';

const FOLDER_ERRORS = {
  INVALID_NAME: 'projectCreateFolderInvalidName',
  INVALID_PARENT: 'projectCreateFolderMissingParent',
  EINVAL: 'projectCreateFolderInvalidName',
  ENAMETOOLONG: 'projectCreateFolderInvalidName',
  EEXIST: 'projectCreateFolderExists',
  EACCES: 'projectCreateFolderPermission',
  EPERM: 'projectCreateFolderPermission',
  EROFS: 'projectCreateFolderPermission',
  ENOTDIR: 'projectCreateFolderMissingParent',
  ENOENT: 'projectCreateFolderMissingParent',
};

export function ProjectSelector({ open, onOpenChange, onOpenProject, initialPath }) {
  const [pathInput, setPathInput] = useState('');
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [folderName, setFolderName] = useState(null);
  const [folderError, setFolderError] = useState('');
  const [creating, setCreating] = useState(false);
  const request = useRef(0);
  const searchInput = useRef(null);
  const createButton = useRef(null);
  const folderInput = useRef(null);
  const selectedRow = useRef(null);
  const createInFlight = useRef(false);
  const locked = busy || creating;
  const canCreate = Boolean(data?.path && pathInput === data.path && !loading && !locked && !error);

  function cancelFolder() {
    setFolderName(null);
    setFolderError('');
    requestAnimationFrame(() => createButton.current?.focus());
  }

  async function createFolder(event) {
    event.preventDefault();
    if (!canCreate || createInFlight.current || !folderName?.trim()) return;
    const id = request.current;
    createInFlight.current = true;
    setCreating(true);
    setFolderError('');
    try {
      const folder = await api.createProjectFolder(data.path, folderName);
      if (id !== request.current) return;
      setData((previous) => ({
        ...previous,
        dirs: [...(previous.dirs || []).filter((item) => item.path !== folder.path), folder]
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
      setQuery('');
      setSelected(folder);
      setFolderName(null);
      requestAnimationFrame(() => {
        selectedRow.current?.scrollIntoView({ block: 'nearest' });
        selectedRow.current?.focus({ preventScroll: true });
      });
    } catch (err) {
      if (id === request.current) setFolderError(t(FOLDER_ERRORS[err.code] || 'projectCreateFolderError'));
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  }

  const browse = async dir => {
    const id = ++request.current;
    setLoading(true); setError(''); setQuery(''); setSelected(null);
    setFolderName(null); setFolderError('');
    try {
      const result = await api.browseDir(dir);
      if (id !== request.current) return;
      if (result.error) throw new Error(result.error);
      setData(result); setPathInput(result.path || '');
    } catch (err) { if (id === request.current) setError(err.message); }
    finally { if (id === request.current) setLoading(false); }
  };
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setData(null); setError(''); setPathInput(initialPath || ''); setLoading(true);
    const start = async () => {
      let dir = initialPath;
      if (dir === undefined) {
        try { const project = await api.fetchProject(); dir = project.isGeneral ? '' : project.cwd || ''; }
        catch { dir = ''; }
      }
      if (!cancelled) browse(dir || '');
    };
    start();
    return () => { cancelled = true; ++request.current; };
  }, [open, initialPath]);
  const creatingFormOpen = folderName !== null;
  useEffect(() => {
    if (creatingFormOpen) folderInput.current?.focus();
  }, [creatingFormOpen]);
  const confirm = async () => {
    if (locked || loading || !data?.path || pathInput !== data.path || error) return;
    setBusy(true);
    try { await onOpenProject(selected?.path || data.path, { newSession: true }); onOpenChange(false); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const dirs = (data?.path ? data.dirs || [] : data?.roots || []).filter(dir => dir.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const parent = parentDirectory(data?.path || '');
  return (
    <Dialog open={open} onOpenChange={value => { if (!locked) onOpenChange(value); }}>
      <DialogContent className="project-picker p-0" onEscapeKeyDown={(event) => {
        if (!creatingFormOpen) return;
        event.preventDefault();
        if (!creating) cancelFolder();
      }}>
        <DialogHeader><DialogTitle>{t('selectProject')}</DialogTitle></DialogHeader>
        <div className="project-picker-toolbar">
          <button type="button" className="project-picker-icon" aria-label={t('projectParent')} disabled={loading || locked || !data?.path} onClick={() => browse(parent)}><ArrowUp size={17} /></button>
          <div className="project-picker-address">
            <FolderSimple size={16} aria-hidden="true" />
            <Input aria-label={t('scheduledProject')} value={pathInput} onChange={event => setPathInput(event.target.value)} placeholder={t('enterOrBrowse')} disabled={locked} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); browse(pathInput.trim()); } }} />
            <button type="button" className="project-picker-icon" disabled={loading || locked} onClick={() => browse(pathInput.trim())} aria-label={t('projectGo')}><ArrowRight size={16} /></button>
          </div>
        </div>
        <div className="project-picker-browser">
          <section className="project-picker-main" aria-label={t('projectFolders')}>
            <div className="project-picker-list-tools">
            <div className="project-picker-search" data-disabled={locked || loading}>
              <MagnifyingGlass size={16} aria-hidden="true" />
              <Input ref={searchInput} value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} placeholder={t('projectFilter')} aria-label={t('projectFilter')} disabled={locked || loading} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
              {query && <button type="button" className="project-picker-clear" aria-label={t('projectClearSearch')} disabled={locked || loading} onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X size={14} /></button>}
            </div>
              <Button ref={createButton} type="button" variant="outline" size="sm" disabled={!canCreate} aria-expanded={creatingFormOpen} onClick={() => {
                if (creatingFormOpen) cancelFolder();
                else setFolderName('');
              }}><Plus size={15} />{t('projectNewFolder')}</Button>
            </div>
            {creatingFormOpen && (
              <form className="project-picker-create" onSubmit={createFolder}>
                <Input ref={folderInput} aria-label={t('projectFolderName')} placeholder={t('projectFolderName')} value={folderName} aria-invalid={Boolean(folderError)} disabled={creating} onChange={(event) => {
                  setFolderName(event.target.value);
                  setFolderError('');
                }} />
                <Button type="button" variant="ghost" size="sm" disabled={creating} onClick={cancelFolder}>{t('cancel')}</Button>
                <Button type="submit" size="sm" disabled={!canCreate || !folderName.trim()}>{t(creating ? 'loading' : 'projectCreateFolder')}</Button>
                {folderError && <p role="alert" className="project-picker-create-error">{folderError}</p>}
              </form>
            )}
            <div aria-busy={loading} className="project-picker-list">
              {loading ? <p role="status" className="project-picker-empty">{t('loading')}</p> : dirs.map(dir => <div key={dir.path} className="project-picker-row" data-selected={selected?.path === dir.path}>
                <button ref={selected?.path === dir.path ? selectedRow : undefined} type="button" className="project-picker-file" aria-pressed={selected?.path === dir.path} disabled={locked} onClick={() => setSelected(dir)} onDoubleClick={() => browse(dir.path)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); browse(dir.path); } }}>
                  <FolderSimple size={18} /><span>{dir.name}</span>{dir.isGit && <GitLogo size={16} aria-label="Git" className="text-(--text-muted)" />}{selected?.path === dir.path && <Check size={15} />}
                </button>
                <button type="button" className="project-picker-enter" aria-label={`${t('projectEnter')}: ${dir.name}`} disabled={locked} onClick={() => browse(dir.path)}><ArrowRight size={15} /></button>
              </div>)}
              {!loading && !error && !dirs.length && <div className="project-picker-empty"><FolderSimple size={27} aria-hidden="true" /><p>{query ? t('projectNoMatches') : t('noSubDirs')}</p></div>}
            </div>
          </section>
        </div>
        {error && <p role="alert" className="project-picker-error" title={error}>{t('projectPickerError')}</p>}
        <div className="project-picker-bottom">
          <DialogFooter><Button type="button" disabled={!canCreate || creatingFormOpen} onClick={confirm}>{busy ? t('loading') : t('projectSelectFolder')}</Button></DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
