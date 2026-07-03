import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SoulPanel } from '@/components/SoulPanel.jsx';
import { t } from '../../i18n/index.js';

export function SoulDialog({ open, onOpenChange, disabled = false }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] max-h-[82vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
          <DialogTitle>{t('souls')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-6">
          <SoulPanel disabled={disabled} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
