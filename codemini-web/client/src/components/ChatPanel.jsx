import { Suspense, lazy, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { GitBranch } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import { hasConversationContent } from "@/lib/chat-empty-state.js";
import { t } from "../../i18n/index.js";
import { HomeEmptyVisual } from "./HomeEmptyVisual.jsx";
import { HomeEmptyCaption } from "./HomeEmptyCaption.jsx";

const MessageBubble = lazy(() =>
  import("./MessageBubble").then((module) => ({
    default: module.MessageBubble,
  })),
);

function truncate(text, max = 36) {
  const s = String(text || "")
    .replace(/\n/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function UserMessageNav({ userMessages, activeNavIndex, scrollToMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const hideTimerRef = useRef(null);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setExpanded(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => {
      setExpanded(false);
      setHoveredIndex(-1);
    }, 150);
  }, []);

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  if (userMessages.length <= 1) return null;

  return (
    <div
      className="fixed right-5 top-1/2 -translate-y-1/2 pointer-events-auto z-30 flex items-center gap-1"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Expanded card */}
      {expanded && (
        <div className="flex flex-col gap-px rounded-lg bg-(--bg-primary) border border-(--border-default) p-1.5 max-w-[180px] max-h-[60vh] overflow-y-auto shadow-[var(--shadow-default)]">
          {userMessages.map((um, i) => (
            <button
              key={um.id}
              onClick={() => scrollToMessage(um.id)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(-1)}
              className={cn(
                "text-left text-[11px] leading-tight px-2 py-1 rounded-md truncate transition-colors cursor-pointer max-w-full",
                i === activeNavIndex ? "text-primary" : "text-(--text-muted)",
                hoveredIndex === i && "bg-primary/10 text-primary",
              )}
            >
              {um.text || "..."}
            </button>
          ))}
        </div>
      )}

      {/* Tick-mark indicators */}
      <div className="flex flex-col items-end gap-6 py-1">
        {userMessages.map((um, i) => (
          <button
            key={um.id}
            onClick={() => scrollToMessage(um.id)}
            className={cn(
              "h-0.5 rounded-sm transition-all duration-150 cursor-pointer",
              i === activeNavIndex
                ? "w-5 bg-primary"
                : hoveredIndex === i
                  ? "w-4 bg-primary/50"
                  : "w-3 bg-(--text-muted)",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ChatPanelContent({
  messages,
  projectCwd,
  skills = [],
  gitInfo,
  messagesLoading,
  isGeneral = false,
  onRetryMessage,
}) {
  const scrollRef = useRef(null);
  const [activeNavIndex, setActiveNavIndex] = useState(-1);
  const { pauseFollowEnd } = useMessageScroller();
  const hasConversation = useMemo(
    () => hasConversationContent(messages),
    [messages],
  );

  const userMessages = useMemo(
    () =>
      messages
        .filter((m) => m.role === "you")
        .map((m) => ({
          id: m.id,
          text: truncate(
            m.text ||
              m.segments
                ?.filter((s) => s.type === "text")
                .map((s) => s.text)
                .join("") ||
              "",
          ),
        })),
    [messages],
  );

  const scrollToMessage = useCallback((msgId) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${msgId}"]`);
    if (el) {
      pauseFollowEnd();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [pauseFollowEnd]);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const userEls = el.querySelectorAll(
      '[data-message-id][class*="justify-end"]',
    );
    if (userEls.length === 0) {
      setActiveNavIndex(-1);
      return;
    }
    // Use getBoundingClientRect instead of offsetTop because
    // MessageScrollerItem has content-visibility:auto which skips
    // layout for off-screen items, causing offsetTop to return 0
    // for elements inside skipped containers.
    const viewportRect = el.getBoundingClientRect();
    const midLine = viewportRect.top + viewportRect.height * 0.4;
    let last = -1;
    userEls.forEach((uel, i) => {
      if (uel.getBoundingClientRect().top <= midLine) last = i;
    });
    setActiveNavIndex(last);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    return () => {
      el.removeEventListener("scroll", updateScrollState);
    };
  }, [updateScrollState]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(updateScrollState);
    });
  }, [messages, messagesLoading, updateScrollState]);

  return (
    <div className="flex-1 relative overflow-hidden">
      {messagesLoading && !hasConversation && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Spinner />
        </div>
      )}
      {!messagesLoading && !hasConversation && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {isGeneral ? (
            <HomeEmptyVisual mode="general">
              <HomeEmptyCaption
                promptKey="askAnythingGeneralPrompts"
                className="codemini-home-empty-title mx-auto max-w-[320px] sm:max-w-none text-[20px] sm:text-[26px] font-medium leading-tight tracking-normal text-(--text-primary) break-words"
              />
            </HomeEmptyVisual>
          ) : (
            <HomeEmptyVisual mode="project">
              <HomeEmptyCaption
                promptKey="buildInProjectPrompts"
                vars={{ project: projectCwd || "qurio-coder" }}
                className="codemini-home-empty-title mx-auto max-w-[320px] sm:max-w-none text-[20px] sm:text-[26px] font-medium leading-tight tracking-normal text-(--text-primary) break-words"
              />
              {gitInfo?.isGit && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[12px] text-(--text-muted)">
                  <span className="inline-flex items-center gap-1.5">
                    <GitBranch size={13} />
                    <span>{gitInfo.branch}</span>
                  </span>
                  {gitInfo.dirty ? (
                    <>
                      {gitInfo.staged > 0 && (
                        <span className="inline-flex items-center gap-1 text-(--accent-green)">
                          <span className="size-1.5 rounded-full bg-current" />
                          {t("gitStaged")} {gitInfo.staged}
                        </span>
                      )}
                      {gitInfo.modified > 0 && (
                        <span className="inline-flex items-center gap-1 text-(--accent-orange)">
                          <span className="size-1.5 rounded-full bg-current" />
                          {t("gitModified")} {gitInfo.modified}
                        </span>
                      )}
                      {gitInfo.untracked > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-current" />
                          {t("gitUntracked")} {gitInfo.untracked}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-(--accent-green)" />
                      {t("gitClean")}
                    </span>
                  )}
                </div>
              )}
            </HomeEmptyVisual>
          )}
        </div>
      )}
      <MessageScroller>
        <MessageScrollerViewport ref={scrollRef}>
          <MessageScrollerContent className="gap-0 py-[32px_0_24px]">
            <div className="w-[calc(100%_-_32px)] max-w-[920px] sm:w-[calc(100%_-_64px)] mx-auto">
              <Suspense fallback={null}>
                {messages.map((msg) => (
                  <MessageScrollerItem key={msg.id}>
                    <MessageBubble
                      message={msg}
                      skills={skills}
                      onRetry={onRetryMessage}
                    />
                  </MessageScrollerItem>
                ))}
              </Suspense>
            </div>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="bottom-2" />
      </MessageScroller>
      <UserMessageNav
        userMessages={userMessages}
        activeNavIndex={activeNavIndex}
        scrollToMessage={scrollToMessage}
      />
    </div>
  );
}

export function ChatPanel(props) {
  return (
    <MessageScrollerProvider>
      <ChatPanelContent {...props} />
    </MessageScrollerProvider>
  );
}
