import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { t } from "../../i18n/index.js";

export function SpecApprovalCard({ spec, onAction, onUpdate, disabled = false }) {
  const [editMode, setEditMode] = useState(false);
  const [content, setContent] = useState("");
  if (!spec) return null;
  const missingHeadings = Array.isArray(spec.missingHeadings) ? spec.missingHeadings : [];
  const incomplete = spec.complete === false || missingHeadings.length > 0;

  const startEdit = () => {
    setContent(spec.specText || "");
    setEditMode(true);
  };

  const saveEdit = async () => {
    const next = { ...spec, specText: content };
    if (onUpdate) await onUpdate(next);
    setEditMode(false);
  };

  return (
    <div className="border border-(--border-default) rounded-lg p-3 max-w-3xl mx-auto bg-(--bg-secondary) space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium text-(--text-primary)">
              {t("specReviewTitle")}
            </span>
            <Badge className="text-[11px] bg-(--accent-blue-bg) text-(--accent-blue)">
              {incomplete ? t("specIncompleteStatus") : t("specReviewStatus")}
            </Badge>
          </div>
          {spec.filePath && (
            <div className="mt-1 text-[11px] font-mono text-(--text-muted) break-all">
              {spec.filePath}
            </div>
          )}
        </div>
      </div>

      {spec.goal && (
        <p className="text-[13px] leading-relaxed text-(--text-secondary)">
          {spec.goal}
        </p>
      )}

      {incomplete && (
        <div className="rounded-md border border-(--accent-orange)/35 bg-(--accent-orange-bg) px-3 py-2 text-[12px] leading-relaxed text-(--accent-orange)">
          {t("specIncompleteMessage")}
          {missingHeadings.length > 0 && (
            <div className="mt-1 font-mono text-[11px]">
              {missingHeadings.join(", ")}
            </div>
          )}
        </div>
      )}

      {editMode ? (
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[260px] font-mono text-[12px]"
          autoFocus
        />
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md border border-(--border-default) bg-(--bg-primary) p-3 text-[12px] leading-relaxed text-(--text-secondary) whitespace-pre-wrap">
          {spec.specText || ""}
        </pre>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="destructive"
          size="xs"
          disabled={disabled}
          onClick={() => onAction("delete")}
        >
          {t("specDelete")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => onAction("reject")}
        >
          {t("specReject")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => (editMode ? saveEdit() : startEdit())}
        >
          {editMode ? t("specSave") : t("specEdit")}
        </Button>
        {!editMode && (
          <Button
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={() => onAction("save")}
          >
            {t("specSaveOnly")}
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || incomplete || editMode}
          onClick={() => onAction("approve")}
        >
          {t("specPlanExecute")}
        </Button>
        <Button size="xs" disabled={disabled || incomplete || editMode} onClick={() => onAction("execute")}>
          {t("specExecuteNow")}
        </Button>
      </div>
    </div>
  );
}
