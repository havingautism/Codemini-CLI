import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  Database,
  FolderOpen,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import * as api from "@/hooks/use-api";
import { t } from "../../../i18n/index.js";

const STORAGE_TARGETS = [
  { id: "global", labelKey: "storageGlobal" },
  { id: "project", labelKey: "storageProject" },
];

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`;
}

export function SettingsStorage({ active }) {
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api.fetchStorageInfo()
      .then((result) => {
        if (cancelled) return;
        if (result?.error) throw new Error(result.message || t("storageLoadFailed"));
        setStorage(result);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError?.message || t("storageLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, refreshRevision]);

  const handleOpen = async (target) => {
    setOpening(target);
    setError("");
    try {
      const result = await api.openStorageFolder(target);
      if (result?.error) throw new Error(result.message || t("storageOpenFailed"));
    } catch (openError) {
      setError(openError?.message || t("storageOpenFailed"));
    } finally {
      setOpening("");
    }
  };

  return (
    <SettingsSection
      title={t("storageOverview")}
      description={t("storageOverviewHelp")}
    >
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRefreshRevision((value) => value + 1)}
          disabled={loading}
        >
          {loading ? <Spinner className="size-3.5" /> : <ArrowClockwise size={15} />}
          {t("refresh")}
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg bg-(--accent-red-bg) px-3 py-2.5 text-[12px] text-(--accent-red)">
          <WarningCircle size={16} className="mt-0.5" weight="fill" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {STORAGE_TARGETS.map((target) => {
          const entry = storage?.[target.id];
          return (
            <div
              key={target.id}
              className="rounded-xl border border-(--border-default) bg-(--bg-subtle) p-3.5"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--badge-bg) text-(--text-secondary)">
                  <Database size={17} weight="duotone" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-(--text-primary)">
                      {t(target.labelKey)}
                    </span>
                    <span className="rounded-md bg-(--badge-bg) px-1.5 py-0.5 text-[11px] text-(--text-muted)">
                      {entry?.exists ? formatBytes(entry.sizeBytes) : t("storageNotCreated")}
                    </span>
                  </div>
                  {target.id === "project" && entry?.projectDir ? (
                    <p className="mt-1 truncate text-[11px] text-(--text-muted)" title={entry.projectDir}>
                      {entry.projectDir}
                    </p>
                  ) : null}
                  <p
                    className="mt-2 break-all rounded-md bg-(--bg-primary) px-2.5 py-2 font-mono text-[11px] leading-relaxed text-(--text-secondary)"
                    title={entry?.path || ""}
                  >
                    {entry?.path || (loading ? t("loading") : "—")}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpen(target.id)}
                  disabled={!entry?.folder || Boolean(opening)}
                >
                  {opening === target.id ? <Spinner className="size-3.5" /> : <FolderOpen size={15} />}
                  {t("storageOpenFolder")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-(--text-muted)">
        {t("storageSizeHelp")}
      </p>
    </SettingsSection>
  );
}
