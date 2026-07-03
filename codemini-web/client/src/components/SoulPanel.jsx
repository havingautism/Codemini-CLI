import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DotsThree,
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
import { Empty, EmptyDescription } from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SettingsField } from "@/components/settings/SettingsField.jsx";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";
import { useApp } from "@/context/app-context.jsx";
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-1">
        <SettingsSection
          description={t("soulEditorHint")}
          className="gap-4"
        >
          <SettingsField id="soul-editor-name" label={t("name")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isNew}
              placeholder="my-soul"
            />
          </SettingsField>
          <SettingsField id="soul-editor-content" label={t("soulContent")}>
            {loading ? (
              <Empty className="rounded-lg border border-(--border-default) py-8">
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
          </SettingsField>
        </SettingsSection>
      </div>

      <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-(--border-default) pt-4">
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
      <DialogContent className="flex h-[86vh] max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{soul ? t("editSoul") : t("newSoul")}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6">
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
      <DialogContent className="flex max-h-[82vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>
            {soul?.name} {t("contentPreview")}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 sm:px-6">
          {loading ? (
            <div className="py-8 text-center text-[12px] text-(--text-muted)">
              {t("loading")}...
            </div>
          ) : (
            <pre className="rounded-lg border border-(--border-default) bg-(--bg-subtle) p-3 text-[13px] whitespace-pre-wrap break-words font-mono leading-5">
              {content}
            </pre>
          )}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t border-(--border-default) px-4 py-4 sm:px-6">
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

function soulItemKey(soul) {
  return `${soul?.scope || "unknown"}:${soul?.name || ""}`;
}

function groupFilteredSouls(items, filter) {
  if (filter !== "all") {
    return [{ key: "flat", label: null, items }];
  }
  const builtin = items.filter((soul) => soul.scope === "builtin");
  const custom = items.filter((soul) => soul.scope !== "builtin");
  const groups = [];
  if (builtin.length > 0) {
    groups.push({ key: "builtin", label: t("builtin"), items: builtin });
  }
  if (custom.length > 0) {
    groups.push({ key: "custom", label: t("custom"), items: custom });
  }
  return groups;
}

function SoulChoiceCard({
  soul,
  disabled,
  onView,
  onActivate,
  onEdit,
  onDelete,
}) {
  const active = !!soul.active;
  const isCustom = soul.scope !== "builtin";

  const handleSelect = () => {
    if (disabled || active) return;
    onActivate(soul.name);
  };

  return (
    <div
      className={cn(
        "relative flex w-full items-stretch overflow-hidden rounded-lg border transition-colors",
        active
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={handleSelect}
        aria-pressed={active}
        aria-label={
          active
            ? `${soul.name} (${t("current")})`
            : `${t("activate")} ${soul.name}`
        }
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left",
          disabled && "cursor-not-allowed opacity-60",
          active ? "cursor-default" : "cursor-pointer",
        )}
      >
        <MaskHappy
          size={16}
          weight={active ? "fill" : "regular"}
          className={cn(
            "mt-0.5 shrink-0",
            active ? "text-[var(--input-shell-accent)]" : "text-(--text-muted)",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-(--text-primary)">
              {soul.name}
            </span>
            <Badge
              variant="outline"
              className="h-4 rounded-md px-1.5 py-0 text-[10px]"
            >
              {scopeLabel(soul.scope)}
            </Badge>
            {active && (
              <Badge
                variant="secondary"
                className="h-4 rounded-md px-1.5 py-0 text-[10px]"
              >
                {t("current")}
              </Badge>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[11px] font-normal leading-snug text-(--text-muted)">
            {soul.preview || t("noPreview")}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-start py-1.5 pr-1.5">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)"
              aria-label={t("soulActions")}
              onClick={(event) => event.stopPropagation()}
            >
              <DotsThree size={15} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-36 p-1"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-(--text-primary) hover:bg-(--bg-hover)"
              onClick={() => onView(soul)}
            >
              <Eye size={14} />
              {t("view")}
            </button>
            {isCustom && (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-(--text-primary) hover:bg-(--bg-hover) disabled:opacity-50"
                  onClick={() => onEdit(soul)}
                >
                  <PencilSimple size={14} />
                  {t("edit")}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-(--accent-red) hover:bg-(--accent-red-bg) disabled:opacity-50"
                  onClick={() => {
                    if (disabled) return;
                    if (
                      confirm(
                        t("confirmDeleteSoul").replace("{{name}}", soul.name),
                      )
                    ) {
                      onDelete(soul.name);
                    }
                  }}
                >
                  <Trash size={14} />
                  {t("delete")}
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function SoulPanel({ disabled = false }) {
  const { state, actions } = useApp();
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

  useEffect(() => {
    if (state.soulsRevision > 0) {
      loadSouls();
    }
  }, [state.soulsRevision, loadSouls]);

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

  const groupedSouls = useMemo(
    () => groupFilteredSouls(filteredSouls, filter),
    [filteredSouls, filter],
  );

  const handleActivate = async (name) => {
    if (disabled) return;
    await api.activateSoul(name);
    await loadSouls();
    actions.notifySoulsChanged();
  };

  const handleDelete = async (name) => {
    if (disabled) return;
    await api.deleteSoul(name);
    await loadSouls();
    actions.notifySoulsChanged();
  };

  const handleSave = () => {
    setEditing(null);
    loadSouls().then(() => actions.notifySoulsChanged());
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-[12px] text-(--text-muted)">
        {t("loading")}...
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <SettingsSection
          description={t("soulPanelHint")}
          className="shrink-0 gap-2"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <MaskHappy size={14} className="shrink-0 text-(--text-muted)" />
              <span className="truncate text-[13px] font-medium text-(--text-primary)">
                {activeSoul?.name || t("noActiveSoul")}
              </span>
              {activeSoul && (
                <Badge
                  variant="secondary"
                  className="h-4 shrink-0 rounded-md px-1.5 py-0 text-[10px]"
                >
                  {t("current")}
                </Badge>
              )}
              {souls.length > 0 && (
                <span className="text-[12px] text-(--text-muted)">
                  · {souls.length} {t("items")} · {customCount} {t("custom")}
                </span>
              )}
            </div>
            <Button
              onClick={() => setEditing("new")}
              size="sm"
              disabled={disabled}
              className="w-full sm:ml-auto sm:w-auto"
            >
              <Plus size={13} />
              {t("addSoul")}
            </Button>
          </div>
        </SettingsSection>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-muted)"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchSouls")}
              className="h-9 pl-8 text-[13px]"
            />
          </div>
          <SettingsSegmentedControl
            idPrefix="soul-filter"
            value={filter}
            onValueChange={setFilter}
            options={FILTERS.map((item) => ({
              value: item,
              label: t(`filter_${item}`),
            }))}
            className="w-full shrink-0 sm:min-w-[200px] sm:w-auto [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-3 [scrollbar-gutter:stable]">
          {souls.length === 0 && !editing && (
            <Empty className="rounded-lg py-8">
              <EmptyDescription className="text-[13px] text-(--text-primary)">
                {t("noSouls")}
              </EmptyDescription>
              <EmptyDescription className="text-[11px]">
                {t("noSoulsHint")}
              </EmptyDescription>
            </Empty>
          )}

          {souls.length > 0 && filteredSouls.length === 0 && (
            <div className="py-8 text-center text-[12px] text-(--text-muted)">
              {t("noMatches")}
            </div>
          )}

          {filteredSouls.length > 0 && (
            <div className="flex flex-col gap-3">
              {groupedSouls.map((group) => (
                <div key={group.key} className="flex flex-col gap-1.5">
                  {group.label && (
                    <div className="px-0.5 text-[12px] font-medium text-(--text-muted)">
                      {group.label}
                    </div>
                  )}
                  {group.items.map((soul) => (
                    <SoulChoiceCard
                      key={soulItemKey(soul)}
                      soul={soul}
                      disabled={disabled}
                      onView={setViewSoul}
                      onActivate={handleActivate}
                      onEdit={setEditing}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
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
    </>
  );
}
