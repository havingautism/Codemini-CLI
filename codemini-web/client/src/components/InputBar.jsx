import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Separator } from "@/components/ui/separator";
import {
  Archive,
  ArrowUp,
  Camera,
  CaretDown,
  FileText,
  Hammer,
  ImageSquare,
  MaskHappy,
  MagnifyingGlass,
  Minus,
  Moon,
  Paperclip,
  Plus,
  Sparkle,
  Tray,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import * as api from "@/hooks/use-api";
import { useApp } from "@/context/app-context.jsx";
import { ReasoningQuickControl } from "@/components/ReasoningControls.jsx";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { USER_ACTION_COMMAND_NAMES } from "@/lib/user-skill-prompt.js";
import {
  beginActionParameter,
  cancelActionParameter,
  createComposerState,
  runComposerAction,
  toggleComposerSkill,
} from "@/lib/chat-composer-state.js";
import {
  getExecutionModeOptions,
  getApprovalModeOptions,
} from "@/lib/settings-options.js";

const IMPLICIT_SKILLS = new Set(["superpowers-lite"]);
const INTERNAL_SKILLS = new Set([
  "project-requirements",
  "project-requirements-md",
]);
const EMPTY_PROJECT_DIRS = Object.freeze([]);

const ACTION_COMMANDS = [
  {
    name: "dream",
    icon: Moon,
    description:
      "Run memory consolidation now. Auto dream still runs in the background when needed.",
  },
  {
    name: "compact",
    icon: Archive,
    description:
      "Compress the current conversation context while keeping the useful working summary.",
  },
  {
    name: "capture",
    icon: Camera,
    description:
      "Capture an explicit note into the memory inbox for later consolidation.",
  },
  {
    name: "inbox",
    icon: Tray,
    description: "Review pending memory inbox entries.",
  },
  {
    name: "reflect",
    icon: Sparkle,
    description: "Draft or update a reusable skill from the current workflow.",
  },
];

const INPUT_PILL_CLASS =
  "border border-(--selected-edge) bg-transparent text-(--text-secondary) h-7 rounded-md inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer text-[11px] sm:text-[12px] whitespace-nowrap transition-colors hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary)";

const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx";
const IMAGE_MAX_EDGE = 1600;
const IMAGE_JPEG_QUALITY = 0.82;

function isImageFile(file) {
  return String(file?.type || "").startsWith("image/");
}

function extensionFromName(name = "") {
  const match = String(name || "").match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function compactBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

async function compressImageFile(file) {
  if (!isImageFile(file)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", IMAGE_JPEG_QUALITY),
  );
  if (!blob) return file;
  const base = String(file.name || "image").replace(/\.[^.]+$/, "");
  const compressed = new File([blob], `${base || "image"}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
  return compressed.size < file.size ? compressed : file;
}

function ModeSelector({ sessionId, current, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const MODE_OPTIONS = getExecutionModeOptions();
  const active =
    MODE_OPTIONS.find((m) => m.value === current) || MODE_OPTIONS[0];
  const ActiveIcon = active.icon;

  const handleSelect = async (mode) => {
    if (mode === current || switching || disabled) return;
    setSwitching(true);
    try {
      const result = await api.setExecutionMode(sessionId, mode);
      if (result?.error)
        throw new Error(result.message || "Failed to switch mode");
    } catch {
    } finally {
      setSwitching(false);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            INPUT_PILL_CLASS,
            "px-2.5 hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary)",
            (switching || disabled) && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={disabled ? t("switchModeDisabled") : t("switchMode")}
        >
          <ActiveIcon size={13} />
          <span className="truncate">{active.label}</span>
          <CaretDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-88 p-2"
      >
        <div className="px-0.5 pb-1.5 text-[11px] font-medium text-muted-foreground">
          {t("executionMode")}
        </div>
        <ToggleGroup
          type="single"
          value={current}
          onValueChange={handleSelect}
          disabled={disabled || switching}
          className="flex w-full flex-col items-stretch gap-0.5"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="h-auto min-h-8 w-full justify-start px-2 py-1.5 text-left"
              >
                <Icon data-icon="inline-start" />
                <span className="min-w-0 flex-1">
                  <span className="block">{opt.label}</span>
                  <span className="block text-[11px] font-normal leading-snug text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}

function ApprovalModeSelector({ sessionId, current, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const MODE_OPTIONS = getApprovalModeOptions();
  const active =
    MODE_OPTIONS.find((m) => m.value === current) || MODE_OPTIONS[0];
  const ActiveIcon = active.icon;

  const handleSelect = async (mode) => {
    if (mode === current || switching || disabled) return;
    setSwitching(true);
    try {
      const result = await api.setApprovalMode(sessionId, mode);
      if (result?.error)
        throw new Error(result.message || "Failed to switch approval mode");
    } catch {
    } finally {
      setSwitching(false);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            INPUT_PILL_CLASS,
            "px-2.5 hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary)",
            (switching || disabled) && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={disabled ? t("switchModeDisabled") : t("switchApprovalMode")}
        >
          <ActiveIcon size={13} />
          <span className="truncate">{active.label}</span>
          <CaretDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-76 p-2"
      >
        <div className="px-0.5 pb-1.5 text-[11px] font-medium text-muted-foreground">
          {t("approvalMode")}
        </div>
        <ToggleGroup
          type="single"
          value={current}
          onValueChange={handleSelect}
          disabled={disabled || switching}
          className="flex w-full flex-col items-stretch gap-0.5"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="h-auto min-h-8 w-full justify-start px-2 py-1.5 text-left"
              >
                <Icon data-icon="inline-start" />
                <span className="min-w-0 flex-1">
                  <span className="block">{opt.label}</span>
                  <span className="block text-[11px] font-normal leading-snug text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}

function SoulQuickSwitch({ disabled = false }) {
  const { state, actions } = useApp();
  const [souls, setSouls] = useState([]);
  const [active, setActive] = useState("");
  const [open, setOpen] = useState(false);

  const loadSouls = useCallback(async () => {
    try {
      const list = await api.fetchSouls();
      const arr = Array.isArray(list) ? list : [];
      setSouls(arr);
      const current = arr.find((s) => s.active);
      setActive(current ? current.name : "");
    } catch {}
  }, []);

  useEffect(() => {
    loadSouls();
  }, [loadSouls]);

  useEffect(() => {
    if (state.soulsRevision > 0) {
      loadSouls();
    }
  }, [state.soulsRevision, loadSouls]);

  const handleActivate = async (name) => {
    if (disabled) return;
    await api.activateSoul(name);
    setActive(name);
    setOpen(false);
    await loadSouls();
    actions.notifySoulsChanged();
  };

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            INPUT_PILL_CLASS,
            "px-2.5",
            disabled && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={disabled ? t("inputDisabled") : t("soulSwitch")}
        >
          <MaskHappy size={13} />
          <span className="truncate max-w-[60px]">{active || "default"}</span>
          <CaretDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-52 p-1"
      >
        <div className="text-[11px] text-(--text-muted) px-2 py-1.5 font-medium">
          {t("switchSoul")}
        </div>
        <div className="flex flex-col gap-0.5">
          {souls.map((soul) => (
            <button
              key={`${soul.scope}-${soul.name}`}
              disabled={disabled}
              className={cn(
                "w-full border-0 rounded-md px-2 py-1.5 text-left text-[12px] cursor-pointer flex items-center gap-2",
                disabled && "opacity-50 cursor-not-allowed",
                soul.active
                  ? "bg-(--bg-active) text-(--text-primary) font-medium"
                  : "bg-transparent text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
              )}
              onClick={() => handleActivate(soul.name)}
            >
              <span className="truncate flex-1">{soul.name}</span>
              <span className="text-[10px] text-(--text-muted) shrink-0">
                {soul.scope === "builtin" ? t("builtin") : t("custom")}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SpecQuickSelect({ sessionId, visible, disabled = false, onSelect }) {
  const [open, setOpen] = useState(false);
  const [specs, setSpecs] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadSpecs = useCallback(async () => {
    if (!visible || disabled) return;
    setLoading(true);
    try {
      const result = await api.fetchSpecs(sessionId);
      setSpecs(Array.isArray(result?.specs) ? result.specs : []);
    } catch {
      setSpecs([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, visible, disabled]);

  useEffect(() => {
    if (open) loadSpecs();
  }, [open, loadSpecs]);

  if (!visible) return null;

  const handleSelect = (spec) => {
    if (!spec?.path) return;
    onSelect?.(spec);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            INPUT_PILL_CLASS,
            "px-2.5 hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary)",
            disabled && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={t("planFromSpec")}
        >
          <FileText size={13} />
          <span className="truncate">{t("specFile")}</span>
          <CaretDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[420px] max-w-[calc(100vw-32px)] p-1"
      >
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-[11px] text-(--text-muted) font-medium">
            {t("planFromSpec")}
          </span>
          <button
            type="button"
            className="border-0 bg-transparent text-[11px] text-(--text-muted) hover:text-(--text-primary) cursor-pointer"
            onClick={loadSpecs}
          >
            {t("refresh")}
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto flex flex-col gap-0.5">
          {loading && (
            <div className="px-2 py-4 text-center text-[12px] text-(--text-muted)">
              {t("loading")}
            </div>
          )}
          {!loading && specs.length === 0 && (
            <div className="px-2 py-4 text-center text-[12px] text-(--text-muted)">
              {t("noSpecFiles")}
            </div>
          )}
          {!loading &&
            specs.map((spec) => (
              <button
                key={spec.path}
                type="button"
                className="w-full border-0 rounded-md px-2 py-2 text-left cursor-pointer grid grid-cols-[22px_minmax(0,1fr)] gap-2 bg-transparent text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                onClick={() => handleSelect(spec)}
              >
                <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-md bg-(--accent-purple-bg) text-(--accent-purple)">
                  <FileText size={12} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">
                    {spec.name || spec.file}
                  </span>
                  <span className="block truncate text-[11px] text-(--text-muted) font-mono">
                    {spec.relativePath || spec.file}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActionSkillPalette({
  query,
  error,
  onQueryChange,
  onSelect,
  visible,
  projectDirs = EMPTY_PROJECT_DIRS,
  defaultSkillNames = [],
  onClose,
}) {
  const [skills, setSkills] = useState([]);
  const [hoveredItem, setHoveredItem] = useState(null);
  const searchRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    const handlePointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [visible, onClose]);

  useEffect(() => {
    let cancelled = false;
    if (visible) {
      api
        .fetchSkills(projectDirs)
        .then((list) => {
          if (cancelled) return;
          setSkills(
            Array.isArray(list)
              ? list.filter(
                  (s) =>
                    s.enabled !== false &&
                    !IMPLICIT_SKILLS.has(s.name) &&
                    !INTERNAL_SKILLS.has(s.name) &&
                    !USER_ACTION_COMMAND_NAMES.has(s.name),
                )
              : [],
          );
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [visible, projectDirs]);

  useEffect(() => {
    if (visible) searchRef.current?.focus();
  }, [visible]);

  const needle = query.trim().toLowerCase();
  const actionItems = useMemo(
    () =>
      ACTION_COMMANDS.filter(
        (command) =>
          !needle ||
          command.name.includes(needle) ||
          command.description.toLowerCase().includes(needle),
      ).map((command) => ({
        ...command,
        kind: "action",
        key: `action-${command.name}`,
      })),
    [needle],
  );

  const skillItems = useMemo(
    () =>
      skills
        .filter(
          (skill) =>
            !defaultSkillNames.includes(skill.name) &&
            (!needle ||
              skill.name.toLowerCase().includes(needle) ||
              (skill.description || "").toLowerCase().includes(needle)),
        )
        .map((skill) => ({
          name: skill.name,
          icon: Hammer,
          description: skill.description || "Manual skill",
          kind: "skill",
          key: `skill-${skill.name}`,
        })),
    [skills, needle, defaultSkillNames],
  );

  if (!visible) return null;
  const hasItems = actionItems.length > 0 || skillItems.length > 0;

  const renderSection = (title, items) => {
    if (!items.length) return null;
    return (
      <div className="py-1">
        <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.45px] text-(--text-muted)">
          {title}
        </div>
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const isHovered = hoveredItem === item.key;
            return (
              <button
                key={item.key}
                className={cn(
                  "w-full border-0 rounded-md px-2.5 py-2 text-left cursor-pointer grid grid-cols-[22px_minmax(96px,180px)_minmax(0,1fr)_auto] items-start gap-2 text-[12px] transition-colors",
                  isHovered
                    ? "bg-(--bg-hover) text-(--text-primary)"
                    : "bg-transparent text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                )}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setHoveredItem(item.key)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-5 items-center justify-center rounded-md transition-colors",
                    item.kind === "action"
                      ? "bg-(--accent-cyan-bg) text-(--accent-cyan)"
                      : "bg-(--accent-purple-bg) text-(--accent-purple)",
                    !isHovered && "opacity-80",
                  )}
                >
                  <Icon size={12} />
                </span>
                <span className="truncate font-medium leading-5 font-mono">
                  /{item.name}
                </span>
                <span
                  className="text-(--text-muted) text-[11px] leading-5 overflow-hidden"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {item.description}
                </span>
                <span
                  className={cn(
                    "mt-0.5 rounded-full border px-1.5 py-0.5 text-[10px] uppercase leading-none",
                    item.kind === "action"
                      ? "border-(--accent-cyan)/25 text-(--accent-cyan)"
                      : "border-(--accent-purple)/25 text-(--accent-purple)",
                  )}
                >
                  {item.kind}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 mb-1.5 max-h-[360px] overflow-y-auto rounded-lg border border-(--border-default) bg-(--bg-primary) shadow-[var(--shadow-default)] z-50 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      style={{ scrollbarWidth: "thin" }}
    >
      <div className="sticky top-0 z-10 bg-(--bg-primary) p-2">
        <label className="flex items-center gap-2 rounded-md border border-(--border-default) px-2">
          <MagnifyingGlass size={14} className="text-(--text-muted)" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label={t("searchActionsAndSkills")}
            placeholder={t("searchActionsAndSkills")}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent text-[12px] outline-none"
          />
        </label>
        {error ? (
          <div
            role="alert"
            className="px-1 pt-1.5 text-[11px] text-(--accent-red)"
          >
            {error}
          </div>
        ) : null}
      </div>
      {/* <div className="px-2.5 py-1.5 text-[11px] text-(--text-muted) font-medium flex items-center gap-1.5 uppercase tracking-[0.45px]">
        Commands
      </div>
      <Separator className="my-2 bg-(--border-default)" /> */}
      {!hasItems && (
        <div className="px-2.5 py-5 text-[12px] text-(--text-muted) text-center">
          No matching commands
        </div>
      )}
      {renderSection("Actions", actionItems)}
      {actionItems.length > 0 && skillItems.length > 0 && (
        <Separator className=" my-1 bg-(--border-default)" />
      )}
      {renderSection("Skills", skillItems)}
    </div>
  );
}

export function InputBar({
  onSubmit,
  onAction,
  onAbort,
  busy,
  disabled = false,
  disabledReason = "",
  runtimeState,
  history: externalHistory,
  onOpenSpec,
  projectCwd,
  projectDirs = EMPTY_PROJECT_DIRS,
}) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteError, setPaletteError] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionParameter, setActionParameter] = useState(() =>
    createComposerState(),
  );
  const [attachments, setAttachments] = useState([]);
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [dismissedDefaultSkills, setDismissedDefaultSkills] = useState(
    new Set(),
  );
  const [attachmentError, setAttachmentError] = useState("");
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const actionSubmissionRef = useRef(false);

  const rs = runtimeState || {};
  const mode = rs.mode || "normal";
  const approvalMode = rs.approvalMode || "review";
  const reasoningEnabled = rs.reasoningEnabled !== false;
  const reasoningEffort = rs.reasoningEffort || "auto";
  const defaultSkillNames = useMemo(
    () =>
      (Array.isArray(rs.alwaysSkillNames) ? rs.alwaysSkillNames : [])
        .map((name) => String(name || "").trim())
        .filter(Boolean),
    [rs.alwaysSkillNames],
  );
  const visibleDefaultSkillNames = useMemo(
    () => defaultSkillNames.filter((name) => !dismissedDefaultSkills.has(name)),
    [defaultSkillNames, dismissedDefaultSkills],
  );
  const removeDefaultSkill = useCallback((name) => {
    setDismissedDefaultSkills((prev) => new Set([...prev, name]));
  }, []);
  const selectedSkillNames = useMemo(
    () => selectedSkills.map((skill) => skill.name).filter(Boolean),
    [selectedSkills],
  );
  const inputLocked = busy || disabled || uploadingAttachments;
  const isGeneralChat = projectCwd === "__codemini_general__";

  useEffect(() => {
    if (externalHistory && externalHistory.length && history.length === 0) {
      setHistory([...externalHistory].reverse());
    }
  }, [externalHistory]);

  useEffect(() => {
    if (!inputLocked || actionSubmitting) return;
    setPaletteOpen(false);
  }, [inputLocked, actionSubmitting]);

  const submitCurrent = useCallback(async () => {
    const val = value.trim();
    const hasText = val.length > 0;
    const hasAttachments = attachments.length > 0;
    const hasSkills = selectedSkills.length > 0;
    if ((!hasText && !hasAttachments && !hasSkills) || inputLocked) return;

    let fallbackText = val;
    if (!hasText && hasAttachments) {
      fallbackText = t("attachmentFallbackPrompt");
    }

    const dismissedSkills = [...dismissedDefaultSkills];
    try {
      await onSubmit({
        text: fallbackText,
        skillNames: selectedSkillNames,
        attachmentIds: attachments.map((item) => item.id).filter(Boolean),
        attachments,
        dismissedAlwaysSkills: dismissedSkills,
      });
    } catch {
      return;
    }
    setValue("");
    setAttachments([]);
    setSelectedSkills([]);
    setDismissedDefaultSkills(new Set());
    setAttachmentError("");
    setPaletteOpen(false);
    setHistoryIndex(-1);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [
    value,
    attachments,
    selectedSkills,
    selectedSkillNames,
    dismissedDefaultSkills,
    inputLocked,
    onSubmit,
  ]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        if (actionParameter.activeAction) {
          e.preventDefault();
          if (actionSubmissionRef.current) return;
          actionSubmissionRef.current = true;
          setActionSubmitting(true);
          setPaletteError("");
          runComposerAction(
            actionParameter.activeAction,
            onAction,
            actionParameter.parameterText,
          )
            .then(() => setActionParameter(createComposerState()))
            .catch((error) =>
              setPaletteError(error?.message || t("actionFailed")),
            )
            .finally(() => {
              actionSubmissionRef.current = false;
              setActionSubmitting(false);
            });
          return;
        }
        if (paletteOpen) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        submitCurrent();
        return;
      }
      if (paletteOpen && e.key === "Escape") {
        e.preventDefault();
        setPaletteOpen(false);
        return;
      }
      if (actionParameter.activeAction && e.key === "Escape") {
        e.preventDefault();
        setActionParameter((current) => cancelActionParameter(current));
        return;
      }
      if (e.key === "ArrowUp" && history.length > 0 && !paletteOpen) {
        e.preventDefault();
        if (historyIndex === -1) setDraftBeforeHistory(value);
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next]);
        return;
      }
      if (e.key === "ArrowDown" && historyIndex !== -1 && !paletteOpen) {
        e.preventDefault();
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setValue(next < 0 ? draftBeforeHistory : history[next]);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
      }
    },
    [
      value,
      history,
      historyIndex,
      draftBeforeHistory,
      submitCurrent,
      paletteOpen,
      actionParameter,
      onAction,
    ],
  );

  const handleInput = useCallback((e) => {
    const val = e.target.value;
    setValue(val);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  }, []);

  const handleCommandSelect = useCallback(
    async (item) => {
      if (item?.kind === "skill") {
        if (defaultSkillNames.includes(item.name)) {
          setValue("");
          setPaletteOpen(false);
          textareaRef.current?.focus();
          return;
        }
        setSelectedSkills(
          (current) =>
            toggleComposerSkill(
              { selectedSkills: current },
              { name: item.name, description: item.description || "" },
            ).selectedSkills,
        );
        setPaletteOpen(false);
        textareaRef.current?.focus();
        return;
      }

      if (item?.kind === "action") {
        if (inputLocked) return;
        if (item.name === "capture") {
          setActionParameter((current) =>
            beginActionParameter(current, item.name),
          );
          setPaletteOpen(false);
          textareaRef.current?.focus();
          return;
        }
        if (actionSubmissionRef.current) return;
        actionSubmissionRef.current = true;
        setPaletteError("");
        setActionSubmitting(true);
        try {
          await runComposerAction(item.name, onAction);
          setPaletteOpen(false);
        } catch (error) {
          setPaletteError(error?.message || t("actionFailed"));
        } finally {
          actionSubmissionRef.current = false;
          setActionSubmitting(false);
        }
        textareaRef.current?.focus();
        return;
      }
    },
    [defaultSkillNames, inputLocked, onAction],
  );

  const removeSelectedSkill = useCallback((name) => {
    setSelectedSkills((current) =>
      current.filter((skill) => skill.name !== name),
    );
  }, []);

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length || inputLocked) return;
      setAttachmentError("");
      setUploadingAttachments(true);
      try {
        const prepared = [];
        for (const file of files.slice(0, 8)) {
          const ext = extensionFromName(file.name);
          if (ext === "doc") {
            throw new Error(t("attachmentDocUnsupported"));
          }
          try {
            prepared.push(await compressImageFile(file));
          } catch {
            prepared.push(file);
          }
        }
        const result = await api.uploadAttachments(rs.sessionId, prepared);
        if (result?.error) {
          throw new Error(result.message || t("attachmentUploadFailed"));
        }
        setAttachments((current) =>
          [
            ...current,
            ...(Array.isArray(result.attachments) ? result.attachments : []),
          ].slice(0, 8),
        );
      } catch (error) {
        setAttachmentError(error?.message || t("attachmentUploadFailed"));
      } finally {
        setUploadingAttachments(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        textareaRef.current?.focus();
      }
    },
    [inputLocked, rs.sessionId],
  );

  const removeAttachment = useCallback((id) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <div className="w-full relative">
      <ActionSkillPalette
        query={paletteQuery}
        error={paletteError}
        onQueryChange={setPaletteQuery}
        onSelect={handleCommandSelect}
        visible={paletteOpen}
        projectDirs={projectDirs}
        defaultSkillNames={defaultSkillNames}
        onClose={() => setPaletteOpen(false)}
      />
      <div className="codemini-input-shell flex flex-col gap-2.5 px-2 py-2 sm:px-2.5">
        {(selectedSkills.length > 0 ||
          visibleDefaultSkillNames.length > 0 ||
          attachments.length > 0 ||
          attachmentError ||
          uploadingAttachments) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {visibleDefaultSkillNames.map((name) => (
              <span
                key={`default-${name}`}
                className="codemini-input-chip inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-[12px] text-(--text-secondary)"
                title={`Always-loaded skill: ${name}`}
              >
                <Hammer size={14} className="shrink-0" />
                <span className="max-w-[180px] truncate font-mono">{name}</span>
                <span className="text-[10px] uppercase text-(--text-muted)">
                  default
                </span>
                <button
                  type="button"
                  className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-(--bg-hover) hover:text-(--text-primary)"
                  onClick={() => removeDefaultSkill(name)}
                  title={t("removeLoadedSkill")}
                  disabled={inputLocked}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {selectedSkills.map((selectedSkill) => (
              <span
                key={selectedSkill.name}
                className="codemini-input-chip codemini-input-chip--selected inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-[12px] text-accent-purple"
                title={selectedSkill.description || selectedSkill.name}
              >
                <Hammer size={14} className="shrink-0" />
                <span className="max-w-[180px] truncate">
                  {selectedSkill.name}
                </span>
                <button
                  type="button"
                  className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-(--bg-hover) hover:text-(--text-primary)"
                  onClick={() => removeSelectedSkill(selectedSkill.name)}
                  title={t("removeLoadedSkill")}
                  disabled={inputLocked}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {attachments.map((item) => {
              const Icon = item.kind === "image" ? ImageSquare : FileText;
              return (
                <span
                  key={item.id}
                  className="codemini-input-chip inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-[12px] text-(--text-secondary)"
                  title={`${item.name} (${compactBytes(item.size)})`}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="max-w-[180px] truncate">{item.name}</span>
                  <span className="shrink-0 text-(--text-muted)">
                    {compactBytes(item.size)}
                  </span>
                  <button
                    type="button"
                    className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-(--bg-hover) hover:text-(--text-primary)"
                    onClick={() => removeAttachment(item.id)}
                    title={t("removeAttachment")}
                    disabled={inputLocked}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            {uploadingAttachments && (
              <span className="text-[12px] text-(--text-muted)">
                {t("attachmentUploading")}
              </span>
            )}
            {attachmentError && (
              <span className="text-[12px] text-(--accent-red)">
                {attachmentError}
              </span>
            )}
          </div>
        )}
        <div className="flex min-h-[42px]">
          <textarea
            ref={textareaRef}
            value={
              actionParameter.activeAction
                ? actionParameter.parameterText
                : value
            }
            onChange={
              actionParameter.activeAction
                ? (event) =>
                    setActionParameter((current) => ({
                      ...current,
                      parameterText: event.target.value,
                    }))
                : handleInput
            }
            onKeyDown={handleKeyDown}
            placeholder={
              actionParameter.activeAction === "capture"
                ? "Capture summary (required; Esc to cancel)"
                : busy
                  ? t("inputDisabled")
                  : disabled
                    ? disabledReason || t("inputDisabled")
                    : t("sendMessageToCodemini")
            }
            disabled={inputLocked}
            rows={1}
            className="flex-1 resize-none border-0 outline-none bg-transparent text-(--text-primary) min-h-[30px] max-h-[150px] p-1 leading-[1.5] text-[14px] placeholder:text-(--text-muted) disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ height: "auto" }}
          />
        </div>
        <div className="flex items-center gap-1.5 min-h-8 flex-wrap">
          <div className="flex min-w-0 flex-1 basis-full sm:basis-auto items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
            <button
              type="button"
              className="border-0 bg-transparent text-(--text-secondary) min-w-8 h-8 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary)"
              title={t("addActionOrSkill")}
              aria-label={t("addActionOrSkill")}
              disabled={inputLocked}
              onClick={() => {
                setPaletteQuery("");
                setPaletteOpen((open) => !open);
              }}
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              className="border-0 bg-transparent text-(--text-secondary) min-w-8 h-8 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary)"
              title={t("addContext")}
              disabled={inputLocked}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ATTACHMENT_ACCEPT}
              multiple
              onChange={(event) => handleFiles(event.target.files)}
            />
            <ModeSelector
              sessionId={rs.sessionId}
              current={mode}
              disabled={inputLocked}
            />
            <SpecQuickSelect
              sessionId={rs.sessionId}
              visible={!isGeneralChat}
              disabled={inputLocked}
              onSelect={(spec) => {
                onOpenSpec?.(spec);
                setPaletteOpen(false);
                textareaRef.current?.focus();
              }}
            />
            <ApprovalModeSelector
              sessionId={rs.sessionId}
              current={approvalMode}
              disabled={inputLocked}
            />
            <SoulQuickSwitch disabled={inputLocked} />
            <ReasoningQuickControl
              enabled={reasoningEnabled}
              effort={reasoningEffort}
              disabled={inputLocked}
            />
          </div>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            {/* <button type="button" className="border-0 bg-transparent text-(--text-muted) w-auto px-2 h-[30px] rounded-lg inline-flex items-center justify-center gap-1 shrink-0 cursor-pointer text-[12px] whitespace-nowrap hover:bg-(--bg-hover) hover:text-(--text-primary)" title="模型">
              <span className={cn('truncate', !rs.model && 'opacity-50')}>{rs.model || '加载中'}</span>
              <CaretDown size={11} />
            </button> */}
            {busy ? (
              <button
                type="button"
                className="border-0 text-(--accent-red) min-w-8 h-8 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer bg-(--accent-red-bg) transition-opacity hover:opacity-80"
                onClick={onAbort}
                title={t("abort")}
              >
                <Minus size={14} />
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  "border-0 min-w-8 w-8 h-8 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-all",
                  (value.trim() ||
                    attachments.length > 0 ||
                    selectedSkills.length > 0) &&
                    !inputLocked
                    ? "bg-(--text-primary) text-(--bg-primary) hover:opacity-85"
                    : "bg-(--text-muted)/25 text-(--text-muted) cursor-not-allowed",
                )}
                onClick={submitCurrent}
                disabled={
                  (!value.trim() &&
                    attachments.length === 0 &&
                    selectedSkills.length === 0) ||
                  inputLocked
                }
                title={t("sending")}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
