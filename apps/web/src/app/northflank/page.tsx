'use client';

import { PageHeader } from '@/components/layout/page-header';
import { NorthflankStatusCard } from '@/components/northflank/northflank-status-card';
import { SelfServiceCard } from '@/components/northflank/self-service-card';
import { ServicesBrowser } from '@/components/northflank/services-browser';
import { useNorthflankConnection } from '@/components/northflank/use-northflank-connection';

export default function NorthflankPage() {
  const { connection } = useNorthflankConnection();
  return (
    <>
      <PageHeader
        title="Northflank"
        description="Projects, services and builds from your Northflank account. Quotas and billing stay controlled by Northflank."
      />
      <div className="grid gap-6">
        <NorthflankStatusCard />
        {connection?.connected && (
          <>
            <SelfServiceCard />
            <ServicesBrowser />
          </>
        )}
      </div>
    </>
  );
}
