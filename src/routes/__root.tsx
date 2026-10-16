import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  Navigate,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { useDriveEvents } from "../hooks/useDrive";
import { useSession } from "../hooks/useAuth";

// Routes that are accessible without being signed in
const PUBLIC_ROUTES = ['/login'];

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "KJET | Co-Investment Portfolio" },
      { name: "description", content: "Kenya Jobs and Economic Transformation Cohort 1 portfolio, implemented by MSEA." },
      { name: "author", content: "MSEA" },
      { property: "og:title", content: "KJET | Co-Investment Portfolio" },
      { property: "og:description", content: "Kenya Jobs and Economic Transformation Cohort 1 portfolio, implemented by MSEA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/Leadedge_LOGO.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/Leadedge_LOGO.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    const preferred = localStorage.getItem("kjet-theme") === "dark";
    document.documentElement.classList.toggle("dark", preferred);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGuard />
    </QueryClientProvider>
  );
}

/** Subscribes to SSE stream once per authenticated app session for live Drive change push. */
function DriveEventListener() {
  useDriveEvents();
  return null;
}

/** Checks session and redirects unauthenticated users to /login. */
function AuthGuard() {
  const location   = useLocation();
  const { data: session, isLoading } = useSession();
  const isPublic   = PUBLIC_ROUTES.includes(location.pathname);

  // While session is loading, show a minimal spinner so there's no flash
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="brand-mark" style={{ width: 44, height: 44, borderRadius: 10 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">Loading KJET Dashboard...</p>
        </div>
      </div>
    );
  }

  // Not signed in and trying to access a protected route → redirect to login
  if (!session && !isPublic) {
    return <Navigate to="/login" />;
  }

  // Signed in and trying to access /login → redirect to dashboard
  if (session && isPublic) {
    return <Navigate to="/" />;
  }

  return (
    <>
      {session && <DriveEventListener />}
      <Outlet />
    </>
  );
}

