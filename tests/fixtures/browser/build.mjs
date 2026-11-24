process.env.NODE_ENV = "development";

const { build } = await import("vite");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const root = path.dirname(fileURLToPath(import.meta.url));

for (const configFile of ["react18/vite.config.js", "react19/vite.config.js", "vue3/vite.config.js"]) {
  await build({
    configFile: path.join(root, configFile),
    mode: "development",
  });
}
