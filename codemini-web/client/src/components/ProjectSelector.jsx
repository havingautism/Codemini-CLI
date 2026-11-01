import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowUp, ArrowRight, FolderSimple, MagnifyingGlass, Check, X, GitLogo } from '@/lib/icons';
import { parentDirectory } from '@/lib/workspace-picker';
import * as api from '@/hooks/use-api';
import { t } from '../../i18n/index.js';
import './project-selector.css';

export function ProjectSelector({ open, onOpenChange, onOpenProject, initialPath }) {
  const [pathInput, setPathInput] = useState('');
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const request = useRef(0);
  const searchInput = useRef(null);
  const browse = async dir => {
    const id = ++request.current;
    setLoading(true); setError(''); setQuery(''); setSelected(null);
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
  const confirm = async () => {
    if (busy || loading || !data?.path || pathInput !== data.path || error) return;
    setBusy(true);
    try { await onOpenProject(selected?.path || data.path, { newSession: true }); onOpenChange(false); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const dirs = (data?.path ? data.dirs || [] : data?.roots || []).filter(dir => dir.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const parent = parentDirectory(data?.path || '');
  return (
    <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
      <DialogContent className="project-picker">
        <DialogHeader><DialogTitle>{t('selectProject')}</DialogTitle></DialogHeader>
        <div className="project-picker-toolbar">
          <button type="button" className="project-picker-icon" aria-label={t('projectParent')} disabled={loading || busy || !data?.path} onClick={() => browse(parent)}><ArrowUp size={17} /></button>
          <div className="project-picker-address">
            <FolderSimple size={16} aria-hidden="true" />
            <Input aria-label={t('scheduledProject')} value={pathInput} onChange={event => setPathInput(event.target.value)} placeholder={t('enterOrBrowse')} disabled={busy} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); browse(pathInput.trim()); } }} />
            <button type="button" className="project-picker-icon" disabled={loading || busy} onClick={() => browse(pathInput.trim())} aria-label={t('projectGo')}><ArrowRight size={16} /></button>
          </div>
        </div>
        <div className="project-picker-browser">
          <section className="project-picker-main" aria-label={t('projectFolders')}>
            <div className="project-picker-search" data-disabled={busy || loading}>
              <MagnifyingGlass size={16} aria-hidden="true" />
              <Input ref={searchInput} value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} placeholder={t('projectFilter')} aria-label={t('projectFilter')} disabled={busy || loading} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
              {query && <button type="button" className="project-picker-clear" aria-label={t('projectClearSearch')} disabled={busy || loading} onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X size={14} /></button>}
            </div>
            <div aria-busy={loading} className="project-picker-list">
              {loading ? <p role="status" className="project-picker-empty">{t('loading')}</p> : dirs.map(dir => <div key={dir.path} className="project-picker-row" data-selected={selected?.path === dir.path}>
                <button type="button" className="project-picker-file" aria-pressed={selected?.path === dir.path} disabled={busy} onClick={() => setSelected(dir)} onDoubleClick={() => browse(dir.path)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); browse(dir.path); } }}>
                  <FolderSimple size={18} /><span>{dir.name}</span>{dir.isGit && <GitLogo size={16} aria-label="Git" className="text-(--text-muted)" />}{selected?.path === dir.path && <Check size={15} />}
                </button>
                <button type="button" className="project-picker-enter" aria-label={`${t('projectEnter')}: ${dir.name}`} disabled={busy} onClick={() => browse(dir.path)}><ArrowRight size={15} /></button>
              </div>)}
              {!loading && !error && !dirs.length && <div className="project-picker-empty"><FolderSimple size={27} aria-hidden="true" /><p>{query ? t('projectNoMatches') : t('noSubDirs')}</p></div>}
            </div>
          </section>
        </div>
        {error && <p role="alert" className="project-picker-error" title={error}>{t('projectPickerError')}</p>}
        <div className="project-picker-bottom">
          <DialogFooter><Button type="button" variant="tab" disabled={busy} onClick={() => onOpenChange(false)}>{t('cancel')}</Button><Button type="button" disabled={loading || busy || !data?.path || pathInput !== data.path || Boolean(error)} onClick={confirm}>{busy ? t('loading') : t('projectSelectFolder')}</Button></DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
