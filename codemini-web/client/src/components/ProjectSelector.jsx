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
import * as api from "@/hooks/use-api";
import { t } from "../../i18n/index.js";

function formatRootLabel(root) {
  if (!root) return "";
  const name = String(root.name || "").trim();
  if (root.isDrive || /^[A-Za-z]:$/i.test(name)) {
    const letter = (name.charAt(0) || String(root.path || "").charAt(0)).toUpperCase();
    return letter ? `${letter}:\\` : name;
  }
  if (name === "/" || String(root.path || "") === "/") return "/";
  return name || String(root.path || "");
}

export function ProjectSelector({ open, onOpenChange, onOpenProject }) {
  const [pathInput, setPathInput] = useState("");
  const [dirData, setDirData] = useState(null);
  const [currentDir, setCurrentDir] = useState("");

  useEffect(() => {
    if (open) {
      api
        .fetchProject()
        .then((data) => {
          const cwd = data.isGeneral ? "" : data.cwd || "";
          setPathInput(cwd);
          setCurrentDir(cwd);
          browseDir(cwd);
        })
        .catch(() => {
          setPathInput("");
          setCurrentDir("");
          browseDir("");
        });
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
    const p = pathInput.trim();
    if (!p) return;
    onOpenChange(false);
    onOpenProject(p);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("selectProject")}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          {roots.length > 0 && (
            <Select
              value={activeRoot?.path || roots[0]?.path}
              onValueChange={(nextPath) => {
                setPathInput(nextPath);
                browseDir(nextPath);
              }}
            >
              <SelectTrigger className="w-[4.75rem] shrink-0 h-8 px-2.5 bg-(--bg-input) text-(--text-primary)">
                <SelectValue>{formatRootLabel(activeRoot || roots[0])}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[4.75rem]">
                {roots.map((root) => (
                  <SelectItem
                    key={root.path}
                    value={root.path}
                    textValue={root.path}
                    className="pr-8"
                  >
                    {formatRootLabel(root)}
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
          <ScrollArea className="h-[240px]">
            {dirData && (
              <div className="p-2">
                {parts.length > 0 && (
                  <button
                    className="w-full text-left px-2 py-1.5 text-[13px] hover:bg-(--bg-hover) rounded cursor-pointer flex items-center gap-2 border-0 bg-transparent text-(--text-secondary)"
                    onClick={() => {
                      const parentPath = makePathFromParts(parts.slice(0, -1));
                      setPathInput(parentPath);
                      browseDir(parentPath);
                    }}
                  >
                    <span>..</span>
                  </button>
                )}
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
      </DialogContent>
    </Dialog>
  );
}
