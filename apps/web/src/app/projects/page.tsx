import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ProjectsList } from '@/components/projects/projects-list';
import { LinkButton } from '@/components/ui/link-button';

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Projects"
        description="Node.js, Python, Go and PHP apps that StackDock runs for you."
        actions={
          <LinkButton href="/projects/new">
            <Plus /> New project
          </LinkButton>
        }
      />
      <ProjectsList />
    </>
  );
}
