// 仓库页只保留统一级联选择器，选中文件后直接创建或加入规则集。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { RuleCatalogPicker } from '../components/RuleSetPicker.tsx';
import { useMe } from '../hooks.ts';
import { api, type RuleRepo } from '../api.ts';
import type { RuleCatalogSelection } from '../domain/ruleCatalog.ts';
import { Card, ErrorAlert, PageHeader } from '../components/ui.tsx';

export function RuleRepoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [params] = useSearchParams();
  const ruleset = params.get('ruleset');
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  const create = useMutation({ meta: { successMessage: ruleset ? '规则文件已加入规则集' : '规则集已创建' },
    mutationFn: (selection: RuleCatalogSelection) => {
      if (selection.source !== 'repository') throw new Error('请选择仓库文件');
      return api<{ item: { id: string } }>('POST', '/rule-repos/import', { repo: selection.repo, path: selection.entry, file: selection.file, ...(ruleset ? { ruleset } : {}) });
    },
    onSuccess: async r => { await qc.invalidateQueries({ queryKey: ['rulesets'] }); navigate(ruleset ? `/rulesets/${ruleset}` : `/rulesets/${r.item.id}`); },
  });
  return <>
    <PageHeader title="规则仓库" />
    <RepositoryManager repos={repos.data?.repos ?? []} admin={me.data?.role === 'admin'} />
    <Card title={ruleset ? '加入规则集' : '新建规则集'} subtitle="依次选择仓库、分类目录和具体文件。根目录文件可直接选择。">
      <div className="max-w-[560px]"><RuleCatalogPicker scope="repository" label={create.isPending ? '正在创建…' : '选择仓库文件'} disabled={create.isPending} onSelect={selection => create.mutate(selection)} /></div>
      {ruleset && <Link to={`/rulesets/${ruleset}`} className="mt-3 inline-block text-[13px] text-accent">返回规则集</Link>}
    </Card>
    <ErrorAlert error={repos.error ?? create.error} />
  </>;
}
