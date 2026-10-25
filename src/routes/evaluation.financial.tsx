import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/evaluation/financial')({
  head: () => ({ meta: [
    { title: 'KJET | Financial screening' },
    { name: 'description', content: 'The 50-50 co-investment rule and category limits checked against each application.' },
    { property: 'og:title', content: 'KJET | Financial screening' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="financial" />; }
