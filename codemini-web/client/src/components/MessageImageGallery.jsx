import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { t } from '../../i18n/index.js';

const MessageImageGalleryContext = createContext(null);

function imageKey({ url, alt }) {
  return `${String(url || '').trim()}\0${String(alt || '')}`;
}

function isPlaceholderAlt(alt) {
  return /^(image|图片|thumbnail|缩略图|link|链接)$/i.test(String(alt || '').trim());
}

export function useMessageImageGallery() {
  return useContext(MessageImageGalleryContext);
}

export function MessageImageGalleryProvider({
  images = [],
  enabled = true,
  children,
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failedKeys, setFailedKeys] = useState(() => new Set());

  const galleryImages = useMemo(
    () => (Array.isArray(images) ? images.filter((item) => item?.url) : []),
    [images],
  );

  useEffect(() => {
    setFailedKeys(new Set());
  }, [galleryImages]);

  const activeImages = useMemo(
    () => galleryImages.filter((item) => !failedKeys.has(imageKey(item))),
    [galleryImages, failedKeys],
  );

  const markImageFailed = useCallback((galleryIndex) => {
    const item = galleryImages[galleryIndex];
    if (!item?.url) return;
    const key = imageKey(item);
    setFailedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [galleryImages]);

  const markImageFailedByItem = useCallback((item) => {
    if (!item?.url) return;
    const key = imageKey(item);
    setFailedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!activeImages.length) {
      setOpen(false);
      setIndex(0);
      return;
    }
    setIndex((current) => Math.min(current, activeImages.length - 1));
  }, [open, activeImages.length]);

  const openGallery = useCallback((originalIndex) => {
    const item = galleryImages[originalIndex];
    if (!item?.url || failedKeys.has(imageKey(item))) return;
    const activeIndex = activeImages.findIndex(
      (candidate) => imageKey(candidate) === imageKey(item),
    );
    if (activeIndex < 0) return;
    setIndex(activeIndex);
    setOpen(true);
  }, [galleryImages, failedKeys, activeImages]);

  const closeGallery = useCallback(() => {
    setOpen(false);
  }, []);

  const goPrevious = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((current) => Math.min(activeImages.length - 1, current + 1));
  }, [activeImages.length]);

  const value = useMemo(
    () => ({
      enabled: enabled && activeImages.length > 0,
      images: activeImages,
      open,
      index,
      openGallery,
      closeGallery,
      goPrevious,
      goNext,
      markImageFailed,
    }),
    [
      enabled,
      activeImages,
      open,
      index,
      openGallery,
      closeGallery,
      goPrevious,
      goNext,
      markImageFailed,
    ],
  );

  return (
    <MessageImageGalleryContext.Provider value={value}>
      {children}
      {enabled && (
        <MessageImageGalleryModal
          open={open}
          index={index}
          images={activeImages}
          onClose={closeGallery}
          onPrevious={goPrevious}
          onNext={goNext}
          onImageFailed={markImageFailedByItem}
        />
      )}
    </MessageImageGalleryContext.Provider>
  );
}

function MessageImageGalleryModal({
  open,
  index,
  images,
  onClose,
  onPrevious,
  onNext,
  onImageFailed,
}) {
  const current = images[index];
  const hasMultiple = images.length > 1;
  const canGoPrevious = hasMultiple && index > 0;
  const canGoNext = hasMultiple && index < images.length - 1;

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (!hasMultiple) return;
      if (event.key === 'ArrowLeft' && canGoPrevious) {
        event.preventDefault();
        onPrevious();
      }
      if (event.key === 'ArrowRight' && canGoNext) {
        event.preventDefault();
        onNext();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, hasMultiple, canGoPrevious, canGoNext, onClose, onPrevious, onNext]);

  if (!open || !current?.url) return null;

  const caption =
    current.alt && !isPlaceholderAlt(current.alt) ? current.alt : '';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[96vh] max-w-[96vw] items-center justify-center border-0 bg-transparent p-4 shadow-none sm:max-w-[96vw]">
      <DialogTitle className="sr-only">{caption || t('imageGalleryPreview')}</DialogTitle>
      <DialogClose asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="absolute right-4 top-4"
          aria-label={t('imageGalleryClose')}
        >
          <X />
        </Button>
      </DialogClose>

      {canGoPrevious && (
        <button
          type="button"
          className="absolute left-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75 sm:left-4 sm:size-11"
          aria-label={t('imageGalleryPrevious')}
          onClick={(event) => {
            event.stopPropagation();
            onPrevious();
          }}
        >
          <CaretLeft size={22} weight="bold" />
        </button>
      )}

      {canGoNext && (
        <button
          type="button"
          className="absolute right-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75 sm:right-4 sm:size-11"
          aria-label={t('imageGalleryNext')}
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
        >
          <CaretRight size={22} weight="bold" />
        </button>
      )}

      <div
        className="flex max-h-[92vh] max-w-[min(960px,92vw)] flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          key={current.url}
          src={current.url}
          alt={current.alt || ''}
          referrerPolicy="no-referrer"
          className="max-h-[82vh] max-w-full object-contain shadow-2xl"
          onError={() => onImageFailed?.(current)}
        />
        {hasMultiple && (
          <div className="rounded-full bg-black/55 px-3 py-1 text-[13px] text-white/90">
            {t('imageGalleryCounter')
              .replace('{current}', String(index + 1))
              .replace('{total}', String(images.length))}
          </div>
        )}
        {caption && (
          <p className="max-w-full px-2 text-center text-[13px] text-white/85">
            {caption}
          </p>
        )}
      </div>
      </DialogContent>
    </Dialog>
  );
}
