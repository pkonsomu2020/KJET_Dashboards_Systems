import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '@/components/auth/LoginPage';

export const Route = createFileRoute('/login')({
  head: () => ({
    meta: [
      { title: 'KJET | Sign in' },
      { name: 'description', content: 'Sign in to the KJET Co-Investment Portfolio Dashboard.' },
    ],
  }),
  component: LoginPage,
});
