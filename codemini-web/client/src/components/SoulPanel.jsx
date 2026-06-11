import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Eye,
  MagnifyingGlass,
  MaskHappy,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";
import { t } from "../../i18n/index.js";

const FILTERS = ["all", "builtin", "custom"];

function scopeLabel(scope) {
  return scope === "builtin" ? t("builtin") : t("custom");
}

function SoulEditor({ soul, onSave, onCancel }) {
  const [name, setName] = useState(soul?.name || "");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const isNew = !soul;

  useEffect(() => {
    setName(soul?.name || "");
    if (!soul) {
      setContent("");
      return;
    }
    setLoading(true);
    api
      .fetchSoulContent(soul.name)
      .then((data) => setContent(data.content || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [soul]);

  const handleSave = async () => {
    if (isNew) {
      await api.createSoul({ name, content });
    } else {
      await api.updateSoulContent(soul.name, content);
    }
    onSave();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-(--text-primary)">
            {isNew ? t("newSoul") : t("editSoul")}
          </div>
          <div className="mt-0.5 text-[11px] text-(--text-muted)">
            {t("soulEditorHint")}
          </div>
        </div>
        <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
          {isNew ? t("custom") : scopeLabel(soul.scope)}
        </Badge>
      </div>

      <FieldGroup className="gap-3">
        <Field className="flex-col items-stretch gap-1.5">
          <FieldTitle>{t("name")}</FieldTitle>
          <FieldContent>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isNew}
              placeholder="my-soul"
            />
          </FieldContent>
        </Field>
        <Field className="flex-col items-stretch gap-1.5">
          <FieldTitle>{t("soulContent")}</FieldTitle>
          <FieldContent>
            {loading ? (
              <Empty className="rounded-md border border-(--border-default) py-8">
                <EmptyDescription>{t("loading")}...</EmptyDescription>
              </Empty>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[220px] resize-y font-mono leading-5"
                placeholder={t("soulPlaceholder")}
              />
            )}
          </FieldContent>
        </Field>
      </FieldGroup>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} size="sm">
          {t("cancel")}
        </Button>
        <Button
          onClick={handleSave}
          disabled={loading || !content.trim() || (isNew && !name.trim())}
          size="sm"
        >
          {isNew ? t("create") : t("save")}
        </Button>
      </div>
    </div>
  );
}

function SoulEditorDialog({ soul, open, onSave, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[86vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{soul ? t("editSoul") : t("newSoul")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <SoulEditor
            soul={soul}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewDialog({ soul, open, onOpenChange }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !soul) return;
    setLoading(true);
    api
      .fetchSoulContent(soul.name)
      .then((data) => setContent(data.content || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, soul]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[82vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {soul?.name} {t("contentPreview")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          {loading ? (
            <div className="py-8 text-center text-[12px] text-(--text-muted)">
              {t("loading")}...
            </div>
          ) : (
            <pre className="rounded-lg bg-(--bg-secondary) p-3 text-[13px] whitespace-pre-wrap break-words font-mono leading-5">
              {content}
            </pre>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            size="sm"
          >
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SoulPanel({ disabled = false }) {
  const [souls, setSouls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewSoul, setViewSoul] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const loadSouls = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.fetchSouls();
      setSouls(Array.isArray(list) ? list : []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSouls();
  }, [loadSouls]);

  const activeSoul = souls.find((soul) => soul.active);
  const customCount = souls.filter((soul) => soul.scope !== "builtin").length;
  const filteredSouls = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return souls.filter((soul) => {
      if (filter !== "all" && soul.scope !== filter) return false;
      if (!needle) return true;
      return soul.name.toLowerCase().includes(needle);
    });
  }, [souls, query, filter]);

  const handleActivate = async (name) => {
    if (disabled) return;
    await api.activateSoul(name);
    loadSouls();
  };

  const handleDelete = async (name) => {
    if (disabled) return;
    await api.deleteSoul(name);
    loadSouls();
  };

  const handleSave = () => {
    setEditing(null);
    loadSouls();
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-[12px] text-(--text-muted)">
        {t("loading")}...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-(--border-default) p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MaskHappy size={14} className="text-(--text-muted)" />
              <span className="text-[13px] font-medium text-(--text-primary)">
                {activeSoul?.name || t("noActiveSoul")}
              </span>
              {activeSoul && (
                <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px]">
                  {t("current")}
                </Badge>
              )}
            </div>
            <div className="mt-1 text-[11px] text-(--text-muted)">
              {t("soulPanelHint")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
              {souls.length} {t("items")}
            </Badge>
            <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
              {customCount} {t("custom")}
            </Badge> */}
            <Button
              onClick={() => setEditing("new")}
              size="sm"
              disabled={disabled}
            >
              <Plus size={13} />
              {t("addSoul")}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-muted)"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchSouls")}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <div className="flex shrink-0 rounded-md border border-(--border-default) p-0.5 gap-0.5">
          {FILTERS.map((item) => (
            <Button
              key={item}
              type="button"
              variant={filter === item ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setFilter(item)}
              className="px-2"
            >
              {t(`filter_${item}`)}
            </Button>
          ))}
        </div>
      </div>

      <Separator className="bg-(--border-default)" />

      {souls.length === 0 && !editing && (
        <Empty className="rounded-lg py-8">
          <EmptyDescription className="text-[13px] text-(--text-primary)">
            {t("noSouls")}
          </EmptyDescription>
          <EmptyDescription className="text-[11px]">{t("noSoulsHint")}</EmptyDescription>
        </Empty>
      )}

      {souls.length > 0 && filteredSouls.length === 0 && (
        <div className="py-8 text-center text-[12px] text-(--text-muted)">
          {t("noMatches")}
        </div>
      )}

      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
        {filteredSouls.map((soul) => (
          <div
            key={`${soul.scope}-${soul.name}`}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              soul.active
                ? "border-(--border-strong) bg-(--bg-active)"
                : "border-(--border-default) bg-(--bg-primary) hover:bg-(--bg-hover)",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-(--text-primary)">
                    {soul.name}
                  </span>
                  <Badge
                    variant="outline"
                    className="h-4 rounded-md px-1.5 py-0 text-[10px]"
                  >
                    {scopeLabel(soul.scope)}
                  </Badge>
                  {soul.active && (
                    <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px]">
                      {t("current")}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">
                  {soul.preview || t("noPreview")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setViewSoul(soul)}
                  title={t("view")}
                >
                  <Eye size={13} />
                </Button>
                <Switch
                  checked={!!soul.active}
                  onCheckedChange={(next) => {
                    if (next && !disabled && !soul.active) handleActivate(soul.name);
                  }}
                  disabled={disabled || soul.active}
                  aria-label={soul.active ? t("current") : t("activate")}
                />
                {soul.scope !== "builtin" && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setEditing(soul)}
                      disabled={disabled}
                      title={t("edit")}
                    >
                      <PencilSimple size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        if (disabled) return;
                        if (
                          confirm(
                            t("confirmDeleteSoul").replace(
                              "{{name}}",
                              soul.name,
                            ),
                          )
                        ) {
                          handleDelete(soul.name);
                        }
                      }}
                      disabled={disabled}
                      title={t("delete")}
                      className="text-(--accent-red) hover:text-(--accent-red)"
                    >
                      <Trash size={13} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <ViewDialog
        soul={viewSoul}
        open={!!viewSoul}
        onOpenChange={(open) => {
          if (!open) setViewSoul(null);
        }}
      />
      <SoulEditorDialog
        soul={editing === "new" ? null : editing}
        open={!!editing}
        onSave={handleSave}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
