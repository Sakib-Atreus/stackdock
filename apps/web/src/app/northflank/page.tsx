import { PageHeader } from '@/components/layout/page-header';
import { NorthflankStatusCard } from '@/components/northflank/northflank-status-card';

export default function NorthflankPage() {
  return (
    <>
      <PageHeader
        title="Northflank"
        description="Projects, services and builds from your Northflank account."
      />
      <div className="grid gap-6">
        <NorthflankStatusCard />
        <p className="text-sm text-muted-foreground">
          Listing your Northflank projects, services and builds arrives in Phase
          6.
        </p>
      </div>
    </>
  );
}
