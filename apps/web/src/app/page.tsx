import { PageHeader } from '@/components/layout/page-header';
import { NorthflankStatusCard } from '@/components/northflank/northflank-status-card';
import { SystemStatusCard } from '@/components/overview/system-status-card';
import { ProjectsOverviewCard } from '@/components/projects/projects-overview-card';

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Your projects, deployments and host status at a glance."
      />
      <div className="grid gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <SystemStatusCard />
          <NorthflankStatusCard />
        </div>
        <ProjectsOverviewCard />
        <p className="text-xs text-muted-foreground">
          Hosting resources, quotas and billing are controlled by your host
          (Northflank or your own machine), not by StackDock.
        </p>
      </div>
    </>
  );
}
