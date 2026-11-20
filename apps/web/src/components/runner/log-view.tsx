'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Scrollable monospace log output that follows new lines unless you scroll up. */
export function LogView({
  text,
  className,
  emptyText = 'No output yet.',
  label,
}: {
  text: string;
  className?: string;
  emptyText?: string;
  label: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <pre
      ref={ref}
      tabIndex={0}
      aria-label={label}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className={cn(
        'max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      {text || <span className="text-muted-foreground">{emptyText}</span>}
    </pre>
  );
}
