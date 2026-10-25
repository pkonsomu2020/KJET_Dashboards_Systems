import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/evaluation/')({
  head: () => ({ meta: [
    { title: 'KJET | Evaluation overview' },
    { name: 'description', content: 'Screening, eligibility and scoring of every cluster, with a downloadable report for each cluster.' },
    { property: 'og:title', content: 'KJET | Evaluation overview' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="evaluation" />; }
