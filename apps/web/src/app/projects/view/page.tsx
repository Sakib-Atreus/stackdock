import { Suspense } from 'react';
import { ProjectDetail } from '@/components/projects/project-detail';

// Static export: the project is chosen by ?slug=, not a dynamic route.
export default function ProjectViewPage() {
  return (
    <Suspense>
      <ProjectDetail />
    </Suspense>
  );
}
