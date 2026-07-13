// Merge adjacent tool segments (possibly separated by empty text) into merged render groups.
export function buildRenderGroups(segments) {
  const groups = [];
  let pendingTools = [];

  const flushTools = () => {
    if (pendingTools.length > 0) {
      groups.push({ type: "tools", cards: pendingTools });
      pendingTools = [];
    }
  };

  for (const seg of segments || []) {
    if (seg.type === "tools") {
      pendingTools.push(...seg.cards);
    } else if (seg.type === "text") {
      if (seg.text || seg.isStreaming) {
        flushTools();
        groups.push({
          type: "text",
          text: seg.text || "",
          isStreaming: seg.isStreaming,
          startedAt: seg.startedAt || null,
          endedAt: seg.endedAt || null,
        });
      }
      // Empty non-streaming text between tools: skip, keep accumulating.
    } else if (seg.type === "thinking") {
      if (seg.text) {
        flushTools();
        groups.push({ type: "thinking", ...seg });
      }
    } else if (seg.type === "handoff") {
      if (seg.text) {
        flushTools();
        groups.push({ type: "handoff", ...seg });
      }
    } else if (seg.type === "skill") {
      flushTools();
      groups.push({ type: "skill", ...seg });
    }
  }
  flushTools();

  return groups
    .map((group, index) => {
      if (
        group.type === "text" &&
        group.isStreaming &&
        groups[index + 1]?.type === "tools"
      ) {
        return { ...group, isStreaming: false };
      }
      return group;
    })
    .filter((group) => group.type !== "text" || group.text || group.isStreaming);
}
