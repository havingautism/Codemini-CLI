import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMessageImageGallery } from "@/components/MessageImageGallery.jsx";
import { t } from "../../i18n/index.js";

export function ImagePreviewDialog({ open = true, src, alt, caption, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[96vh] max-w-[96vw] items-center justify-center border-0 bg-transparent p-4 shadow-none sm:max-w-[96vw]">
        <DialogTitle className="sr-only">{caption || t("imageGalleryPreview")}</DialogTitle>
        <DialogClose asChild>
          <Button type="button" variant="close" size="icon" className="absolute right-4 top-4" aria-label={t("imageGalleryClose")}>
            <X />
          </Button>
        </DialogClose>
        <img
          src={src}
          alt={alt || ""}
          referrerPolicy="no-referrer"
          className="max-h-[90vh] max-w-[min(960px,92vw)] object-contain shadow-2xl"
        />
      </DialogContent>
    </Dialog>
  );
}

export function MarkdownLightboxImage({
  src,
  alt,
  title,
  className,
  figureClassName,
  buttonClassName,
  galleryIndex,
  ...props
}) {
  const gallery = useMessageImageGallery();
  const [soloOpen, setSoloOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src || failed) return null;

  const caption =
    alt &&
    !/^(image|图片|thumbnail|缩略图|link|链接)$/i.test(String(alt).trim())
      ? alt
      : "";

  const useSharedGallery = gallery?.enabled;
  const handleOpen = () => {
    if (useSharedGallery && typeof galleryIndex === "number") {
      gallery.openGallery(galleryIndex);
      return;
    }
    setSoloOpen(true);
  };

  return (
    <>
      <figure
        className={cn("markdown-lightbox my-3 max-w-full", figureClassName)}
      >
        <button
          type="button"
          data-markdown-lightbox=""
          onClick={handleOpen}
          className={cn(
            "group inline-block max-w-full overflow-hidden rounded-lg text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--text-primary)/20",
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
            onError={() => {
              if (useSharedGallery && typeof galleryIndex === "number") {
                gallery.markImageFailed?.(galleryIndex);
              }
              setFailed(true);
            }}
            className={cn(
              "max-h-[520px] max-w-full cursor-zoom-in rounded-lg object-contain transition duration-200 group-hover:brightness-[1.03]",
              className,
            )}
            {...props}
          />
        </button>
      </figure>
      {!useSharedGallery && soloOpen && (
        <ImagePreviewDialog
          src={src}
          alt={alt}
          caption={caption}
          onClose={() => setSoloOpen(false)}
        />
      )}
    </>
  );
}
