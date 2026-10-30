import { LoonImportPage } from './pages/profile/LoonImport.tsx';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router';
import { ModalRoot } from './modals/index.tsx';
import { FeedbackHost } from './components/FeedbackHost.tsx';
import { alertError, notifySuccess } from './feedback.ts';
import { ApiError } from './api.ts';
import './index.css';
import { AppLayout, RequireAdmin } from './layout.tsx';
import { Account } from './pages/Account.tsx';
import { CollectionEdit, CollectionList } from './pages/Collections.tsx';
import { LocalEdit, LocalList, LocalNodeEdit } from './pages/Locals.tsx';
import { Login } from './pages/Login.tsx';
import { Overview } from './pages/Overview.tsx';
import { ProfileDetail } from './pages/profile/ProfileDetail.tsx';
import { ProfileList, ProfileNew } from './pages/profile/ProfileList.tsx';
import { RulesetEdit, RulesetList } from './pages/Rulesets.tsx';
import { SourceEdit, SourceList } from './pages/Sources.tsx';
import { TemplateEdit, TemplateList } from './pages/Templates.tsx';
import { RuleRepoEditorPage } from './pages/RuleRepoEdit.tsx';
import { RuleRepoPage } from './pages/RuleRepo.tsx';
import { System } from './pages/System.tsx';
import { Users } from './pages/Users.tsx';

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _result, mutation) => {
      const message = mutation.meta?.successMessage;
      if (typeof message === 'string') notifySuccess(message);
    },
    onError: (error, _variables, _result, mutation) => { if (!mutation.meta?.modalErrors) alertError(error); },
  }),
  defaultOptions: {
    queries: {
      // 401 / 403 / 404 重试没有意义
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
      staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
    },
  },
});

const router = createBrowserRouter(createRoutesFromElements(
  <Route element={<ModalRoot />}>
    <Route path="/login" element={<Login />} />
    <Route element={<AppLayout />}>
      <Route index element={<Overview />} />
      <Route path="sources" element={<SourceList />} />
      <Route path="sources/:id" element={<SourceEdit />} />
      <Route path="profiles" element={<ProfileList />} />
      <Route path="profiles/import-loon" element={<LoonImportPage />} />
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
      <Route path="system" element={<RequireAdmin><System /></RequireAdmin>} />
      <Route path="users" element={<RequireAdmin><Users /></RequireAdmin>} />
      <Route path="account" element={<Account />} />
      <Route path="*" element={<div className="text-ink-muted">页面不存在</div>} />
    </Route>
  </Route>
));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <FeedbackHost />
    </QueryClientProvider>
  </StrictMode>,
);
