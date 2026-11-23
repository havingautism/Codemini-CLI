// Glyphs from Beautiful UI's StreamingText. See LICENSE.
function ReplyActionIcon({ size = 17, children }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function ReplyCopyIcon() {
  return <ReplyActionIcon><g><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></g></ReplyActionIcon>;
}

export function ReplyRetryIcon() {
  return <ReplyActionIcon><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></ReplyActionIcon>;
}
