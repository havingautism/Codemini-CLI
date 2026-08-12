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
  CircleNotch,
  FileText,
  Hammer,
  ImageSquare,
  MaskHappy,
  MagnifyingGlass,
  Minus,
  Moon,
  Notebook,
  Paperclip,
  Plus,
  Sparkle,
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
  executionModeSkillContext,
  filterSkillsForExecutionMode,
  skillIsVisibleInExecutionMode,
} from "@/lib/skill-visibility.js";
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
  getSandboxModeOptions,
} from "@/lib/settings-options.js";

const IMPLICIT_SKILLS = new Set();
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
    requiresConversation: true,
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
    name: "reflect",
    icon: Sparkle,
    requiresConversation: true,
    description: "Draft or update a reusable skill from the current workflow.",
  },
];

const INPUT_PILL_CLASS =
  "codemini-input-pill border-0 bg-(--badge-bg) text-(--text-secondary) h-7 rounded-md inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer text-[11px] sm:text-[12px] whitespace-nowrap transition-all shadow-[0_1px_2px_color-mix(in_srgb,black_5%,transparent)] hover:bg-(--bg-hover) hover:text-(--text-primary) hover:shadow-[0_1px_3px_color-mix(in_srgb,black_10%,transparent)]";

const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx";
const IMAGE_MAX_EDGE = 1600;
const SCRAPBOOK_PICKER_PAGE_SIZE = 8;
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

function getScrapbookPreviewText(entry) {
  return String(
    entry?.summary ||
      entry?.contentText ||
      entry?.sourceUrl ||
      t("scrapbookNoContent"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getScrapbookAskSummary(entry) {
  const fromJob = String(entry?.latestJob?.resultSummary || "").trim();
  const fromEntry = String(entry?.summary || "").trim();
  return fromJob || fromEntry;
}

function isScrapbookAskBlocked(entry) {
  if (getScrapbookAskSummary(entry)) return false;
  const status = String(entry?.latestJob?.status || "");
  return status === "pending" || status === "running";
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
            "px-2.5",
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
        className="w-72 max-w-[calc(100vw-32px)] p-2"
      >
        <div className="px-0.5 pb-1.5 text-[11px] font-medium text-muted-foreground">
          {t("executionMode")}
        </div>
        <ToggleGroup
          type="single"
          value={current}
          onValueChange={handleSelect}
          disabled={disabled || switching}
          size="auto"
          className="flex w-full flex-col items-stretch gap-0.5"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="gap-2 data-[state=on]:shadow-none"
              >
                <Icon data-icon="inline-start" className="mt-0.5" />
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate">{opt.label}</span>
                  <span className="block wrap-break-word text-[11px] font-normal leading-snug text-muted-foreground">
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
            "px-2.5",
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
        className="w-72 max-w-[calc(100vw-32px)] p-2"
      >
        <div className="px-0.5 pb-1.5 text-[11px] font-medium text-muted-foreground">
          {t("approvalMode")}
        </div>
        <ToggleGroup
          type="single"
          value={current}
          onValueChange={handleSelect}
          disabled={disabled || switching}
          size="auto"
          className="flex w-full flex-col items-stretch gap-0.5"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="gap-2 data-[state=on]:shadow-none"
              >
                <Icon data-icon="inline-start" className="mt-0.5" />
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate">{opt.label}</span>
                  <span className="block wrap-break-word text-[11px] font-normal leading-snug text-muted-foreground">
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

function SandboxModeSelector({ sessionId, current, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const MODE_OPTIONS = getSandboxModeOptions();
  const active =
    MODE_OPTIONS.find((m) => m.value === current) || MODE_OPTIONS[0];
  const ActiveIcon = active.icon;

  const handleSelect = async (mode) => {
    if (!mode || mode === current || switching || disabled) return;
    setSwitching(true);
    setError("");
    try {
      await onChange(sessionId, mode);
      setOpen(false);
    } catch (err) {
      setError(err?.message || t("actionFailed"));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && !switching && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            INPUT_PILL_CLASS,
            "px-2.5",
            (switching || disabled) && "opacity-50 pointer-events-none",
          )}
          disabled={disabled || switching}
          aria-busy={switching}
          title={disabled ? t("switchModeDisabled") : t("switchSandboxMode")}
        >
          {switching ? (
            <CircleNotch size={13} className="animate-spin" />
          ) : (
            <ActiveIcon size={13} />
          )}
          <span className="truncate">{active.label}</span>
          <CaretDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-32px)] p-2"
      >
        <div className="px-0.5 pb-1.5 text-[11px] font-medium text-muted-foreground">
          {t("sandboxMode")}
        </div>
        <ToggleGroup
          type="single"
          value={current}
          onValueChange={handleSelect}
          disabled={disabled || switching}
          size="auto"
          className="flex w-full flex-col items-stretch gap-0.5"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="gap-2 data-[state=on]:shadow-none"
              >
                <Icon data-icon="inline-start" className="mt-0.5" />
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate">{opt.label}</span>
                  <span className="block wrap-break-word text-[11px] font-normal leading-snug text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        {error ? (
          <div role="alert" className="px-2 pt-1.5 text-[11px] text-(--accent-red)">
            {error}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function SoulQuickSwitch({ disabled = false, mode = "normal" }) {
  const { state, actions } = useApp();
  const [souls, setSouls] = useState([]);
  const [active, setActive] = useState("");
  const [open, setOpen] = useState(false);
  const category = executionModeSkillContext(mode);

  const loadSouls = useCallback(async () => {
    try {
      const list = await api.fetchSouls();
      const arr = (Array.isArray(list) ? list : []).filter(
        (soul) => (soul.category || "coding") === category,
      );
      setSouls(arr);
      const current = arr.find((s) => s.active);
      setActive(current ? current.name : "");
    } catch {}
  }, [category]);

  useEffect(() => {
    loadSouls();
  }, [loadSouls]);

  useEffect(() => {
    if (state.soulsRevision > 0) {
      loadSouls();
    }
  }, [state.soulsRevision, loadSouls]);

  const handleActivate = async (soul) => {
    if (disabled || !soul?.name) return;
    await api.activateSoul(soul.name, soul.category || category);
    setActive(soul.name);
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
          {t("switchSoul")} ·{" "}
          {category === "daily"
            ? t("skillContextDaily")
            : t("skillContextCoding")}
        </div>
        <div className="flex flex-col gap-0.5">
          {souls.map((soul) => (
            <button
              key={`${soul.category}-${soul.scope}-${soul.name}`}
              disabled={disabled}
              className={cn(
                "w-full border-0 rounded-md px-2 py-1.5 text-left text-[12px] cursor-pointer flex items-center gap-2",
                disabled && "opacity-50 cursor-not-allowed",
                soul.active
                  ? "bg-(--bg-active) text-(--text-primary) font-medium"
                  : "bg-transparent text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
              )}
              onClick={() => handleActivate(soul)}
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

function ActionSkillPalette({
  query,
  error,
  onQueryChange,
  onSelect,
  visible,
  projectDirs = EMPTY_PROJECT_DIRS,
  defaultSkillNames = [],
  mode = "normal",
  hasConversation = false,
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
        .fetchSkills()
        .then((list) => {
          if (cancelled) return;
          setSkills(
            filterSkillsForExecutionMode(list, mode).filter(
              (s) =>
                !IMPLICIT_SKILLS.has(s.name) &&
                !INTERNAL_SKILLS.has(s.name) &&
                !USER_ACTION_COMMAND_NAMES.has(s.name),
            ),
          );
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [visible, projectDirs, mode]);

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
        disabled: command.requiresConversation && !hasConversation,
        kind: "action",
        key: `action-${command.name}`,
      })),
    [needle, hasConversation],
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
          contexts: skill.contexts,
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
                type="button"
                disabled={item.disabled}
                title={
                  item.disabled ? t("actionRequiresConversation") : undefined
                }
                className={cn(
                  "w-full border-0 rounded-md px-2.5 py-2 text-left cursor-pointer grid grid-cols-[22px_minmax(96px,180px)_minmax(0,1fr)_auto] items-start gap-2 text-[12px] transition-colors",
                  item.disabled
                    ? "cursor-not-allowed bg-transparent text-(--text-muted) opacity-45"
                    : isHovered
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
  onActionStart,
  onAbort,
  busy,
  disabled = false,
  disabledReason = "",
  runtimeState,
  history: externalHistory,
  projectCwd,
  projectDirs = EMPTY_PROJECT_DIRS,
  hasConversation = false,
}) {
  const { state, actions } = useApp();
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
  const [scrapbookContext, setScrapbookContext] = useState(null);
  const [scrapbookPickerOpen, setScrapbookPickerOpen] = useState(false);
  const [scrapbookEntries, setScrapbookEntries] = useState([]);
  const [scrapbookLoading, setScrapbookLoading] = useState(false);
  const [scrapbookQuery, setScrapbookQuery] = useState("");
  const [scrapbookVisibleCount, setScrapbookVisibleCount] = useState(
    SCRAPBOOK_PICKER_PAGE_SIZE,
  );
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
  const approvalMode = rs.approvalMode || "auto";
  const approvalUiEnabled = rs.approvalUiEnabled !== false;
  const sandboxMode = rs.sandboxMode || "workspace-write";
  const sandboxUiEnabled = rs.sandboxUiEnabled === true;
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
  const filteredScrapbookEntries = useMemo(() => {
    const query = scrapbookQuery.trim().toLowerCase();
    if (!query) return scrapbookEntries;
    return scrapbookEntries.filter((entry) => {
      const haystack = [
        entry?.title,
        entry?.summary,
        entry?.contentText,
        entry?.sourceUrl,
      ]
        .map((item) => String(item || "").toLowerCase())
        .join("\n");
      return haystack.includes(query);
    });
  }, [scrapbookEntries, scrapbookQuery]);
  const visibleScrapbookEntries = useMemo(
    () => filteredScrapbookEntries.slice(0, scrapbookVisibleCount),
    [filteredScrapbookEntries, scrapbookVisibleCount],
  );
  const hasMoreScrapbookEntries =
    filteredScrapbookEntries.length > visibleScrapbookEntries.length;
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
    setSelectedSkills((current) =>
      current.filter((skill) => skillIsVisibleInExecutionMode(skill, mode)),
    );
  }, [mode]);

  useEffect(() => {
    if (externalHistory && externalHistory.length && history.length === 0) {
      setHistory([...externalHistory].reverse());
    }
  }, [externalHistory]);

  useEffect(() => {
    const pendingScrapbookContext = state?.pendingScrapbookContext || null;
    if (!pendingScrapbookContext?.attachment) return;
    setScrapbookContext({
      entryId: pendingScrapbookContext.entryId,
      attachment: pendingScrapbookContext.attachment,
      modelText: pendingScrapbookContext.modelText || "",
    });
    actions.clearPendingScrapbookContext?.();
  }, [actions, state?.pendingScrapbookContext]);

  useEffect(() => {
    if (!inputLocked || actionSubmitting) return;
    setPaletteOpen(false);
  }, [inputLocked, actionSubmitting]);

  const submitCurrent = useCallback(async () => {
    const val = value.trim();
    const hasText = val.length > 0;
    const hasAttachments = attachments.length > 0;
    const hasScrapbookContext = Boolean(scrapbookContext);
    const hasSkills = selectedSkills.length > 0;
    if (
      (!hasText && !hasAttachments && !hasScrapbookContext && !hasSkills) ||
      inputLocked
    )
      return;

    let fallbackText = val;
    if (!hasText && (hasAttachments || hasScrapbookContext)) {
      fallbackText = t("attachmentFallbackPrompt");
    }

    const dismissedSkills = [...dismissedDefaultSkills];
    try {
      await onSubmit({
        text: fallbackText,
        skillNames: selectedSkillNames,
        attachmentIds: attachments.map((item) => item.id).filter(Boolean),
        attachments: scrapbookContext
          ? [...attachments, scrapbookContext.attachment]
          : attachments,
        dismissedAlwaysSkills: dismissedSkills,
        ...(scrapbookContext?.modelText
          ? { modelText: scrapbookContext.modelText }
          : {}),
      });
    } catch {
      return;
    }
    setValue("");
    setAttachments([]);
    setScrapbookContext(null);
    setSelectedSkills([]);
    setDismissedDefaultSkills(new Set());
    setAttachmentError("");
    setPaletteOpen(false);
    setHistoryIndex(-1);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [
    value,
    attachments,
    scrapbookContext,
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
              {
                name: item.name,
                description: item.description || "",
                contexts: item.contexts,
              },
            ).selectedSkills,
        );
        setPaletteOpen(false);
        textareaRef.current?.focus();
        return;
      }

      if (item?.kind === "action") {
        if (inputLocked || item.disabled) return;
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
        setPaletteOpen(false);
        try {
          onActionStart?.(item.name);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await runComposerAction(item.name, onAction);
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
    [defaultSkillNames, inputLocked, onAction, onActionStart],
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

  const loadScrapbookEntries = useCallback(async () => {
    setScrapbookLoading(true);
    try {
      const result = await api.fetchScrapbookEntries("");
      setScrapbookEntries(Array.isArray(result?.entries) ? result.entries : []);
    } catch {
      setScrapbookEntries([]);
    } finally {
      setScrapbookLoading(false);
    }
  }, []);

  const selectScrapbookEntry = useCallback(async (entryId) => {
    const entry = scrapbookEntries.find((item) => item.id === entryId);
    if (entry && isScrapbookAskBlocked(entry)) {
      setAttachmentError(t("scrapbookAskSummaryPending"));
      return;
    }
    const result = await api.buildScrapbookAskPayload(entryId);
    if (result?.error || !result?.payload) {
      setAttachmentError(
        result?.message || t("scrapbookAskSummaryPending"),
      );
      return;
    }
    const attachment = Array.isArray(result.payload.attachments)
      ? result.payload.attachments[0]
      : null;
    setScrapbookContext(
      attachment
        ? {
            entryId,
            attachment,
            modelText: result.payload.modelText || "",
          }
        : null,
    );
    setAttachmentError("");
    setScrapbookPickerOpen(false);
  }, [scrapbookEntries]);

  const removeScrapbookContext = useCallback(() => {
    setScrapbookContext(null);
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
        mode={mode}
        hasConversation={hasConversation}
        onClose={() => setPaletteOpen(false)}
      />
      <div
        className={cn(
          "codemini-input-shell flex flex-col gap-2.5 px-2 py-2 sm:px-2.5",
          busy && "codemini-input-shell--busy",
        )}
      >
        {(selectedSkills.length > 0 ||
          visibleDefaultSkillNames.length > 0 ||
          attachments.length > 0 ||
          scrapbookContext ||
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
            {scrapbookContext?.attachment ? (
              <span
                className="codemini-input-chip inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-[12px] text-(--text-secondary)"
                title={scrapbookContext.attachment.name}
              >
                <Notebook size={14} className="shrink-0" />
                <span className="max-w-[180px] truncate">
                  {scrapbookContext.attachment.name}
                </span>
                <button
                  type="button"
                  className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-(--bg-hover) hover:text-(--text-primary)"
                  onClick={removeScrapbookContext}
                  title={t("removeAttachment")}
                  disabled={inputLocked}
                >
                  <X size={11} />
                </button>
              </span>
            ) : null}
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
            <Popover
              open={scrapbookPickerOpen}
              onOpenChange={(open) => {
                if (inputLocked) return;
                setScrapbookPickerOpen(open);
                if (open) {
                  setScrapbookQuery("");
                  setScrapbookVisibleCount(SCRAPBOOK_PICKER_PAGE_SIZE);
                  loadScrapbookEntries();
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="border-0 bg-transparent text-(--text-secondary) min-w-8 h-8 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary)"
                  title={t("scrapbook")}
                  aria-label={t("scrapbook")}
                  disabled={inputLocked}
                >
                  <Notebook size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-96 overflow-hidden rounded-xl p-0"
              >
                <div className="border-b border-(--border-default) bg-(--bg-primary) px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[13px] font-medium text-(--text-primary)">
                      {t("scrapbook")}
                    </div>
                    <div className="shrink-0 rounded-full border border-(--border-default) bg-(--bg-subtle) px-2 py-0.5 text-[10px] font-medium text-(--text-muted)">
                      {filteredScrapbookEntries.length}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-(--text-muted)">
                    {t("scrapbookPickerHelp")}
                  </div>
                  <label className="group scrapbook-picker-search-shell mt-3 flex items-center gap-2.5 rounded-xl border border-(--border-default) bg-(--bg-secondary) px-3 py-0.5 transition-[border-color,background-color,box-shadow] hover:border-(--border-strong) hover:bg-(--bg-primary) focus-within:border-(--border-strong) focus-within:bg-(--bg-primary) focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
                    <MagnifyingGlass
                      size={14}
                      className="shrink-0 text-(--text-muted) transition-colors group-focus-within:text-(--text-secondary)"
                    />
                    <input
                      type="text"
                      inputMode="search"
                      autoComplete="off"
                      value={scrapbookQuery}
                      onChange={(event) => {
                        setScrapbookQuery(event.target.value);
                        setScrapbookVisibleCount(SCRAPBOOK_PICKER_PAGE_SIZE);
                      }}
                      placeholder={t("scrapbookSearchPlaceholder")}
                      aria-label={t("scrapbookSearchPlaceholder")}
                      className="scrapbook-picker-search h-9 min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[12px] text-(--text-primary) shadow-none outline-none ring-0 placeholder:text-(--text-muted) focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                    />
                  </label>
                </div>
                <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-2">
                  {scrapbookLoading ? (
                    <div className="rounded-lg border border-dashed border-(--border-default) px-3 py-6 text-center text-[12px] text-(--text-muted)">
                      {t("scrapbookLoading")}
                    </div>
                  ) : filteredScrapbookEntries.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-(--border-default) px-3 py-6 text-center text-[12px] text-(--text-muted)">
                      {t("scrapbookEmpty")}
                    </div>
                  ) : (
                    <>
                      {visibleScrapbookEntries.map((entry) => {
                        const askBlocked = isScrapbookAskBlocked(entry);
                        return (
                        <button
                          key={entry.id}
                          type="button"
                          disabled={askBlocked}
                          className={cn(
                            "group relative flex w-full min-w-0 shrink-0 flex-col items-stretch gap-1.5 overflow-hidden rounded-xl border px-3 py-3 text-left transition-[background-color,box-shadow,transform] duration-150",
                            askBlocked
                              ? "cursor-not-allowed opacity-60"
                              : scrapbookContext?.entryId === entry.id
                              ? "border-(--border-strong) bg-(--bg-subtle)"
                              : "border-transparent hover:-translate-y-px hover:bg-(--bg-subtle)/80 hover:shadow-[0_10px_24px_color-mix(in_srgb,var(--text-primary)_10%,transparent)]",
                          )}
                          onClick={() => selectScrapbookEntry(entry.id)}
                        >
                          <div className="flex w-full min-w-0 items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-5 text-(--text-primary)">
                              {entry.title ||
                                entry.sourceUrl ||
                                t("scrapbookUntitled")}
                            </span>
                            {scrapbookContext?.entryId === entry.id ? (
                              <span className="shrink-0 rounded-full bg-(--bg-hover) px-2 py-0.5 text-[10px] font-medium leading-5 text-(--text-secondary)">
                                {t("scrapbookPickerActive")}
                              </span>
                            ) : askBlocked ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--bg-hover) px-2 py-0.5 text-[10px] font-medium leading-5 text-(--text-muted)">
                                <CircleNotch size={10} className="animate-spin" />
                                {t("scrapbookSummarizing")}
                              </span>
                            ) : null}
                          </div>
                          <div className="min-w-0 w-full truncate text-[12px] leading-5 text-(--text-muted)">
                            {getScrapbookPreviewText(entry)}
                          </div>
                        </button>
                        );
                      })}
                      {hasMoreScrapbookEntries ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-xl px-3 py-2 text-[12px] text-(--text-secondary) transition-colors hover:bg-(--bg-subtle) hover:text-(--text-primary)"
                          onClick={() =>
                            setScrapbookVisibleCount(
                              (current) => current + SCRAPBOOK_PICKER_PAGE_SIZE,
                            )
                          }
                        >
                          {t("scrapbookShowMore")}
                          {` · ${filteredScrapbookEntries.length - visibleScrapbookEntries.length}`}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
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
            <ReasoningQuickControl
              enabled={reasoningEnabled}
              effort={reasoningEffort}
              disabled={inputLocked}
            />
            {approvalUiEnabled ? (
              <ApprovalModeSelector
                sessionId={rs.sessionId}
                current={approvalMode}
                disabled={inputLocked}
              />
            ) : null}
            {sandboxUiEnabled ? (
              <SandboxModeSelector
                sessionId={rs.sessionId}
                current={sandboxMode}
                onChange={actions.setSandboxMode}
                disabled={inputLocked}
              />
            ) : null}
            <SoulQuickSwitch disabled={inputLocked} mode={mode} />
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
