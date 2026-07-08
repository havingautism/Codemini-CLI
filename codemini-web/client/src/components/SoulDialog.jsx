import { MaskHappy } from "@phosphor-icons/react";
import { ResourceLibraryDialog } from "@/components/ResourceLibraryDialog.jsx";
import { SoulPanel } from '@/components/SoulPanel.jsx';
import { t } from '../../i18n/index.js';

export function SoulDialog({ open, onOpenChange, disabled = false }) {
  return (
    <ResourceLibraryDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={MaskHappy}
      title={t('souls')}
      description={t('soulPanelHint')}
    >
      <SoulPanel disabled={disabled} />
    </ResourceLibraryDialog>
  );
}
