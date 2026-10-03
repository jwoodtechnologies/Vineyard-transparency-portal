import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/router';
import PullToRefresh from '@/console/PullToRefresh';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PullToRefresh />
    <RouterProvider router={router} />
  </StrictMode>,
);
