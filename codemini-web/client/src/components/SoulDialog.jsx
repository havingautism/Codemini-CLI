import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SoulPanel } from '@/components/SoulPanel.jsx';
import { t } from '../../i18n/index.js';

export function SoulDialog({ open, onOpenChange, disabled = false }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[86vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('souls')}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <SoulPanel disabled={disabled} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
