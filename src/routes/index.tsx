import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'KJET | Portfolio overview' },
    { name: 'description', content: 'Explore 85 KJET Cohort 1 clusters — co-investment, county coverage, membership and employment projections.' },
    { property: 'og:title', content: 'KJET | Portfolio overview' },
    { property: 'og:description', content: 'Explore 85 KJET Cohort 1 clusters — co-investment, county coverage, membership and employment projections.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="overview" />; }
