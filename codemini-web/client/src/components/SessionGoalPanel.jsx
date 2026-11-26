import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GitBranch } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { fetchSessionGoal } from "@/hooks/use-api.js";
import { layoutGoalGraph } from "@/lib/goal-graph.js";

const statusLabel = {
  pending: "待执行", running: "执行中", delivered: "已交付", verified: "已验收",
  interrupted: "已中断", failed: "失败", completed: "通过", continue: "需继续",
  pause: "暂停", unreachable: "无法达成",
};
const evidenceLabel = { pass: "通过", fail: "失败", environment_error: "环境异常", change: "文件变更", observation: "观测" };

function EvidenceList({ records }) {
  return <ul className="my-1 list-none space-y-1.5 border-l border-(--separator) pl-3">
    {records.map(record => (
      <li key={record.id}>
        <span className="text-(--text-secondary)">{[evidenceLabel[record.kind] || record.kind, record.source, record.artifactPath].filter(Boolean).join(" · ")}</span>
        {Number.isInteger(record.exitCode) && <span> · 退出码 {record.exitCode}</span>}
        <p className="whitespace-pre-wrap">{record.summary}</p>
        <code className="text-[11px] text-(--text-muted)">{record.id}</code>
        {record.revalidatedFrom && <p>重新核对自 <code>{record.revalidatedFrom}</code></p>}
      </li>
    ))}
  </ul>;
}

function TaskAttempts({ task, tasks, criteria }) {
  const dependencies = task.dependsOn.map(id => tasks.find(item => item.id === id)?.title || id);
  const criterionLabel = id => {
    const criterion = criteria?.find(item => item.id === id);
    return criterion?.text ? `${id} · ${criterion.text}` : id;
  };
  return <section className="min-w-0 space-y-2 border-t border-(--separator) pt-4 text-[13px] [overflow-wrap:anywhere]" aria-label="任务详情">
    <h3 className="font-semibold">{task.title}</h3>
    <p className="text-(--text-secondary)">{task.id} · {statusLabel[task.status] || task.status}</p>
    {dependencies.length > 0 && <p>前置任务：{dependencies.join("、")}</p>}
    {task.criterionIds.length > 0 && <div><h4 className="font-medium">验收条件</h4>
      <ul>{task.criterionIds.map(id => <li key={id}>{criterionLabel(id)}</li>)}</ul>
    </div>}
    {task.reviewReason && <p>{task.reviewReason}</p>}
    {!task.attempts.length && <p className="text-(--text-muted)">尚无执行记录。</p>}
    {task.attempts.map((attempt, index) => (
      <details key={attempt.id} open={index === task.attempts.length - 1} className="rounded-lg border border-(--separator) p-3">
        <summary className="cursor-pointer font-medium">
          第 {index + 1} 次尝试 · {attempt.owner === "main" ? "主代理" : "子代理"} · {statusLabel[attempt.status] || attempt.status}
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-(--text-secondary)">第 {attempt.iteration} 轮{attempt.model && ` · ${attempt.model}`} · {attempt.id}</p>
          {attempt.handoff && <div><h4 className="font-medium">交接记录</h4>
            {attempt.handoff.summary && <p className="whitespace-pre-wrap">{attempt.handoff.summary}</p>}
            {attempt.handoff.path && <code>{attempt.handoff.path}</code>}
          </div>}
          <div><h4 className="font-medium">本次取得的证据</h4>
            {attempt.evidence.length ? <EvidenceList records={attempt.evidence} /> : <p className="text-(--text-muted)">暂无归属于这次尝试的证据。</p>}
          </div>
          {attempt.reviews.map((review, reviewIndex) => (
            <div key={reviewIndex} className="border-t border-(--separator) pt-2">
              <h4 className="font-medium">第 {reviewIndex + 1} 次验收 · {statusLabel[review.decision] || review.decision}
                {review.workspaceOnly && " · 工作区部分"}
                {review.decision === "completed" && (review.current ? "（当前有效）" : "（历史记录）")}
              </h4>
              <p>{review.gatekeeperModel}{review.gatekeeperModel && review.reason && " · "}{review.reason}</p>
              {review.checks.map(check => <div key={check.criterionId} className="mt-1">
                <span className="text-(--text-secondary)">验收引用 · {criterionLabel(check.criterionId)}</span>
                <EvidenceList records={check.evidence} />
                {check.evidenceIds.filter(id => !check.evidence.some(record => record.id === id))
                  .map(id => <p key={id}>{id} · 仅有引用编号</p>)}
              </div>)}
            </div>
          ))}
        </div>
      </details>
    ))}
  </section>;
}

function GoalGraph({ goal }) {
  const [selectedId, select] = useState(null);
  const selected = goal.tasks.find(item => item.id === selectedId) || goal.tasks[0];
  const graph = useMemo(() => layoutGoalGraph(goal.tasks), [goal.tasks]);
  const arrow = useId().replaceAll(":", "");
  return <Dialog>
    <DialogTrigger asChild>
      <Button type="button" size="sm" variant="ghost"><GitBranch size={14} />任务依赖图 · {goal.tasks.length}</Button>
    </DialogTrigger>
    <DialogContent closeOnOutsideClick className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)] px-4 pb-4 sm:max-w-3xl sm:px-6">
      <DialogHeader>
        <DialogTitle>任务依赖图</DialogTitle>
        <DialogDescription className="break-words">{goal.objective}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto">
        <p className="text-xs text-(--text-secondary)">箭头从前置任务指向后续任务。选择任务可查看每次尝试和证据。</p>
        <div className="max-h-[42dvh] min-w-0 overflow-auto rounded-lg border border-(--separator) bg-(--bg-primary)" role="group" aria-label="任务与依赖">
          <div className="relative" style={{ width: graph.width, height: graph.height }}>
            <svg aria-hidden="true" width={graph.width} height={graph.height} className="pointer-events-none absolute inset-0 text-(--text-secondary)">
              <defs><marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker></defs>
              {graph.edges.map(({ from, to, path }) => <path key={`${from.id}/${to.id}`} d={path} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${arrow})`} />)}
            </svg>
            {graph.nodes.map(({ task, x, y }) => <button key={task.id} type="button" title={task.title} onClick={() => select(task.id)}
              aria-pressed={selected.id === task.id} aria-label={`${task.title}，${statusLabel[task.status] || task.status}`}
              className="absolute flex cursor-pointer flex-col justify-center gap-1 rounded-lg border border-(--separator) bg-(--material-elevated) px-3 text-left text-[13px] aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary focus-visible:outline-2 focus-visible:outline-primary"
              style={{ top: y, left: x, width: graph.nodeWidth, height: graph.nodeHeight }}>
              <span className="w-full truncate font-medium">{task.title}</span>
              <span className="text-xs text-(--text-secondary)">{statusLabel[task.status] || task.status}</span>
            </button>)}
          </div>
        </div>
        <TaskAttempts key={selected.id} task={selected} tasks={goal.tasks} criteria={goal.criteria} />
      </div>
    </DialogContent>
  </Dialog>;
}

export function SessionGoalPanel({ sessionId, revision, busy, submit }) {
  const [goal, setGoal] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const lock = useRef(false);
  const refresh = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let fetching = false;
    refresh.current = async () => {
      pending = true;
      if (fetching) return;
      fetching = true;
      // 同时到达的多条变化只追加一次读取，当前请求完成前继续显示已有视图。
      while (pending && !controller.signal.aborted) {
        pending = false;
        try {
          const result = await fetchSessionGoal(sessionId, controller.signal);
          if (controller.signal.aborted) break;
          setGoal(result.goal);
          setLoadError(false);
        } catch {
          if (!controller.signal.aborted) setLoadError(true);
        }
      }
      fetching = false;
    };
    return () => { controller.abort(); refresh.current = null; };
  }, [sessionId]);
  useEffect(() => { void refresh.current?.(); }, [sessionId, revision]);

  const retryId = goal?.retryVerificationId;
  async function retryVerification() {
    if (lock.current || busy || loadError || !retryId) return;
    lock.current = true;
    setRetrying(true);
    setActionError("");
    try {
      const result = await submit(`/goal retry-verification ${retryId}`, { sessionId });
      if (result?.error) setActionError(result.text || "未能重试验收。");
    } catch {
      setActionError("未能提交验收重试，请检查会话连接。");
    } finally {
      lock.current = false;
      setRetrying(false);
      void refresh.current?.();
    }
  }

  if (!goal?.tasks.length && !retryId && !loadError && !actionError) return null;
  return <section aria-label="会话目标" className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
    {Boolean(goal?.tasks.length) && <GoalGraph key={goal.id} goal={goal} />}
    {retryId && <><span>总验收超时</span>
      <Button type="button" size="sm" variant="outline" onClick={retryVerification} disabled={busy || retrying || loadError}>
        {retrying ? "正在重试验收…" : "只重试验收"}
      </Button></>}
    {loadError && <><span role="status">无法读取目标状态。</span>
      <Button type="button" size="sm" variant="ghost" onClick={() => refresh.current?.()}>重新加载</Button></>}
    {actionError && <p role="alert">{actionError}</p>}
  </section>;
}
