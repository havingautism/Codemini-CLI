import { buildMcpToolDisplayLabels } from "../../../../src/core/mcp-tool-display.js";
import { setMcpToolDisplayLabels } from "../../../../src/core/tool-display.js";
import * as api from "@/hooks/use-api";

export function syncMcpToolDisplayLabels(servers = []) {
  setMcpToolDisplayLabels(buildMcpToolDisplayLabels(servers));
}

export async function refreshMcpToolDisplayLabels() {
  try {
    const result = await api.fetchMcpServers();
    syncMcpToolDisplayLabels(result?.servers || []);
    return result?.servers || [];
  } catch {
    syncMcpToolDisplayLabels([]);
    return [];
  }
}
