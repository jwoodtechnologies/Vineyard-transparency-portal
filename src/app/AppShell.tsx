import { Suspense } from 'react';
import { Outlet, ScrollRestoration } from 'react-router-dom';
import { DemoDataStrip, OfflineStrip } from '@/components/layout/Banners';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { ReportIssueDialog } from '@/components/report/ReportIssueDialog';
import { Skeleton } from '@/components/ui/Skeleton';

function PageFallback() {
  return (
    <div className="container-page py-12" role="status" aria-label="Loading page">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="mt-4 h-4 w-2/3" />
      <Skeleton className="mt-10 h-40 w-full" />
    </div>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-accent px-4 py-2 font-medium text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <DemoDataStrip />
      <OfflineStrip />
      <Header />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <ReportIssueDialog />
      <ScrollRestoration />
    </div>
  );
}
