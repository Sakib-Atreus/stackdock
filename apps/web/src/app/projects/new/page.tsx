import { PageHeader } from '@/components/layout/page-header';
import { ProjectForm } from '@/components/projects/project-form';

export default function NewProjectPage() {
  return (
    <>
      <PageHeader
        title="New project"
        description="Register a public GitHub repository."
      />
      <ProjectForm />
    </>
  );
}
