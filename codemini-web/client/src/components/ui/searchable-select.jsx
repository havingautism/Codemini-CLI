import { useState } from 'react';
import { Command } from 'cmdk';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CaretDown, Check } from '@/lib/icons';

// cmdk owns filtering, active-option semantics and keyboard selection.
export function SearchableSelect({ id, value, options, onChange, placeholder, searchPlaceholder, emptyText, footer, disabled }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full min-w-0 justify-between font-normal" title={selected?.description || value}>
          <span className="truncate">{selected?.label || value || placeholder}</span><CaretDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[max(280px,var(--radix-popover-trigger-width))] max-w-[calc(100vw-2rem)] p-1">
        <Command label={searchPlaceholder} loop>
          <Command.Input placeholder={searchPlaceholder} className="h-9 w-full border-b border-(--separator) bg-transparent px-3 text-[13px] outline-none" />
          <Command.List className="max-h-64 scroll-py-1 overflow-y-auto overscroll-contain p-1">
            <Command.Empty className="px-3 py-6 text-center text-[12px] text-(--text-muted)">{emptyText}</Command.Empty>
            <Command.Group>
              {options.map(option => <Command.Item key={option.value} value={option.value || '__general__'} keywords={[option.label, option.description || '', ...(option.keywords || [])]} onSelect={() => { onChange(option.value); setOpen(false); }} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-[13px] outline-none data-[selected=true]:bg-(--bg-hover)">
                <div className="min-w-0 flex-1"><div className="truncate">{option.label}</div>{option.description && <div className="truncate text-[11px] text-(--text-muted)">{option.description}</div>}</div>
                {value === option.value && <Check size={14} aria-hidden="true" />}
              </Command.Item>)}
            </Command.Group>
          </Command.List>
        </Command>
        {footer && <div className="border-t border-(--separator) pt-1"><Button type="button" variant="ghost" className="w-full justify-start" onClick={() => { setOpen(false); footer.onClick(); }}>{footer.label}</Button></div>}
      </PopoverContent>
    </Popover>
  );
}
