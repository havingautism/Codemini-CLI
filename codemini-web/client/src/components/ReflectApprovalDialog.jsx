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
              {t("reflectScope")}: {draft.scope || "project"}
            </span>
            <span>
              {t("reflectConfidence")}: {confidenceLabel(draft.confidence)}
            </span>
          </div>
        </div>
      </div>

      <FieldGroup className="gap-2">
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
          size="xs"
          disabled={disabled}
          onClick={() => onAction(CHAT_ACTION_NAMES.REFLECT_REJECT)}
        >
          {t("reflectReject")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => (editMode ? submitEdit() : startEdit())}
        >
          {editMode ? t("reflectSave") : t("reflectEdit")}
        </Button>
        <Button
          size="xs"
          disabled={disabled || editMode}
          onClick={() => onAction(CHAT_ACTION_NAMES.REFLECT_APPROVE)}
        >
          {t("reflectApprove")}
        </Button>
      </div>
    </div>
  );
}
