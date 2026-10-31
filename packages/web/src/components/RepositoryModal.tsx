import { api, type RuleRepo } from '../api.ts';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { blankRepoLocation, groupRepoLocations, serializeRepoLocations } from '../domain/repoLocations.ts';
import { Button, Field, Input } from './ui.tsx';

export const RepositoryModal = createModal<{ repo?: RuleRepo }>(function Repository({ data: { repo }, modal }) {
  const [form, setForm] = useModalDraft({ name: repo?.name ?? '', url: repo?.url ?? '', license: repo?.license ?? '' });
  const [locations, setLocations] = useModalDraft(repo ? groupRepoLocations(repo.scans) : [blankRepoLocation(0)]);
  return <ModalContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[440px]">
    <ModalHeader className="px-6 pt-5 pb-4"><ModalTitle>{repo ? '编辑规则仓库' : '添加规则仓库'}</ModalTitle></ModalHeader>
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-5">
      <Field label="GitHub 地址">{id => <Input id={id} autoFocus placeholder="输入公开 GitHub 仓库地址" value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} />}</Field>
      <Field label="显示名称">{id => <Input id={id} placeholder="留空使用 owner/repo" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />}</Field>
      <section><div className="mb-1.5 flex items-center justify-between"><h3 className="m-0 text-[length:var(--text-control)] font-medium text-ink-muted">扫描位置</h3></div>
        <div className="flex flex-col gap-3">{locations.map((location, index) => <div key={location.id} className=""><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-end gap-2">
          <Field className="[&>label]:sr-only" label={`分支 ${index + 1}`}>{id => <Input id={id} placeholder="自动识别默认分支" value={location.ref} onChange={event => setLocations(locations.map(row => row.id === location.id ? { ...row, ref: event.target.value } : row))} />}</Field>
          <Field className="[&>label]:sr-only" label="目录">{id => <Input id={id} placeholder="留空扫描整个仓库" value={location.directory} onChange={event => setLocations(locations.map(row => row.id === location.id ? { ...row, directory: event.target.value } : row))} />}</Field>
          <Button size="sm" variant="ghost" aria-label={`移除扫描位置 ${index + 1}`} disabled={locations.length <= 1} onClick={() => setLocations(locations.filter(row => row.id !== location.id))}>×</Button>
        </div></div>)}</div><Button size="sm" variant="ghost" className="mt-2" disabled={locations.reduce((sum, location) => sum + location.filters.length, 0) >= 20} onClick={() => setLocations([...locations, blankRepoLocation(Math.max(-1, ...locations.map(location => location.id)) + 1)])}>添加位置</Button>
      </section>
      <details><summary className="cursor-pointer text-[length:var(--text-control)] text-ink-muted">许可证说明</summary><div className="mt-3"><Field label="许可证">{id => <Input id={id} placeholder="填写许可证名称或说明" value={form.license} onChange={event => setForm({ ...form, license: event.target.value })} />}</Field></div></details>
    </div>
    <ModalFooter className="border-t border-line-2 px-6 py-3"><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!form.url.trim() || modal.pending || repo?.indexing} onClick={() => modal.submit(async () => { await api(repo ? 'PUT' : 'POST', repo ? `/rule-repos/${repo.id}` : '/rule-repos', { ...form, license: form.license || undefined, configRevision: repo?.configRevision, scans: serializeRepoLocations(locations) }); })}>{modal.pending ? '保存中…' : repo ? '保存配置' : '添加并建立索引'}</Button></ModalFooter>
  </ModalContent>;
});
