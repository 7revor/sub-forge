import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ApiError } from './api.ts';
import './index.css';
import { AppLayout, RequireAdmin } from './layout.tsx';
import { Account } from './pages/Account.tsx';
import { CollectionEdit, CollectionList } from './pages/Collections.tsx';
import { LocalEdit, LocalList } from './pages/Locals.tsx';
import { Login } from './pages/Login.tsx';
import { Overview } from './pages/Overview.tsx';
import { PresetEdit, PresetList } from './pages/Presets.tsx';
import { ProfileDetail } from './pages/profile/ProfileDetail.tsx';
import { ProfileList, ProfileNew } from './pages/profile/ProfileList.tsx';
import { BundleEdit, BundleList, RulesetEdit, RulesetList } from './pages/Rulesets.tsx';
import { SourceEdit, SourceList } from './pages/Sources.tsx';
import { TemplateEdit, TemplateList } from './pages/Templates.tsx';
import { Users } from './pages/Users.tsx';

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
            <Route path="profiles" element={<ProfileList />} />
            <Route path="profiles/new" element={<ProfileNew />} />
            <Route path="profiles/:id/:tab?" element={<ProfileDetail />} />
            <Route path="collections" element={<CollectionList />} />
            <Route path="collections/:id" element={<CollectionEdit />} />
            <Route path="locals" element={<LocalList />} />
            <Route path="locals/:id" element={<LocalEdit />} />
            <Route path="rulesets" element={<RulesetList />} />
            <Route path="rulesets/:id" element={<RulesetEdit />} />
            <Route path="bundles" element={<BundleList />} />
            <Route path="bundles/:id" element={<BundleEdit />} />
            <Route path="templates" element={<TemplateList />} />
            <Route path="templates/:id" element={<TemplateEdit />} />
            <Route path="presets" element={<RequireAdmin><PresetList /></RequireAdmin>} />
            <Route path="presets/:id" element={<RequireAdmin><PresetEdit /></RequireAdmin>} />
            <Route path="users" element={<RequireAdmin><Users /></RequireAdmin>} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<div className="text-muted">页面不存在</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
