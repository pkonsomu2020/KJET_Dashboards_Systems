import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/evaluation/scorecard')({
  head: () => ({ meta: [
    { title: 'KJET | Scorecard' },
    { name: 'description', content: 'Weighted assessment of every cluster across the six criteria, with every rating and justification.' },
    { property: 'og:title', content: 'KJET | Scorecard' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="scorecard" />; }
