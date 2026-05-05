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
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";

export function ProjectSelector({ open, onOpenChange, onOpenProject }) {
  const [pathInput, setPathInput] = useState("");
  const [dirData, setDirData] = useState(null);
  const [currentDir, setCurrentDir] = useState("");

  useEffect(() => {
    if (open) {
      api
        .fetchProject()
        .then((data) => {
          setPathInput(data.cwd || "");
          setCurrentDir(data.cwd || "/");
          browseDir(data.cwd || "/");
        })
        .catch(() => {});
    }
  }, [open]);

  const browseDir = async (dir) => {
    try {
      const data = await api.browseDir(dir);
      setDirData(data);
      setCurrentDir(dir);
    } catch {}
  };

  const handleOpen = () => {
    const p = pathInput.trim();
    if (p) {
      onOpenChange(false);
      onOpenProject(p);
    }
  };

  const normalizedPath = (currentDir || "").replace(/\\/g, "/");
  const isAbsolute = normalizedPath.startsWith("/");
  const parts = normalizedPath.split("/").filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>选择项目</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="输入或浏览项目路径..."
            onKeyDown={(e) => e.key === "Enter" && handleOpen()}
            className="flex-1 h-8 text-[13px]"
          />
          <Button onClick={handleOpen} className="text-[13px] h-8">
            选择
          </Button>
        </div>
        <ScrollArea className="h-[280px] border border-(--border-default) rounded-lg">
          {dirData && (
            <div className="p-2">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-[12px] mb-2 px-2 flex-wrap text-(--text-secondary)">
                {parts.map((part, i) => {
                  const segPath =
                    (isAbsolute ? "/" : "") + parts.slice(0, i + 1).join("/");
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

              {/* Parent */}
              {parts.length > 0 && (
                <button
                  className="w-full text-left px-2 py-1.5 text-[13px] hover:bg-(--bg-hover) rounded cursor-pointer flex items-center gap-2 border-0 bg-transparent text-(--text-secondary)"
                  onClick={() => {
                    const parentPath =
                      (isAbsolute ? "/" : "") + parts.slice(0, -1).join("/");
                    setPathInput(parentPath);
                    browseDir(parentPath);
                  }}
                >
                  <span>..</span>
                </button>
              )}

              {/* Directories */}
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

              {!(dirData.dirs || []).length && !dirData.error && (
                <div className="text-center text-[12px] text-(--text-muted) py-4">
                  无子目录
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
