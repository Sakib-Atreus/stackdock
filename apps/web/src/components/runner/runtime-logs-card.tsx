'use client';

import type {
  ApiSuccess,
  RuntimeLogLine,
  RuntimeLogPage,
} from '@stackdock/shared';
import { Pause, Play, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import { LogView } from './log-view';

const MAX_LINES = 1_000;

export function RuntimeLogsCard({ slug }: { slug: string }) {
  const [lines, setLines] = useState<RuntimeLogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const after = useRef(0);

  const load = useCallback(async () => {
    const { data } = await apiFetch<ApiSuccess<RuntimeLogPage>>(
      `/projects/${slug}/logs?after=${after.current}`,
    );
    if (data.lines.length) {
      after.current = data.lastSeq;
      setLines((prev) => [...prev, ...data.lines].slice(-MAX_LINES));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(load, 2_000, !paused);

  const text = lines
    .map(
      (l) =>
        `${new Date(l.ts).toLocaleTimeString()} ${l.stream === 'system' ? '▸ ' : l.stream === 'stderr' ? '! ' : '  '}${l.text}`,
    )
    .join('\n');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            <h2>Runtime logs</h2>
          </CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
            >
              {paused ? <Play /> : <Pause />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLines([])}>
              <Trash2 /> Clear view
            </Button>
          </div>
        </div>
        <CardDescription>
          Live output of the running app (last {MAX_LINES} lines, kept in
          memory). ▸ = StackDock, ! = stderr.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LogView label="Runtime logs" text={text} emptyText="No output yet." />
      </CardContent>
    </Card>
  );
}
