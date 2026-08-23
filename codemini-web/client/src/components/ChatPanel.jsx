import { Suspense, lazy, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { GitBranch } from "@/lib/icons";
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
import { hasConversationContent, isSupersededWaitingResponse } from "@/lib/chat-empty-state.js";
import { getActiveMessageIndex } from "@/lib/chat-navigation.js";
import { t } from "../../i18n/index.js";
import { useGitWorkspace } from "@/hooks/use-git-workspace.js";
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

function resolveUserAnchorId(messages, messageId) {
  const targetIndex = messages.findIndex((message) => message?.id === messageId);
  if (targetIndex < 0) return messageId;
  if (messages[targetIndex]?.role === "you") return messageId;
  const userMessage = [...messages.slice(0, targetIndex)]
    .reverse()
    .find((message) => message?.role === "you");
  return userMessage?.id || messageId;
}

function isAnchorReady(viewport, anchorId) {
  const anchorEl = viewport?.querySelector(`[data-message-id="${anchorId}"]`);
  if (!anchorEl) return false;
  const itemEl = anchorEl.closest('[data-slot="message-scroller-item"]');
  return (itemEl?.getBoundingClientRect().height || anchorEl.getBoundingClientRect().height) > 48;
}

function UserMessageNav({ userMessages, activeNavIndex, scrollToMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const hideTimerRef = useRef(null);
  const currentPosition = activeNavIndex >= 0 ? activeNavIndex + 1 : 1;
  const positionLabel = t("quickJumpPosition")
    .replace("{current}", currentPosition)
    .replace("{total}", userMessages.length);

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

  const handleFocusCapture = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setExpanded(true);
  }, []);

  const handleBlurCapture = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setExpanded(false);
    setHoveredIndex(-1);
  }, []);

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  if (userMessages.length <= 1) return null;

  return (
    <nav
      aria-label={t("quickJump")}
      className="pointer-events-auto absolute right-2 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      {expanded && (
        <div className="max-h-[60vh] w-48 overflow-hidden rounded-xl bg-(--material-elevated) p-1.5 shadow-[var(--shadow-elevated)] backdrop-blur-xl">
          <div className="flex h-7 items-center gap-2 px-2 text-[10px] text-(--text-muted)">
            <span className="min-w-0 flex-1 truncate font-medium">{t("quickJump")}</span>
            <span className="shrink-0 tabular-nums">{positionLabel}</span>
          </div>
          <div className="flex max-h-[calc(60vh-2.25rem)] flex-col gap-1 overflow-y-auto">
            {userMessages.map((um, i) => {
              const isActive = i === activeNavIndex;
              const messageText = um.text || "...";
              return (
                <button
                  key={um.id}
                  type="button"
                  data-quick-jump-id={um.id}
                  aria-current={isActive ? "location" : undefined}
                  aria-label={`${i + 1}. ${messageText}`}
                  title={messageText}
                  onClick={() => scrollToMessage(um.id)}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(-1)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                    isActive
                      ? "bg-primary/10 text-(--text-primary)"
                      : "text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full transition-colors",
                      isActive ? "bg-primary" : "bg-(--text-muted) opacity-45",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{messageText}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col items-end gap-1 rounded-full px-1 py-2 transition-[background-color,box-shadow] hover:bg-(--bg-primary)/85 hover:shadow-[var(--shadow-default)] focus-within:bg-(--bg-primary)/85 focus-within:shadow-[var(--shadow-default)]">
        {userMessages.map((um, i) => (
          <button
            key={um.id}
            type="button"
            data-quick-jump-id={um.id}
            aria-current={i === activeNavIndex ? "location" : undefined}
            aria-label={`${t("quickJump")} ${i + 1}: ${um.text || "..."}`}
            title={um.text || "..."}
            onClick={() => scrollToMessage(um.id)}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(-1)}
            className="group flex h-4 w-7 cursor-pointer items-center justify-end rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-0.5 rounded-full transition-[width,background-color] duration-150",
                i === activeNavIndex
                  ? "w-5 bg-primary"
                  : hoveredIndex === i
                    ? "w-4 bg-primary/60"
                    : "w-2 bg-(--text-muted) opacity-70 group-hover:w-3 group-hover:opacity-100",
              )}
            />
          </button>
        ))}
      </div>
    </nav>
  );
}

function GitWorkspaceHint() {
  const git = useGitWorkspace();
  if (git.isLoading) {
    return (
      <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-(--text-muted)">
        <Spinner className="size-3.5" />
        <span>{t("gitDiffLoading")}</span>
      </div>
    );
  }
  if (git.isError) {
    return (
      <p className="mt-3 text-center text-[12px] text-(--accent-red)">
        {git.error || t("gitStatusLoadFailed")}
      </p>
    );
  }
  if (!git.isGit) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[12px] text-(--text-muted)">
      <span className="inline-flex items-center gap-1.5">
        <GitBranch size={13} />
        <span>{git.branch}</span>
      </span>
      {git.dirty ? (
        <>
          {git.staged > 0 && (
            <span className="inline-flex items-center gap-1 text-(--accent-green)">
              <span className="size-1.5 rounded-full bg-current" />
              {t("gitStaged")} {git.staged}
            </span>
          )}
          {git.modified > 0 && (
            <span className="inline-flex items-center gap-1 text-(--accent-orange)">
              <span className="size-1.5 rounded-full bg-current" />
              {t("gitModified")} {git.modified}
            </span>
          )}
          {git.untracked > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-current" />
              {t("gitUntracked")} {git.untracked}
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
  );
}

function ChatPanelContent({
  messages,
  projectCwd,
  skills = [],
  messagesLoading,
  isGeneral = false,
  targetMessageId = "",
  dockedTodoMessageId = "",
  busy = false,
  onTargetMessageHandled,
  onRetryMessage,
}) {
  const scrollRef = useRef(null);
  const settleTimerRef = useRef(0);
  const jumpFinishTimerRef = useRef(0);
  const scrollRafRef = useRef(0);
  const measureCacheRef = useRef({ scrollTop: 0, rects: new Map() });
  const [activeNavIndex, setActiveNavIndex] = useState(-1);
  const [pendingScrollTargetId, setPendingScrollTargetId] = useState("");
  const [layoutSettled, setLayoutSettled] = useState(false);
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

  const scrollToMessage = useCallback((msgId, { behavior = "smooth" } = {}) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${msgId}"]`);
    if (!el) return;
    pauseFollowEnd();
    const targetIndex = userMessages.findIndex((message) => message.id === msgId);
    if (targetIndex >= 0) setActiveNavIndex(targetIndex);
    el.scrollIntoView({ behavior, block: "center" });
  }, [pauseFollowEnd, userMessages]);

  const measureScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const userEls = el.querySelectorAll(
      '[data-message-id][class*="justify-end"]',
    );
    const isAtTop = el.scrollTop <= 2;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    // Use getBoundingClientRect instead of offsetTop because
    // MessageScrollerItem has content-visibility:auto which skips
    // layout for off-screen items, causing offsetTop to return 0
    // for elements inside skipped containers.
    const viewportRect = el.getBoundingClientRect();
    const cache = measureCacheRef.current;
    const delta = el.scrollTop - cache.scrollTop;
    cache.scrollTop = el.scrollTop;
    // Only (re)measure user messages near the viewport: off-screen entries
    // reuse their cached client rect translated by the scroll delta, so we
    // avoid forcing layout on far-away messages on every scroll. Translated
    // rects of far-off-screen messages never win the closest-to-center pick;
    // anything near the viewport is measured fresh.
    const margin = Math.max(el.clientHeight * 2, 480);
    const messageRects = [];
    const seenIds = new Set();
    userEls.forEach((userEl) => {
      const id = userEl.getAttribute("data-message-id");
      seenIds.add(id);
      const prev = cache.rects.get(id);
      const prevTop = prev ? prev.top - delta : null;
      const prevBottom = prev ? prev.bottom - delta : null;
      const nearViewport =
        prevTop === null ||
        (prevBottom >= viewportRect.top - margin &&
          prevTop <= viewportRect.bottom + margin);
      if (nearViewport) {
        const rect = userEl.getBoundingClientRect();
        cache.rects.set(id, rect);
        messageRects.push(rect);
      } else {
        messageRects.push({ top: prevTop, bottom: prevBottom });
      }
    });
    // Drop cache entries for messages that left the conversation.
    for (const id of cache.rects.keys()) {
      if (!seenIds.has(id)) cache.rects.delete(id);
    }
    setActiveNavIndex(
      getActiveMessageIndex({
        viewportTop: viewportRect.top,
        viewportHeight: viewportRect.height,
        isAtTop,
        isAtBottom,
        messageRects,
      }),
    );
  }, []);

  // rAF-throttled scroll handler: at most one measurement per frame, so
  // bursts of scroll events do not each trigger full layout work.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      measureScrollState();
    });
  }, [measureScrollState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [handleScroll]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(measureScrollState);
    });
  }, [messages, messagesLoading, measureScrollState]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || messagesLoading) {
      setLayoutSettled(false);
      return;
    }
    setLayoutSettled(false);
    const markSettledSoon = () => {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        setLayoutSettled(true);
      }, 80);
    };
    const observer = new ResizeObserver(() => {
      setLayoutSettled(false);
      markSettledSoon();
    });
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    requestAnimationFrame(() => {
      requestAnimationFrame(markSettledSoon);
    });
    return () => {
      observer.disconnect();
      window.clearTimeout(settleTimerRef.current);
    };
  }, [messages, messagesLoading]);

  useEffect(() => {
    const nextTargetId = String(targetMessageId || "").trim();
    if (!nextTargetId) return;
    setPendingScrollTargetId(nextTargetId);
  }, [targetMessageId]);

  useEffect(() => {
    const messageId = String(pendingScrollTargetId || "").trim();
    if (!messageId || messagesLoading || !layoutSettled) return;
    const anchorId = resolveUserAnchorId(messages, messageId);
    const viewport = scrollRef.current;
    if (!isAnchorReady(viewport, anchorId)) return;

    let cancelled = false;
    const finishJump = () => {
      if (cancelled) return;
      setPendingScrollTargetId("");
      onTargetMessageHandled?.();
    };
    const handleScrollEnd = () => {
      window.clearTimeout(jumpFinishTimerRef.current);
      finishJump();
    };

    scrollToMessage(anchorId);
    viewport.addEventListener("scrollend", handleScrollEnd);
    jumpFinishTimerRef.current = window.setTimeout(handleScrollEnd, 1500);

    return () => {
      cancelled = true;
      viewport.removeEventListener("scrollend", handleScrollEnd);
      window.clearTimeout(jumpFinishTimerRef.current);
    };
  }, [
    layoutSettled,
    messages,
    messagesLoading,
    onTargetMessageHandled,
    pendingScrollTargetId,
    scrollToMessage,
  ]);

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
            <HomeEmptyVisual>
              <HomeEmptyCaption
                promptKey="askAnythingGeneralPrompts"
                className="codemini-home-empty-title mx-auto max-w-[320px] sm:max-w-none text-[20px] sm:text-[26px] font-medium leading-tight tracking-normal text-(--text-primary) break-words"
              />
            </HomeEmptyVisual>
          ) : (
            <HomeEmptyVisual>
              <HomeEmptyCaption
                promptKey="buildInProjectPrompts"
                vars={{ project: projectCwd || t("currentProject") }}
                className="codemini-home-empty-title mx-auto max-w-[320px] sm:max-w-none text-[20px] sm:text-[26px] font-medium leading-tight tracking-normal text-(--text-primary) break-words"
              />
              <GitWorkspaceHint />
            </HomeEmptyVisual>
          )}
        </div>
      )}
      <MessageScroller>
        <MessageScrollerViewport ref={scrollRef}>
          <MessageScrollerContent className="gap-0 py-[32px_0_24px]">
            <div className="w-[calc(100%_-_32px)] max-w-[920px] sm:w-[calc(100%_-_64px)] mx-auto">
              <Suspense fallback={null}>
                {messages.map((msg, index) => {
                  if (isSupersededWaitingResponse(messages, index)) return null;
                  return (
                    <MessageScrollerItem
                      key={msg.id}
                      data-msg-scroll-id={msg.id}
                      data-scroll-anchor-id={msg.id}
                    >
                      <MessageBubble
                        message={msg}
                        onRetry={onRetryMessage}
                        dockTodo={Boolean(dockedTodoMessageId) && msg.id === dockedTodoMessageId}
                        turnActive={busy}
                      />
                    </MessageScrollerItem>
                  );
                })}
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
  const hasScrollTarget = Boolean(String(props.targetMessageId || "").trim());
  return (
    <MessageScrollerProvider initialFollowEnd={!hasScrollTarget}>
      <ChatPanelContent {...props} />
    </MessageScrollerProvider>
  );
}
