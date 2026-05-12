import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "../../utils/time.js";

const TOOL_ICONS = {
  read: "\u{1F4D6}",
  edit: "\u{270F}\u{FE0F}",
  write: "\u{1F4DD}",
  delete: "\u{1F5D1}\u{FE0F}",
  run: "\u{2699}\u{FE0F}",
  grep: "\u{1F50D}",
  glob: "\u{1F4C2}",
  list: "\u{1F4C1}",
  web_fetch: "\u{1F310}",
  web_search: "\u{1F50E}",
  default: "\u{1F527}",
};

function extractToolName(name) {
  const match = String(name).match(/^(\w+)/);
  return match ? match[1] : name;
}

function extractKeyArg(args, toolName) {
  if (!args) return "";
  let obj = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return args;
    }
  }
  if (typeof obj !== "object") return String(obj);
  const keyMap = {
    read: "path",
    edit: "path",
    write: "path",
    delete: "path",
    run: "command",
    grep: "pattern",
    glob: "pattern",
    list: "path",
    web_fetch: "url",
    web_search: "query",
  };
  const key = keyMap[toolName];
  if (key && obj[key] != null) return String(obj[key]);
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.length > 0 && v.length < 200) return v;
  }
  return "";
}

function formatDetail(value) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  const text = value.trim();
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return value;
  }
}

const STATUS_STYLES = {
  running: "bg-[var(--accent-blue)] animate-pulse",
  done: "bg-[var(--accent-green)]",
  error: "bg-[var(--accent-red)]",
  blocked: "bg-[var(--accent-orange)]",
};

export function ToolCard({ card }) {
  const [open, setOpen] = useState(false);
  const toolName = extractToolName(card.name);
  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const keyArg = extractKeyArg(card.arguments, toolName);
  const nameText =
    keyArg && !String(card.name).includes("(")
      ? `${card.name}(${keyArg})`
      : card.name;

  const sections = [];
  if (card.arguments != null && card.arguments !== "")
    sections.push(["Arguments", formatDetail(card.arguments)]);
  if (card.summary) sections.push(["Summary", String(card.summary)]);
  if (card.result) sections.push(["Result", formatDetail(card.result)]);

  return (
    <div
      className={cn(
        "border border-[var(--border-default)] rounded-lg bg-[var(--bg-primary)] dark:bg-[var(--bg-secondary)] my-2 overflow-hidden",
        card.status === "error" && "border-[var(--accent-red)]/40",
        card.status === "blocked" && "border-[var(--accent-orange)]/40",
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none text-[13px] hover:bg-[var(--bg-hover)]"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="w-[18px] h-[18px] flex items-center justify-center text-xs rounded shrink-0">
          {icon}
        </span>
        <span className="font-mono text-xs font-semibold text-[var(--text-primary)] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap flex-1">
          {nameText}
        </span>
        {card.durationMs != null && (
          <span className="text-[11px] text-[var(--text-muted)] font-mono ml-auto shrink-0">
            {formatDuration(card.durationMs)}
          </span>
        )}
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            STATUS_STYLES[card.status] || "bg-[var(--muted)]",
          )}
        />
      </div>

      {/* Collapsible body */}
      {open && (
        <div className="px-3 py-2.5 border-t border-[var(--border-default)]">
          {sections.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">
              No details yet
            </div>
          ) : (
            sections.map(([label, value], i) => (
              <div key={i}>
                <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-[0.4px] text-[var(--text-muted)]">
                  {label}
                </div>
                <pre className="m-0 p-2 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-mono text-xs leading-relaxed max-h-100 overflow-x-auto whitespace-pre-wrap break-words">
                  {value}
                </pre>
              </div>
            ))
          )}
        </div>
      )}

      {/* Summary when collapsed */}
      {card.summary && !open && (
        <div className="px-3 pb-2 text-xs text-[var(--text-secondary)]">
          {card.summary}
        </div>
      )}
    </div>
  );
}
