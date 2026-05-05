import { Component } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';
import { createCodePlugin } from '@/lib/shiki-plugin';

const codePlugin = createCodePlugin();

class StreamdownErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div className="msg-body whitespace-pre-wrap text-(--text-primary)">{this.props.fallbackText}</div>;
    }
    return this.props.children;
  }
}

export function StreamdownRenderer({ text, streaming, className }) {
  if (!text) return null;

  return (
    <StreamdownErrorBoundary fallbackText={text}>
      <div className={cn('msg-body', streaming && 'streaming-cursor', className)}>
        <Streamdown
          parseIncompleteMarkdown
          showLineNumbers={false}
          plugins={{ code: codePlugin }}
          controls={{
            tables: true,
            codeBlocks: true,
            mermaid: { display: true, wrap: true },
          }}
        >
          {text}
        </Streamdown>
      </div>
    </StreamdownErrorBoundary>
  );
}
