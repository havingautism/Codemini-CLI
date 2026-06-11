import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CaretDown,
  CaretRight,
  Download,
  Eye,
  FileCode,
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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function compactSourceLabel(value) {
  const text = String(value || "").trim();
  const github = text.match(
    /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/i,
  );
  if (github) return `${github[1]}/${github[2]}`;
  const ownerRepo = text.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s|$)/);
  if (ownerRepo) return ownerRepo[1];
  return text.replace(/\\/g, "/").split("/").filter(Boolean).pop() || text;
}

function isPackagedSkill(skill) {
  if (isBuiltin(skill)) return false;
  const source = String(skill?.source || "").trim();
  const packageSource = String(skill?.packageSource || "").trim();
  const packageName = String(skill?.packageName || "").trim();
  if (!packageSource && !packageName) return false;
  return !["web-create", "web-move", "reindex"].includes(source);
}

function skillPackageKey(skill) {
  if (!isPackagedSkill(skill)) return "";
  return [
    skill?.scope || "unknown",
    skill?.projectDir || "",
    skill?.packageSource || skill?.source || skill?.packageName || "",
  ].join(":");
}

function skillPackageName(skill) {
  return (
    String(skill?.packageName || "").trim() ||
    compactSourceLabel(skill?.packageSource || skill?.source) ||
    t("skillPackage")
  );
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

function skillSortValue(skill) {
  const modeRank = normalizeSkillMode(skill?.mode) === "always" ? 0 : 1;
  const enabledRank = isEnabled(skill) ? 0 : 1;
  const priority = Number(skill?.priority);
  return {
    modeRank,
    enabledRank,
    priority: Number.isFinite(priority) ? priority : 0,
    name: String(skill?.name || "").toLowerCase(),
  };
}

function compareSkills(a, b) {
  const left = skillSortValue(a);
  const right = skillSortValue(b);
  return (
    left.modeRank - right.modeRank ||
    left.enabledRank - right.enabledRank ||
    right.priority - left.priority ||
    left.name.localeCompare(right.name)
  );
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
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-(--text-primary)">
              {isNew ? t("newSkill") : t("editSkill")}
            </div>
            <div className="mt-0.5 text-[11px] text-(--text-muted)">
              {t("skillEditorHint")}
            </div>
          </div>
          <Badge
            variant="outline"
            className="rounded-md px-1.5 py-0 text-[10px]"
          >
            {scopeLabel(parseSkillTarget(target).scope)}
          </Badge>
        </div>

        <FieldGroup className="gap-3">
          {(isNew || !isBuiltin(skill)) && (
            <Field className="flex-col items-stretch gap-1.5">
              <FieldTitle>{t("skillScope")}</FieldTitle>
              <FieldContent>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger className="w-full">
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
              </FieldContent>
            </Field>
          )}
          <Field className="flex-col items-stretch gap-1.5">
            <FieldTitle>{t("name")}</FieldTitle>
            <FieldContent>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isNew}
                placeholder="my-skill"
              />
            </FieldContent>
          </Field>
          <Field className="flex-col items-stretch gap-1.5">
            <FieldTitle>{t("description")}</FieldTitle>
            <FieldContent>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("skillDescriptionPlaceholder")}
              />
            </FieldContent>
          </Field>

          <div className="rounded-md border border-(--border-default) bg-(--bg-secondary) p-3">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-(--text-primary)">
              <SlidersHorizontal size={13} />
              {t("skillRoutingSettings")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field className="flex-col items-stretch gap-1.5">
                <FieldTitle>{t("skillMode")}</FieldTitle>
                <FieldContent>
                  <Select value={mode} onValueChange={setMode}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {SKILL_MODES.map((item) => (
                          <SelectItem key={item} value={item}>
                            {t(`skillMode_${item}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field className="flex-col items-stretch gap-1.5">
                <FieldTitle>{t("skillPriority")}</FieldTitle>
                <FieldContent>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                </FieldContent>
              </Field>
              <Field className="flex-col items-stretch gap-1.5 sm:col-span-2">
                <FieldTitle>{t("skillTriggers")}</FieldTitle>
                <FieldContent>
                  <Input
                    value={triggers}
                    onChange={(e) => setTriggers(e.target.value)}
                    placeholder="after_edit, before_final"
                  />
                </FieldContent>
              </Field>
              <div className="flex items-center justify-between rounded-md border border-(--border-default) bg-(--bg-primary) px-2 py-1.5 sm:col-span-2">
                <span className="text-[12px] text-(--text-muted)">
                  {enabled ? t("enabled") : t("disabled")}
                </span>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label={enabled ? t("disable") : t("enable")}
                />
              </div>
            </div>
          </div>

          <Field className="flex-col items-stretch gap-1.5">
            <FieldTitle>{t("skillContent")}</FieldTitle>
            <FieldContent>
              {loading ? (
                <Empty className="rounded-md border border-(--border-default) py-8">
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
            </FieldContent>
          </Field>
        </FieldGroup>
      </div>

      <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-(--border-default) bg-(--bg-primary) pt-3">
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
      <DialogContent className="sm:max-w-[760px] h-[86vh] max-h-[86vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{skill ? t("editSkill") : t("newSkill")}</DialogTitle>
        </DialogHeader>
        <SkillEditor
          skill={skill}
          projectTargets={projectTargets}
          onSave={onSave}
          onCancel={() => onOpenChange(false)}
        />
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

function SkillCard({ skill, onView, onToggle, onEdit, onDelete }) {
  const enabled = isEnabled(skill);
  return (
    <div
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
                {t(`skillMode_${normalizeSkillMode(skill.mode)}`)}
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
            onClick={() => onView(skill)}
            title={t("view")}
          >
            <Eye size={13} />
          </Button>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => onToggle(skill, next)}
            aria-label={enabled ? t("disable") : t("enable")}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onEdit(skill)}
            title={isBuiltin(skill) ? t("skillRoutingSettings") : t("edit")}
          >
            {isBuiltin(skill) ? (
              <SlidersHorizontal size={13} />
            ) : (
              <PencilSimple size={13} />
            )}
          </Button>
          {!isBuiltin(skill) && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                if (
                  confirm(
                    t("confirmDeleteSkill").replace("{{name}}", skill.name),
                  )
                ) {
                  onDelete(skill);
                }
              }}
              title={t("delete")}
              className="text-(--accent-red) hover:text-(--accent-red)"
            >
              <Trash size={13} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillGroupHeader({
  icon = "folder",
  name,
  count,
  collapsed,
  title,
  onClick,
}) {
  const Icon = icon === "package" ? FileCode : Folder;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[12px] font-medium text-(--text-primary) hover:bg-(--bg-hover)"
      title={title}
    >
      <Icon size={14} className="shrink-0 text-(--text-muted)" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-[12px] font-medium text-(--text-accent)">
        {count}
      </span>
      {collapsed ? (
        <CaretRight size={13} className="shrink-0 text-(--text-muted)" />
      ) : (
        <CaretDown size={13} className="shrink-0 text-(--text-muted)" />
      )}
    </button>
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

export function SkillPanel({ projectDirs = [], projectTargets = [] }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewSkill, setViewSkill] = useState(null);
  const [collapsedProjects, setCollapsedProjects] = useState(() => new Set());
  const [collapsedPackages, setCollapsedPackages] = useState(() => new Set());
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
        String(compactSourceLabel(skill.packageSource || skill.source))
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
    const packageGroups = [];
    const projectGroups = [];
    const packageIndex = new Map();
    const projectIndex = new Map();
    const addToPackage = (groups, index, skill) => {
      const key = skillPackageKey(skill);
      if (!key) return false;
      if (!index.has(key)) {
        const group = {
          key,
          name: skillPackageName(skill),
          source: skill.packageSource || skill.source || "",
          items: [],
        };
        index.set(key, group);
        groups.push(group);
      }
      index.get(key).items.push(skill);
      return true;
    };

    for (const skill of filteredSkills) {
      if (skill.scope !== "project") {
        if (!addToPackage(packageGroups, packageIndex, skill)) {
          regular.push(skill);
        }
        continue;
      }
      const key = skill.projectDir || "__current_project__";
      if (!projectIndex.has(key)) {
        const group = {
          key,
          name: projectDisplayName(skill.projectName || t("projectScope")),
          items: [],
          packageGroups: [],
          packageIndex: new Map(),
          total: 0,
        };
        projectIndex.set(key, group);
        projectGroups.push(group);
      }
      const group = projectIndex.get(key);
      group.total += 1;
      if (!addToPackage(group.packageGroups, group.packageIndex, skill)) {
        group.items.push(skill);
      }
    }
    for (const group of projectGroups) {
      delete group.packageIndex;
    }
    regular.sort(compareSkills);
    packageGroups.sort((a, b) => a.name.localeCompare(b.name));
    for (const group of packageGroups) {
      group.items.sort(compareSkills);
    }
    projectGroups.sort((a, b) => a.name.localeCompare(b.name));
    for (const group of projectGroups) {
      group.items.sort(compareSkills);
      group.packageGroups.sort((a, b) => a.name.localeCompare(b.name));
      for (const packageGroup of group.packageGroups) {
        packageGroup.items.sort(compareSkills);
      }
    }
    return { regular, packageGroups, projectGroups };
  }, [filteredSkills]);

  const togglePackageGroup = useCallback((key) => {
    setCollapsedPackages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleProjectGroup = useCallback((key) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const renderPackageGroup = (group, indentClass = "pl-6") => {
    const collapsed = collapsedPackages.has(group.key);
    return (
      <div key={group.key} className="grid gap-1">
        <SkillGroupHeader
          icon="package"
          name={group.name}
          count={group.items.length}
          collapsed={collapsed}
          title={group.source || group.key}
          onClick={() => togglePackageGroup(group.key)}
        />
        {!collapsed && (
          <div className={cn("grid gap-2", indentClass)}>
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
              <FileCode size={14} className="text-(--text-muted)" />
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

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <Input
          value={installSource}
          onChange={(e) => setInstallSource(e.target.value)}
          placeholder={t("skillInstallPlaceholder")}
          className="h-8 text-[13px]"
        />
        <Select
          value={installTarget || defaultSkillTarget(normalizedProjectTargets)}
          onValueChange={setInstallTarget}
        >
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              <SelectItem value="global">{t("globalScope")}</SelectItem>
              {normalizedProjectTargets.map((item) => (
                <SelectItem key={item.dir} value={projectTargetValue(item.dir)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          onClick={handleInstall}
          disabled={installing || !installSource.trim()}
          size="sm"
        >
          <Download data-icon="inline-start" />
          {installing ? t("installing") : t("installSkill")}
        </Button>
      </div>
      {installError && (
        <div className="mt-2 text-[11px] text-(--accent-red)">
          {installError}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlass
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

      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
        <SkillCards
          items={groupedSkills.regular}
          onView={setViewSkill}
          onToggle={handleToggle}
          onEdit={setEditing}
          onDelete={handleDelete}
        />
        {groupedSkills.packageGroups.map((group) => renderPackageGroup(group))}
        {groupedSkills.projectGroups.map((group) => {
          const collapsed = collapsedProjects.has(group.key);
          return (
            <div key={group.key} className="grid gap-1">
              <SkillGroupHeader
                name={group.name}
                count={group.total}
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
                  {group.packageGroups.map((pkg) => renderPackageGroup(pkg))}
                </div>
              )}
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
        projectTargets={normalizedProjectTargets}
        open={!!editing}
        onSave={handleSave}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
