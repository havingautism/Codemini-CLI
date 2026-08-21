import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MagnifyingGlass,
  MaskHappy,
  PencilSimple,
  Plus,
  Trash,
} from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import {
  MarkdownEditor,
  MarkdownPreview,
} from "@/components/MarkdownEditor.jsx";
import { SettingsField } from "@/components/settings/SettingsField.jsx";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";
import { useApp } from "@/context/app-context.jsx";
import { t } from "../../i18n/index.js";

const FILTERS = ["all", "builtin", "custom"];
const SOUL_TABS = ["coding", "daily"];

function scopeLabel(scope) {
  return scope === "builtin" ? t("builtin") : t("custom");
}

function categoryLabel(category) {
  return category === "daily"
    ? t("skillContextDaily")
    : t("skillContextCoding");
}

function SoulEditor({ soul, onSave, onCancel, defaultCategory = "daily" }) {
  const [name, setName] = useState(soul?.name || "");
  const [category, setCategory] = useState(soul?.category || defaultCategory);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const isNew = !soul;

  useEffect(() => {
    setName(soul?.name || "");
    setCategory(soul?.category || defaultCategory);
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
  }, [soul, defaultCategory]);

  const handleSave = async () => {
    if (isNew) {
      await api.createSoul({ name, content, category });
    } else {
      await api.updateSoulContent(soul.name, content);
    }
    onSave();
  };

  return (
    <div className="flex flex-col">
      <div className="max-h-[min(52vh,480px)] overflow-y-auto scroll-smooth pr-1">
        <SettingsSection description={t("soulEditorHint")} className="gap-4">
          <SettingsField id="soul-editor-name" label={t("name")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isNew}
              placeholder="my-soul"
            />
          </SettingsField>
          {isNew ? (
            <SettingsField id="soul-editor-category" label={t("soulCategory")}>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="coding">
                    {t("skillContextCoding")}
                  </SelectItem>
                  <SelectItem value="daily">
                    {t("skillContextDaily")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </SettingsField>
          ) : null}
          <SettingsField id="soul-editor-content" label={t("soulContent")}>
            {loading ? (
              <Empty className="rounded-lg border border-(--border-default) py-8">
                <EmptyDescription>{t("loading")}...</EmptyDescription>
              </Empty>
            ) : (
              <MarkdownEditor
                value={content}
                onChange={setContent}
                height={280}
                placeholder={t("soulPlaceholder")}
              />
            )}
          </SettingsField>
        </SettingsSection>
      </div>

      <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-(--border-default) pt-4">
        {onCancel ? (
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
        <Button
          onClick={handleSave}
          disabled={loading || !content.trim() || (isNew && !name.trim())}
        >
          {isNew ? t("create") : t("save")}
        </Button>
      </div>
    </div>
  );
}

function SoulEditorDialog({ soul, open, onSave, onOpenChange, defaultCategory = "daily" }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{soul ? t("editSoul") : t("newSoul")}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col px-4 pb-4 sm:px-6">
          <SoulEditor
            soul={soul}
            defaultCategory={defaultCategory}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SoulDetailPane({ soul, disabled = false, onSave }) {
  const [content, setContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const soulName = soul?.name || "";
  const soulScope = soul?.scope || "";

  useEffect(() => {
    setEditing(false);
    if (!soulName) {
      setContent("");
      setDraftContent("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .fetchSoulContent(soulName)
      .then((data) => {
        if (cancelled) return;
        const next = data.content || "";
        setContent(next);
        setDraftContent(next);
      })
      .catch(() => {
        if (cancelled) return;
        setContent("");
        setDraftContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [soulName, soulScope]);

  if (!soul) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-(--text-muted)">
        {t("noSouls")}
      </div>
    );
  }

  const isCustom = soul.scope !== "builtin";

  const handleSave = async () => {
    if (!isCustom || disabled) return;
    setSaving(true);
    try {
      await api.updateSoulContent(soul.name, draftContent);
      setContent(draftContent);
      setEditing(false);
      await onSave?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-(--border-default) px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <MaskHappy
                size={22}
                weight={soul.active ? "fill" : "regular"}
                className={
                  soul.active
                    ? "text-[var(--input-shell-accent)]"
                    : "text-(--text-muted)"
                }
              />
              <h3 className="min-w-0 truncate text-[17px] font-semibold leading-6 text-(--text-primary)">
                {soul.name}
              </h3>
              <Badge
                variant="outline"
                className="h-6 rounded-md px-2 text-[11px]"
              >
                {categoryLabel(soul.category)}
              </Badge>
              <Badge
                variant="outline"
                className="h-6 rounded-md px-2 text-[11px]"
              >
                {scopeLabel(soul.scope)}
              </Badge>
              {soul.active ? (
                <Badge
                  variant="secondary"
                  className="h-6 rounded-md px-2 text-[11px]"
                >
                  {t("current")}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-(--text-muted)">
              {soul.preview || t("noPreview")}
            </p>
          </div>
          {isCustom && !disabled ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {editing ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraftContent(content);
                      setEditing(false);
                    }}
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saving || loading || !draftContent.trim()}
                  >
                    {saving ? t("loading") : t("save")}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraftContent(content);
                    setEditing(true);
                  }}
                >
                  <PencilSimple size={14} />
                  {t("edit")}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
        {loading && !content ? (
          <div className="py-8 text-center text-[12px] text-(--text-muted)">
            {t("loading")}...
          </div>
        ) : editing ? (
          <MarkdownEditor
            value={draftContent}
            onChange={setDraftContent}
            height="100%"
            placeholder={t("soulPlaceholder")}
          />
        ) : (
          <MarkdownPreview value={content} className="flex-1" />
        )}
      </div>
    </div>
  );
}

function soulItemKey(soul) {
  return `${soul?.category || "coding"}:${soul?.scope || "unknown"}:${soul?.name || ""}`;
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
  selected,
  disabled,
  onSelect,
  onActivate,
  onDelete,
}) {
  const active = !!soul.active;
  const isCustom = soul.scope !== "builtin";

  const handleToggle = (checked) => {
    if (disabled) return;
    if (checked && !active) {
      onActivate(soul);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(soul)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(soul);
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-transparent bg-(--bg-active)"
          : active
            ? "border-transparent bg-primary/5"
            : "border-transparent bg-transparent hover:bg-(--bg-hover)",
      )}
    >
      {/* Header: icon + name + badges + switch */}
      <div className="flex items-center gap-2">
        <MaskHappy
          size={15}
          weight={active ? "fill" : "regular"}
          className={cn(
            "shrink-0",
            active ? "text-[var(--input-shell-accent)]" : "text-(--text-muted)",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {soul.name}
        </span>
        <Badge
          variant="outline"
          className="h-5 shrink-0 rounded-md px-1.5 text-[11px]"
        >
          {scopeLabel(soul.scope)}
        </Badge>
        {active && (
          <Badge
            variant="secondary"
            className="h-5 shrink-0 rounded-md px-1.5 text-[11px]"
          >
            {t("current")}
          </Badge>
        )}
        <Switch
          checked={active}
          onCheckedChange={handleToggle}
          onClick={(event) => event.stopPropagation()}
          disabled={disabled}
          aria-label={
            active
              ? `${soul.name} (${t("current")})`
              : `${t("activate")} ${soul.name}`
          }
        />
      </div>

      {/* Footer: actions (custom only) */}
      {isCustom && (
        <div
          className="flex items-center gap-0.5"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            className="text-(--accent-red) hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
            onClick={() => {
              if (disabled) return;
              onDelete(soul);
            }}
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function SoulPanel({ disabled = false }) {
  const { state, actions } = useApp();
  const [souls, setSouls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [selectedSoul, setSelectedSoul] = useState(null);
  const [query, setQuery] = useState("");
  const [categoryTab, setCategoryTab] = useState("coding");
  const [filter, setFilter] = useState("all");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadSouls = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const list = await api.fetchSouls();
      setSouls(Array.isArray(list) ? list : []);
    } catch {}
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    loadSouls();
  }, [loadSouls]);

  useEffect(() => {
    if (state.soulsRevision > 0) {
      loadSouls({ silent: true });
    }
  }, [state.soulsRevision, loadSouls]);

  const categorySouls = useMemo(
    () => souls.filter((soul) => (soul.category || "coding") === categoryTab),
    [souls, categoryTab],
  );
  const activeSoul = categorySouls.find((soul) => soul.active);
  const customCount = categorySouls.filter((soul) => soul.scope !== "builtin").length;
  const filteredSouls = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return categorySouls.filter((soul) => {
      if (filter !== "all" && soul.scope !== filter) return false;
      if (!needle) return true;
      return soul.name.toLowerCase().includes(needle);
    });
  }, [categorySouls, query, filter]);

  const groupedSouls = useMemo(
    () => groupFilteredSouls(filteredSouls, filter),
    [filteredSouls, filter],
  );

  useEffect(() => {
    if (filteredSouls.length === 0) {
      setSelectedSoul(null);
      return;
    }
    if (
      !selectedSoul ||
      !filteredSouls.some(
        (soul) => soulItemKey(soul) === soulItemKey(selectedSoul),
      )
    ) {
      setSelectedSoul(filteredSouls[0]);
      return;
    }
    // Keep selection object in sync when only `active` / preview changes.
    const next = filteredSouls.find(
      (soul) => soulItemKey(soul) === soulItemKey(selectedSoul),
    );
    if (next && next !== selectedSoul) setSelectedSoul(next);
  }, [filteredSouls, selectedSoul]);

  const handleActivate = async (soul) => {
    if (disabled || !soul?.name || soul.active) return;
    const category = soul.category || categoryTab;
    setSouls((prev) =>
      prev.map((item) => ({
        ...item,
        active:
          (item.category || "coding") === category
            ? item.name === soul.name
            : item.active,
      })),
    );
    setSelectedSoul((prev) =>
      prev && soulItemKey(prev) === soulItemKey(soul)
        ? { ...prev, active: true }
        : prev,
    );
    try {
      await api.activateSoul(soul.name, category);
      actions.notifySoulsChanged();
    } catch {
      await loadSouls({ silent: true });
    }
  };

  const handleDelete = (soul) => {
    if (disabled || !soul?.name) return;
    setDeleteError("");
    setPendingDelete(soul);
  };

  const confirmDelete = async () => {
    if (disabled || !pendingDelete?.name || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteSoul(pendingDelete.name);
      setPendingDelete(null);
      await loadSouls({ silent: true });
      actions.notifySoulsChanged();
    } catch (err) {
      setDeleteError(err.message || t("deleteSoulFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = () => {
    setEditing(null);
    loadSouls({ silent: true }).then(() => actions.notifySoulsChanged());
  };

  if (loading && souls.length === 0) {
    return (
      <div className="py-8 text-center text-[12px] text-(--text-muted)">
        {t("loading")}...
      </div>
    );
  }

  return (
    <>
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3 border-b border-(--border-default) p-3 lg:border-b-0 lg:border-r">
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
              {categorySouls.length > 0 && (
                <span className="text-[12px] text-(--text-muted)">
                  · {categorySouls.length} {t("items")} · {customCount}{" "}
                  {t("custom")}
                </span>
              )}
            </div>
            <Button
              onClick={() => setEditing("new")}
              disabled={disabled}
              className="w-full sm:ml-auto sm:w-auto"
            >
              <Plus size={13} />
              {t("addSoul")}
            </Button>
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            <SettingsSegmentedControl
              idPrefix="soul-category"
              value={categoryTab}
              onValueChange={setCategoryTab}
              options={SOUL_TABS.map((item) => ({
                value: item,
                label: categoryLabel(item),
              }))}
              className="w-full shrink-0 [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
            />
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
              className="w-full shrink-0 [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
            />
          </div>

          {deleteError && (
            <div className="rounded-md border border-(--accent-red) bg-(--accent-red-bg) px-3 py-2 text-[12px] text-(--accent-red)">
              {deleteError}
            </div>
          )}

          <div className="min-h-[220px] flex-1 overflow-y-auto scroll-smooth pr-2 [scrollbar-gutter:stable]">
            {categorySouls.length === 0 && !editing && (
              <Empty className="rounded-lg py-8">
                <EmptyDescription className="text-[13px] text-(--text-primary)">
                  {t("noSouls")}
                </EmptyDescription>
                <EmptyDescription className="text-[11px]">
                  {t("noSoulsHint")}
                </EmptyDescription>
              </Empty>
            )}

            {categorySouls.length > 0 && filteredSouls.length === 0 && (
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
                        selected={
                          soulItemKey(soul) === soulItemKey(selectedSoul)
                        }
                        disabled={disabled}
                        onSelect={setSelectedSoul}
                        onActivate={handleActivate}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="hidden min-h-0 bg-(--bg-primary) lg:block">
          <SoulDetailPane
            soul={selectedSoul}
            disabled={disabled}
            onSave={handleSave}
          />
        </div>
      </div>

      <SoulEditorDialog
        soul={editing === "new" ? null : editing}
        open={!!editing}
        defaultCategory={categoryTab}
        onSave={handleSave}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title={t("deleteSoulConfirm")}
        description={
          pendingDelete
            ? t("deleteSoulDescription").replace(
                "{{name}}",
                pendingDelete.name || "",
              )
            : ""
        }
        loading={deleting}
        onOpenChange={(next) => {
          if (!next && !deleting) setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
}
