import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/cohort-1/finalists')({
  head: () => ({ meta: [
    { title: 'KJET | Cohort 1 Finalists' },
    { name: 'description', content: 'The 90 Cohort 1 finalists, two per county, with their selection scores, application forms and documents.' },
    { property: 'og:title', content: 'KJET | Cohort 1 Finalists' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="finalists1" />; }
