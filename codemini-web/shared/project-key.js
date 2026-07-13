/**
 * Stable project-dir key shared by Web UI client and server.
 * Forward slashes, lowercase Windows drive letter, no trailing slash.
 * Avoids Node path APIs so the browser can use the same rules.
 */
export function normalizeProjectDirKey(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "unknown") return raw;

  let key = raw.replace(/\\/g, "/");
  // Drop trailing slashes except a bare drive root like "e:/"
  if (/^[A-Za-z]:\//.test(key)) {
    key = key.replace(/\/+$/, "") || key.slice(0, 3);
    if (/^[A-Za-z]:$/.test(key)) key = `${key}/`;
  } else {
    key = key.replace(/\/+$/, "") || "/";
  }
  key = key.replace(/([^:])\/{2,}/g, "$1/");
  key = key.replace(/^([A-Za-z]):/, (_, drive) => `${drive.toLowerCase()}:`);
  return key;
}
