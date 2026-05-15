import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import * as api from "@/hooks/use-api";
import { t } from "../../i18n/index.js";

const GENERAL_PROJECT_DIR = "__codemini_general__";

const MODE_OPTIONS = [
  { value: "general", label: t("generalChat") },
  { value: "project", label: t("projectTask") },
];

export function ProjectSelector({ open, onOpenChange, onOpenProject }) {
  const [mode, setMode] = useState("project");
  const [modeOpen, setModeOpen] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [dirData, setDirData] = useState(null);
  const [currentDir, setCurrentDir] = useState("");

  useEffect(() => {
    if (open) {
      api
        .fetchProject()
        .then((data) => {
          const cwd = data.cwd || "";
          if (data.isGeneral) {
            setMode("general");
            setPathInput("");
            setCurrentDir("");
            browseDir("");
          } else {
            setMode("project");
            setPathInput(cwd);
            setCurrentDir(cwd || "");
            browseDir(cwd || "");
          }
        })
        .catch(() => {});
    }
  }, [open]);

  const browseDir = async (dir) => {
    try {
      const data = await api.browseDir(dir);
      const defaultRoot = !dir && !data.path && data.roots?.[0]?.path;
      if (defaultRoot) {
        const rootData = await api.browseDir(defaultRoot);
        setDirData(rootData);
        setCurrentDir(rootData.path ?? defaultRoot);
        setPathInput(rootData.path ?? defaultRoot);
        return;
      }
      setDirData(data);
      setCurrentDir(data.path ?? dir);
    } catch {}
  };

  const handleOpen = () => {
    if (mode === "general") {
      onOpenChange(false);
      onOpenProject(GENERAL_PROJECT_DIR);
      return;
    }
    const p = pathInput.trim();
    if (p) {
      onOpenChange(false);
      onOpenProject(p);
    }
  };

  const normalizedPath = (currentDir || "").replace(/\\/g, "/");
  const isDrivePath = /^[A-Za-z]:($|\/)/.test(normalizedPath);
  const isAbsolute = normalizedPath.startsWith("/") || isDrivePath;
  const parts = normalizedPath.split("/").filter(Boolean);
  const makePathFromParts = (nextParts) => {
    if (!nextParts.length) return "";
    if (/^[A-Za-z]:$/.test(nextParts[0])) {
      return nextParts.length === 1
        ? `${nextParts[0]}/`
        : `${nextParts[0]}/${nextParts.slice(1).join("/")}`;
    }
    return `${isAbsolute ? "/" : ""}${nextParts.join("/")}`;
  };
  const roots = dirData?.roots || [];
  const normalizeRootMatch = (value) =>
    String(value || "")
      .replace(/\\/g, "/")
      .toLowerCase();
  const activeRoot = roots
    .slice()
    .sort(
      (a, b) =>
        normalizeRootMatch(b.path).length - normalizeRootMatch(a.path).length,
    )
    .find((root) => {
      const rootPath = normalizeRootMatch(root.path);
      const dirPath = normalizeRootMatch(currentDir || pathInput);
      return (
        rootPath &&
        (dirPath === rootPath ||
          dirPath.startsWith(
            rootPath.endsWith("/") ? rootPath : `${rootPath}/`,
          ))
      );
    });

  const activeMode =
    MODE_OPTIONS.find((m) => m.value === mode) || MODE_OPTIONS[1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("selectProject")}</DialogTitle>
        </DialogHeader>

        {/* Mode dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setModeOpen(!modeOpen)}
            className="w-full flex items-center justify-between h-9 px-3 rounded-lg border border-(--border-default) bg-(--bg-input) text-[13px] text-(--text-primary) cursor-pointer hover:bg-(--bg-hover)"
          >
            <span className="font-medium">{activeMode.label}</span>
            <ChevronDown size={14} className="text-(--text-muted)" />
          </button>
          {modeOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-(--border-default) bg-(--bg-primary) shadow-lg z-50 p-1">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={cn(
                    "w-full text-left px-3 py-2 my-1 text-[13px] rounded-md cursor-pointer border-0",
                    mode === opt.value
                      ? "bg-(--bg-active) text-(--text-primary) font-medium"
                      : "bg-transparent text-(--text-secondary) hover:bg-(--bg-hover)",
                  )}
                  onClick={() => {
                    setMode(opt.value);
                    setModeOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === "general" ? (
          <div className="flex flex-col items-center gap-4 py-8 text-(--text-muted) text-[13px]">
            <span>{t("generalChatDesc")}</span>
            <Button onClick={handleOpen} className="text-[13px] h-8">
              {t("enterGeneral")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              {roots.length > 0 && (
                <Select
                  value={activeRoot?.path || roots[0]?.path}
                  onValueChange={(nextPath) => {
                    setPathInput(nextPath);
                    browseDir(nextPath);
                  }}
                >
                  <SelectTrigger className="w-[132px] h-8 bg-(--bg-input) text-(--text-primary)">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {roots.map((root) => (
                      <SelectItem key={root.path} value={root.path}>
                        <span className="font-medium">{root.name}</span>
                        <span className="text-(--text-muted) truncate">
                          {root.path}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder={t("enterOrBrowse")}
                onKeyDown={(e) => e.key === "Enter" && handleOpen()}
                className="flex-1 h-8 text-[13px]"
              />
              <Button onClick={handleOpen} className="text-[13px] h-8">
                {t("select")}
              </Button>
            </div>
            <div className="border border-(--border-default) rounded-lg overflow-hidden">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-[12px] px-3 py-2 border-b border-(--border-default) bg-(--bg-secondary) flex-wrap text-(--text-secondary)">
                {parts.map((part, i) => {
                  const segPath = makePathFromParts(parts.slice(0, i + 1));
                  return (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-(--text-muted)">/</span>}
                      <button
                        onClick={() => {
                          setPathInput(segPath);
                          browseDir(segPath);
                        }}
                        className={cn(
                          "hover:underline cursor-pointer border-0 bg-transparent",
                          i === parts.length - 1
                            ? "text-(--text-primary) font-medium"
                            : "text-(--accent-blue)",
                        )}
                      >
                        {part}
                      </button>
                    </span>
                  );
                })}
              </div>
              {/* Directory list */}
              <ScrollArea className="h-[240px]">
                {dirData && (
                  <div className="p-2">
                    {parts.length > 0 && (
                      <button
                        className="w-full text-left px-2 py-1.5 text-[13px] hover:bg-(--bg-hover) rounded cursor-pointer flex items-center gap-2 border-0 bg-transparent text-(--text-secondary)"
                        onClick={() => {
                          const parentPath = makePathFromParts(
                            parts.slice(0, -1),
                          );
                          setPathInput(parentPath);
                          browseDir(parentPath);
                        }}
                      >
                        <span>..</span>
                      </button>
                    )}
                    {/* {(dirData.roots || []).length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        {(dirData.roots || []).map((d) => (
                          <button
                            key={d.path}
                            className="text-left px-3 py-2 text-[13px] hover:bg-(--bg-hover) rounded cursor-pointer flex items-center gap-2 border border-(--border-default) bg-(--bg-input) text-(--text-primary)"
                            onClick={() => {
                              setPathInput(d.path);
                              browseDir(d.path);
                            }}
                          >
                            <span className="font-medium">{d.name}</span>
                            <span className="text-(--text-muted) truncate">{d.path}</span>
                          </button>
                        ))}
                      </div>
                    )} */}
                    {(dirData.dirs || []).map((d) => (
                      <button
                        key={d.path}
                        className="w-full text-left px-2 py-1.5 text-[13px] hover:bg-(--bg-hover) rounded cursor-pointer flex items-center gap-2 border-0 bg-transparent text-(--text-secondary)"
                        onClick={() => {
                          setPathInput(d.path);
                          browseDir(d.path);
                        }}
                      >
                        <span className="flex-1 truncate">{d.name}</span>
                        {d.isGit && (
                          <span className="text-[11px] text-(--text-muted) bg-(--bg-tertiary) px-1.5 py-0.5 rounded">
                            git
                          </span>
                        )}
                      </button>
                    ))}
                    {!(dirData.roots || []).length &&
                      !(dirData.dirs || []).length &&
                      !dirData.error && (
                        <div className="text-center text-[12px] text-(--text-muted) py-4">
                          {t("noSubDirs")}
                        </div>
                      )}
                  </div>
                )}
              </ScrollArea>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
