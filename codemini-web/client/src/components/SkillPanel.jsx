import { useState, useEffect, useCallback, useMemo } from "react";
import { Eye, FileCode2, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
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

const FILTERS = ["all", "enabled", "builtin", "custom"];
const SKILL_MODES = ["always", "auto_attach", "agent_requested", "manual"];

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
  if (scope === "builtin") return t("builtin");
  if (scope === "global") return t("globalScope");
  return t("projectScope");
}

function isBuiltin(skill) {
  return skill?.scope === "builtin";
}

function isEnabled(skill) {
  return skill?.enabled !== false;
}

function SkillEditor({ skill, onSave, onCancel }) {
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [mode, setMode] = useState(skill?.mode || "agent_requested");
  const [triggers, setTriggers] = useState((skill?.triggers || []).join(", "));
  const [priority, setPriority] = useState(skill?.priority ?? 50);
  const [enabled, setEnabled] = useState(isEnabled(skill));
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const isNew = !skill;
  const contentReadOnly = isBuiltin(skill);

  useEffect(() => {
    setName(skill?.name || "");
    setDescription(skill?.description || "");
    setMode(skill?.mode || "agent_requested");
    setTriggers((skill?.triggers || []).join(", "));
    setPriority(skill?.priority ?? 50);
    setEnabled(isEnabled(skill));
    if (!skill) {
      setContent("");
      return;
    }
    setLoading(true);
    api
      .fetchSkillContent(skill.name)
      .then((data) => setContent(data.content || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [skill]);

  const handleSave = async () => {
    const metadata = {
      description,
      mode,
      triggers: triggers
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      enabled,
      priority: Number(priority) || 0,
    };
    if (isNew) {
      await api.createSkill({ name, description, content });
      await api.updateSkillMetadata(name, metadata);
    } else {
      await api.updateSkillMetadata(skill.name, metadata);
      if (!contentReadOnly) {
        await api.updateSkillContent(skill.name, content);
      }
    }
    onSave();
  };

  return (
    <div className="space-y-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-(--text-primary)">
            {isNew ? t("newSkill") : t("editSkill")}
          </div>
          <div className="mt-0.5 text-[11px] text-(--text-muted)">
            {t("skillEditorHint")}
          </div>
        </div>
        <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
          {isNew ? t("projectScope") : scopeLabel(skill.scope)}
        </Badge>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <label className="text-[12px] text-(--text-muted)">{t("name")}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isNew}
            placeholder="my-skill"
            className="h-8 text-[13px]"
          />
        </div>
        <div className="grid gap-1.5">
          <label className="text-[12px] text-(--text-muted)">
            {t("description")}
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("skillDescriptionPlaceholder")}
            className="h-8 text-[13px]"
          />
        </div>

        <div className="rounded-md border border-(--border-default) bg-(--bg-secondary) p-3">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-(--text-primary)">
            <SlidersHorizontal size={13} />
            {t("skillRoutingSettings")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-[12px] text-(--text-muted)">
                {t("skillMode")}
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="h-8 rounded-md border border-(--border-default) bg-(--bg-primary) px-2 text-[13px] text-(--text-primary)"
              >
                {SKILL_MODES.map((item) => (
                  <option key={item} value={item}>
                    {t(`skillMode_${item}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-[12px] text-(--text-muted)">
                {t("skillPriority")}
              </label>
              <Input
                type="number"
                min="0"
                max="100"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-[12px] text-(--text-muted)">
                {t("skillTriggers")}
              </label>
              <Input
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                placeholder="after_edit, before_final"
                className="h-8 text-[13px]"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-(--border-default) bg-(--bg-primary) px-2 py-1.5 sm:col-span-2">
              <span className="text-[12px] text-(--text-muted)">
                {enabled ? t("enabled") : t("disabled")}
              </span>
              <SwitchControl
                checked={enabled}
                onClick={() => setEnabled((value) => !value)}
                title={enabled ? t("disable") : t("enable")}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-1.5">
          <label className="text-[12px] text-(--text-muted)">
            {t("skillContent")}
          </label>
          {loading ? (
            <div className="rounded-md border border-(--border-default) py-8 text-center text-[12px] text-(--text-muted)">
              {t("loading")}...
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={contentReadOnly}
              className="min-h-[240px] resize-y text-[13px] font-mono leading-5"
              placeholder={
                "---\nname: my-skill\ndescription: ...\n---\n\nSkill instructions..."
              }
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
          disabled={loading || (!contentReadOnly && !content.trim()) || (isNew && !name.trim())}
          size="sm"
        >
          {isNew ? t("create") : t("save")}
        </Button>
      </div>
    </div>
  );
}

function SkillEditorDialog({ skill, open, onSave, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[86vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{skill ? t("editSkill") : t("newSkill")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <SkillEditor
            skill={skill}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewDialog({ skill, open, onOpenChange }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !skill) return;
    setLoading(true);
    api
      .fetchSkillContent(skill.name)
      .then((data) => setContent(data.content || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, skill]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[82vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {skill?.name} {t("contentPreview")}
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

export function SkillPanel() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewSkill, setViewSkill] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.fetchSkills();
      setSkills(Array.isArray(list) ? list : []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = async (name, enabled) => {
    await api.toggleSkill(name, enabled);
    loadSkills();
  };

  const handleDelete = async (name) => {
    await api.deleteSkill(name);
    loadSkills();
  };

  const handleSave = () => {
    setEditing(null);
    loadSkills();
  };

  const enabledCount = skills.filter(isEnabled).length;
  const customCount = skills.filter((skill) => !isBuiltin(skill)).length;
  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (filter === "enabled" && !isEnabled(skill)) return false;
      if (filter === "builtin" && skill.scope !== "builtin") return false;
      if (filter === "custom" && skill.scope === "builtin") return false;
      if (!needle) return true;
      return skill.name.toLowerCase().includes(needle);
    });
  }, [skills, query, filter]);

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
              <FileCode2 size={14} className="text-(--text-muted)" />
              <span className="text-[13px] font-medium text-(--text-primary)">
                {t("skillLibrary")}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-(--text-muted)">
              {t("skillPanelHint")}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
              {enabledCount}/{skills.length} {t("enabled")}
            </Badge>
            <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px]">
              {customCount} {t("custom")}
            </Badge> */}
            <Button onClick={() => setEditing("new")} size="sm">
              <Plus size={13} />
              {t("addSkill")}
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
            placeholder={t("searchSkills")}
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

      {skills.length === 0 && !editing && (
        <div className="rounded-lg border border-dashed border-(--border-default) py-8 text-center">
          <div className="text-[13px] text-(--text-primary)">
            {t("noSkills")}
          </div>
          <div className="mt-1 text-[11px] text-(--text-muted)">
            {t("noSkillsHint")}
          </div>
        </div>
      )}

      {skills.length > 0 && filteredSkills.length === 0 && (
        <div className="py-8 text-center text-[12px] text-(--text-muted)">
          {t("noMatches")}
        </div>
      )}

      <div
        className="grid max-h-[420px] gap-2 overflow-y-auto pr-1"
      >
        {filteredSkills.map((skill) => {
          const enabled = isEnabled(skill);
          return (
            <div
              key={skill.name}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                enabled
                  ? "border-(--border-default) bg-(--bg-primary) hover:bg-(--bg-hover)"
                  : "border-(--border-default) bg-(--bg-secondary) opacity-75",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-(--text-primary)">
                      {skill.name}
                    </span>
                    <Badge
                      variant={isBuiltin(skill) ? "secondary" : "outline"}
                      className="h-4 rounded-md px-1.5 py-0 text-[10px]"
                    >
                      {scopeLabel(skill.scope)}
                    </Badge>
                    <Badge
                      variant={enabled ? "outline" : "secondary"}
                      className="h-4 rounded-md px-1.5 py-0 text-[10px]"
                    >
                      {enabled ? t("enabled") : t("disabled")}
                    </Badge>
                    {skill.version && skill.version !== "0.0.0" && (
                      <span className="text-[10px] text-(--text-muted)">
                        v{skill.version}
                      </span>
                    )}
                    {skill.mode && (
                      <Badge
                        variant="outline"
                        className="h-4 rounded-md px-1.5 py-0 text-[10px]"
                      >
                        {t(`skillMode_${skill.mode}`)}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-(--text-muted)">
                    {skill.description || t("noDescription")}
                  </div>
                  {skill.triggers?.length > 0 && (
                    <div className="mt-1 truncate text-[10px] text-(--text-muted)">
                      {t("skillTriggers")}: {skill.triggers.join(", ")}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setViewSkill(skill)}
                    title={t("view")}
                  >
                    <Eye size={13} />
                  </Button>
                  <SwitchControl
                    checked={enabled}
                    onClick={() => handleToggle(skill.name, !enabled)}
                    title={enabled ? t("disable") : t("enable")}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setEditing(skill)}
                    title={isBuiltin(skill) ? t("skillRoutingSettings") : t("edit")}
                  >
                    {isBuiltin(skill) ? <SlidersHorizontal size={13} /> : <Pencil size={13} />}
                  </Button>
                  {!isBuiltin(skill) && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          if (
                            confirm(
                              t("confirmDeleteSkill").replace(
                                "{{name}}",
                                skill.name,
                              ),
                            )
                          ) {
                            handleDelete(skill.name);
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
          );
        })}
      </div>

      <ViewDialog
        skill={viewSkill}
        open={!!viewSkill}
        onOpenChange={(open) => {
          if (!open) setViewSkill(null);
        }}
      />
      <SkillEditorDialog
        skill={editing === "new" ? null : editing}
        open={!!editing}
        onSave={handleSave}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
