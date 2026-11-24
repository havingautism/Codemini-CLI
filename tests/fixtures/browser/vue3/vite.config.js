import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [vue({ isProduction: false })],
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  build: {
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
    outDir: "dist",
  },
});
