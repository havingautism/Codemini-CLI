import {
  Article,
  Bug,
  CaretRight,
  Check,
  CircleNotch,
  Code,
  Compass,
  Eye,
  Flask,
  Lightbulb,
  ListChecks,
  MagnifyingGlass,
  PencilLine,
  Recycle,
  X,
} from "@/lib/icons";

/** Role glyph shown in the step badge (pending / as base for status overlays). */
export const ROLE_STEP_ICONS = {
  planner: ListChecks,
  explorer: Compass,
  architect: MagnifyingGlass,
  coder: Code,
  refactorer: Recycle,
  reviewer: Eye,
  tester: Flask,
  advisor: Lightbulb,
  debugger: Bug,
  writer: PencilLine,
  summarizer: Article,
};

export function PlanStepStatusGlyph({ step, index = 0 }) {
  const status = String(step?.status || "pending");
  const role = String(step?.role || "").toLowerCase();
  const RoleIcon = ROLE_STEP_ICONS[role];

  if (status === "done") {
    return <Check size={11} weight="bold" aria-hidden />;
  }
  if (status === "failed") {
    return <X size={11} weight="bold" aria-hidden />;
  }
  if (status === "running") {
    return (
      <CircleNotch size={11} weight="bold" className="animate-spin" aria-hidden />
    );
  }
  if (RoleIcon) {
    return <RoleIcon size={11} weight="regular" aria-hidden />;
  }
  if (status === "pending") {
    return (
      <span className="text-[10px] font-medium leading-none tabular-nums">
        {index + 1}
      </span>
    );
  }
  return <CaretRight size={10} weight="fill" aria-hidden />;
}
