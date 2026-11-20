import { Suspense } from 'react';
import { EditProject } from '@/components/projects/edit-project';

export default function EditProjectPage() {
  return (
    <Suspense>
      <EditProject />
    </Suspense>
  );
}
