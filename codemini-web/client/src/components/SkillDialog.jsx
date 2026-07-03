import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SkillPanel } from '@/components/SkillPanel.jsx';
import { t } from '../../i18n/index.js';

export function SkillDialog({ open, onOpenChange, projectDirs = [], projectTargets = [] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{t('skills')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-6">
          <SkillPanel projectDirs={projectDirs} projectTargets={projectTargets} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
