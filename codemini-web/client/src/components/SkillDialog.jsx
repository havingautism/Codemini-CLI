import { Hammer } from "@phosphor-icons/react";
import { ResourceLibraryDialog } from "@/components/ResourceLibraryDialog.jsx";
import { SkillPanel } from '@/components/SkillPanel.jsx';
import { t } from '../../i18n/index.js';

export function SkillDialog({ open, onOpenChange, projectDirs = [], projectTargets = [] }) {
  return (
    <ResourceLibraryDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Hammer}
      title={t('skills')}
      description={t('skillPanelHint')}
      className="max-w-[1380px] sm:max-w-[1380px]"
    >
      <SkillPanel projectDirs={projectDirs} projectTargets={projectTargets} />
    </ResourceLibraryDialog>
  );
}
