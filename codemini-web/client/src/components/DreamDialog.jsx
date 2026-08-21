import { ArrowClockwise, CheckCircle, WarningCircle } from "@/lib/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinearRing } from "@/components/ui/spinner";
import { t } from "../../i18n/index.js";

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

export function DreamDialog({
  open,
  status = "idle",
  result,
  error = "",
  onOpenChange,
  onRetry,
}) {
  const generating = status === "generating";
  const complete = status === "complete";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader showCloseButton={!generating}>
          <DialogTitle>
            {generating
              ? t("dreamGeneratingTitle")
              : error
                ? t("dreamFailedTitle")
                : t("dreamCompleteTitle")}
          </DialogTitle>
          <DialogDescription>
            {generating
              ? t("dreamGeneratingDescription")
              : error
                ? t("dreamFailedDescription")
                : t("dreamCompleteDescription")}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <WarningCircle />
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{error}</span>
              <Button variant="outline" onClick={onRetry}>
                <ArrowClockwise data-icon="inline-start" />
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : generating ? (
          <div className="flex flex-col gap-4 rounded-lg border border-(--border-default) bg-(--bg-secondary) p-5">
            <div className="flex items-start gap-3">
              <LinearRing />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[13px] font-medium text-(--text-primary)">
                  {t("dreamGeneratingStatus")}
                </p>
                <p className="text-[12px] leading-5 text-(--text-secondary)">
                  {t("dreamGeneratingDetail")}
                </p>
              </div>
            </div>
            <div className="grid gap-2 text-[12px] text-(--text-muted) sm:grid-cols-3">
              <span>{t("dreamStepScreen")}</span>
              <span>{t("dreamStepConsolidate")}</span>
              <span>{t("dreamStepMaintain")}</span>
            </div>
          </div>
        ) : complete ? (
          <div className="flex flex-col gap-4 rounded-lg border border-(--border-default) bg-(--bg-secondary) p-5">
            <div className="flex items-start gap-3">
              <CheckCircle className="mt-0.5 shrink-0 text-(--accent-green)" size={20} />
              <p className="text-[13px] leading-6 text-(--text-secondary)">
                {result?.message || t("dreamCompleteDetail")}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-(--border-default) p-3">
                <div className="text-lg font-semibold text-(--text-primary)">{count(result?.promotions)}</div>
                <div className="text-[11px] text-(--text-muted)">{t("dreamPromoted")}</div>
              </div>
              <div className="rounded-md border border-(--border-default) p-3">
                <div className="text-lg font-semibold text-(--text-primary)">{count(result?.rejections)}</div>
                <div className="text-[11px] text-(--text-muted)">{t("dreamRejected")}</div>
              </div>
              <div className="rounded-md border border-(--border-default) p-3">
                <div className="text-lg font-semibold text-(--text-primary)">{count(result?.archives)}</div>
                <div className="text-[11px] text-(--text-muted)">{t("dreamArchived")}</div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
