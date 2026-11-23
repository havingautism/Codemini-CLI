// Adapted from Beautiful UI's StreamingText source list. See beautiful-ui/LICENSE.
import { useId, useState } from "react";
import { SourceAvatar, sourceDomain } from "@/components/beautiful-ui/SourceAvatar.jsx";
import { isPublicHttpUrl } from "@/lib/markdown-embeds.js";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";
import "./beautiful-ui/StreamingText.css";

export function EmbedBanner({ items, className, renderActions, children }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const links = items?.filter((item) => item?.type !== "image" && isPublicHttpUrl(item?.url)) ?? [];
  const toggle = links.length > 0 && (
    <button
      type="button"
      className="codemini-sources-toggle"
      aria-expanded={open}
      aria-controls={listId}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="codemini-sources-stack" aria-hidden="true">
        {links.slice(0, 3).map((item) => <SourceAvatar key={item.url} url={item.url} type={item.type} />)}
      </span>
      <span>{t(links.length === 1 ? "relatedSourceCountOne" : "relatedSourceCount").replace("{n}", links.length)}</span>
    </button>
  );

  return (
    <div className={cn("w-full min-w-0", className)}>
      {renderActions(toggle)}
      {links.length > 0 && (
        <div id={listId} className="codemini-sources-reveal" data-open={open} inert={!open}>
          <div className="min-h-0 overflow-hidden">
            <ul className="codemini-sources-list" aria-label={t("relatedLinks")}>
              {links.map((item) => {
                const domain = sourceDomain(item.url);
                const title = item.title && item.title !== item.url ? item.title : item.siteName || domain;
                return (
                  <li key={item.url} className="min-w-0">
                    <a className="codemini-source-row" href={item.url} target="_blank" rel="noopener noreferrer" title={item.description || title}>
                      <SourceAvatar url={item.url} type={item.type} />
                      <span className="codemini-source-title">{title}</span>
                      <span className="codemini-source-domain">{domain}</span>
                      {item.description && <span className="sr-only">{item.description}</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
