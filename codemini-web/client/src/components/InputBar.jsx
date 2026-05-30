import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Separator } from "@/components/ui/separator";
import {
  Paperclip,
  ChevronDown,
  ArrowUp,
  Minus,
  MessageCircle,
  FileText,
  Sparkles,
  ListChecks,
  Hammer,
  ShieldAlert,
  Unlock,
  Moon,
  Archive,
  Database,
  Inbox,
  Camera,
  Drama,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import * as api from "@/hooks/use-api";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

const IMPLICIT_SKILLS = new Set(["superpowers-lite"]);

function getModeOptions() {
  return [
    {
      value: "normal",
      label: t("normalExecutionMode"),
      desc: t("normalModeDesc"),
      icon: MessageCircle,
    },
    {
      value: "plan",
      label: t("planMode"),
      desc: t("planModeDesc"),
      icon: ListChecks,
    },
  ];
}

function getApprovalModeOptions() {
  return [
    {
      value: "review",
      label: t("reviewMode"),
      desc: t("reviewModeDesc"),
      icon: ShieldAlert,
    },
    {
      value: "auto",
      label: t("autoMode"),
      desc: t("autoModeDesc"),
      icon: Sparkles,
    },
    {
      value: "full_access",
      label: t("fullAccessMode"),
      desc: t("fullAccessModeDesc"),
      icon: Unlock,
    },
  ];
}

const ACTION_COMMANDS = [
  {
    name: "dream",
    insert: "/dream ",
    icon: Moon,
    description:
      "Run memory consolidation now. Auto dream still runs in the background when needed.",
  },
  {
    name: "compact",
    insert: "/compact ",
    icon: Archive,
    description:
      "Compress the current conversation context while keeping the useful working summary.",
  },
  {
    name: "memory",
    insert: "/memory ",
    icon: Database,
    description: "Inspect or manage remembered project and user context.",
  },
  {
    name: "capture",
    insert: "/capture ",
    icon: Camera,
    description:
      "Capture an explicit note into the memory inbox for later consolidation.",
  },
  {
    name: "inbox",
    insert: "/inbox ",
    icon: Inbox,
    description: "Review pending memory inbox entries.",
  },
  {
    name: "reflect",
    insert: "/reflect ",
    icon: Sparkles,
    description: "Draft or update a reusable skill from the current workflow.",
  },
];

const ACTION_COMMAND_NAMES = new Set(
  ACTION_COMMANDS.map((command) => command.name),
);

const INPUT_PILL_CLASS =
  "border border-transparent bg-(--bg-primary)/35 text-(--text-secondary) h-8 rounded-full inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer text-[13px] whitespace-nowrap transition-colors hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary)";

function ModeSelector({ current, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const MODE_OPTIONS = getModeOptions();
  const active =
    MODE_OPTIONS.find((m) => m.value === current) || MODE_OPTIONS[0];
  const ActiveIcon = active.icon;

  const handleSelect = async (mode) => {
    if (mode === current || switching || disabled) return;
    setSwitching(true);
    try {
      const result = await api.setExecutionMode(mode);
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
            "px-3 hover:border-(--accent-blue)/55 hover:bg-(--accent-blue-bg) hover:text-(--accent-blue)",
            (switching || disabled) && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={disabled ? t("switchModeDisabled") : t("switchMode")}
        >
          <ActiveIcon size={13} />
          <span className="truncate">{active.label}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-88 p-1 rounded-lg bg-(--bg-primary) border border-(--border-default) shadow-lg"
      >
        <div className="text-[11px] text-(--text-muted) px-2 py-1.5 font-medium">
          {t("executionMode")}
        </div>
        <div className="flex flex-col gap-0.5">
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                disabled={disabled || switching}
                className={cn(
                  "w-full border-0 rounded-md px-2 py-1.5 text-left text-[12px] cursor-pointer flex items-center gap-2",
                  (disabled || switching) && "opacity-50 cursor-not-allowed",
                  current === opt.value
                    ? "bg-(--bg-active) text-(--text-primary) font-medium"
                    : "bg-transparent text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                )}
                onClick={() => handleSelect(opt.value)}
              >
                <Icon size={14} className="shrink-0 mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block">{opt.label}</span>
                  <span className="block text-(--text-muted) text-[11px] font-normal leading-snug">
                    {opt.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ApprovalModeSelector({ current, disabled = false }) {
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
      const result = await api.setApprovalMode(mode);
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
            "px-3 hover:border-(--accent-green)/55 hover:bg-(--accent-green-bg) hover:text-(--accent-green)",
            (switching || disabled) && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={disabled ? t("switchModeDisabled") : t("switchApprovalMode")}
        >
          <ActiveIcon size={13} />
          <span className="truncate">{active.label}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-76 p-1 rounded-lg bg-(--bg-primary) border border-(--border-default) shadow-lg"
      >
        <div className="text-[11px] text-(--text-muted) px-2 py-1.5 font-medium">
          {t("approvalMode")}
        </div>
        <div className="flex flex-col gap-0.5">
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                disabled={disabled || switching}
                className={cn(
                  "w-full border-0 rounded-md px-2 py-1.5 text-left text-[12px] cursor-pointer flex items-center gap-2",
                  (disabled || switching) && "opacity-50 cursor-not-allowed",
                  current === opt.value
                    ? "bg-(--bg-active) text-(--text-primary) font-medium"
                    : "bg-transparent text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                )}
                onClick={() => handleSelect(opt.value)}
              >
                <Icon size={14} className="shrink-0 mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block">{opt.label}</span>
                  <span className="block text-(--text-muted) text-[11px] font-normal leading-snug">
                    {opt.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SoulQuickSwitch() {
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

  const handleActivate = async (name) => {
    await api.activateSoul(name);
    setActive(name);
    setOpen(false);
    loadSouls();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(INPUT_PILL_CLASS, "px-3")}
          title={t("soulSwitch")}
        >
          <Drama size={13} />
          <span className="truncate max-w-[60px]">{active || "default"}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-52 p-1 rounded-lg bg-(--bg-primary) border border-(--border-default) shadow-lg"
      >
        <div className="text-[11px] text-(--text-muted) px-2 py-1.5 font-medium">
          {t("switchSoul")}
        </div>
        <div className="flex flex-col gap-0.5">
          {souls.map((soul) => (
            <button
              key={`${soul.scope}-${soul.name}`}
              className={cn(
                "w-full border-0 rounded-md px-2 py-1.5 text-left text-[12px] cursor-pointer flex items-center gap-2",
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

function SpecQuickSelect({ visible, disabled = false, onSelect }) {
  const [open, setOpen] = useState(false);
  const [specs, setSpecs] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadSpecs = useCallback(async () => {
    if (!visible || disabled) return;
    setLoading(true);
    try {
      const result = await api.fetchSpecs();
      setSpecs(Array.isArray(result?.specs) ? result.specs : []);
    } catch {
      setSpecs([]);
    } finally {
      setLoading(false);
    }
  }, [visible, disabled]);

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
            "px-3 hover:border-(--accent-purple)/55 hover:bg-(--accent-purple-bg) hover:text-(--accent-purple)",
            disabled && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={t("planFromSpec")}
        >
          <FileText size={13} />
          <span className="truncate">{t("specFile")}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[420px] max-w-[calc(100vw-32px)] p-1 rounded-lg bg-(--bg-primary) border border-(--border-default) shadow-lg"
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
          {!loading && specs.map((spec) => (
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

function CommandPalette({ query, onSelect, visible }) {
  const [skills, setSkills] = useState([]);
  const [hoveredItem, setHoveredItem] = useState(null);

  useEffect(() => {
    if (visible) {
      api
        .fetchSkills()
        .then((list) => {
          setSkills(
            Array.isArray(list)
              ? list.filter(
                  (s) =>
                    s.enabled !== false &&
                    !IMPLICIT_SKILLS.has(s.name) &&
                    !ACTION_COMMAND_NAMES.has(s.name),
                )
              : [],
          );
        })
        .catch(() => {});
    }
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
            !needle ||
            skill.name.toLowerCase().includes(needle) ||
            (skill.description || "").toLowerCase().includes(needle),
        )
        .map((skill) => ({
          name: skill.name,
          insert: `/${skill.name} `,
          icon: Hammer,
          description: skill.description || "Manual skill",
          kind: "skill",
          key: `skill-${skill.name}`,
        })),
    [skills, needle],
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
                onClick={() => onSelect(item.insert)}
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
      className="absolute bottom-full left-0 right-0 mb-1.5 max-h-[360px] overflow-y-auto rounded-xl border border-(--border-default) bg-(--bg-primary) shadow-lg z-50 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      style={{ scrollbarWidth: "thin" }}
    >
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
  onAbort,
  busy,
  disabled = false,
  disabledReason = "",
  runtimeState,
  history: externalHistory,
  onOpenSpec,
  projectCwd,
}) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const textareaRef = useRef(null);

  const rs = runtimeState || {};
  const mode = rs.mode || "normal";
  const approvalMode = rs.approvalMode || "review";
  const inputLocked = busy || disabled;
  const isGeneralChat = projectCwd === "__codemini_general__";

  useEffect(() => {
    if (externalHistory && externalHistory.length && history.length === 0) {
      setHistory([...externalHistory].reverse());
    }
  }, [externalHistory]);

  useEffect(() => {
    if (!inputLocked) return;
    setSlashOpen(false);
  }, [inputLocked]);

  const submitCurrent = useCallback(() => {
    const val = value.trim();
    if (!val || inputLocked) return;
    onSubmit(val);
    setValue("");
    setSlashOpen(false);
    setHistoryIndex(-1);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value, inputLocked, onSubmit]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        if (slashOpen) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        submitCurrent();
        return;
      }
      if (slashOpen && e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
      if (e.key === "ArrowUp" && history.length > 0 && !slashOpen) {
        e.preventDefault();
        if (historyIndex === -1) setDraftBeforeHistory(value);
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next]);
        return;
      }
      if (e.key === "ArrowDown" && historyIndex !== -1 && !slashOpen) {
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
      slashOpen,
    ],
  );

  const handleInput = useCallback((e) => {
    const val = e.target.value;
    setValue(val);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";

    if (val === "/") {
      setSlashOpen(true);
      setSlashQuery("");
    } else if (val.startsWith("/") && !val.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(val.slice(1));
    } else {
      setSlashOpen(false);
    }
  }, []);

  const handleCommandSelect = useCallback((insert) => {
    setValue(insert);
    setSlashOpen(false);
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="w-full relative">
      <CommandPalette
        query={slashQuery}
        onSelect={handleCommandSelect}
        visible={slashOpen}
      />
      <div
        className="flex flex-col gap-4 border border-border rounded-[28px] px-3 py-2 transition-colors bg-(--bg-primary) shadow-(--shadow-lg) dark:bg-(--bg-secondary) dark:shadow-[0_14px_44px_color-mix(in_srgb,var(--background)_70%,transparent)]"
        // style={{
        //   background:
        //     "color-mix(in srgb, var(--bg-tertiary) 72%, var(--bg-input))",
        //   // boxShadow: "var(--shadow-default)",
        // }}
      >
        <div className="flex min-h-[58px]">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={
              busy
                ? t("inputDisabled")
                : disabled
                  ? disabledReason || t("inputDisabled")
                  : t("sendMessageToCodeminiWithSlash")
            }
            disabled={inputLocked}
            rows={1}
            className="flex-1 resize-none border-0 outline-none bg-transparent text-(--text-primary) min-h-[34px] max-h-[160px] p-1 leading-[1.55] text-[16px] placeholder:text-(--text-muted) disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ height: "auto" }}
          />
        </div>
        <div className="flex items-center gap-2 min-h-9 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <ModeSelector current={mode} disabled={inputLocked} />
            <SpecQuickSelect
              visible={!isGeneralChat}
              disabled={inputLocked}
              onSelect={(spec) => {
                onOpenSpec?.(spec);
                setSlashOpen(false);
                textareaRef.current?.focus();
              }}
            />
            <ApprovalModeSelector current={approvalMode} disabled={inputLocked} />
            <SoulQuickSwitch />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {/* <button type="button" className="border-0 bg-transparent text-(--text-muted) w-auto px-2 h-[30px] rounded-lg inline-flex items-center justify-center gap-1 shrink-0 cursor-pointer text-[12px] whitespace-nowrap hover:bg-(--bg-hover) hover:text-(--text-primary)" title="模型">
              <span className={cn('truncate', !rs.model && 'opacity-50')}>{rs.model || '加载中'}</span>
              <ChevronDown size={11} />
            </button> */}
            <button
              type="button"
              className="border-0 bg-transparent text-(--text-secondary) min-w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary)"
              title={t("addContext")}
            >
              <Paperclip size={18} />
            </button>
            {busy ? (
              <button
                type="button"
                className="border-0 text-(--accent-red) min-w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer bg-(--accent-red-bg) transition-opacity hover:opacity-80"
                onClick={onAbort}
                title={t("abort")}
              >
                <Minus size={14} />
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  "border-0 min-w-10 w-10 h-10 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer transition-all",
                  value.trim() && !inputLocked
                    ? "bg-(--accent-blue) text-white hover:bg-(--accent-hover)"
                    : "bg-(--text-muted)/25 text-(--text-muted) cursor-not-allowed",
                )}
                onClick={submitCurrent}
                disabled={!value.trim() || inputLocked}
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
