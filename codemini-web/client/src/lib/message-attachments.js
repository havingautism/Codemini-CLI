export function parseAttachmentsFromModelContent(modelContent) {
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
