import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const start = path.join(root, "codemini-web", "lib", "runtime-bridge.js");
const seen = new Set();
const queue = [start];
const re = /from\s+['"](\.[^'"]+)['"]/g;

while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!fs.existsSync(file)) {
    console.log("MISSING", path.relative(root, file));
    continue;
  }
  if (!file.endsWith(".js")) continue;
  const text = fs.readFileSync(file, "utf8");
  let match;
  const copy = new RegExp(re);
  while ((match = copy.exec(text))) {
    let resolved = path.resolve(path.dirname(file), match[1]);
    if (!path.extname(resolved) && fs.existsSync(`${resolved}.js`)) {
      resolved = `${resolved}.js`;
    }
    if (!seen.has(resolved)) queue.push(resolved);
  }
}

const clientFiles = [...seen]
  .filter((file) => file.includes(`${path.sep}client${path.sep}`))
  .map((file) => path.relative(root, file))
  .sort();

console.log(clientFiles.join("\n"));
console.log("count", clientFiles.length);
