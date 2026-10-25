import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/clusters')({
  head: () => ({ meta: [
    { title: 'KJET | Cluster profile' },
    { name: 'description', content: 'Search all 85 KJET Cohort 1 beneficiary clusters and inspect financials, machinery, membership and governance.' },
    { property: 'og:title', content: 'KJET | Cluster profile' },
    { property: 'og:description', content: 'Search all 85 KJET Cohort 1 beneficiary clusters and inspect financials, machinery, membership and governance.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="clusters"/>; }
