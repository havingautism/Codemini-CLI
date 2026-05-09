import { useRef, useEffect, useState } from "react";
import { ArrowUp, ArrowDown, GitBranch } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

export function ChatPanel({ messages, projectCwd, skills = [], gitInfo }) {
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setAutoScroll(atBottom);
      setShowBackToTop(el.scrollTop > 400);
      setShowScrollToBottom(!atBottom && el.scrollTop > 100);
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [messages, autoScroll]);

  return (
    <div className="flex-1 relative overflow-hidden">
      {messages.length === 0 && (
        <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-[min(760px,calc(100%-48px))] text-center pointer-events-none">
          <h1 className="text-[clamp(24px,2.4vw,36px)] font-medium leading-tight tracking-normal">
            {t("buildInProject").replace("{{project}}", projectCwd || "qurio-coder")}
          </h1>
          {gitInfo?.isGit && (
            <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-(--text-muted)">
              <span className="inline-flex items-center gap-1.5">
                <GitBranch size={13} />
                <span>{gitInfo.branch}</span>
              </span>
              {gitInfo.dirty ? (
                <>
                  {gitInfo.staged > 0 && (
                    <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {t("gitStaged")} {gitInfo.staged}
                    </span>
                  )}
                  {gitInfo.modified > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {t("gitModified")} {gitInfo.modified}
                    </span>
                  )}
                  {gitInfo.untracked > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {t("gitUntracked")} {gitInfo.untracked}
                    </span>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {t("gitClean")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto py-[44px_0_28px] scroll-smooth"
        style={{ scrollbarWidth: "thin" }}
      >
        <div className="w-[min(960px,calc(100%-96px))] mx-auto">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} skills={skills} />
          ))}
        </div>
      </div>
      <div className="absolute right-7 bottom-[220px] flex flex-col gap-2 z-20">
        {showBackToTop && (
          <button
            className="w-9 h-9 rounded-full bg-(--bg-input) border border-(--border-default) cursor-pointer flex items-center justify-center text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) animate-in fade-in-0 zoom-in-95"
            style={{ boxShadow: "var(--shadow-default)" }}
            onClick={() =>
              scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
            }
          >
            <ArrowUp size={16} />
          </button>
        )}
        {showScrollToBottom && (
          <button
            className="w-9 h-9 rounded-full bg-(--bg-input) border border-(--border-default) cursor-pointer flex items-center justify-center text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) animate-in fade-in-0 zoom-in-95"
            style={{ boxShadow: "var(--shadow-default)" }}
            onClick={() => {
              setAutoScroll(true);
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
