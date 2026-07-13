import { ResourceLibraryDialog } from "@/components/ResourceLibraryDialog.jsx";
import { SoulPanel } from '@/components/SoulPanel.jsx';
import { t } from '../../i18n/index.js';

export function SoulDialog({ open, onOpenChange, disabled = false }) {
  return (
    <ResourceLibraryDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('souls')}
      description={t('soulPanelHint')}
    >
      <SoulPanel disabled={disabled} />
    </ResourceLibraryDialog>
  );
}
