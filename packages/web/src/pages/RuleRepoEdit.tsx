import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type RuleRepo } from '../api.ts';
import { Button, Card, ErrorAlert, Field, Input, PageHeader, PageScroll } from '../components/ui.tsx';

import { blankRepoLocation, groupRepoLocations, serializeRepoLocations, type RepoLocation } from '../domain/repoLocations.ts';

export function RuleRepoEditorPage() {
  const { id } = useParams();
  const { search } = useLocation();
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), enabled: !!id,
    refetchOnMount: 'always', refetchInterval: query => query.state.data?.repos.some(r => r.id === id && r.indexing) ? 3000 : false });
  if (id && (repos.isPending || repos.error || !repos.data?.repos.some(r => r.id === id))) return <>
    <PageHeader title="编辑仓库" crumbs={<Link to={`/rule-repo${search}`} className="text-ink-muted hover:text-brand">规则集合</Link>} />
    {repos.error ? <ErrorAlert error={repos.error} /> : <div className="text-ink-muted">{repos.isPending ? '加载中…' : '仓库不存在或已删除。'}</div>}
  </>;
  return <RepositoryForm key={id ?? 'new'} repo={repos.data?.repos.find(r => r.id === id)} />;
}

function RepositoryForm({ repo }: { repo?: RuleRepo }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();
  const back = `/rule-repo${search}`;
  // 保留打开页面时的配置版本；后台刷新只更新同步状态，不覆盖编辑草稿。
  const [initial] = useState(() => ({ repo, form: { name: repo?.name ?? '', url: repo?.url ?? '', license: repo?.license ?? '' }, locations: repo ? groupRepoLocations(repo.scans) : [blankRepoLocation(0)] }));
  const [form, setForm] = useState(initial.form);
  const [locations, setLocations] = useState(initial.locations);
  const nextLocationId = useRef(locations.length);
  const scanCount = locations.reduce((sum, l) => sum + l.filters.length, 0);
  const dirty = JSON.stringify({ form, locations }) !== JSON.stringify({ form: initial.form, locations: initial.locations });
  const save = useMutation({
    meta: { successMessage: initial.repo ? '仓库配置已保存' : '仓库已添加，正在建立索引' },
    mutationFn: () => api(initial.repo ? 'PUT' : 'POST', initial.repo ? `/rule-repos/${initial.repo.id}` : '/rule-repos', {
      ...form, ...(form.license ? {} : { license: undefined }), configRevision: initial.repo?.configRevision,
      scans: serializeRepoLocations(locations),
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rule-repos'] });
      if (blocker.state === 'blocked') blocker.proceed(); else leave(back);
    },
  });
  const { blocker, leave } = useLeaveGuard(dirty || save.isPending);
  const canSave = !!form.url.trim() && !save.isPending && !repo?.indexing;
  const submit = () => { if (canSave) save.mutate(); };
  const updateLocation = (id: number, patch: Partial<RepoLocation>) => setLocations(locations.map(l => l.id === id ? { ...l, ...patch } : l));
  return <>
    <PageHeader title={repo ? '编辑仓库' : '新增仓库'} subtitle={repo?.name}
      crumbs={<><Link to={back} className="text-ink-muted hover:text-brand">规则集合</Link> / {repo ? '编辑' : '新增'}</>}
      actions={<><Button disabled={save.isPending} onClick={() => navigate(back)}>返回列表</Button><Button variant="primary" disabled={!canSave} onClick={submit}>{save.isPending ? '保存中…' : repo ? (repo.enabled ? '保存并更新索引' : '保存配置') : '添加并建立索引'}</Button></>} />
    {blocker.state === 'blocked' && <section role="alert" aria-label="未保存修改" className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel p-3">
      <span className="text-[13px]">有未保存的修改，请选择如何离开。</span><div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending} onClick={() => blocker.reset()}>继续编辑</Button>
        <Button disabled={save.isPending} onClick={() => blocker.proceed()}>放弃修改并离开</Button>
        <Button variant="primary" disabled={!canSave} onClick={submit}>保存并离开</Button>
      </div>
    </section>}
    {repo?.indexing && <p role="status" className="m-0 text-[13px] text-ink-muted">索引正在更新，完成后可保存修改。</p>}
    <ErrorAlert error={save.error} />
    <PageScroll>
    <form id="repository-form" className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); submit(); }}>
    <fieldset disabled={save.isPending} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
    <Card title="基本信息" bodyClass="grid gap-4 px-4 pb-4 md:grid-cols-2">
      <Field label="GitHub 仓库地址" hint="公开仓库，如 https://github.com/owner/repo；通过 Git 校验仓库和分支">{id => <Input id={id} autoFocus value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />}</Field>
      <Field label="显示名称" hint="留空使用 owner/repo">{id => <Input id={id} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}</Field>
      <details className="md:col-span-2"><summary className="cursor-pointer text-[13px] text-ink-muted">许可证说明</summary><div className="mt-3">
        <Field label="许可证" hint="可填写许可证名称或说明；留空请参阅上游仓库许可证">{id => <Input id={id} value={form.license} onChange={e => setForm({ ...form, license: e.target.value })} />}</Field>
      </div></details>
    </Card>
    <Card title="规则位置" subtitle="仅接受 .list 和 .txt 文本规则，支持 Clash classical、域名和 IP 列表，内容自动识别。"
      actions={<Button disabled={scanCount >= 20} onClick={() => setLocations([...locations, blankRepoLocation(nextLocationId.current++)])}>添加位置</Button>}>
      <div className="grid items-start gap-3 xl:grid-cols-2">
        {locations.map((location, i) => <section key={location.id} aria-label={`规则位置 ${i + 1}`} className="rounded-lg border border-line-2 p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><strong className="text-[13px]">位置 {i + 1}</strong>
            {locations.length > 1 && <Button size="sm" variant="ghost" onClick={() => setLocations(locations.filter(l => l.id !== location.id))}>移除位置</Button>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="分支" hint="留空通过 Git 识别默认分支">{id => <Input id={id} value={location.ref} onChange={e => updateLocation(location.id, { ref: e.target.value })} />}</Field>
            <Field label="目录" hint="留空扫描整个仓库">{id => <Input id={id} value={location.directory} onChange={e => updateLocation(location.id, { directory: e.target.value })} />}</Field>
          </div>
        </section>)}
      </div>
    </Card>
    </fieldset>
    </form>
    </PageScroll>
  </>;
}
