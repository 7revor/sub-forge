import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type RepoScan, type RuleRepo } from '../api.ts';
import { Button, Card, ErrorAlert, Field, Input, PageHeader, PageScroll, Select, Textarea } from '../components/ui.tsx';

const blankScan = () => ({ ref: '', directory: '', include: '**/*.list\n**/*.txt', exclude: '', format: 'auto', client: 'any', groupBy: 'path', readme: false, preferred: '' });
const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
const toForm = (scan: RepoScan) => ({ ...scan, include: scan.include.join('\n'), exclude: scan.exclude.join('\n'), preferred: scan.preferred.join('\n') });

export function RuleRepoEditorPage() {
  const { id } = useParams();
  const { search } = useLocation();
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), enabled: !!id,
    refetchOnMount: 'always', refetchInterval: query => query.state.data?.repos.some(r => r.id === id && r.indexing) ? 3000 : false });
  if (id && (repos.isPending || repos.error || !repos.data?.repos.some(r => r.id === id))) return <>
    <PageHeader title="编辑仓库" crumbs={<Link to={`/rule-repo${search}`} className="text-muted hover:text-accent">规则仓库</Link>} />
    {repos.error ? <ErrorAlert error={repos.error} /> : <div className="text-muted">{repos.isPending ? '加载中…' : '仓库不存在或已删除。'}</div>}
  </>;
  return <RepositoryForm key={id ?? 'new'} repo={repos.data?.repos.find(r => r.id === id)} />;
}

function RepositoryForm({ repo }: { repo?: RuleRepo }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();
  const back = `/rule-repo${search}`;
  // 保留打开页面时的配置版本；后台刷新只更新同步状态，不覆盖编辑草稿。
  const [initial] = useState(() => ({ repo, form: { name: repo?.name ?? '', url: repo?.url ?? '', license: repo?.license ?? '' }, scans: repo?.scans.map(toForm) ?? [blankScan()] }));
  const [form, setForm] = useState(initial.form);
  const [scans, setScans] = useState(initial.scans);
  const dirty = JSON.stringify({ form, scans }) !== JSON.stringify({ form: initial.form, scans: initial.scans });
  const save = useMutation({
    meta: { successMessage: initial.repo ? '仓库配置已保存' : '仓库已添加，正在建立索引' },
    mutationFn: () => api(initial.repo ? 'PUT' : 'POST', initial.repo ? `/rule-repos/${initial.repo.id}` : '/rule-repos', {
      ...form, ...(form.license ? {} : { license: undefined }), configRevision: initial.repo?.configRevision,
      scans: scans.map(s => ({ ...s, include: lines(s.include), exclude: lines(s.exclude), preferred: lines(s.preferred) })),
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rule-repos'] });
      if (blocker.state === 'blocked') blocker.proceed(); else leave(back);
    },
  });
  const { blocker, leave } = useLeaveGuard(dirty || save.isPending);
  const canSave = !!form.url.trim() && scans.every(s => lines(s.include).length) && !save.isPending && !repo?.indexing;
  const submit = () => { if (canSave) save.mutate(); };
  const update = (index: number, patch: Partial<ReturnType<typeof blankScan>>) => setScans(scans.map((s, i) => i === index ? { ...s, ...patch } : s));
  return <>
    <PageHeader title={repo ? '编辑仓库' : '新增仓库'} subtitle={repo?.name}
      crumbs={<><Link to={back} className="text-muted hover:text-accent">规则仓库</Link> / {repo ? '编辑' : '新增'}</>}
      actions={<><Button disabled={save.isPending} onClick={() => navigate(back)}>返回列表</Button><Button variant="primary" disabled={!canSave} onClick={submit}>{save.isPending ? '保存中…' : repo ? (repo.enabled ? '保存并更新索引' : '保存配置') : '添加并建立索引'}</Button></>} />
    {blocker.state === 'blocked' && <section role="alert" aria-label="未保存修改" className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel p-3">
      <span className="text-[13px]">有未保存的修改，请选择如何离开。</span><div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending} onClick={() => blocker.reset()}>继续编辑</Button>
        <Button disabled={save.isPending} onClick={() => blocker.proceed()}>放弃修改并离开</Button>
        <Button variant="primary" disabled={!canSave} onClick={submit}>保存并离开</Button>
      </div>
    </section>}
    {repo?.indexing && <p role="status" className="m-0 text-[13px] text-muted">索引正在更新，完成后可保存修改。</p>}
    <ErrorAlert error={save.error} />
    <PageScroll>
    <form id="repository-form" className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); submit(); }}>
    <fieldset disabled={save.isPending} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
    <Card title="基本信息" bodyClass="grid gap-4 px-4 pb-4 md:grid-cols-2">
      <Field label="GitHub 仓库地址" hint="公开仓库，如 https://github.com/owner/repo">{id => <Input id={id} autoFocus value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />}</Field>
      <Field label="显示名称" hint="留空使用 owner/repo">{id => <Input id={id} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}</Field>
      <Field label="许可证说明" hint="留空使用上游信息">{id => <Input id={id} value={form.license} onChange={e => setForm({ ...form, license: e.target.value })} />}</Field>
    </Card>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-[17px] font-semibold">扫描范围</h2><Button disabled={scans.length >= 20} onClick={() => setScans([...scans, blankScan()])}>添加扫描范围</Button></div>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {scans.map((scan, i) => <section key={i} aria-label={`扫描范围 ${i + 1}`} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-panel p-4">
        <div className="flex items-center justify-between"><strong className="text-[13px]">扫描范围 {i + 1}</strong><Button size="sm" disabled={scans.length === 1} onClick={() => setScans(scans.filter((_, n) => n !== i))}>移除范围</Button></div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Field label="分支" hint="留空使用默认分支">{id => <Input id={id} value={scan.ref} onChange={e => update(i, { ref: e.target.value })} />}</Field>
          <Field label="扫描目录" hint="留空扫描整个仓库，包含所有子目录">{id => <Input id={id} value={scan.directory} onChange={e => update(i, { directory: e.target.value })} />}</Field>
        </div>
        <Field label="包含文件" hint="相对扫描目录，每行一个模式；** 可跨目录。仅支持 .list 和 .txt。">{id => <Textarea id={id} rows={2} className="font-mono" value={scan.include} onChange={e => update(i, { include: e.target.value })} />}</Field>
        <Field label="排除文件" hint="选填，每行一个模式，例如 tests/**">{id => <Textarea id={id} rows={2} className="font-mono" value={scan.exclude} onChange={e => update(i, { exclude: e.target.value })} />}</Field>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Field label="规则格式">{id => <Select id={id} value={scan.format} onChange={e => update(i, { format: e.target.value })}><option value="auto">自动识别</option><option value="classical">classical 文本</option><option value="domain">域名文本</option><option value="domain-set">DOMAIN-SET 域名列表</option><option value="ipcidr">纯 CIDR</option></Select>}</Field>
          <Field label="适用客户端">{id => <Select id={id} value={scan.client} onChange={e => update(i, { client: e.target.value })}><option value="any">通用</option><option value="mihomo">Mihomo</option><option value="surge">Surge</option></Select>}</Field>
        </div>
        <details><summary className="cursor-pointer text-[13px] text-muted">分组与推荐设置</summary><div className="mt-3 flex flex-col gap-3">
          <Field label="文件分组" hint="同组文件显示为同一规则的不同变体">{id => <Select id={id} value={scan.groupBy} onChange={e => update(i, { groupBy: e.target.value })}><option value="path">每个完整路径独立展示</option><option value="directory">按扫描目录内的父目录分组</option><option value="stem">按相对路径去除扩展名和尾空格分组</option></Select>}</Field>
          <Field label="优先推荐文件" hint="选填，按文件名匹配，每行一个通配模式">{id => <Textarea id={id} rows={2} value={scan.preferred} onChange={e => update(i, { preferred: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={scan.readme} onChange={e => update(i, { readme: e.target.checked })} />读取同目录 README 的使用说明与配置建议</label>
        </div></details>
      </section>)}
    </div>
      <p className="m-0 text-[12px] text-muted">范围重叠时使用上方配置。更新失败会保留旧索引；已导入的来源地址不随配置修改。</p>
    </fieldset>
    </form>
    </PageScroll>
  </>;
}
