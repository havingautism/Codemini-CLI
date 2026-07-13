import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const entry = path.join(root, "codemini-web", "server.js");
const seen = new Set();
const missing = [];
const queue = [entry];
const re =
  /from\s+['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!fs.existsSync(file)) {
    missing.push(file);
    continue;
  }
  if (!file.endsWith(".js") && !file.endsWith(".mjs") && !file.endsWith(".cjs")) continue;
  const text = fs.readFileSync(file, "utf8");
  let match;
  const copy = new RegExp(re);
  while ((match = copy.exec(text))) {
    const spec = match[1] || match[2] || match[3];
    if (!spec) continue;
    let resolved = path.resolve(path.dirname(file), spec);
    if (!path.extname(resolved)) {
      if (fs.existsSync(`${resolved}.js`)) resolved = `${resolved}.js`;
      else if (fs.existsSync(path.join(resolved, "index.js"))) {
        resolved = path.join(resolved, "index.js");
      }
    }
    if (!seen.has(resolved)) queue.push(resolved);
  }
}

const prefixes = (pkg.files || [])
  .filter((item) => !item.endsWith(".md"))
  .map((item) => path.join(root, ...item.split("/")));

function isPublished(file) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || rel.startsWith("node_modules")) return true;
  return prefixes.some((prefix) => {
    if (prefix === file) return true;
    const r = path.relative(prefix, file);
    return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
  });
}

const unpackaged = [...seen]
  .filter((f) => f.startsWith(root) && fs.existsSync(f) && f.endsWith(".js") && !isPublished(f))
  .map((f) => path.relative(root, f))
  .sort();

if (missing.length || unpackaged.length) {
  console.error("missing:", missing.map((f) => path.relative(root, f)));
  console.error("unpackaged:", unpackaged);
  process.exit(1);
}

console.log(`ok reachable=${seen.size} all packaged`);
