import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/evaluation/eligibility')({
  head: () => ({ meta: [
    { title: 'KJET | Eligibility' },
    { name: 'description', content: 'The ten eligibility tests for every cluster, with the reasons for each result.' },
    { property: 'og:title', content: 'KJET | Eligibility' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="eligibility" />; }
