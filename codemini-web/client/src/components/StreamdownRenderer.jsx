import { Component, useMemo, useRef } from 'react';
import { defaultComponents, Streamdown } from 'streamdown';
import { mermaid } from '@streamdown/mermaid';
import { cn } from '@/lib/utils';
import { ArrowSquareOut, Check, Copy, Download, X } from '@/lib/icons';
import { createCodePlugin } from '@/lib/shiki-plugin';
import {
  collectMessageImages,
  extractInlineImagesFromMarkdown,
  groupGalleryParts,
  isPublicHttpUrl,
  normalizeMarkdownForDisplay,
  splitMarkdownForEmbeds,
} from '@/lib/markdown-embeds';
import { EmbedCard } from '@/components/EmbedCard.jsx';
import { HorizontalScrollStrip } from '@/components/HorizontalScrollStrip.jsx';
import { MarkdownLightboxImage } from '@/components/MarkdownLightboxImage.jsx';
import { ResponseLoader } from '@/components/ui/spinner.jsx';
import { CodeBlockFrame } from '@/components/beautiful-ui/CodeBlockFrame.jsx';
import { SourceAvatar, sourceDomain } from '@/components/beautiful-ui/SourceAvatar.jsx';
import {
  MessageImageGalleryProvider,
} from '@/components/MessageImageGallery.jsx';
import { t } from '../../i18n/index.js';

const codePlugin = createCodePlugin();
const streamdownPlugins = { code: codePlugin, mermaid };

const streamingTextAnimation = {
  animation: 'fadeIn',
  duration: 150,
  easing: 'ease-out',
  sep: 'word',
  stagger: 55,
  maxBacklogMs: 80,
};

const streamingCjkAnimation = { ...streamingTextAnimation, sep: 'char', stagger: 12 };
const streamdownIcons = {
  CheckIcon: Check,
  CopyIcon: Copy,
  DownloadIcon: Download,
  ExternalLinkIcon: ArrowSquareOut,
  XIcon: X,
};

function MarkdownSourceLink({ href, children, className, ...props }) {
  const Link = defaultComponents.a;
  if (!isPublicHttpUrl(href) || props.node?.children?.some((child) => child.type === 'element')) {
    return <Link href={href} className={className} {...props}>{children}</Link>;
  }
  const domain = sourceDomain(href);
  const label = children === href ? domain : children;
  return (
    <Link href={href} className={cn('codemini-source-chip', className)} {...props}>
      <SourceAvatar url={href} />
      <span className="codemini-source-chip-label">{label || domain}</span>
    </Link>
  );
}

const streamdownControls = {
  tables: true,
  codeBlocks: true,
  mermaid: { display: true, wrap: true },
};

class StreamdownErrorBoundary extends Component {
  state = { hasError: false, retryCount: 0 };
  retryTimer = null;

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('Streamdown render failed; retrying with markdown renderer.', error);
    if (this.state.retryCount >= 2) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      this.setState(prev => ({ hasError: false, retryCount: prev.retryCount + 1 }));
    }, 80);
  }

  componentDidUpdate(prevProps) {
    if (
      (prevProps.fallbackText !== this.props.fallbackText || prevProps.resetKey !== this.props.resetKey)
      && (this.state.hasError || this.state.retryCount)
    ) {
      clearTimeout(this.retryTimer);
      this.setState({ hasError: false, retryCount: 0 });
    }
  }

  componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }

  render() {
    if (this.state.hasError) {
      return <div className="msg-body whitespace-pre-wrap text-(--text-primary)">{this.props.fallbackText}</div>;
    }
    return this.props.children;
  }
}

function PersistentMarkdownTable({
  children,
  className,
  node: _node,
  ...props
}) {
  return (
    <div className="codemini-markdown-table-strip my-4 max-w-full">
      <HorizontalScrollStrip fadeEdges contentClassName="block min-w-full gap-0 px-0">
        <table
          {...props}
          className={cn('w-max min-w-full border-collapse', className)}
          data-streamdown="table"
        >
          {children}
        </table>
      </HorizontalScrollStrip>
    </div>
  );
}

function MarkdownStreamdown({
  content,
  mode,
  streaming,
  useGallery,
  sourceChips,
  inlineImageStartIndex = 0,
}) {
  const inlineImageCounterRef = useRef(0);
  inlineImageCounterRef.current = 0;

  const components = useMemo(
    () => ({
      img: (props) => {
        const galleryIndex = inlineImageStartIndex + inlineImageCounterRef.current;
        inlineImageCounterRef.current += 1;
        return (
          <MarkdownLightboxImage
            {...props}
            galleryIndex={useGallery ? galleryIndex : undefined}
          />
        );
      },
      table: PersistentMarkdownTable,
      pre: CodeBlockFrame,
      ...(sourceChips ? { a: MarkdownSourceLink } : {}),
    }),
    [inlineImageStartIndex, useGallery, sourceChips],
  );
  const animation = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(content)
    ? streamingCjkAnimation
    : streamingTextAnimation;

  return (
    <Streamdown
      mode={mode}
      isAnimating={streaming}
      animated={streaming ? animation : false}
      parseIncompleteMarkdown
      plugins={streamdownPlugins}
      controls={streamdownControls}
      icons={streamdownIcons}
      translations={{ copyCode: t('copyCode'), copied: t('copied') }}
      components={components}
    >
      {content}
    </Streamdown>
  );
}

function MarkdownImageGallery({ images = [], startIndex = 0 }) {
  if (!images.length) return null;

  if (images.length === 1) {
    const image = images[0];
    return (
      <MarkdownLightboxImage
        src={image.url}
        alt={image.alt || ''}
        galleryIndex={startIndex}
        figureClassName="my-3"
      />
    );
  }

  return (
    <div className="my-4 max-w-full">
      <HorizontalScrollStrip>
        {images.map((image, index) => (
          <MarkdownLightboxImage
            key={`${image.url || 'image'}-${index}`}
            src={image.url}
            alt={image.alt || ''}
            galleryIndex={startIndex + index}
            figureClassName="m-0 w-[260px] shrink-0 sm:w-[320px]"
            buttonClassName="block w-full rounded-xl"
            className="aspect-[4/3] max-h-none w-full rounded-xl object-cover"
          />
        ))}
      </HorizontalScrollStrip>
    </div>
  );
}

function StreamdownRendererBody({
  content,
  streaming,
  className,
  inlineEmbeds,
  useGallery,
  sourceChips,
}) {
  const mode = streaming ? 'streaming' : 'static';
  const parts = streaming
    ? [{ type: 'markdown', text: content }]
    : splitMarkdownForEmbeds(content, { includeLinks: inlineEmbeds });
  const groupedParts = groupGalleryParts(parts);
  const hasRichParts = groupedParts.some((part) => part.type === 'embed' || part.type === 'image' || part.type === 'gallery');
  let imageIndex = 0;

  if (!hasRichParts) {
    return (
      <StreamdownErrorBoundary fallbackText={content} resetKey={mode}>
        <div className={cn('msg-body', streaming && 'streaming-cursor', className)}>
          <MarkdownStreamdown
            content={content}
            mode={mode}
            streaming={streaming}
            useGallery={useGallery}
            sourceChips={sourceChips}
          />
        </div>
      </StreamdownErrorBoundary>
    );
  }

  return (
    <div className={cn('msg-body', className)}>
      {groupedParts.map((part, index) => {
        if (part.type === 'embed') {
          return <EmbedCard key={`embed-${part.url}-${index}`} url={part.url} />;
        }
        if (part.type === 'image' || part.type === 'gallery') {
          const startIndex = imageIndex;
          imageIndex += part.images.length;
          return (
            <MarkdownImageGallery
              key={`gallery-${index}`}
              images={part.images}
              startIndex={startIndex}
            />
          );
        }
        if (!part.text) return null;
        const inlineStartIndex = imageIndex;
        imageIndex += extractInlineImagesFromMarkdown(part.text).length;
        return (
          <StreamdownErrorBoundary
            key={`md-${index}`}
            fallbackText={part.text}
            resetKey={`${mode}-${index}`}
          >
            <MarkdownStreamdown
              content={part.text}
              mode={mode}
              streaming={false}
              useGallery={useGallery}
              sourceChips={sourceChips}
              inlineImageStartIndex={inlineStartIndex}
            />
          </StreamdownErrorBoundary>
        );
      })}
    </div>
  );
}

export function StreamdownRenderer({ text, streaming, className, inlineEmbeds = true, sourceChips = false }) {
  const rawContent = typeof text === 'string' ? text : String(text || '');
  const content = normalizeMarkdownForDisplay(rawContent, {
    linkFallback: t('markdownLinkFallback'),
    imageFallback: t('markdownImageFallback'),
  });
  const galleryContent = streaming ? '' : content;
  const messageImages = useMemo(
    () => galleryContent ? collectMessageImages(galleryContent, { includeLinks: inlineEmbeds }) : [],
    [galleryContent, inlineEmbeds],
  );

  if (!content && !streaming) return null;

  if (!content && streaming) {
    return (
      <ResponseLoader
        className={cn('msg-body', className)}
        label={t('waitingResponse')}
      />
    );
  }

  const useGallery = messageImages.length > 0;

  const body = (
    <StreamdownRendererBody
      content={content}
      streaming={streaming}
      className={className}
      inlineEmbeds={inlineEmbeds}
      useGallery={useGallery}
      sourceChips={sourceChips}
    />
  );

  if (!useGallery) return body;

  return (
    <MessageImageGalleryProvider images={messageImages} enabled>
      {body}
    </MessageImageGalleryProvider>
  );
}
