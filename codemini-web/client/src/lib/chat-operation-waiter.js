export function operationKey(sessionId, operationId) {
  const id = String(operationId || "");
  return sessionId ? `${String(sessionId)}:${id}` : id;
}

export function waitForAcceptedOperation(
  accepted,
  { sessionId, waiters, earlyResults, fallbackError = "Request failed" },
) {
  const operationId = accepted?.operationId;
  if (!operationId) return Promise.resolve(accepted);
  const key = operationKey(accepted?.sessionId || sessionId, operationId);

  const earlyResult = earlyResults.get(key);
  if (earlyResult) {
    earlyResults.delete(key);
    if (earlyResult.type === "error") {
      return Promise.reject(new Error(earlyResult.text || fallbackError));
    }
    return Promise.resolve(earlyResult);
  }

  return new Promise((resolve, reject) => {
    waiters.set(key, { resolve, reject });
  });
}
