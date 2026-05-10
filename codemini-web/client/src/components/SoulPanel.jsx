import { useState, useEffect, useCallback, useMemo } from "react";
import { Eye, Pencil, Plus, Search, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

function SwitchControl({ checked, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={checked}
      className={cn(
        "relative h-5 w-9 rounded-full border shadow-inner transition-colors",
        checked
          ? "border-(--text-primary) bg-(--text-primary)"
          : "border-(--border-strong) bg-(--bg-hover)",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 size-3.5 rounded-full transition-transform",
          checked ? "bg-(--bg-primary)" : "bg-(--text-muted)",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

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
    <div className="space-y-3">
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

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <label className="text-[12px] text-(--text-muted)">{t("name")}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isNew}
            placeholder="my-soul"
            className="h-8 text-[13px]"
          />
        </div>
        <div className="grid gap-1.5">
          <label className="text-[12px] text-(--text-muted)">
            {t("soulContent")}
          </label>
          {loading ? (
            <div className="rounded-md border border-(--border-default) py-8 text-center text-[12px] text-(--text-muted)">
              {t("loading")}...
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[220px] resize-y text-[13px] font-mono leading-5"
              placeholder={t("soulPlaceholder")}
            />
          )}
        </div>
      </div>

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
      <DialogContent className="sm:max-w-[720px] max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{soul ? t("editSoul") : t("newSoul")}</DialogTitle>
        </DialogHeader>
        <SoulEditor
          soul={soul}
          onSave={onSave}
          onCancel={() => onOpenChange(false)}
        />
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
      <DialogContent className="sm:max-w-[680px] max-h-[82vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {soul?.name} {t("contentPreview")}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-[12px] text-(--text-muted)">
            {t("loading")}...
          </div>
        ) : (
          <pre className="max-h-[460px] overflow-y-auto rounded-lg bg-(--bg-secondary) p-3 text-[13px] whitespace-pre-wrap break-words font-mono leading-5">
            {content}
          </pre>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm">
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SoulPanel() {
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
    await api.activateSoul(name);
    loadSouls();
  };

  const handleDelete = async (name) => {
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
    <div className="space-y-3">
      <div className="rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Wand2 size={14} className="text-(--text-muted)" />
              <span className="text-[13px] font-medium text-(--text-primary)">
                {activeSoul?.name || t("noActiveSoul")}
              </span>
              {activeSoul && (
                <Badge className="h-4 rounded-md border-0 bg-(--text-primary) px-1.5 py-0 text-[10px] text-(--bg-primary)">
                  {t("current")}
                </Badge>
              )}
            </div>
            <div className="mt-1 text-[11px] text-(--text-muted)">
              {t("soulPanelHint")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
              {souls.length} {t("items")}
            </Badge>
            <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
              {customCount} {t("custom")}
            </Badge>
            <Button onClick={() => setEditing("new")} size="sm">
              <Plus size={13} />
              {t("addSoul")}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
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
        <div className="flex shrink-0 rounded-md border border-(--border-default) p-0.5">
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
        <div className="rounded-lg border border-dashed border-(--border-default) py-8 text-center">
          <div className="text-[13px] text-(--text-primary)">{t("noSouls")}</div>
          <div className="mt-1 text-[11px] text-(--text-muted)">
            {t("noSoulsHint")}
          </div>
        </div>
      )}

      {souls.length > 0 && filteredSouls.length === 0 && (
        <div className="py-8 text-center text-[12px] text-(--text-muted)">
          {t("noMatches")}
        </div>
      )}

      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
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
                  <Badge variant="outline" className="h-4 rounded-md px-1.5 py-0 text-[10px]">
                    {scopeLabel(soul.scope)}
                  </Badge>
                  {soul.active && (
                    <Badge className="h-4 rounded-md border-0 bg-(--text-primary) px-1.5 py-0 text-[10px] text-(--bg-primary)">
                      {t("current")}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">
                  {soul.preview || t("noPreview")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={() => setViewSoul(soul)} title={t("view")}>
                  <Eye size={13} />
                </Button>
                <SwitchControl
                  checked={!!soul.active}
                  onClick={() => {
                    if (!soul.active) handleActivate(soul.name);
                  }}
                  title={soul.active ? t("current") : t("activate")}
                />
                {soul.scope !== "builtin" && (
                  <>
                    <Button variant="ghost" size="icon-xs" onClick={() => setEditing(soul)} title={t("edit")}>
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        if (confirm(t("confirmDeleteSoul").replace("{{name}}", soul.name))) {
                          handleDelete(soul.name);
                        }
                      }}
                      title={t("delete")}
                      className="text-(--accent-red) hover:text-(--accent-red)"
                    >
                      <Trash2 size={13} />
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
