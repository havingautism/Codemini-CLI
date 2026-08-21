import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Circuitry,
  CheckCircle,
  FlowArrow,
  GearSix,
  Terminal,
} from "@/lib/icons";
import { t } from "../../i18n/index.js";

const FEATURES = [
  {
    icon: FlowArrow,
    title: "aboutFeatureRuntime",
    text: "aboutFeatureRuntimeDesc",
  },
  {
    icon: CheckCircle,
    title: "aboutFeatureApprovals",
    text: "aboutFeatureApprovalsDesc",
  },
  {
    icon: Circuitry,
    title: "aboutFeatureMemory",
    text: "aboutFeatureMemoryDesc",
  },
  {
    icon: GearSix,
    title: "aboutFeatureConfig",
    text: "aboutFeatureConfigDesc",
  },
];

export function AboutDialog({ open, onOpenChange, version }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{t("aboutTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <img
              src="/logos/codemini_logo.png"
              alt="Codemini"
              className="size-20 shrink-0 rounded-[18px] border border-(--border-default) bg-(--bg-secondary) p-1.5"
            />
            <div className="min-w-0">
              {/* <div className="text-[12px] font-medium uppercase tracking-[0.18em] text-(--text-muted)">
                {t("aboutEyebrow")}
              </div> */}
              <h2 className="mt-1 text-[24px] font-semibold leading-tight text-(--text-primary)">
                Codemini CLI
              </h2>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-(--text-secondary)">
                {t("aboutTagline")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-md border border-(--border-default) bg-(--bg-secondary) px-3 py-3"
              >
                <div className="flex items-center gap-2 text-[13px] font-semibold text-(--text-primary)">
                  <Icon size={15} />
                  <span>{t(title)}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-(--text-muted)">
                  {t(text)}
                </p>
              </div>
            ))}
          </div>

          <Separator className="bg-(--border-default)" />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-(--text-primary)">
                <Terminal size={14} />
                {t("installation")}
              </h3>
              <pre className="bg-(--bg-secondary) rounded-md border border-(--border-default) px-3 py-2 text-[12px] font-mono overflow-x-auto">
                npm install -g codemini-cli
              </pre>
            </div>

            <div>
              <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-(--text-primary)">
                <Terminal size={14} />
                {t("startWebUI")}
              </h3>
              <pre className="bg-(--bg-secondary) rounded-md border border-(--border-default) px-3 py-2 text-[12px] font-mono overflow-x-auto">
                codemini --web
              </pre>
            </div>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-2">
              {t("basicUsage")}
            </h3>
            <div className="grid gap-2 text-[12px] sm:grid-cols-2">
              <div className="rounded-md bg-(--bg-secondary) px-3 py-2">
                <span className="font-medium text-(--text-primary)">
                  {t("newChat")}
                </span>
                <p className="mt-1 text-(--text-muted)">{t("chatUsage")}</p>
              </div>
              <div className="rounded-md bg-(--bg-secondary) px-3 py-2">
                <span className="font-medium text-(--text-primary)">
                  {t("skills")}
                </span>
                <p className="mt-1 text-(--text-muted)">{t("skillUsage")}</p>
              </div>
              <div className="rounded-md bg-(--bg-secondary) px-3 py-2">
                <span className="font-medium text-(--text-primary)">
                  {t("souls")}
                </span>
                <p className="mt-1 text-(--text-muted)">{t("soulUsage")}</p>
              </div>
              <div className="rounded-md bg-(--bg-secondary) px-3 py-2">
                <span className="font-medium text-(--text-primary)">
                  {t("workspace")}
                </span>
                <p className="mt-1 text-(--text-muted)">
                  {t("workspaceUsage")}
                </p>
              </div>
            </div>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">
              {t("configureModel")}
            </h3>
            <pre className="bg-(--bg-secondary) rounded-md border border-(--border-default) px-3 py-2 text-[12px] font-mono overflow-x-auto">
              codemini config set gateway.base_url &lt;url&gt;{"\n"}
              codemini config set gateway.api_key &lt;token&gt;{"\n"}
              codemini config set model.name &lt;model-id&gt;
            </pre>
            {/* <p className="mt-1.5 text-[12px] text-(--text-muted)">
              {t("configureModelDesc")}
            </p> */}
          </div>
        </div>

        <div className="text-center text-[11px] text-(--text-muted) pt-1">
          Codemini CLI{version ? `@${version}` : ""} — {t("aboutFooter")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
