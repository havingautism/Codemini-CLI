import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitChangesPanel } from "@/components/GitChangesPanel.jsx";
import { t } from "../../i18n/index.js";

export function GitDiffDialog({ open, onOpenChange, sessionId }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 px-6">
          <DialogTitle>{t("gitDiffTitle")}</DialogTitle>
        </DialogHeader>
        <GitChangesPanel sessionId={sessionId} showHeader={false} />
      </DialogContent>
    </Dialog>
  );
}
