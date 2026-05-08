import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import * as api from '@/hooks/use-api';

const CONFIG_GROUPS = [
  {
    title: 'Gateway',
    keys: [
      { path: 'gateway.base_url', label: 'Base URL', placeholder: 'http://127.0.0.1:8000/v1' },
      { path: 'gateway.api_key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { path: 'gateway.timeout_ms', label: 'Timeout (ms)', type: 'number' },
      { path: 'gateway.max_retries', label: 'Max Retries', type: 'number' }
    ]
  },
  {
    title: 'Model',
    keys: [
      { path: 'model.name', label: 'Model Name', placeholder: 'gpt-4.1-mini' },
      { path: 'model.fast_name', label: 'Fast Model', placeholder: 'fallback to Model Name when empty' },
      { path: 'model.max_context_tokens', label: 'Max Context Tokens', type: 'number' }
    ]
  },
  {
    title: 'SDK',
    keys: [
      { path: 'sdk.provider', label: 'Provider', options: ['openai-compatible', 'anthropic'] }
    ]
  },
  {
    title: 'Execution',
    keys: [
      { path: 'execution.mode', label: 'Mode', options: ['normal', 'auto', 'plan'] }
    ]
  },
  {
    title: 'Shell',
    keys: [
      { path: 'shell.default', label: 'Default Shell', options: ['bash', 'powershell', 'zsh', 'cmd'] }
    ]
  },
  {
    title: 'UI',
    keys: [
      { path: 'ui.language', label: 'UI Language', options: ['zh', 'en'] },
      { path: 'ui.reply_language', label: 'Reply Language', options: ['zh', 'en'] }
    ]
  }
];

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function ConfigDialog({ open, onOpenChange }) {
  const [config, setConfig] = useState(null);
  const [changes, setChanges] = useState({});

  useEffect(() => {
    if (open) {
      api.fetchConfig().then(cfg => {
        setConfig(cfg);
        setChanges({});
      }).catch(() => {});
    }
  }, [open]);

  const handleChange = (path, value) => {
    setChanges(prev => ({ ...prev, [path]: value }));
  };

  const getValue = (path) => {
    if (path in changes) return changes[path];
    return config ? String(getNestedValue(config, path) ?? '') : '';
  };

  const hasChanges = Object.keys(changes).length > 0;

  const handleSave = async () => {
    try {
      for (const [path, value] of Object.entries(changes)) {
        const key = CONFIG_GROUPS.flatMap(g => g.keys).find(k => k.path === path);
        await api.setConfig(path, key?.type === 'number' ? Number(value) : value);
      }
      setChanges({});
      onOpenChange(false);
    } catch (err) {
      console.error('Config save failed:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-1">
          {CONFIG_GROUPS.map((group, gi) => (
            <div key={group.title}>
              <div className="text-[13px] font-semibold text-(--text-secondary) mb-2.5 uppercase tracking-[0.3px]">{group.title}</div>
              <div className="space-y-2.5">
                {group.keys.map((key) => (
                  <div key={key.path} className="flex items-center gap-3">
                    <label className="text-[13px] text-(--text-muted) w-32 shrink-0">{key.label}</label>
                    {key.options ? (
                      <Select value={getValue(key.path)} onValueChange={(v) => handleChange(key.path, v)}>
                        <SelectTrigger className="flex-1 h-8 text-[13px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {key.options.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={key.type || 'text'}
                        value={getValue(key.path)}
                        onChange={(e) => handleChange(key.path, e.target.value)}
                        placeholder={key.placeholder || ''}
                        className="flex-1 h-8 text-[13px]"
                      />
                    )}
                  </div>
                ))}
              </div>
              {gi < CONFIG_GROUPS.length - 1 && <Separator className="mt-4 bg-(--border-default)" />}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-[13px]">取消</Button>
          <Button onClick={handleSave} disabled={!hasChanges} className="text-[13px]">保存更改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
