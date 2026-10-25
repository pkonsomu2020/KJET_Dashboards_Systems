import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/evaluation/scorecard')({
  head: () => ({ meta: [
    { title: 'KJET | Scoring' },
    { name: 'description', content: 'Scores of every cluster against the six evaluation criteria, with every rating and justification.' },
    { property: 'og:title', content: 'KJET | Scoring' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="scorecard" />; }
