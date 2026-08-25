import { useMemo } from "react";
import { useApp, useCurrentSessionId } from "@/context/app-context.jsx";

export function createGitWorkspaceLoading(sessionId = "") {
  return { status: "loading", sessionId: String(sessionId || "") };
}

export function createGitWorkspaceReady(data, sessionId = "") {
  return {
    status: "ready",
    sessionId: String(sessionId || ""),
    data: data || {},
  };
}

export function createGitWorkspaceError(message, sessionId = "") {
  return {
    status: "error",
    sessionId: String(sessionId || ""),
    message: String(message || ""),
  };
}

function scopeGitWorkspace(gitWorkspace, currentSessionId) {
  const ws = gitWorkspace || createGitWorkspaceLoading(currentSessionId);
  if (
    ws.sessionId &&
    currentSessionId &&
    ws.sessionId !== currentSessionId
  ) {
    return createGitWorkspaceLoading(currentSessionId);
  }
  if (ws.status === "loading" && !ws.sessionId && currentSessionId) {
    return createGitWorkspaceLoading(currentSessionId);
  }
  return ws;
}

/** Git workspace live state: loading / ready / error. Historical file snapshots stay separate. */
export function useGitWorkspace() {
  const { state } = useApp();
  const gitWorkspace = state?.gitWorkspace;
  const currentSessionId = useCurrentSessionId() || "";

  return useMemo(() => {
    const scoped = scopeGitWorkspace(gitWorkspace, currentSessionId);
    const status = scoped.status;
    const data = status === "ready" ? scoped.data : undefined;

    return {
      status,
      sessionId: scoped.sessionId || currentSessionId,
      data,
      error: status === "error" ? scoped.message || "" : "",
      isLoading: status === "loading",
      isReady: status === "ready",
      isError: status === "error",
      isGit: status === "ready" ? Boolean(data?.isGit) : undefined,
      branch: status === "ready" ? data?.branch ?? null : undefined,
      dirty: status === "ready" ? Boolean(data?.dirty) : undefined,
      files:
        status === "ready"
          ? Array.isArray(data?.files)
            ? data.files
            : []
          : undefined,
      linesAdded:
        status === "ready" ? Number(data?.linesAdded || 0) : undefined,
      linesRemoved:
        status === "ready" ? Number(data?.linesRemoved || 0) : undefined,
      staged: status === "ready" ? Number(data?.staged || 0) : 0,
      modified: status === "ready" ? Number(data?.modified || 0) : 0,
      untracked: status === "ready" ? Number(data?.untracked || 0) : 0,
    };
  }, [gitWorkspace, currentSessionId]);
}
