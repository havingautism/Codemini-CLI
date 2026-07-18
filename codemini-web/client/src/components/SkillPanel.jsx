import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  Download,
  Folder,
  ListBullets,
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
import { SettingsField } from "@/components/settings/SettingsField.jsx";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MarkdownEditor,
  MarkdownPreview,
} from "@/components/MarkdownEditor.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { cn } from "@/lib/utils";
import {
  groupSkillsByPackage,
  skillAuthorLabel,
  skillPackageIsUpdatable,
  skillsInSamePackage,
} from "@/lib/skill-display.js";
import * as api from "@/hooks/use-api";
import { t } from "../../i18n/index.js";

const FILTERS = ["all", "custom", "remote"];
/** Panel tabs map to skill contexts: global = coding+daily (usable in both modes). */
const SKILL_TABS = ["global", "coding", "daily"];
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

function skillContextsOrDefault(skill) {
  const contexts = Array.isArray(skill?.contexts)
    ? skill.contexts.filter((item) => item === "coding" || item === "daily")
    : [];
  return contexts.length > 0 ? contexts : ["coding", "daily"];
}

/** UI tab id for a skill's contexts binding. */
function skillContextValue(contexts = []) {
  const values = new Set(
    (Array.isArray(contexts) ? contexts : []).filter(
      (item) => item === "coding" || item === "daily",
    ),
  );
  if (values.size === 0) return "global";
  if (values.has("coding") && !values.has("daily")) return "coding";
  if (values.has("daily") && !values.has("coding")) return "daily";
  return "global";
}

/** Map panel tab → config.skills.contexts value. */
function contextsFromTab(tab) {
  if (tab === "coding") return ["coding"];
  if (tab === "daily") return ["daily"];
  return ["coding", "daily"];
}

function skillTabLabel(tab) {
  if (tab === "coding") return t("skillContextCoding");
  if (tab === "daily") return t("skillContextDaily");
  return t("skillContextGlobal");
}

/** Tabs are exclusive: global / coding-only / daily-only do not overlap in the list. */
function skillMatchesTab(skill, tab) {
  return skillContextValue(skillContextsOrDefault(skill)) === tab;
}

/**
 * Package update/install picker: never surface siblings bound to another tab.
 * Uninstalled package members stay visible so they can be added into the current tab.
 */
function packagePreviewSkillsForTab(previewSkills = [], localSkills = [], tab = "global") {
  return (Array.isArray(previewSkills) ? previewSkills : []).filter((item) => {
    if (!item?.installed) return true;
    const local = (Array.isArray(localSkills) ? localSkills : []).find(
      (skill) => skill?.name === item.name,
    );
    if (!local) return true;
    return skillMatchesTab(local, tab);
  });
}

/**
 * Context-scoped delete:
 * - global tab → drop both bindings → full delete (only that global skill)
 * - coding/daily → remove only that binding; keep the other if present
 */
function remainingContextsAfterTabRemove(skill, tab) {
  if (tab === "global") return [];
  if (tab !== "coding" && tab !== "daily") return [];
  return skillContextsOrDefault(skill).filter((item) => item !== tab);
}

function SkillEditor({ skill, onSave, onValidate, defaultContext = "global" }) {
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [context, setContext] = useState(
    skill ? skillContextValue(skillContextsOrDefault(skill)) : defaultContext,
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
    setContext(
      skill ? skillContextValue(skillContextsOrDefault(skill)) : defaultContext,
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
      .then((contentData) => {
        setContent(contentData?.content || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [skill, defaultContext]);

  const handleSave = async () => {
    const metadata = {
      description,
      contexts: contextsFromTab(context),
      enabled,
      mode,
      triggers:
        mode === "agent_requested"
          ? triggers.split(",").map((item) => item.trim()).filter(Boolean)
          : [],
      priority: Number(priority) || 0,
      disableModelInvocation: false,
    };
    if (isNew) {
      await api.createSkill({
        name,
        description,
        content,
        scope: "global",
        contexts: metadata.contexts,
      });
      await api.updateSkillMetadata(name, metadata, undefined);
    } else {
      if (!contentReadOnly) {
        await api.updateSkillContent(skill.name, content, skill.projectDir);
      }
      await api.updateSkillMetadata(skill.name, metadata, skill.projectDir);
    }
    onSave();
  };

  const canSave =
    !loading && (contentReadOnly || content.trim()) && (!isNew || name.trim());
  const validateRef = useRef(null);
  useEffect(() => {
    if (
      validateRef.current?.isNew === isNew &&
      validateRef.current?.canSave === canSave
    ) {
      return;
    }
    validateRef.current = { isNew, canSave };
    onValidate?.({ handleSave, isNew, canSave });
  }, [handleSave, isNew, canSave, onValidate]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 pr-1 sm:px-6">
        <SettingsSection description={t("skillEditorHint")} className="gap-4">
          {(isNew || !isBuiltin(skill)) && (
            <SettingsField id="skill-editor-context" label={t("skillContext")}>
              <Select value={context} onValueChange={setContext}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="global">
                      {t("skillContextGlobal")}
                    </SelectItem>
                    <SelectItem value="coding">
                      {t("skillContextCoding")}
                    </SelectItem>
                    <SelectItem value="daily">
                      {t("skillContextDaily")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsField>
          )}
          {(isNew || !isBuiltin(skill)) && (
            <SettingsField
              id="skill-editor-mode"
              label={t("skillMode")}
              description={t("skillModeHint")}
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
          )}
          {mode === "agent_requested" && (isNew || !isBuiltin(skill)) && (
            <SettingsField id="skill-editor-triggers" label={t("skillTriggers")}>
              <Input
                value={triggers}
                onChange={(event) => setTriggers(event.target.value)}
                placeholder="react, testing, docs"
              />
            </SettingsField>
          )}
          {mode === "always" && (isNew || !isBuiltin(skill)) && (
            <SettingsField id="skill-editor-priority" label={t("skillPriority")}>
              <Input
                type="number"
                min="0"
                max="100"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              />
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

          <div className="flex items-center justify-between rounded-lg border border-(--border-default) bg-(--bg-subtle) px-4 py-3">
            <span className="text-[13px] font-medium text-(--text-primary)">
              {t("enabled")}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={enabled ? t("disable") : t("enable")}
            />
          </div>

          <SettingsField id="skill-editor-content" label={t("skillContent")}>
            {loading ? (
              <Empty className="rounded-lg border border-(--border-default) py-8">
                <EmptyDescription>{t("loading")}...</EmptyDescription>
              </Empty>
            ) : (
              <MarkdownEditor
                value={content}
                onChange={setContent}
                height={360}
                preview={contentReadOnly ? "preview" : "live"}
                placeholder={
                  "---\nname: my-skill\ndescription: ...\n---\n\nSkill instructions..."
                }
              />
            )}
          </SettingsField>
        </SettingsSection>
      </div>
    </div>
  );
}

function SkillEditorDialog({ skill, open, onSave, onOpenChange, defaultContext = "global" }) {
  const [footerState, setFooterState] = useState({
    isNew: true,
    canSave: false,
  });
  const saveRef = useRef(null);

  const handleValidate = useCallback(({ handleSave, isNew, canSave }) => {
    saveRef.current = handleSave;
    setFooterState((prev) =>
      prev.isNew === isNew && prev.canSave === canSave
        ? prev
        : { isNew, canSave },
    );
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[86vh] max-h-[86vh] flex-col overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{skill ? t("editSkill") : t("newSkill")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
          <SkillEditor
            skill={skill}
            defaultContext={defaultContext}
            onSave={onSave}
            onValidate={handleValidate}
          />
        </div>
        <div className="mx-4 flex shrink-0 justify-end gap-2 border-t border-(--border-default) py-4 sm:mx-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={() => saveRef.current?.()}
            disabled={!footerState.canSave}
          >
            {footerState.isNew ? t("create") : t("save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillRoutingForm({ skill, onSave, onCancel }) {
  const [routeMode, setRouteMode] = useState(normalizeSkillMode(skill?.mode));
  const [routeContext, setRouteContext] = useState(
    skillContextValue(skillContextsOrDefault(skill)),
  );
  const [routeTriggers, setRouteTriggers] = useState(
    (skill?.triggers || []).join(", "),
  );
  const [routePriority, setRoutePriority] = useState(skill?.priority ?? 50);
  const [saving, setSaving] = useState(false);
  const builtin = isBuiltin(skill);

  useEffect(() => {
    setRouteMode(normalizeSkillMode(skill?.mode));
    setRouteContext(skillContextValue(skillContextsOrDefault(skill)));
    setRouteTriggers((skill?.triggers || []).join(", "));
    setRoutePriority(skill?.priority ?? 50);
  }, [skill]);

  const handleSave = async () => {
    if (!skill || builtin) return;
    setSaving(true);
    try {
      await api.updateSkillMetadata(
        skill.name,
        {
          mode: routeMode,
          contexts: contextsFromTab(routeContext),
          triggers:
            routeMode === "agent_requested"
              ? routeTriggers
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
              : [],
          priority: Number(routePriority) || 0,
        },
        skill.projectDir,
      );
      await onSave?.();
      onCancel?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-1">
        <SettingsSection className="gap-4">
          <SettingsField
            id="skill-detail-context"
            label={t("skillContext")}
            description={t("skillContextHint")}
          >
            <Select
              value={routeContext}
              onValueChange={setRouteContext}
              disabled={builtin}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  <SelectItem value="global">
                    {t("skillContextGlobal")}
                  </SelectItem>
                  <SelectItem value="coding">
                    {t("skillContextCoding")}
                  </SelectItem>
                  <SelectItem value="daily">
                    {t("skillContextDaily")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsField>
          <SettingsField
            id="skill-detail-mode"
            label={t("skillMode")}
            description={t("skillModeHint")}
          >
            <SettingsSegmentedControl
              idPrefix="skill-detail-mode"
              value={routeMode}
              onValueChange={setRouteMode}
              disabled={builtin}
              options={SKILL_MODES.map((item) => ({
                value: item,
                label: t(`skillMode_${item}`),
              }))}
              className="w-full max-w-xl [&_button]:text-[11px] sm:[&_button]:text-[12px]"
            />
          </SettingsField>
          {routeMode === "agent_requested" ? (
            <SettingsField id="skill-detail-triggers" label={t("skillTriggers")}>
              <Input
                value={routeTriggers}
                onChange={(event) => setRouteTriggers(event.target.value)}
                placeholder="react, testing, docs"
                disabled={builtin}
              />
            </SettingsField>
          ) : null}
          {routeMode === "always" ? (
            <SettingsField id="skill-detail-priority" label={t("skillPriority")}>
              <Input
                type="number"
                min="0"
                max="100"
                value={routePriority}
                onChange={(event) => setRoutePriority(event.target.value)}
                disabled={builtin}
              />
            </SettingsField>
          ) : null}
        </SettingsSection>
      </div>
      <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-(--border-default) pt-4">
        <Button variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button onClick={handleSave} disabled={saving || builtin}>
          {saving ? t("loading") : t("save")}
        </Button>
      </div>
    </div>
  );
}

function SkillDetailPane({
  skill,
  onSave,
  onDelete,
  onToggle,
}) {
  const [content, setContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modeView, setModeView] = useState("view");

  useEffect(() => {
    setModeView("view");
    setContent("");
    setDraftContent("");
    if (!skill) return;
    setLoading(true);
    api
      .fetchSkillContent(skill.name, skill.projectDir)
      .then((data) => {
        const next = data.content || "";
        setContent(next);
        setDraftContent(next);
      })
      .catch(() => {
        setContent("");
        setDraftContent("");
      })
      .finally(() => setLoading(false));
  }, [skill]);

  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-(--text-muted)">
        {t("noSkills")}
      </div>
    );
  }

  const mode = normalizeSkillMode(skill.mode);
  const author = skillAuthorLabel(skill);
  const builtin = isBuiltin(skill);

  const handleContentSave = async () => {
    if (!skill || builtin) return;
    setSaving(true);
    try {
      await api.updateSkillContent(skill.name, draftContent, skill.projectDir);
      setContent(draftContent);
      setModeView("view");
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
              <h3 className="min-w-0 truncate text-[17px] font-semibold leading-6 text-(--text-primary)">
                {skill.name}
              </h3>
              <Badge
                variant={builtin ? "secondary" : "outline"}
                className="h-6 rounded-md px-2 text-[11px]"
              >
                {scopeLabel(skill.scope)}
              </Badge>
              <span
                className={cn(
                  "inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium",
                  modeBadgeClass(mode),
                )}
              >
                {t(`skillMode_${mode}`)}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-(--text-muted)">
              {skill.description || t("noDescription")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-(--text-muted)">
              {author ? <span>{author}</span> : null}
              {skill.packageName ? <span>{skill.packageName}</span> : null}
              {skill.version && skill.version !== "0.0.0" ? (
                <span>v{skill.version}</span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {modeView === "edit" || modeView === "routing" ? null : (
              <>
                {!builtin && (
                  <Button
                    variant="outline"
                    onClick={() => setModeView("edit")}
                  >
                    <PencilSimple size={13} />
                    {t("edit")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => setModeView("routing")}
                >
                  <SlidersHorizontal size={13} />
                  {t("skillRoutingSettings")}
                </Button>
                {!builtin && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-(--accent-red) hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
                    onClick={() => onDelete?.(skill)}
                    aria-label={t("delete")}
                    title={t("delete")}
                  >
                    <Trash size={15} />
                  </Button>
                )}
                <Switch
                  checked={isEnabled(skill)}
                  onCheckedChange={(next) => onToggle?.(skill, next)}
                  aria-label={isEnabled(skill) ? t("disable") : t("enable")}
                />
              </>
            )}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          modeView === "view" ? "px-5 py-4" : "p-5",
        )}
      >
        {modeView === "routing" ? (
          <SkillRoutingForm
            key={skillKey(skill)}
            skill={skill}
            onSave={onSave}
            onCancel={() => setModeView("view")}
          />
        ) : loading ? (
          <div className="py-8 text-center text-[12px] text-(--text-muted)">
            {t("loading")}...
          </div>
        ) : modeView === "edit" ? (
          <MarkdownEditor
            value={draftContent}
            onChange={setDraftContent}
            height="100%"
            placeholder={t("skillContent")}
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            {(Array.isArray(skill.triggers) && skill.triggers.length > 0)
              || (Number.isFinite(Number(skill.priority)) && Number(skill.priority) !== 50)
              || skill.disableModelInvocation ? (
              <div className="shrink-0 overflow-hidden rounded-lg border border-(--border-default) bg-(--bg-subtle)/50">
                <div className="border-b border-(--border-default) px-3 py-1.5 text-[11px] font-medium tracking-wide text-(--text-muted)">
                  {t("skillRoutingSettings")}
                </div>
                <div className="grid gap-2.5 px-3 py-2.5">
                  {Array.isArray(skill.triggers) && skill.triggers.length > 0 ? (
                    <div className="min-w-0">
                      <div className="mb-1.5 text-[11px] text-(--text-muted)">
                        {t("skillTriggers")}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {skill.triggers.map((trigger) => (
                          <Badge
                            key={trigger}
                            variant="outline"
                            className="h-6 rounded-md px-2 text-[11px] font-normal"
                          >
                            {trigger}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {Number.isFinite(Number(skill.priority)) && Number(skill.priority) !== 50 ? (
                    <div className="text-[12px] text-(--text-secondary)">
                      <span className="text-(--text-muted)">{t("skillPriority")}: </span>
                      {Number(skill.priority)}
                    </div>
                  ) : null}
                  {skill.disableModelInvocation ? (
                    <div className="text-[12px] text-(--text-secondary)">
                      {t("skillDisableModelInvocation")}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            <MarkdownPreview
              value={content}
              className="skill-md-preview min-h-0 flex-1"
            />
          </div>
        )}
        {modeView === "edit" && (
          <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-(--border-default) pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setDraftContent(content);
                setModeView("view");
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleContentSave}
              disabled={saving || loading}
            >
              {saving ? t("loading") : t("save")}
            </Button>
          </div>
        )}
      </div>
    </div>
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
  onContinue,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-4 overflow-hidden p-0 sm:max-w-[480px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{t("installSkill")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <SettingsSection
            description={t("skillInstallHint")}
            className="gap-4"
          >
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
            <SettingsField id="skill-install-context" label={t("skillContext")}>
              <Select
                value={installTarget || "global"}
                onValueChange={setInstallTarget}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="global">
                      {t("skillContextGlobal")}
                    </SelectItem>
                    <SelectItem value="coding">
                      {t("skillContextCoding")}
                    </SelectItem>
                    <SelectItem value="daily">
                      {t("skillContextDaily")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsField>
          </SettingsSection>
          {installError && (
            <div className="text-[11px] text-(--accent-red)">
              {installError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={installing}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={onContinue}
              disabled={installing || !installSource.trim()}
            >
              <Download data-icon="inline-start" />
              {installing ? t("skillDetecting") : t("skillDetectAndContinue")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillPackageSelectDialog({
  open,
  mode = "install",
  packageName = "",
  skills = [],
  selectedNames,
  setSelectedNames,
  includeHooks,
  setIncludeHooks,
  loading = false,
  confirming = false,
  error = "",
  onOpenChange,
  onConfirm,
}) {
  const selectedCount = skills.filter((skill) => selectedNames.has(skill.name)).length;
  const toggleName = (name, checked) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };
  const setAll = (checked) => {
    setSelectedNames(checked ? new Set(skills.map((skill) => skill.name)) : new Set());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !confirming && onOpenChange?.(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>
            {mode === "update" ? t("updateSkillPackage") : t("installSkill")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-6 sm:px-6">
          <p className="text-[12px] leading-5 text-(--text-muted)">
            {mode === "update"
              ? t("skillSelectUpdateHint").replace("{{package}}", packageName || t("skillPackage"))
              : t("skillSelectInstallHint").replace("{{package}}", packageName || t("skillPackage"))}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-(--text-muted)">
              {t("skillSelectCount")
                .replace("{{selected}}", String(selectedCount))
                .replace("{{total}}", String(skills.length))}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={confirming || loading} onClick={() => setAll(true)}>
                {t("skillSelectAll")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={confirming || loading} onClick={() => setAll(false)}>
                {t("skillSelectNone")}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-(--border-default)">
            {loading ? (
              <div className="px-3 py-8 text-center text-[12px] text-(--text-muted)">{t("skillDetecting")}</div>
            ) : skills.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-(--text-muted)">{t("skillSelectEmpty")}</div>
            ) : (
              <div className="divide-y divide-(--border-default)">
                {skills.map((skill) => {
                  const checked = selectedNames.has(skill.name);
                  return (
                    <label
                      key={skill.name}
                      className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-(--bg-subtle)"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        disabled={confirming}
                        onCheckedChange={(value) => toggleName(skill.name, value === true)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-(--text-primary)">{skill.name}</span>
                          {mode === "update" ? (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                              {skill.installed ? t("skillSelectInstalled") : t("skillSelectNew")}
                            </Badge>
                          ) : null}
                        </span>
                        {skill.description ? (
                          <span className="mt-0.5 block text-[11px] leading-4 text-(--text-muted)">
                            {skill.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-(--border-default) bg-(--bg-subtle) px-3 py-2.5">
            <Checkbox
              className="mt-0.5"
              checked={includeHooks}
              disabled={confirming}
              onCheckedChange={(checked) => setIncludeHooks(checked === true)}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-(--text-primary)">
                {t("skillInstallHooks")}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-(--text-muted)">
                {t("skillInstallHooksHint")}
              </span>
            </span>
          </label>
          {error ? <div className="text-[11px] text-(--accent-red)">{error}</div> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={confirming} onClick={() => onOpenChange?.(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={confirming || loading || selectedCount === 0}
              onClick={onConfirm}
            >
              {confirming
                ? mode === "update"
                  ? t("updatingSkillPackage")
                  : t("installing")
                : mode === "update"
                  ? t("updateSkillPackage")
                  : t("installSkill")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function modeBadgeClass(mode) {
  // Apple-style muted badge: use the same neutral token as the Badge component's
  // "secondary" variant instead of bright accent colors.
  return "bg-(--badge-bg) text-(--text-secondary) shadow-[inset_0_0_0_1px_var(--badge-edge)]";
}

function SkillCard({ skill, selected, onSelect }) {
  const enabled = isEnabled(skill);
  const author = skillAuthorLabel(skill);
  const mode = normalizeSkillMode(skill.mode);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(skill)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(skill);
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow] focus-visible:shadow-[0_0_0_3px_var(--control-focus-ring)]",
        selected
          ? "border-transparent bg-(--bg-active)"
          : enabled
            ? "border-transparent bg-transparent hover:bg-(--bg-hover)"
            : "border-transparent bg-transparent text-muted-foreground hover:bg-(--bg-hover)",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            enabled
              ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.14)]"
              : "bg-(--border-default)",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {skill.name}
          </span>
          {skill.triggers?.length > 0 && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {t("skillTriggers")}: {skill.triggers.join(", ")}
            </p>
          )}
        </div>
        <div className="ml-auto flex max-w-[58%] shrink-0 flex-wrap justify-end gap-1">
          {skill.version && skill.version !== "0.0.0" && (
            <Badge
              variant="outline"
              className="h-5 rounded-md px-1.5 text-[11px]"
            >
              v{skill.version}
            </Badge>
          )}
          {skill.mode && (
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium",
                modeBadgeClass(mode),
              )}
            >
              {t(`skillMode_${mode}`)}
            </span>
          )}
          {author && (
            <Badge
              variant="secondary"
              className="h-5 rounded-md px-1.5 text-[11px]"
            >
              {author}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillCards({ items, selectedSkill, onSelect }) {
  return items.map((skill) => (
    <SkillCard
      key={skillKey(skill)}
      skill={skill}
      selected={skillKey(skill) === skillKey(selectedSkill)}
      onSelect={onSelect}
    />
  ));
}

function SkillGroupHeader({ name, count, collapsed, title, onClick, actions }) {
  return (
    <div className="flex h-8 w-full items-center gap-1 rounded-lg px-1 text-[12px] font-medium text-foreground hover:bg-muted/50">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left"
        title={title}
      >
        <Folder size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-muted-foreground">{count}</span>
        {collapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}
      </button>
      {actions ? (
        <div
          className="flex shrink-0 items-center gap-0.5 pr-0.5"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function PackageBatchDialog({
  packageGroup,
  open,
  applying,
  onOpenChange,
  onApply,
  defaultContext = "global",
}) {
  const [mode, setMode] = useState("agent_requested");
  const [context, setContext] = useState(defaultContext);
  const [enabled, setEnabled] = useState("keep");

  useEffect(() => {
    if (!open) return;
    setMode("agent_requested");
    setContext(defaultContext);
    setEnabled("keep");
  }, [open, packageGroup?.key, defaultContext]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-4 overflow-hidden p-0 sm:max-w-[480px]">
        <DialogHeader className="shrink-0 px-4 pb-2 pt-6 sm:px-6">
          <DialogTitle>{t("skillPackageBatchEdit")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <SettingsSection
            description={t("skillPackageBatchEditHint").replace(
              "{{package}}",
              packageGroup?.packageName || "",
            )}
            className="gap-4"
          >
            <SettingsField id="package-batch-mode" label={t("skillMode")}>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {SKILL_MODES.map((item) => (
                      <SelectItem key={item} value={item}>{t(`skillMode_${item}`)}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField id="package-batch-context" label={t("skillContext")}>
              <Select value={context} onValueChange={setContext}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="global">
                      {t("skillContextGlobal")}
                    </SelectItem>
                    <SelectItem value="coding">
                      {t("skillContextCoding")}
                    </SelectItem>
                    <SelectItem value="daily">
                      {t("skillContextDaily")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField id="package-batch-enabled" label={t("enabled")}>
              <Select value={enabled} onValueChange={setEnabled}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="keep">
                      {t("skillPackageKeepEnabled")}
                    </SelectItem>
                    <SelectItem value="true">{t("enable")}</SelectItem>
                    <SelectItem value="false">{t("disable")}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsField>
          </SettingsSection>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={applying}
              onClick={() => onOpenChange?.(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={applying || !packageGroup}
              onClick={() =>
                onApply?.(packageGroup, {
                  mode,
                  contexts: contextsFromTab(context),
                  enabled: enabled === "keep" ? undefined : enabled === "true",
                })
              }
            >
              {applying ? t("loading") : t("skillPackageApplyAll")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillIndexPreviewDialog({
  open,
  onOpenChange,
  projectDir = "",
  context = "coding",
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewTab, setPreviewTab] = useState(
    SKILL_TABS.includes(context) ? context : "global",
  );

  useEffect(() => {
    if (!open) return;
    setPreviewTab(SKILL_TABS.includes(context) ? context : "global");
  }, [open, context]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .fetchSkillIndex(projectDir)
      .then((result) => {
        if (cancelled) return;
        setPreview(result && typeof result === "object" ? result : null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setError(err?.message || t("skillIndexLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectDir]);

  const payload =
    previewTab === "daily"
      ? preview?.daily
      : previewTab === "coding"
        ? preview?.coding
        : preview?.global;
  const hasSkills = Array.isArray(payload?.skills) && payload.skills.length > 0;
  const rawJson = hasSkills ? JSON.stringify(payload, null, 2) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-[calc(100vw-2rem)] max-w-[780px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[780px]">
        <DialogHeader className="shrink-0 border-b border-(--border-default) px-4 py-3 sm:px-5">
          <DialogTitle>{t("previewSkillIndex")}</DialogTitle>
          <DialogDescription>{t("previewSkillIndexHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center border-b border-(--border-default) px-3 py-2">
          <Tabs value={previewTab} onValueChange={setPreviewTab}>
            <TabsList variant="line" className="h-8">
              {SKILL_TABS.map((tabValue) => (
                <TabsTrigger key={tabValue} value={tabValue}>
                  {skillTabLabel(tabValue)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loading ? (
            <div className="py-10 text-center text-[12px] text-(--text-muted)">
              {t("loading")}...
            </div>
          ) : error ? (
            <div className="rounded-md border border-(--accent-red) bg-(--accent-red-bg) px-3 py-2 text-[12px] text-(--accent-red)">
              {error}
            </div>
          ) : hasSkills ? (
            <pre className="overflow-x-auto rounded-md border border-(--border-default) bg-(--bg-secondary) px-3 py-3 font-mono text-[11px] leading-5 whitespace-pre text-(--text-primary)">
              {rawJson}
            </pre>
          ) : (
            <Empty className="py-12">
              <EmptyDescription>
                {previewTab === "global"
                  ? t("skillIndexEmptyGlobal")
                  : previewTab === "daily"
                    ? t("skillIndexEmptyDaily")
                    : t("skillIndexEmptyCoding")}
              </EmptyDescription>
            </Empty>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-(--border-default) px-4 py-3 sm:px-5">
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkillPanel({ projectDirs = [] }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [activeTab, setActiveTab] = useState("global");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [installSource, setInstallSource] = useState("");
  const [installTarget, setInstallTarget] = useState("global");
  const [installHooks, setInstallHooks] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState("");
  const [installOpen, setInstallOpen] = useState(false);
  const [skillSelect, setSkillSelect] = useState(null);
  const [selectedSkillNames, setSelectedSkillNames] = useState(() => new Set());
  const [updating, setUpdating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingBatchPackage, setPendingBatchPackage] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [applyingPackageKey, setApplyingPackageKey] = useState("");
  const [actionError, setActionError] = useState("");
  const [indexPreviewOpen, setIndexPreviewOpen] = useState(false);
  const projectKey = projectDirsKey(projectDirs);
  const requestProjectDirs = useMemo(
    () => (projectKey ? projectKey.split("\n") : []),
    [projectKey],
  );
  const indexProjectDir = requestProjectDirs[0] || "";

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
      prev.map((s) => (s.name === skill.name ? { ...s, enabled } : s)),
    );
    try {
      await api.toggleSkill(skill.name, enabled, skill.projectDir);
    } catch {
      // 请求失败时回滚
      setSkills((prev) =>
        prev.map((s) =>
          s.name === skill.name ? { ...s, enabled: !enabled } : s,
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
    if (!skill) return;
    // Only siblings visible on the current tab — never cascade into other contexts.
    const siblings = skillsInSamePackage(skills, skill).filter((item) =>
      skillMatchesTab(item, activeTab),
    );
    if (siblings.length > 1) {
      setPendingDelete({
        kind: "package",
        packageName:
          skill.packageName || skill.packageSource || skill.source || skill.name,
        items: siblings,
        representative: skill,
      });
      return;
    }
    setPendingDelete({ kind: "skill", skill, items: [skill] });
  };

  const handleDeletePackage = (packageGroup) => {
    if (!packageGroup?.items?.length) return;
    setPendingDelete({
      kind: "package",
      packageName: packageGroup.packageName,
      items: packageGroup.items,
      representative: packageGroup.representative,
    });
  };

  const confirmDeleteSkill = async () => {
    if (!pendingDelete || deleting) return;
    const items = pendingDelete.items || [];
    if (items.length === 0) return;
    const deletedKeys = new Set(items.map((skill) => skillKey(skill)));
    setDeleting(true);
    setActionError("");
    try {
      for (const skill of items) {
        const remaining = remainingContextsAfterTabRemove(skill, activeTab);
        if (remaining.length > 0) {
          // Tab-scoped remove: keep files, only drop the current context.
          await api.updateSkillMetadata(
            skill.name,
            { contexts: remaining },
            skill.projectDir,
          );
        } else {
          await api.deleteSkill(skill.name, skill.projectDir, requestProjectDirs);
        }
      }
      setPendingDelete(null);
      if (selectedSkill && deletedKeys.has(skillKey(selectedSkill))) {
        setSelectedSkill(null);
      }
      await loadSkills();
    } catch (err) {
      setActionError(err.message || t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = () => {
    setEditing(null);
    loadSkills();
  };

  const handleInstallContinue = async () => {
    const source = installSource.trim();
    if (!source) return;
    setInstalling(true);
    setInstallError("");
    try {
      const preview = await api.previewSkillSource(source);
      if (preview?.error) throw new Error(preview.message || "Preview failed");
      const skills = Array.isArray(preview?.skills) ? preview.skills : [];
      if (skills.length === 0) throw new Error(t("skillSelectEmpty"));
      setSelectedSkillNames(new Set(skills.map((skill) => skill.name)));
      setInstallHooks(false);
      setSkillSelect({
        mode: "install",
        source,
        packageName: preview.packageName || preview.packageSource || source,
        skills,
        contexts: contextsFromTab(installTarget || activeTab || "global"),
      });
      setInstallOpen(false);
    } catch (err) {
      setInstallError(err.message || "Install failed");
    } finally {
      setInstalling(false);
    }
  };

  const handleConfirmSkillSelect = async () => {
    if (!skillSelect || selectedSkillNames.size === 0) return;
    const skillNames = [...selectedSkillNames];
    setUpdating(true);
    setInstalling(true);
    setActionError("");
    setInstallError("");
    try {
      if (skillSelect.mode === "update") {
        const result = await api.updateSkillPackage({
          name: skillSelect.name,
          projectDir: skillSelect.projectDir,
          skillNames,
          includeHooks: installHooks,
          // Only used for newly added skills in the package; existing keep prior contexts.
          defaultContexts:
            skillSelect.contexts || contextsFromTab(activeTab || "global"),
        });
        if (result?.error) {
          throw new Error(result.message || t("updateSkillPackageFailed"));
        }
      } else {
        const result = await api.installSkill({
          source: skillSelect.source,
          scope: "global",
          includeHooks: installHooks,
          skillNames,
          contexts: skillSelect.contexts,
        });
        if (result?.error) throw new Error(result.message || "Install failed");
        setInstallSource("");
      }
      setSkillSelect(null);
      await loadSkills();
    } catch (err) {
      if (skillSelect.mode === "update") {
        setActionError(err.message || t("updateSkillPackageFailed"));
      } else {
        setInstallError(err.message || "Install failed");
      }
    } finally {
      setUpdating(false);
      setInstalling(false);
    }
  };

  const handleUpdatePackage = async (skill) => {
    if (!skill || updating || installing) return;
    setUpdating(true);
    setActionError("");
    try {
      const preview = await api.previewSkillPackageUpdate({
        name: skill.name,
        projectDir: skill.projectDir,
      });
      if (preview?.error) {
        throw new Error(preview.message || t("updateSkillPackageFailed"));
      }
      const rawSkills = Array.isArray(preview?.skills) ? preview.skills : [];
      // Only this tab's bindings (+ brand-new package members). Never touch other tabs.
      const tabSkills = packagePreviewSkillsForTab(rawSkills, skills, activeTab);
      if (tabSkills.length === 0) throw new Error(t("skillSelectEmpty"));
      setSelectedSkillNames(
        new Set(
          tabSkills
            .filter((item) => item.installed)
            .map((item) => item.name),
        ),
      );
      setInstallHooks(false);
      setSkillSelect({
        mode: "update",
        name: skill.name,
        projectDir: skill.projectDir,
        packageName:
          preview.packageName ||
          skill.packageName ||
          skill.packageSource ||
          skill.name,
        skills: tabSkills,
        // Fallback for brand-new skills pulled in by update; existing keep prior.
        contexts: contextsFromTab(activeTab),
      });
    } catch (err) {
      setActionError(err.message || t("updateSkillPackageFailed"));
    } finally {
      setUpdating(false);
    }
  };

  const handleApplyPackage = async (packageGroup, patch = {}) => {
    if (!packageGroup?.items?.length || applyingPackageKey) return;
    setApplyingPackageKey(packageGroup.key);
    setActionError("");
    try {
      for (const skill of packageGroup.items) {
        const metadata = {
          contexts: patch.contexts,
          mode: patch.mode,
          disableModelInvocation: false,
        };
        if (patch.enabled !== undefined) metadata.enabled = patch.enabled;
        await api.updateSkillMetadata(skill.name, metadata, skill.projectDir);
      }
      setPendingBatchPackage(null);
      await loadSkills();
    } catch (err) {
      setActionError(err.message || t("skillPackageApplyFailed"));
    } finally {
      setApplyingPackageKey("");
    }
  };

  const enabledCount = skills.filter(isEnabled).length;
  const customCount = skills.filter((skill) => !isBuiltin(skill)).length;
  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (!skillMatchesTab(skill, activeTab)) return false;
      if (filter === "custom") {
        if (skill.scope === "builtin" || skillPackageIsUpdatable(skill)) {
          return false;
        }
      }
      if (filter === "remote" && !skillPackageIsUpdatable(skill)) return false;
      if (!needle) return true;
      return (
        skill.name.toLowerCase().includes(needle) ||
        String(skill.packageName || "")
          .toLowerCase()
          .includes(needle) ||
        String(skillAuthorLabel(skill)).toLowerCase().includes(needle) ||
        String(projectDisplayName(skill.projectName || ""))
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [skills, query, filter, activeTab]);

  const packageGroupedSkills = useMemo(
    () => groupSkillsByPackage(filteredSkills),
    [filteredSkills],
  );

  useEffect(() => {
    if (filteredSkills.length === 0) {
      setSelectedSkill(null);
      return;
    }
    const refreshedSelection = selectedSkill
      ? filteredSkills.find(
          (skill) => skillKey(skill) === skillKey(selectedSkill),
        )
      : null;
    if (refreshedSelection) {
      if (refreshedSelection !== selectedSkill)
        setSelectedSkill(refreshedSelection);
      return;
    }
    setSelectedSkill(filteredSkills[0]);
  }, [filteredSkills, selectedSkill]);

  const toggleSkillGroup = useCallback((key) => {
    setExpandedGroups((current) => {
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

      {skills.length > 0 && filteredSkills.length > 0 && (
        <div className="grid gap-2">
            {packageGroupedSkills.packages.map((pkg) => {
              const collapsed = !expandedGroups.has(pkg.key);
              return (
                <div key={pkg.key} className="grid gap-1">
                  <SkillGroupHeader
                    name={pkg.packageName}
                    count={pkg.items.length}
                    collapsed={collapsed}
                    title={pkg.packageSource || pkg.key}
                    onClick={() => toggleSkillGroup(pkg.key)}
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setPendingBatchPackage(pkg)}
                          aria-label={t("skillPackageBatchEdit")}
                          title={t("skillPackageBatchEdit")}
                        >
                          <PencilSimple size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={updating}
                          onClick={() =>
                            handleUpdatePackage(pkg.representative)
                          }
                          aria-label={t("updateSkillPackage")}
                          title={t("updateSkillPackage")}
                        >
                          <ArrowsClockwise
                            size={13}
                            className={updating ? "animate-spin" : undefined}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-(--accent-red) hover:bg-(--accent-red-bg) hover:text-(--accent-red)"
                          onClick={() => handleDeletePackage(pkg)}
                          aria-label={t("deleteSkillPackage")}
                          title={t("deleteSkillPackage")}
                        >
                          <Trash size={13} />
                        </Button>
                      </>
                    }
                  />
                  {!collapsed && (
                    <div className="grid gap-2 pl-1">
                      <SkillCards
                        items={pkg.items}
                        selectedSkill={selectedSkill}
                        onSelect={setSelectedSkill}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {packageGroupedSkills.ungrouped.length > 0 && (
              <div className="grid gap-1">
                <SkillGroupHeader
                  name={t("skillUngrouped")}
                  count={packageGroupedSkills.ungrouped.length}
                  collapsed={!expandedGroups.has("ungrouped")}
                  title="ungrouped"
                  onClick={() => toggleSkillGroup("ungrouped")}
                />
                {expandedGroups.has("ungrouped") && (
                  <div className="grid gap-2">
                    <SkillCards
                      items={packageGroupedSkills.ungrouped}
                      selectedSkill={selectedSkill}
                      onSelect={setSelectedSkill}
                    />
                  </div>
                )}
              </div>
            )}
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
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full min-h-0 gap-0"
      >
        <div className="flex shrink-0 items-center border-b border-(--border-default) px-3 py-2">
          <TabsList variant="line" className="h-8">
            {SKILL_TABS.map((tabValue) => (
              <TabsTrigger key={tabValue} value={tabValue}>
                {skillTabLabel(tabValue)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={activeTab} className="min-h-0 flex-1">
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3 border-b border-(--border-default) p-3 lg:border-b-0 lg:border-r">
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
                  setInstallTarget(activeTab || "global");
                  setInstallOpen(true);
                }}
              >
                <Download size={13} />
                {t("installSkill")}
              </Button>
              <Button onClick={() => setEditing("new")}>
                <Plus size={13} />
                {t("addSkill")}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
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
              className="w-full shrink-0 [&_button]:truncate [&_button]:text-[11px] sm:[&_button]:text-[12px]"
            />
          </div>

          {actionError ? (
            <div className="rounded-md border border-(--accent-red) bg-(--accent-red-bg) px-3 py-2 text-[12px] text-(--accent-red)">
              {actionError}
            </div>
          ) : null}

          <div className="min-h-[220px] flex-1 overflow-y-auto scroll-smooth pr-2 [scrollbar-gutter:stable]">
            {renderSkillList()}
          </div>
          <div className="flex shrink-0 items-center border-t border-(--border-default) pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[12px] text-(--text-secondary)"
              onClick={() => setIndexPreviewOpen(true)}
            >
              <ListBullets size={13} />
              {t("previewSkillIndex")}
            </Button>
          </div>
        </div>
        <div className="hidden min-h-0 bg-(--bg-primary) lg:block">
          <SkillDetailPane
            skill={selectedSkill}
            onSave={handleSave}
            onDelete={handleDelete}
            onToggle={handleToggle}
          />
        </div>
      </div>
        </TabsContent>
      </Tabs>

      <SkillIndexPreviewDialog
        open={indexPreviewOpen}
        onOpenChange={setIndexPreviewOpen}
        projectDir={indexProjectDir}
        context={activeTab}
      />
      <SkillEditorDialog
        skill={editing === "new" ? null : editing}
        open={!!editing}
        defaultContext={activeTab || "global"}
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
        onContinue={handleInstallContinue}
      />
      <SkillPackageSelectDialog
        open={!!skillSelect}
        mode={skillSelect?.mode || "install"}
        packageName={skillSelect?.packageName || ""}
        skills={skillSelect?.skills || []}
        selectedNames={selectedSkillNames}
        setSelectedNames={setSelectedSkillNames}
        includeHooks={installHooks}
        setIncludeHooks={setInstallHooks}
        loading={false}
        confirming={installing || updating}
        error={skillSelect?.mode === "update" ? actionError : installError}
        onOpenChange={(open) => {
          if (!open && !installing && !updating) {
            setSkillSelect(null);
            setInstallError("");
            setActionError("");
          }
        }}
        onConfirm={handleConfirmSkillSelect}
      />
      <PackageBatchDialog
        packageGroup={pendingBatchPackage}
        open={!!pendingBatchPackage}
        defaultContext={activeTab || "global"}
        applying={
          !!pendingBatchPackage &&
          applyingPackageKey === pendingBatchPackage.key
        }
        onOpenChange={(open) => {
          if (!open && !applyingPackageKey) setPendingBatchPackage(null);
        }}
        onApply={handleApplyPackage}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title={
          pendingDelete?.kind === "package"
            ? t("deleteSkillPackageConfirm")
            : t("deleteSkillConfirm")
        }
        description={
          pendingDelete?.kind === "package"
            ? t("deleteSkillPackageDescriptionFromTab")
                .replace("{{context}}", skillTabLabel(activeTab))
                .replace(
                  "{{package}}",
                  pendingDelete.packageName ||
                    pendingDelete.representative?.name ||
                    "",
                )
                .replace(
                  "{{skills}}",
                  (pendingDelete.items || []).map((item) => item.name).join(", "),
                )
            : pendingDelete?.skill
              ? t("deleteSkillDescriptionFromTab")
                  .replace("{{context}}", skillTabLabel(activeTab))
                  .replace("{{name}}", pendingDelete.skill.name)
              : ""
        }
        loading={deleting}
        onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}
        onConfirm={confirmDeleteSkill}
      />
    </>
  );
}
