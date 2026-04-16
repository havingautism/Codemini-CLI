/**
 * Bun entry point that registers the opentui/solid JSX transform plugin
 * before loading the TSX thread module.
 *
 * This MUST be a plain .js file (not .tsx) so bun runs it without JSX transform.
 * It registers the babel-preset-solid plugin, then dynamically imports thread.tsx.
 */
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin";

ensureSolidTransformPlugin();

await import("./thread.tsx");
