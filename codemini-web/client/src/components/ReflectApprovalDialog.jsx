import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinearRing } from "@/components/ui/spinner";
import { ArrowClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { t } from "../../i18n/index.js";
import { CHAT_ACTION_NAMES } from "@/lib/chat-action-names.js";

function confidenceLabel(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.75";
  return num.toFixed(2);
}

export function ReflectApprovalCard({
  draft,
  onAction,
  onUpdate,
  disabled = false,
}) {
  const [editMode, setEditMode] = useState(false);
  const [localDraft, setLocalDraft] = useState({
    name: "",
    description: "",
    content: "",
  });
  if (!draft) return null;

  const startEdit = () => {
    setLocalDraft({
      name: draft.name || "",
      description: draft.description || "",
      content: draft.content || "",
    });
    setEditMode(true);
  };

  const submitEdit = async () => {
    if (onUpdate) await onUpdate({ ...draft, ...localDraft });
    setEditMode(false);
  };

  return (
    <div className="mx-auto max-w-3xl flex flex-col gap-3 rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3 text-(--text-primary)">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium text-(--text-primary)">
              {t("reflectReviewTitle")}
            </span>
            <Badge variant="secondary">
              {t("reflectReviewStatus")}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-(--text-muted)">
            <span>
              {t("reflectConfidence")}: {confidenceLabel(draft.confidence)}
            </span>
          </div>
        </div>
      </div>

      <FieldGroup className="gap-2">
        <Field className="flex-col items-stretch gap-1.5">
          <FieldTitle>{t("skillContext")}</FieldTitle>
          <FieldContent>
            <Select
              value={draft.context || "global"}
              disabled={disabled}
              onValueChange={(context) => onUpdate?.({ ...draft, context })}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  <SelectItem value="global">{t("skillContextGlobal")}</SelectItem>
                  <SelectItem value="coding">{t("skillContextCoding")}</SelectItem>
                  <SelectItem value="daily">{t("skillContextDaily")}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>
        {editMode ? (
          <>
            <Field className="flex-col items-stretch gap-1.5">
              <FieldTitle>{t("name")}</FieldTitle>
              <FieldContent>
                <Input
                  value={localDraft.name}
                  onChange={(e) =>
                    setLocalDraft((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </FieldContent>
            </Field>
            <Field className="flex-col items-stretch gap-1.5">
              <FieldTitle>{t("description")}</FieldTitle>
              <FieldContent>
                <Textarea
                  value={localDraft.description}
                  onChange={(e) =>
                    setLocalDraft((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  className="min-h-[56px]"
                />
              </FieldContent>
            </Field>
          </>
        ) : (
          <>
            <div className="text-[13px] font-medium text-(--text-primary) break-words">
              /{draft.name || "reflected-skill"}
            </div>
            {draft.description && (
              <p className="text-[13px] leading-6 text-(--text-secondary)">
                {draft.description}
              </p>
            )}
          </>
        )}
        {draft.targetPath && (
          <p className="text-[11px] font-mono break-all text-(--text-muted)">
            {draft.targetPath}
          </p>
        )}
      </FieldGroup>

      {editMode ? (
        <Textarea
          value={localDraft.content}
          onChange={(e) =>
            setLocalDraft((prev) => ({ ...prev, content: e.target.value }))
          }
          className="min-h-[220px] font-mono text-[12px]"
        />
      ) : (
        draft.content && (
          <pre className="max-h-56 overflow-auto rounded-md border border-(--border-default) bg-(--bg-secondary) p-3 font-mono text-[12px] leading-5 text-(--text-secondary) whitespace-pre-wrap">
            {draft.content}
          </pre>
        )
      )}

      <div className="flex items-center gap-2 border-t border-(--border-default) pt-3">
        <Button
          variant="destructive"
          disabled={disabled}
          onClick={() => onAction(CHAT_ACTION_NAMES.REFLECT_REJECT)}
        >
          {t("reflectReject")}
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => (editMode ? submitEdit() : startEdit())}
        >
          {editMode ? t("reflectSave") : t("reflectEdit")}
        </Button>
        <Button
          disabled={disabled || editMode}
          onClick={() => onAction(CHAT_ACTION_NAMES.REFLECT_APPROVE)}
        >
          {t("reflectApprove")}
        </Button>
      </div>
    </div>
  );
}

export function ReflectApprovalDialog({
  open,
  draft,
  error = "",
  result = "",
  onOpenChange,
  onRetry,
  onAction,
  onUpdate,
  disabled = false,
}) {
  const generating = open && !draft && !error && !result;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto sm:max-w-2xl">
        <DialogHeader showCloseButton={!generating && !draft}>
          <DialogTitle>
            {draft
              ? t("reflectReviewTitle")
              : result
                ? t("reflectNoCandidateTitle")
                : t("reflectGeneratingTitle")}
          </DialogTitle>
          <DialogDescription>
            {draft
              ? t("reflectDraftReadyDescription")
              : result
                ? t("reflectNoCandidateDescription")
                : t("reflectGeneratingDescription")}
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
        ) : result ? (
          <div className="flex items-start gap-3 rounded-lg border border-(--border-default) bg-(--bg-secondary) p-5">
            <CheckCircle className="mt-0.5 shrink-0 text-(--accent-green)" size={20} />
            <p className="text-[13px] leading-6 text-(--text-secondary)">
              {t("reflectNoCandidateDetail")}
            </p>
          </div>
        ) : generating ? (
          <div className="flex flex-col gap-4 rounded-lg border border-(--border-default) bg-(--bg-secondary) p-5">
            <div className="flex items-start gap-3">
              <LinearRing size="md" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[13px] font-medium text-(--text-primary)">
                  {t("reflectGeneratingStatus")}
                </p>
                <p className="text-[12px] leading-5 text-(--text-secondary)">
                  {t("reflectGeneratingDetail")}
                </p>
              </div>
            </div>
            <div className="grid gap-2 text-[12px] text-(--text-muted) sm:grid-cols-3">
              <span>{t("reflectStepAnalyze")}</span>
              <span>{t("reflectStepExtract")}</span>
              <span>{t("reflectStepDraft")}</span>
            </div>
          </div>
        ) : (
          <ReflectApprovalCard
            draft={draft}
            onAction={onAction}
            onUpdate={onUpdate}
            disabled={disabled}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
