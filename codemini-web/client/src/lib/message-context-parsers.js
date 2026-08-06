export function parseScrapbookAttachmentFromModelContent(modelContent = "") {
  const text = String(modelContent || "");
  if (!text.includes("<scrapbook_context>")) return null;

  const blockMatch = text.match(/<scrapbook_context>([\s\S]*?)<\/scrapbook_context>/);
  const block = String(blockMatch?.[1] || "");
  if (!block.trim()) return null;

  const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || "note";
  const entryId = block.match(/^Entry ID:\s*(.+)$/m)?.[1]?.trim() || "";
  const sourceUrl = block.match(/^Source URL:\s*(.+)$/m)?.[1]?.trim() || "";

  return {
    id: entryId ? `scrapbook:${entryId}` : `scrapbook:${title}`,
    name: title,
    kind: "scrapbook",
    mime: "text/plain",
    size: text.length,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function parseAttachmentsFromModelContent(modelContent = "") {
  const text = String(modelContent || "");
  if (!text.includes("<uploaded_attachments>")) return [];

  const blockMatch = text.match(
    /<uploaded_attachments>([\s\S]*?)<\/uploaded_attachments>/,
  );
  if (!blockMatch) return [];

  const attachments = [];
  for (const block of blockMatch[1].split(/\n---\n/)) {
    const nameMatch = block.match(/^Attachment \d+: (.+)$/m);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    const typeMatch = block.match(/^Type: (image|file)/m);
    const sizeMatch = block.match(/^Size: (\d+) bytes$/m);
    attachments.push({
      id: `hist-${attachments.length}-${name}`,
      name,
      kind: typeMatch?.[1] === "image" ? "image" : "file",
      size: Number(sizeMatch?.[1] || 0),
    });
  }
  return attachments;
}

export function parseUserBannerAttachmentsFromModelContent(modelContent = "") {
  const attachments = parseAttachmentsFromModelContent(modelContent);
  const scrapbook = parseScrapbookAttachmentFromModelContent(modelContent);
  return scrapbook ? [...attachments, scrapbook] : attachments;
}

export function normalizeScrapbookAttachment(item = {}) {
  const id = String(item?.id || "").trim();
  const kind = String(item?.kind || "").trim();
  const isScrapbook = kind === "scrapbook" || id.startsWith("scrapbook:");
  if (!isScrapbook) return null;
  const name = String(item?.name || "").trim() || "note";
  return {
    id: id || `scrapbook:${name}`,
    name,
    kind: "scrapbook",
    mime: String(item?.mime || "text/plain"),
    size: Number(item?.size || 0),
    ...(item?.sourceUrl ? { sourceUrl: String(item.sourceUrl) } : {}),
  };
}

export function pickScrapbookAttachments(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeScrapbookAttachment(item))
    .filter(Boolean);
}
