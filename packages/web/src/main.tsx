import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router';
import { ApiError } from './api.ts';
import './index.css';
import { AppLayout, RequireAdmin } from './layout.tsx';
import { Account } from './pages/Account.tsx';
import { CollectionEdit, CollectionList } from './pages/Collections.tsx';
import { LocalEdit, LocalList, LocalNodeEdit } from './pages/Locals.tsx';
import { Login } from './pages/Login.tsx';
import { Overview } from './pages/Overview.tsx';
import { PresetEdit, PresetList } from './pages/Presets.tsx';
import { ProfileDetail } from './pages/profile/ProfileDetail.tsx';
import { ProfileList, ProfileNew } from './pages/profile/ProfileList.tsx';
import { RulesetEdit, RulesetList } from './pages/Rulesets.tsx';
import { SourceEdit, SourceList } from './pages/Sources.tsx';
import { TemplateEdit, TemplateList } from './pages/Templates.tsx';
import { RuleRepoEditorPage } from './pages/RuleRepoEdit.tsx';
import { RuleRepoSettingsPage } from './pages/RuleRepoSettings.tsx';
import { RuleRepoPage } from './pages/RuleRepo.tsx';
import { System } from './pages/System.tsx';
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

const router = createBrowserRouter(createRoutesFromElements(
  <>
    <Route path="/login" element={<Login />} />
    <Route element={<AppLayout />}>
      <Route index element={<Overview />} />
      <Route path="sources" element={<SourceList />} />
      <Route path="sources/:id" element={<SourceEdit />} />
      <Route path="profiles" element={<ProfileList />} />
      <Route path="profiles/new" element={<ProfileNew />} />
      <Route path="profiles/:id/:tab?" element={<ProfileDetail />} />
      <Route path="collections" element={<CollectionList />} />
      <Route path="collections/:id/:tab?" element={<CollectionEdit />} />
      <Route path="locals" element={<LocalList />} />
      <Route path="locals/:id" element={<LocalEdit />} />
      <Route path="locals/:id/nodes/:index" element={<LocalNodeEdit />} />
      <Route path="rulesets" element={<RulesetList />} />
      <Route path="rulesets/:id" element={<RulesetEdit />} />
      <Route path="templates" element={<RequireAdmin><TemplateList /></RequireAdmin>} />
      <Route path="templates/manage" element={<RequireAdmin><Navigate to="/templates" replace /></RequireAdmin>} />
      <Route path="templates/:id/:tab?" element={<RequireAdmin><TemplateEdit /></RequireAdmin>} />
      <Route path="rule-repo" element={<RuleRepoPage />} />
      <Route path="rule-repo/new" element={<RequireAdmin><RuleRepoEditorPage /></RequireAdmin>} />
      <Route path="rule-repo/:id/edit" element={<RequireAdmin><RuleRepoEditorPage /></RequireAdmin>} />
      <Route path="rule-repo/settings" element={<RequireAdmin><RuleRepoSettingsPage /></RequireAdmin>} />
      <Route path="system" element={<RequireAdmin><System /></RequireAdmin>} />
      <Route path="presets" element={<RequireAdmin><PresetList /></RequireAdmin>} />
      <Route path="presets/:id" element={<RequireAdmin><PresetEdit /></RequireAdmin>} />
      <Route path="users" element={<RequireAdmin><Users /></RequireAdmin>} />
      <Route path="account" element={<Account />} />
      <Route path="*" element={<div className="text-muted">页面不存在</div>} />
    </Route>
  </>
));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
