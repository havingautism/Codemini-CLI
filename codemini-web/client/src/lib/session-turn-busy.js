export function isSessionTurnBusyResult(result) {
  if (!result || typeof result !== "object") return false;
  const code = String(result.code || "");
  if (code === "BUSY" || code === "SESSION_BUSY") return true;
  return (
    result.error === true &&
    /already in progress/i.test(String(result.message || ""))
  );
}
