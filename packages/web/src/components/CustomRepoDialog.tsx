import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { Button, ErrorAlert, Field, Input, Modal, Textarea } from './ui.tsx';

const EMPTY = { name: '', url: '', ref: '', directory: '', include: '**/*.list\n**/*.txt', exclude: '', format: 'auto' };
const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);

export function CustomRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const add = useMutation({ meta: { successMessage: '仓库已添加，正在建立索引' },
    mutationFn: () => api('POST', '/rule-repos', { ...form, include: lines(form.include), exclude: lines(form.exclude) }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['rule-repos'] }); onClose(); },
  });
  useEffect(() => { if (open) { setForm(EMPTY); add.reset(); } }, [open]);
  const close = () => { if (!add.isPending) onClose(); };
  return <Modal title="添加自定义 GitHub 仓库" open={open} onClose={close}
    footer={<><Button disabled={add.isPending} onClick={close}>取消</Button><Button variant="primary" disabled={!form.url.trim() || !lines(form.include).length || add.isPending} onClick={() => add.mutate()}>{add.isPending ? '检查仓库…' : '添加并建立索引'}</Button></>}>
    <Field label="GitHub 仓库地址" hint="公开仓库，如 https://github.com/owner/repo">{id => <Input id={id} autoFocus placeholder="https://github.com/owner/repo" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />}</Field>
    <Field label="显示名称" hint="留空使用 owner/repo">{id => <Input id={id} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}</Field>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
      <Field label="分支" hint="留空使用仓库默认分支">{id => <Input id={id} placeholder="默认分支" value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} />}</Field>
      <Field label="扫描目录" hint="相对路径；留空扫描整个仓库">{id => <Input id={id} placeholder="例如 rules" value={form.directory} onChange={e => setForm({ ...form, directory: e.target.value })} />}</Field>
    </div>
    <Field label="包含文件" hint="相对扫描目录，每行一个模式；* 匹配文件名，** 可跨目录，? 匹配单个字符。仅索引 .list 和 .txt 文件，其他扩展名一律忽略。">{id => <Textarea id={id} rows={4} className="font-mono" spellCheck={false} value={form.include} onChange={e => setForm({ ...form, include: e.target.value })} />}</Field>
    <Field label="排除文件" hint="选填，每行一个模式，如 tests/**">{id => <Textarea id={id} rows={2} className="font-mono" spellCheck={false} value={form.exclude} onChange={e => setForm({ ...form, exclude: e.target.value })} />}</Field>
    <ErrorAlert error={add.error} />
  </Modal>;
}
