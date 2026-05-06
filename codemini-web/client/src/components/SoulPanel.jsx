import { useState, useEffect, useCallback } from 'react';
import { Plus, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import * as api from '@/hooks/use-api';

function SoulEditor({ soul, onSave, onCancel }) {
  const [name, setName] = useState(soul?.name || '');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const isNew = !soul;

  useEffect(() => {
    if (soul) {
      setLoading(true);
      api.fetchSoulContent(soul.name).then(data => {
        setContent(data.content || '');
      }).catch(() => {}).finally(() => setLoading(false));
    }
  }, [soul]);

  const handleSave = async () => {
    if (isNew) {
      await api.createSoul({ name, content });
    } else {
      await api.updateSoulContent(soul.name, content);
    }
    onSave();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-[13px] text-(--text-muted) w-20 shrink-0">名称</label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={!isNew}
          placeholder="my-soul"
          className="flex-1 h-8 text-[13px]"
        />
      </div>
      <div>
        <label className="text-[13px] text-(--text-muted) mb-1.5 block">灵魂内容</label>
        {loading ? (
          <div className="text-[12px] text-(--text-muted) py-4 text-center">加载中...</div>
        ) : (
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="min-h-[200px] text-[13px] font-mono"
            placeholder="You are a helpful assistant with a specific personality..."
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} className="text-[13px]">取消</Button>
        <Button
          onClick={handleSave}
          disabled={loading || !content || (isNew && !name)}
          className="text-[13px]"
        >
          {isNew ? '创建' : '保存'}
        </Button>
      </div>
    </div>
  );
}

function ViewDialog({ soul, open, onOpenChange }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && soul) {
      setLoading(true);
      api.fetchSoulContent(soul.name).then(data => {
        setContent(data.content || '');
      }).catch(() => {}).finally(() => setLoading(false));
    }
  }, [open, soul]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{soul?.name} - 内容预览</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="text-[12px] text-(--text-muted) py-4 text-center">加载中...</div>
        ) : (
          <pre className="text-[13px] whitespace-pre-wrap break-all bg-(--bg-secondary) rounded-lg p-3 max-h-[400px] overflow-y-auto font-mono">
            {content}
          </pre>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-[13px]">关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SoulPanel() {
  const [souls, setSouls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewSoul, setViewSoul] = useState(null);

  const loadSouls = useCallback(async () => {
    try {
      const list = await api.fetchSouls();
      setSouls(Array.isArray(list) ? list : []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadSouls(); }, [loadSouls]);

  const handleActivate = async (name) => {
    await api.activateSoul(name);
    loadSouls();
  };

  const handleDelete = async (name) => {
    await api.deleteSoul(name);
    loadSouls();
  };

  const handleSave = () => {
    setEditing(null);
    loadSouls();
  };

  if (loading) return <div className="text-[12px] text-(--text-muted) py-4 text-center">加载中...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          onClick={() => setEditing('new')}
          size="xs"
        >
          <Plus size={12} />
          添加灵魂
        </Button>
      </div>

      {editing && (
        <>
          <Separator className="bg-(--border-default)" />
          <SoulEditor
            soul={editing === 'new' ? null : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
          <Separator className="bg-(--border-default)" />
        </>
      )}

      {souls.length === 0 && !editing && (
        <div className="text-[12px] text-(--text-muted) py-4 text-center">暂无灵魂</div>
      )}

      <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {souls.map(soul => (
          <div
            key={`${soul.scope}-${soul.name}`}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors',
              soul.active
                ? 'border-(--border-strong) bg-(--bg-active)'
                : 'border-(--border-default) bg-transparent hover:bg-(--bg-hover)'
            )}
          >
            <User
              size={14}
              className={cn(
                'shrink-0',
                soul.active ? 'text-(--text-primary)' : 'text-(--text-muted)'
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-(--text-primary) truncate">{soul.name}</span>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4 rounded-md font-normal"
                >
                  {soul.scope === 'builtin' ? '内置' : '自定义'}
                </Badge>
                {soul.active && (
                  <Badge className="text-[10px] px-1.5 py-0 h-4 rounded-md bg-(--text-primary) text-(--bg-primary) border-0 font-normal">
                    当前
                  </Badge>
                )}
              </div>
              {soul.preview && (
                <div className="text-[11px] text-(--text-muted) truncate mt-0.5">{soul.preview}</div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setViewSoul(soul)}
              >
                查看
              </Button>
              {!soul.active && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleActivate(soul.name)}
                >
                  激活
                </Button>
              )}
              {soul.scope !== 'builtin' && (
                <>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditing(soul)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => { if (confirm(`确定删除灵魂 "${soul.name}"？`)) handleDelete(soul.name); }}
                    className="text-(--accent-red) hover:text-(--accent-red)"
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <ViewDialog
        soul={viewSoul}
        open={!!viewSoul}
        onOpenChange={(open) => { if (!open) setViewSoul(null); }}
      />
    </div>
  );
}
