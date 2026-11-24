import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const reactDir = path.resolve(root, "../node_modules/react19");
const reactDomDir = path.resolve(root, "../node_modules/react-dom19");

export default defineConfig({
  root,
  plugins: [react({ jsxRuntime: "automatic" })],
  resolve: {
    alias: [
      { find: "react/jsx-dev-runtime", replacement: path.join(reactDir, "jsx-dev-runtime.js") },
      { find: "react/jsx-runtime", replacement: path.join(reactDir, "jsx-runtime.js") },
      { find: "react-dom/client", replacement: path.join(reactDomDir, "client.js") },
      { find: "react-dom", replacement: reactDomDir },
      { find: "react", replacement: reactDir },
    ],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  esbuild: {
    jsx: "automatic",
    jsxDev: true,
  },
  build: {
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
    outDir: "dist",
  },
});
