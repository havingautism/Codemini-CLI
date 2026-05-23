import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { t } from "../../i18n/index.js";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loadingLabel,
  loading = false,
  onOpenChange,
  onConfirm,
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange?.(next)}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader showCloseButton={!loading}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-6">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange?.(false)}
          >
            {cancelLabel || t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? (loadingLabel || t('deleting')) : (confirmLabel || t('delete'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
