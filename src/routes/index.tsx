import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/dashboard/dashboard';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'KJET | General Overview' },
    { name: 'description', content: 'KJET Cohort 1 at a glance: finalists, co-investment evaluation, value chains and counties.' },
    { property: 'og:title', content: 'KJET | General Overview' },
    { property: 'og:description', content: 'KJET Cohort 1 at a glance: finalists, co-investment evaluation, value chains and counties.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Page,
});
function Page() { return <Dashboard view="general" />; }
