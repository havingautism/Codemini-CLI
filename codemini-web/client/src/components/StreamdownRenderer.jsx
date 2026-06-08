import { Component, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';
import { createCodePlugin } from '@/lib/shiki-plugin';
import { normalizeMarkdownForDisplay, splitMarkdownForEmbeds } from '@/lib/markdown-embeds';
import { EmbedCard } from '@/components/EmbedCard.jsx';
import { MarkdownLightboxImage } from '@/components/MarkdownLightboxImage.jsx';
import { t } from '../../i18n/index.js';

const codePlugin = createCodePlugin();

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

function MarkdownStreamdown({ content, mode, streaming }) {
  const components = useMemo(
    () => ({ img: MarkdownLightboxImage }),
    [],
  );

  return (
    <Streamdown
      mode={mode}
      isAnimating={streaming}
      parseIncompleteMarkdown
      showLineNumbers={false}
      plugins={{ code: codePlugin }}
      controls={streamdownControls}
      components={components}
    >
      {content}
    </Streamdown>
  );
}

export function StreamdownRenderer({ text, streaming, className, inlineEmbeds = true }) {
  const rawContent = typeof text === 'string' ? text : String(text || '');
  const content = normalizeMarkdownForDisplay(rawContent, {
    linkFallback: t('markdownLinkFallback'),
    imageFallback: t('markdownImageFallback'),
  });

  if (!content && !streaming) return null;

  if (!content && streaming) {
    return (
      <div
        className={cn(
          'msg-body streaming-cursor streaming-cursor--pending',
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  const mode = streaming ? 'streaming' : 'static';
  const parts = streaming || !inlineEmbeds
    ? [{ type: 'markdown', text: content }]
    : splitMarkdownForEmbeds(content);
  const hasEmbeds = parts.some((part) => part.type === 'embed');

  if (!hasEmbeds) {
    return (
      <StreamdownErrorBoundary fallbackText={content} resetKey={mode}>
        <div className={cn('msg-body', streaming && 'streaming-cursor', className)}>
          <MarkdownStreamdown content={content} mode={mode} streaming={streaming} />
        </div>
      </StreamdownErrorBoundary>
    );
  }

  return (
    <div className={cn('msg-body', className)}>
      {parts.map((part, index) => {
        if (part.type === 'embed') {
          return <EmbedCard key={`embed-${part.url}-${index}`} url={part.url} />;
        }
        if (!part.text) return null;
        return (
          <StreamdownErrorBoundary
            key={`md-${index}`}
            fallbackText={part.text}
            resetKey={`${mode}-${index}`}
          >
            <MarkdownStreamdown content={part.text} mode={mode} streaming={false} />
          </StreamdownErrorBoundary>
        );
      })}
    </div>
  );
}
