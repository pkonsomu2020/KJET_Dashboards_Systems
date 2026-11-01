import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/cohort-2/overview')({
  head: () => ({ meta: [
    { title: 'KJET | Cohort 2 Overview' },
    { name: 'description', content: 'The Cohort 2 finalists at a glance: counties, value chains, tiers and scores.' },
    { property: 'og:title', content: 'KJET | Cohort 2 Overview' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="overview2" />; }
