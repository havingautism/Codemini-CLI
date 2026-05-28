import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SkillPanel } from '@/components/SkillPanel.jsx';
import { t } from '../../i18n/index.js';

export function SkillDialog({ open, onOpenChange, projectDirs = [], projectTargets = [] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[86vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('skills')}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <SkillPanel projectDirs={projectDirs} projectTargets={projectTargets} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
