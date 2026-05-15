import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PatchDiff } from "@pierre/diffs/react";
import { fetchGitDiff } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

const statusColors = {
  M: "text-amber-600 dark:text-amber-400",
  A: "text-green-600 dark:text-green-400",
  D: "text-red-600 dark:text-red-400",
  "?": "text-(--text-muted)",
};

const statusLabels = {
  M: () => t("gitDiffModified"),
  A: () => t("gitDiffStaged"),
  D: () => t("gitDiffDeleted"),
  "?": () => t("gitDiffUntracked"),
};

export function GitDiffDialog({ open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  const getIsDark = useCallback(
    () =>
      document.documentElement.classList.contains("dark") ||
      document.documentElement.dataset.theme === "dark",
    [],
  );
  const [isDark, setIsDark] = useState(getIsDark);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ob = new MutationObserver(() => setIsDark(getIsDark()));
    ob.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => ob.disconnect();
  }, [getIsDark]);

  const getPatchForFile = useCallback(
    (filePath) => {
      if (!data?.patch || !filePath) return "";
      const lines = data.patch.split("\n");
      const result = [];
      let inFile = false;
      for (const line of lines) {
        if (line.startsWith("diff --git ")) {
          const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
          if (match && (match[1] === filePath || match[2] === filePath)) {
            inFile = true;
            result.push(line);
          } else {
            inFile = false;
          }
        } else if (inFile) {
          result.push(line);
        }
      }
      return result.join("\n");
    },
    [data?.patch],
  );

  const filesWithDiff = useMemo(() => {
    if (!Array.isArray(data?.files)) return [];
    return data.files.filter((file) => getPatchForFile(file.path).trim());
  }, [data?.files, getPatchForFile]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setSelectedFile(null);
      return;
    }
    setLoading(true);
    fetchGitDiff()
      .then((res) => {
        setData(res);
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!filesWithDiff.length) {
      setSelectedFile(null);
      return;
    }
    if (
      !selectedFile ||
      !filesWithDiff.some((file) => file.path === selectedFile)
    ) {
      setSelectedFile(filesWithDiff[0].path);
    }
  }, [filesWithDiff, open, selectedFile]);

  const patchForFile = useMemo(() => {
    return getPatchForFile(selectedFile);
  }, [getPatchForFile, selectedFile]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle>{t("gitDiffTitle")}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12 text-(--text-muted) text-[13px]">
            {t("gitDiffLoading")}
          </div>
        ) : !filesWithDiff.length ? (
          <div className="flex-1 flex items-center justify-center py-12 text-(--text-muted) text-[13px]">
            {t("gitDiffNoChanges")}
          </div>
        ) : (
          <div className="flex-1 flex min-h-0 border-t border-(--border-default)">
            {/* File list sidebar */}
            <div className="w-[220px] shrink-0 border-r border-(--border-default) overflow-y-auto py-1">
              {filesWithDiff.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setSelectedFile(f.path)}
                  className={cn(
                    "w-full text-left px-1 m-1 py-1.5 text-[12px] rounded-md cursor-pointer flex items-center gap-2 border-0 bg-transparent",
                    selectedFile === f.path
                      ? "bg-(--bg-hover) text-(--text-primary)"
                      : "text-(--text-secondary) hover:bg-(--bg-hover)",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-mono w-[14px] text-center",
                      statusColors[f.status] || "",
                    )}
                  >
                    {f.status === "?" ? "U" : f.status}
                  </span>
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
            </div>

            {/* Diff content */}
            <div className="flex-1 overflow-auto">
              {patchForFile ? (
                <PatchDiff
                  patch={patchForFile}
                  options={{
                    theme: { dark: "pierre-dark", light: "pierre-light" },
                    themeType: isDark ? "dark" : "light",
                    diffStyle: "unified",
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-(--text-muted) text-[12px]">
                  {t("gitDiffNoDiffAvailable")}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
