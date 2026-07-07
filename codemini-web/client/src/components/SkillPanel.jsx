import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CaretDown,
  CaretRight,
  Download,
  Eye,
  Folder,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  Trash,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { SettingsField } from "@/components/settings/SettingsField.jsx";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { skillAuthorLabel, sortSkillsByAuthor } from "@/lib/skill-display.js";
import * as api from "@/hooks/use-api";
import { t } from "../../i18n/index.js";

const FILTERS = ["all", "enabled", "builtin", "custom"];
const SKILL_MODES = ["always", "agent_requested", "manual"];

function scopeLabel(scope) {
  if (scope === "builtin") return t("builtin");
  if (scope === "global") return t("globalScope");
  return t("projectScope");
}

function skillKey(skill) {
  return `${skill?.scope || "unknown"}:${skill?.projectDir || ""}:${skill?.name || ""}`;
}

function projectDisplayName(value) {
  return value === "__codemini_general__" ? t("generalChat") : value;
}

function projectDirsKey(projectDirs = []) {
  return Array.isArray(projectDirs)
    ? projectDirs
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join("\n")
    : "";
}

function normalizeProjectTargets(projectTargets = [], projectDirs = []) {
  const byDir = new Map();
  for (const item of Array.isArray(projectTargets) ? projectTargets : []) {
    const dir = String(item?.dir || item?.path || item || "").trim();
    if (!dir || byDir.has(dir)) continue;
    byDir.set(dir, {
      dir,
      label:
        item?.label ||
        projectDisplayName(dir.split(/[/\\]/).filter(Boolean).pop() || dir),
    });
  }
  for (const dir of Array.isArray(projectDirs) ? projectDirs : []) {
    const value = String(dir || "").trim();
    if (!value || byDir.has(value)) continue;
    byDir.set(value, {
      dir: value,
      label: projectDisplayName(
        value.split(/[/\\]/).filter(Boolean).pop() || value,
      ),
    });
  }
  return Array.from(byDir.values());
}

function projectTargetValue(projectDir) {
  const dir = String(projectDir || "").trim();
  return dir ? `project:${dir}` : "";
}

function parseSkillTarget(value) {
  const text = String(value || "");
  if (text === "global") return { scope: "global", projectDir: "" };
  if (text.startsWith("project:")) {
    return { scope: "project", projectDir: text.slice("project:".length) };
  }
  return { scope: "project", projectDir: "" };
}

function defaultSkillTarget(projectTargets = []) {
  return projectTargets[0]?.dir
    ? projectTargetValue(projectTargets[0].dir)
    : "global";
}

function isBuiltin(skill) {
  return skill?.scope === "builtin";
}

function isEnabled(skill) {
  return skill?.enabled !== false;
}

function normalizeSkillMode(value) {
  return value === "auto_attach"
    ? "agent_requested"
    : value || "agent_requested";
}

function SkillEditor({ skill, projectTargets = [], onSave, onCancel }) {
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [target, setTarget] = useState(
    skill?.scope === "global"
      ? "global"
      : projectTargetValue(skill?.projectDir) ||
          defaultSkillTarget(projectTargets),
  );
  const [mode, setMode] = useState(normalizeSkillMode(skill?.mode));
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
    setTarget(
      skill?.scope === "global"
        ? "global"
        : projectTargetValue(skill?.projectDir) ||
            defaultSkillTarget(projectTargets),
    );
    setMode(normalizeSkillMode(skill?.mode));
    setTriggers((skill?.triggers || []).join(", "));
    setPriority(skill?.priority ?? 50);
    setEnabled(isEnabled(skill));
    if (!skill) {
      setContent("");
      return;
    }
    setLoading(true);
    api
      .fetchSkillContent(skill.name, skill.projectDir)
      .then((data) => setContent(data.content || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [skill, projectTargets]);

  const handleSave = async () => {
    const selectedTarget = parseSkillTarget(target);
    const metadata = {
      description,
      scope: selectedTarget.scope,
      mode,
      triggers: triggers
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      enabled,
      priority: Number(priority) || 0,
    };
    if (isNew) {
      await api.createSkill({
        name,
        description,
        content,
        scope: selectedTarget.scope,
        projectDir: selectedTarget.projectDir,
      });
      await api.updateSkillMetadata(
        name,
        metadata,
        selectedTarget.scope === "project"
          ? selectedTarget.projectDir
          : undefined,
      );
    } else {
      if (!contentReadOnly) {
        await api.updateSkillContent(skill.name, content, skill.projectDir);
      }
      await api.updateSkillMetadata(
        skill.name,
        {
          ...metadata,
          targetProjectDir:
            selectedTarget.scope === "project"
              ? selectedTarget.projectDir
              : undefined,
        },
        skill.projectDir,
      );
    }
    onSave();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-1">
        <SettingsSection
          description={t("skillEditorHint")}
          className="gap-4"
        >
          {(isNew || !isBuiltin(skill)) && (
            <SettingsField id="skill-editor-scope" label={t("skillScope")}>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="global">{t("globalScope")}</SelectItem>
                    {projectTargets.map((item) => (
                      <SelectItem
                        key={item.dir}
                        value={projectTargetValue(item.dir)}
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsField>
          )}
          <SettingsField id="skill-editor-name" label={t("name")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isNew}
              placeholder="my-skill"
            />
          </SettingsField>
          <SettingsField id="skill-editor-description" label={t("description")}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("skillDescriptionPlaceholder")}
              className="min-h-[72px] resize-none leading-5"
            />
          </SettingsField>

          <div className="rounded-lg border border-(--border-default) bg-(--bg-subtle) p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-(--text-primary)">
              <SlidersHorizontal size={14} className="text-(--text-muted)" />
              {t("skillRoutingSettings")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsField
                id="skill-editor-mode"
                label={t("skillMode")}
                description={t("skillModeHint")}
                className="sm:col-span-2"
              >
                <SettingsSegmentedControl
                  idPrefix="skill-editor-mode"
                  value={mode}
                  onValueChange={setMode}
                  options={SKILL_MODES.map((item) => ({
                    value: item,
                    label: t(`skillMode_${item}`),
                  }))}
                  className="[&_button]:text-[11px] sm:[&_button]:text-[12px]"
                />
              </SettingsField>
              <SettingsField id="skill-editor-priority" label={t("skillPriority")}>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </SettingsField>
              <SettingsField
                id="skill-editor-triggers"
                label={t("skillTriggers")}
                className="sm:col-span-2"
              >
                <Input
                  value={triggers}
                  onChange={(e) => setTriggers(e.target.value)}
                  placeholder="after_edit, before_final"
                />
              </SettingsField>
              <div className="flex items-center justify-between sm:col-span-2">
                <span className="text-[13px] font-medium text-(--text-primary)">
                  {t("enabled")}
                </span>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label={enabled ? t("disable") : t("enable")}
                />
              </div>
            </div>
          </div>

          <SettingsField id="skill-editor-content" label={t("skillContent")}>
            {loading ? (
              <Empty className="rounded-lg border border-(--border-default) py-8">
                <EmptyDescription>{t("loading")}...</EmptyDescription>
              </Empty>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={contentReadOnly}
                className="min-h-[360px] resize-y font-mono leading-5"
                placeholder={
                  "---\nname: my-skill\ndescription: ...\n---\n\nSkill instructions..."
                }
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
          disabled={
            loading ||
            (!contentReadOnly && !content.trim()) ||
            (isNew && !name.trim())
          }
          size="sm"
        >
          {isNew ? t("create") : t("save")}
        </Button>
      </div>
    </div>
  );
}

function SkillEditorDialog({
  skill,
  projectTargets = [],
  open,
  onSave,
  onOpenChange,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[86vh] max-h-[86vh] flex-col gap-4 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{skill ? t("editSkill") : t("newSkill")}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6">
          <SkillEditor
            skill={skill}
            projectTargets={projectTargets}
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
      .fetchSkillContent(skill.name, skill.projectDir)
      .then((data) => setContent(data.content || ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, skill]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] flex-col gap-4 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>
            {skill?.name} {t("contentPreview")}
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

function InstallDialog({
  open,
  onOpenChange,
  installSource,
  setInstallSource,
  installTarget,
  setInstallTarget,
  installing,
  installError,
  onInstall,
  projectTargets,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-4 overflow-hidden p-0 sm:max-w-[480px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{t("installSkill")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <SettingsSection description={t("skillInstallHint")} className="gap-4">
            <SettingsField
              id="skill-install-source"
              label={t("skillInstallSource")}
            >
              <Input
                value={installSource}
                onChange={(e) => setInstallSource(e.target.value)}
                placeholder={t("skillInstallPlaceholder")}
                className="h-9 text-[13px]"
              />
            </SettingsField>
            <SettingsField id="skill-install-target" label={t("skillScope")}>
              <Select
                value={
                  installTarget || defaultSkillTarget(projectTargets)
                }
                onValueChange={setInstallTarget}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="global">{t("globalScope")}</SelectItem>
                    {projectTargets.map((item) => (
                      <SelectItem
                        key={item.dir}
                        value={projectTargetValue(item.dir)}
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsField>
          </SettingsSection>
          {installError && (
            <div className="text-[11px] text-(--accent-red)">{installError}</div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              size="sm"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={onInstall}
              disabled={installing || !installSource.trim()}
              size="sm"
            >
              <Download data-icon="inline-start" />
              {installing ? t("installing") : t("installSkill")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function modeBadgeClass(mode) {
  if (mode === "always") return "bg-(--accent-blue-bg) text-(--accent-blue)";
  if (mode === "agent_requested") return "bg-(--accent-purple-bg) text-(--accent-purple)";
  return "bg-(--accent-orange-bg) text-(--accent-orange)";
}

function SkillCard({ skill, onView, onToggle, onEdit, onDelete }) {
  const enabled = isEnabled(skill);
  const builtin = isBuiltin(skill);
  const author = skillAuthorLabel(skill);
  const mode = normalizeSkillMode(skill.mode);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 transition-colors",
        enabled
          ? "border-primary/40 bg-primary/5"
          : "border-border/70 text-muted-foreground",
      )}
    >
      {/* Header: name + badges */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-foreground">
          {skill.name}
        </span>
        {skill.version && skill.version !== "0.0.0" && (
          <Badge variant="outline" className="h-4 rounded-md px-1.5 py-0 text-[11px]">
            v{skill.version}
          </Badge>
        )}
        {skill.mode && (
          <span
            className={cn(
              "inline-flex h-4 items-center rounded-md px-1.5 py-0 text-[11px] font-medium",
              modeBadgeClass(mode),
            )}
          >
            {t(`skillMode_${mode}`)}
          </span>
        )}
        {author && (
          <Badge variant="secondary" className="h-4 rounded-md px-1.5 py-0 text-[11px]">
            {author}
          </Badge>
        )}
        <Badge
          variant={builtin ? "secondary" : "outline"}
          className="h-4 rounded-md px-1.5 py-0 text-[11px]"
        >
          {scopeLabel(skill.scope)}
        </Badge>
      </div>

      {/* Description */}
      {skill.description ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {skill.description}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/60">{t("noDescription")}</p>
      )}

      {/* Triggers */}
      {skill.triggers?.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("skillTriggers")}: {skill.triggers.join(", ")}
        </p>
      )}

      {/* Footer: actions + toggle */}
      <Separator />
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onView(skill)}
          aria-label={t("view")}
          title={t("view")}
        >
          <Eye size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onEdit(skill)}
          aria-label={builtin ? t("skillRoutingSettings") : t("edit")}
          title={builtin ? t("skillRoutingSettings") : t("edit")}
        >
          {builtin ? <SlidersHorizontal size={15} /> : <PencilSimple size={15} />}
        </Button>
        {!builtin && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-(--accent-red) hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
            onClick={() => {
              if (
                confirm(
                  t("confirmDeleteSkill").replace("{{name}}", skill.name),
                )
              ) {
                onDelete(skill);
              }
            }}
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash size={15} />
          </Button>
        )}
        <div className="ml-auto">
          <Switch
            checked={enabled}
            onCheckedChange={(next) => onToggle(skill, next)}
            aria-label={enabled ? t("disable") : t("enable")}
          />
        </div>
      </div>
    </div>
  );
}

function SkillCards({ items, onView, onToggle, onEdit, onDelete }) {
  return items.map((skill) => (
    <SkillCard
      key={skillKey(skill)}
      skill={skill}
      onView={onView}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  ));
}

function SkillGroupHeader({ name, count, collapsed, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/50"
      title={title}
    >
      <Folder size={14} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-muted-foreground">{count}</span>
      {collapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}
    </button>
  );
}

export function SkillPanel({ projectDirs = [], projectTargets = [] }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewSkill, setViewSkill] = useState(null);
  const [collapsedProjects, setCollapsedProjects] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [installSource, setInstallSource] = useState("");
  const normalizedProjectTargets = useMemo(
    () => normalizeProjectTargets(projectTargets, projectDirs),
    [projectTargets, projectDirs],
  );
  const [installTarget, setInstallTarget] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState("");
  const [installOpen, setInstallOpen] = useState(false);
  const projectKey = projectDirsKey(projectDirs);
  const requestProjectDirs = useMemo(
    () => (projectKey ? projectKey.split("\n") : []),
    [projectKey],
  );

  useEffect(() => {
    const allowed = new Set([
      "global",
      ...normalizedProjectTargets.map((item) => projectTargetValue(item.dir)),
    ]);
    if (installTarget && !allowed.has(installTarget)) {
      setInstallTarget("");
    }
  }, [installTarget, normalizedProjectTargets]);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.fetchSkills(requestProjectDirs);
      setSkills(Array.isArray(list) ? list : []);
    } catch {}
    setLoading(false);
  }, [requestProjectDirs]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = async (skill, enabled) => {
    // 乐观更新：立即翻转本地状态，用户秒切无闪烁
    setSkills((prev) =>
      prev.map((s) =>
        s.name === skill.name && s.projectDir === skill.projectDir
          ? { ...s, enabled }
          : s,
      ),
    );
    try {
      await api.toggleSkill(skill.name, enabled, skill.projectDir);
    } catch {
      // 请求失败时回滚
      setSkills((prev) =>
        prev.map((s) =>
          s.name === skill.name && s.projectDir === skill.projectDir
            ? { ...s, enabled: !enabled }
            : s,
        ),
      );
    }
    // 闈欓粯鍚庡彴鍒锋柊锛屼笉瑙﹀彂 loading
    try {
      const list = await api.fetchSkills(requestProjectDirs);
      setSkills(Array.isArray(list) ? list : []);
    } catch {}
  };

  const handleDelete = async (skill) => {
    await api.deleteSkill(skill.name, skill.projectDir);
    loadSkills();
  };

  const handleSave = () => {
    setEditing(null);
    loadSkills();
  };

  const handleInstall = async () => {
    const source = installSource.trim();
    if (!source) return;
    setInstalling(true);
    setInstallError("");
    try {
      const selectedTarget = parseSkillTarget(
        installTarget || defaultSkillTarget(normalizedProjectTargets),
      );
      const result = await api.installSkill({
        source,
        scope: selectedTarget.scope,
        projectDir: selectedTarget.projectDir,
      });
      if (result?.error) throw new Error(result.message || "Install failed");
      setInstallSource("");
      setInstallOpen(false);
      await loadSkills();
    } catch (err) {
      setInstallError(err.message || "Install failed");
    } finally {
      setInstalling(false);
    }
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
      return (
        skill.name.toLowerCase().includes(needle) ||
        String(skill.packageName || "")
          .toLowerCase()
          .includes(needle) ||
        String(skillAuthorLabel(skill))
          .toLowerCase()
          .includes(needle) ||
        String(projectDisplayName(skill.projectName || ""))
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [skills, query, filter]);
  const groupedSkills = useMemo(() => {
    const regular = [];
    const projects = new Map();
    for (const skill of filteredSkills) {
      if (skill.scope !== "project") {
        regular.push(skill);
        continue;
      }
      const key = skill.projectDir || "__current_project__";
      if (!projects.has(key)) {
        projects.set(key, {
          key,
          name: projectDisplayName(skill.projectName || t("projectScope")),
          items: [],
        });
      }
      projects.get(key).items.push(skill);
    }
    return {
      regular: sortSkillsByAuthor(regular),
      projects: [...projects.values()]
        .map((group) => ({
          ...group,
          items: sortSkillsByAuthor(group.items),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }, [filteredSkills]);

  const toggleProjectGroup = useCallback((key) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const renderSkillList = () => (
    <>
      {skills.length === 0 && !editing && (
        <Empty className="rounded-lg py-8">
          <EmptyDescription className="text-[13px] text-(--text-primary)">
            {t("noSkills")}
          </EmptyDescription>
          <EmptyDescription className="text-[11px]">
            {t("noSkillsHint")}
          </EmptyDescription>
        </Empty>
      )}

      {skills.length > 0 && filteredSkills.length === 0 && (
        <div className="py-8 text-center text-[12px] text-(--text-muted)">
          {t("noMatches")}
        </div>
      )}

      {(skills.length > 0 && filteredSkills.length > 0) && (
        <div className="grid gap-2">
          <SkillCards
            items={groupedSkills.regular}
            onView={setViewSkill}
            onToggle={handleToggle}
            onEdit={setEditing}
            onDelete={handleDelete}
          />
          {groupedSkills.projects.map((group) => {
            const collapsed = collapsedProjects.has(group.key);
            return (
              <div key={group.key} className="grid gap-1">
                <SkillGroupHeader
                  name={group.name}
                  count={group.items.length}
                  collapsed={collapsed}
                  title={group.key}
                  onClick={() => toggleProjectGroup(group.key)}
                />
                {!collapsed && (
                  <div className="grid gap-2 pl-6">
                    <SkillCards
                      items={group.items}
                      onView={setViewSkill}
                      onToggle={handleToggle}
                      onEdit={setEditing}
                      onDelete={handleDelete}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

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
        <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-3 [scrollbar-gutter:stable]">
          <div className="flex flex-col gap-4">
            <SettingsSection description={t("skillPanelHint")} className="gap-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {skills.length > 0 && (
                  <p className="text-[12px] text-(--text-muted)">
                    {enabledCount}/{skills.length} {t("enabled")} · {customCount}{" "}
                    {t("custom")}
                  </p>
                )}
                <div className="flex items-center gap-2 sm:ml-auto">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setInstallError("");
                      setInstallOpen(true);
                    }}
                    size="sm"
                  >
                    <Download size={13} />
                    {t("installSkill")}
                  </Button>
                  <Button
                    onClick={() => setEditing("new")}
                    size="sm"
                  >
                    <Plus size={13} />
                    {t("addSkill")}
                  </Button>
                </div>
              </div>
            </SettingsSection>

            <div className="sticky top-0 z-10 flex flex-col gap-2 bg-background pb-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <MagnifyingGlass
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-muted)"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchSkills")}
                  className="h-9 pl-8 text-[13px]"
                />
              </div>
              <SettingsSegmentedControl
                idPrefix="skill-filter"
                value={filter}
                onValueChange={setFilter}
                options={FILTERS.map((item) => ({
                  value: item,
                  label: t(`filter_${item}`),
                }))}
                className="w-full shrink-0 sm:min-w-[240px] sm:w-auto [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
              />
            </div>

            {renderSkillList()}
          </div>
        </div>
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
        projectTargets={normalizedProjectTargets}
        open={!!editing}
        onSave={handleSave}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <InstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        installSource={installSource}
        setInstallSource={setInstallSource}
        installTarget={installTarget}
        setInstallTarget={setInstallTarget}
        installing={installing}
        installError={installError}
        onInstall={handleInstall}
        projectTargets={normalizedProjectTargets}
      />
    </>
  );
}
