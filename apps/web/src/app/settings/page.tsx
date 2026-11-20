import { PageHeader } from '@/components/layout/page-header';
import { SettingsContent } from './settings-content';

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Northflank connection, account and security."
      />
      <SettingsContent />
    </>
  );
}
