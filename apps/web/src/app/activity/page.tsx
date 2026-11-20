import { ActivityList } from '@/components/activity/activity-list';
import { PageHeader } from '@/components/layout/page-header';

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="Audit log of sign-ins, connections and configuration changes. Secrets are never recorded."
      />
      <ActivityList />
    </>
  );
}
