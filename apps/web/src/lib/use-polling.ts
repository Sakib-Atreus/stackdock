'use client';

import { useEffect, useRef } from 'react';

/** Calls `fn` every `ms` while `enabled`. Pauses while the tab is hidden. */
export function usePolling(
  fn: () => void | Promise<void>,
  ms: number,
  enabled: boolean,
) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          await saved.current();
        } catch {
          /* the next tick retries */
        }
      }
      if (!stopped) timer = setTimeout(tick, ms);
    };
    timer = setTimeout(tick, ms);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ms, enabled]);
}
