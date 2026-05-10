import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { t } from "../../i18n/index.js";

export function AboutDialog({ open, onOpenChange, version }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("aboutTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-[13px] text-(--text-secondary) leading-relaxed">
          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">
              {t("installation")}
            </h3>
            <pre className="bg-(--bg-secondary) rounded-lg px-3 py-2 text-[12px] font-mono overflow-x-auto">
              npm install -g codemini-cli
            </pre>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">
              {t("startWebUI")}
            </h3>
            <pre className="bg-(--bg-secondary) rounded-lg px-3 py-2 text-[12px] font-mono overflow-x-auto">
              codemini --web
            </pre>
            <p className="mt-1.5 text-[12px] text-(--text-muted)">
              {t("startWebUIDesc")}
            </p>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">
              {t("basicUsage")}
            </h3>
            <ul className="space-y-1.5 text-[12px]">
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">
                  {t("newChat")}
                </span>
                <span>{t("chatUsage")}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">
                  {t("skills")}
                </span>
                <span>{t("skillUsage")}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">
                  {t("souls")}
                </span>
                <span>{t("soulUsage")}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">
                  {t("mode")}
                </span>
                <span>
                  <code className="bg-(--bg-tertiary) px-1 rounded text-[11px]">
                    {t("normalMode")}
                  </code>{" "}
                  {t("modeUsage")}
                  <code className="bg-(--bg-tertiary) px-1 rounded text-[11px]">
                    {t("autoModeAbout")}
                  </code>{" "}
                  {t("modeUsageAuto")}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">
                  {t("workspace")}
                </span>
                <span>{t("workspaceUsage")}</span>
              </li>
            </ul>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">
              {t("configureModel")}
            </h3>
            <pre className="bg-(--bg-secondary) rounded-lg px-3 py-2 text-[12px] font-mono overflow-x-auto">
              codemini config set model.name &lt;model-id&gt;
            </pre>
            <p className="mt-1.5 text-[12px] text-(--text-muted)">
              {t("configureModelDesc")}
            </p>
          </div>
        </div>

        <div className="text-center text-[11px] text-(--text-muted) pt-2">
          Codemini CLI{version ? `@${version}` : ""} — Coding assistant
          optimized for small-model workflows
        </div>
      </DialogContent>
    </Dialog>
  );
}
