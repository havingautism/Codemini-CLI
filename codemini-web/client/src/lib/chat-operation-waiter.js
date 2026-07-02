export function waitForAcceptedOperation(
  accepted,
  { waiters, earlyResults, fallbackError = "Request failed" },
) {
  const operationId = accepted?.operationId;
  if (!operationId) return Promise.resolve(accepted);

  const earlyResult = earlyResults.get(operationId);
  if (earlyResult) {
    earlyResults.delete(operationId);
    if (earlyResult.type === "error") {
      return Promise.reject(new Error(earlyResult.text || fallbackError));
    }
    return Promise.resolve(earlyResult);
  }

  return new Promise((resolve, reject) => {
    waiters.set(operationId, { resolve, reject });
  });
}
