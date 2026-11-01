import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/cohort-2/finalists')({
  head: () => ({ meta: [
    { title: 'KJET | Cohort 2 Finalists' },
    { name: 'description', content: 'The Cohort 2 finalists, six per county, with their selection scores, application forms and documents.' },
    { property: 'og:title', content: 'KJET | Cohort 2 Finalists' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="finalists2" />; }
