import {
  parseScrapbookAttachmentFromModelContent,
  pickScrapbookAttachments,
} from "./message-context-parsers.js";

export {
  parseAttachmentsFromModelContent,
  parseScrapbookAttachmentFromModelContent,
  parseUserBannerAttachmentsFromModelContent,
  normalizeScrapbookAttachment,
  pickScrapbookAttachments,
} from "./message-context-parsers.js";

export function enrichUiMessagesWithScrapbookAttachments(uiMessages = [], coreMessages = []) {
  const coreUsers = (Array.isArray(coreMessages) ? coreMessages : []).filter(
    (message) => message?.role === "user",
  );
  let coreUserIndex = 0;

  return (Array.isArray(uiMessages) ? uiMessages : []).map((message) => {
    if (message?.role !== "you" || message.transientKey) return message;

    const coreMessage = coreUsers[coreUserIndex++];
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const hasScrapbook = pickScrapbookAttachments(attachments).length > 0;
    if (hasScrapbook || !coreMessage) return message;

    const scrapbook = parseScrapbookAttachmentFromModelContent(coreMessage.model_content);
    if (!scrapbook) return message;

    return {
      ...message,
      attachments: [...attachments, scrapbook],
    };
  });
}
