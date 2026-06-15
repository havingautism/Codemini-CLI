import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function MarkdownLightboxImage({
  src,
  alt,
  title,
  className,
  figureClassName,
  buttonClassName,
  ...props
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!src || failed) return null;

  const caption =
    alt &&
    !/^(image|图片|thumbnail|缩略图|link|链接)$/i.test(String(alt).trim())
      ? alt
      : "";

  return (
    <>
      <figure
        className={cn("markdown-lightbox my-3 max-w-full", figureClassName)}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "group block w-full max-w-xl overflow-hidden rounded-lg border border-(--border-default) bg-(--bg-secondary)/60 p-1 text-left transition hover:border-(--border-strong) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--text-primary)/20",
            buttonClassName,
          )}
          aria-label={caption || title || src}
        >
          <img
            src={src}
            alt={alt || ""}
            title={title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className={cn(
              "max-h-60 w-full cursor-zoom-in object-contain transition duration-200 group-hover:brightness-[1.02]",
              className,
            )}
            {...props}
          />
        </button>
        {/* {caption && (
          <figcaption className="mt-1.5 text-[12px] text-(--text-muted)">
            {caption}
          </figcaption>
        )} */}
      </figure>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm animate-in fade-in-0 duration-150"
            role="dialog"
            aria-modal="true"
            aria-label={caption || "Image preview"}
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
            <img
              src={src}
              alt={alt || ""}
              referrerPolicy="no-referrer"
              className="max-h-[90vh] max-w-[min(960px,92vw)] object-contain shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
