import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ApiError } from './api.ts';
import './index.css';
import { AppLayout } from './layout.tsx';
import { Account } from './pages/Account.tsx';
import { Login } from './pages/Login.tsx';
import { Overview } from './pages/Overview.tsx';
import { SourceEdit, SourceList } from './pages/Sources.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 401 / 403 / 404 重试没有意义
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppLayout />}>
            <Route index element={<Overview />} />
            <Route path="sources" element={<SourceList />} />
            <Route path="sources/:id" element={<SourceEdit />} />
            {/* ROUTES */}
            <Route path="account" element={<Account />} />
            <Route path="*" element={<div className="text-muted">页面不存在</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
