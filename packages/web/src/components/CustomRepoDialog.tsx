import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type RepoScan, type RuleRepo } from '../api.ts';
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea } from './ui.tsx';

const blankScan = () => ({ ref: '', directory: '', include: '**/*.list\n**/*.txt', exclude: '', format: 'auto', client: 'any', groupBy: 'path', readme: false, preferred: '' });
const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
const toForm = (scan: RepoScan) => ({ ...scan, include: scan.include.join('\n'), exclude: scan.exclude.join('\n'), preferred: scan.preferred.join('\n') });

export function CustomRepoDialog({ open, repo, onClose }: { open: boolean; repo?: RuleRepo; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', url: '', license: '' });
  const [scans, setScans] = useState([blankScan()]);
  const save = useMutation({
    mutationFn: () => api(repo ? 'PUT' : 'POST', repo ? `/rule-repos/${repo.id}` : '/rule-repos', {
      ...form, ...(form.license ? {} : { license: undefined }), configRevision: repo?.configRevision,
      scans: scans.map(s => ({ ...s, include: lines(s.include), exclude: lines(s.exclude), preferred: lines(s.preferred) })),
    }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['rule-repos'] }); onClose(); },
  });
  useEffect(() => {
    if (open) { setForm({ name: repo?.name ?? '', url: repo?.url ?? '', license: repo?.license ?? '' }); setScans(repo?.scans.map(toForm) ?? [blankScan()]); save.reset(); }
  }, [open, repo]);
  const close = () => { if (!save.isPending) onClose(); };
  const update = (index: number, patch: Partial<ReturnType<typeof blankScan>>) => setScans(scans.map((s, i) => i === index ? { ...s, ...patch } : s));
  return <Modal title={repo ? '编辑 GitHub 仓库' : '添加 GitHub 仓库'} open={open} onClose={close}
    footer={<><Button disabled={save.isPending} onClick={close}>取消</Button><Button variant="primary" disabled={!form.url.trim() || scans.some(s => !lines(s.include).length) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? '保存中…' : repo ? (repo.enabled ? '保存并更新索引' : '保存配置') : '添加并建立索引'}</Button></>}>
    <fieldset disabled={save.isPending} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <Field label="GitHub 仓库地址" hint="公开仓库，如 https://github.com/owner/repo">{id => <Input id={id} autoFocus value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />}</Field>
      <Field label="显示名称" hint="留空使用 owner/repo">{id => <Input id={id} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}</Field>
      <Field label="许可证说明" hint="留空使用上游信息">{id => <Input id={id} value={form.license} onChange={e => setForm({ ...form, license: e.target.value })} />}</Field>
      {scans.map((scan, i) => <section key={i} aria-label={`扫描范围 ${i + 1}`} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line p-3">
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
      <Button disabled={scans.length >= 20} onClick={() => setScans([...scans, blankScan()])}>添加扫描范围</Button>
      <p className="m-0 text-[12px] text-muted">范围重叠时使用上方配置。更新失败会保留旧索引；已导入的来源地址不随配置修改。</p>
    </fieldset>
    <ErrorBox error={save.error} />
  </Modal>;
}
