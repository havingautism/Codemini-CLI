import { useRef, useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { cn } from '@/lib/utils';

export function ChatPanel({ messages, projectCwd }) {
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setAutoScroll(atBottom);
      setShowBackToTop(el.scrollTop > 400);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [messages, autoScroll]);

  return (
    <div className="flex-1 relative overflow-hidden">
      {messages.length === 0 && (
        <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-[min(760px,calc(100%-48px))] text-center pointer-events-none">
          <h1 className="text-[clamp(24px,2.4vw,36px)] font-medium leading-tight tracking-normal">
            要在 {projectCwd || 'qurio-coder'} 中构建什么?
          </h1>
        </div>
      )}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto py-[44px_0_28px] scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="w-[min(980px,calc(100%-96px))] mx-auto">
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      </div>
      {showBackToTop && (
        <button
          className="absolute bottom-[220px] right-7 w-9 h-9 rounded-full bg-[var(--bg-input)] border border-[var(--border-default)] cursor-pointer flex items-center justify-center text-[var(--text-secondary)] z-20 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          style={{ boxShadow: 'var(--shadow-default)' }}
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
