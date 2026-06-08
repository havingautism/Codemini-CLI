import { Component } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';
import { createCodePlugin } from '@/lib/shiki-plugin';
import { splitMarkdownForEmbeds } from '@/lib/markdown-embeds';
import { EmbedCard } from '@/components/EmbedCard.jsx';

const codePlugin = createCodePlugin();

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

export function StreamdownRenderer({ text, streaming, className, inlineEmbeds = true }) {
  const content = typeof text === 'string' ? text : String(text || '');
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
          <Streamdown
            mode={mode}
            isAnimating={streaming}
            parseIncompleteMarkdown
            showLineNumbers={false}
            plugins={{ code: codePlugin }}
            controls={{
              tables: true,
              codeBlocks: true,
              mermaid: { display: true, wrap: true },
            }}
          >
            {content}
          </Streamdown>
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
            <Streamdown
              mode={mode}
              isAnimating={false}
              parseIncompleteMarkdown
              showLineNumbers={false}
              plugins={{ code: codePlugin }}
              controls={{
                tables: true,
                codeBlocks: true,
                mermaid: { display: true, wrap: true },
              }}
            >
              {part.text}
            </Streamdown>
          </StreamdownErrorBoundary>
        );
      })}
    </div>
  );
}
