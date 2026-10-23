import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/grant-ready')({
  head: () => ({ meta: [
    { title: 'KJET | Grant-ready clusters' },
    { name: 'description', content: 'Clusters recommended for grant support after scoring and eligibility screening, with their scores and status checks.' },
    { property: 'og:title', content: 'KJET | Grant-ready clusters' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="grant-ready" />; }
