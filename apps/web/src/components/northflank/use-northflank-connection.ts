'use client';

import type { ApiSuccess, ProviderConnectionView } from '@stackdock/shared';
import { useApi } from '@/lib/use-api';

export function useNorthflankConnection() {
  const { state, retry, setData } =
    useApi<ApiSuccess<ProviderConnectionView[]>>('/providers');
  const connection =
    state.status === 'success'
      ? (state.data.data.find((p) => p.provider === 'NORTHFLANK') ?? null)
      : null;
  return {
    state,
    connection,
    retry,
    update: (view: ProviderConnectionView) => setData({ data: [view] }),
  };
}
