import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { t } from "../../i18n/index.js";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loadingLabel,
  loading = false,
  confirmVariant = "destructive",
  onOpenChange,
  onConfirm,
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange?.(next)}>
      <DialogContent className="sm:max-w-[380px] gap-5">
        <DialogHeader showCloseButton={!loading}>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-[13px] leading-6">
              {description}
            </DialogDescription>
          ) : null}
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
            variant={confirmVariant}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? (
              <>
                <Spinner data-icon="inline-start" />
                {loadingLabel || t("deleting")}
              </>
            ) : (
              confirmLabel || t("delete")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
