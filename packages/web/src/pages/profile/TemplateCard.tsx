// 模板引用只修改当前草稿，由详情页统一保存。

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api.ts';
import { Card, ErrorBox, Field, Segmented, Select } from '../../components/ui.tsx';
import { useTemplates, type ProfileDoc, type TemplateDoc } from '../../hooks.ts';
import { useProfile } from './context.ts';
import { findOverlayOrphans } from './orphans.ts';

type TemplateDetails = { item: TemplateDoc; versions: { version: number; changelog?: string; createdAt: number }[] };

/** bare：放进对话框时不套卡片 */
export function TemplateCard({ bare = false }: { bare?: boolean } = {}) {
  const { draft, setDraft, template } = useProfile();
  const templates = useTemplates();
  const ref = draft.template;
  const details = useQuery({
    queryKey: ['template-versions', ref?.id], enabled: !!ref,
    queryFn: () => api<TemplateDetails>('GET', `/templates/${ref!.id}`),
  });
  const change = useMutation({
    mutationFn: async (next: ProfileDoc['template']) => ({
      next,
      template: next ? (await api<{ item: TemplateDoc }>('GET', next.follow === 'latest' ? `/templates/${next.id}` : `/templates/${next.id}/versions/${next.follow.pinned}`)).item : undefined,
    }),
    onSuccess: ({ next, template: nextTemplate }) => {
      const orphans = findOverlayOrphans(draft.overlay, nextTemplate);
      const total = Object.values(orphans).reduce((sum, ids) => sum + ids.length, 0);
      if (total && !confirm(`切换后将有 ${total} 个孤儿覆盖项：组覆盖 ${orphans.groupPatches.length} 个、规则覆盖 ${orphans.rulePatches.length} 个、私有组锚点 ${orphans.extraGroups.length} 个、私有规则锚点 ${orphans.extraRules.length} 个。覆盖层会保留，请在策略组、规则或预览中检查。是否继续？`)) return;
      const { template: _template, ...rest } = draft;
      setDraft({ ...rest, ...(next ? { template: next } : {}) });
    },
  });
  const pinned = ref && ref.follow !== 'latest' ? ref.follow.pinned : undefined;
  const versions = details.data?.versions ?? [];

  const body = (
      <div className="flex flex-col gap-3.5">
        <p className="m-0 text-[13px] text-muted">{ref ? `${template?.name ?? ref.id} · v${template?.version ?? pinned ?? '?'} · ${pinned === undefined ? '跟随最新' : '锁定版本'}` : '不使用模板'}</p>
        <ErrorBox error={templates.error ?? details.error ?? change.error} />
        <Field label="更换模板" hint="覆盖项会保留；修改后点击右上角保存">{(id) => (
          <Select id={id} value={ref?.id ?? ''} disabled={change.isPending || templates.isPending || templates.isError}
            onChange={(e) => change.mutate(e.target.value ? { id: e.target.value, follow: 'latest' } : undefined)}>
            <option value="">不使用模板</option>
            {ref && !templates.data?.some((t) => t.id === ref.id) && <option value={ref.id}>{template?.name ?? ref.id}</option>}
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}（v{t.version}）</option>)}
          </Select>
        )}</Field>
        {ref && <>
          <fieldset disabled={change.isPending || !details.data || details.isError} className="m-0 min-w-0 border-0 p-0">
            <Segmented label="跟随" value={pinned === undefined ? 'latest' : 'pinned'} options={[{ value: 'latest', label: '跟随最新' }, { value: 'pinned', label: '锁定版本' }]}
              onChange={(value) => change.mutate({ id: ref.id, follow: value === 'latest' ? 'latest' : { pinned: template?.version ?? details.data!.item.version } })} />
          </fieldset>
          {pinned !== undefined && <Field label="锁定版本">{(id) => (
            <Select id={id} value={pinned} disabled={change.isPending || !details.data || details.isError}
              onChange={(e) => change.mutate({ id: ref.id, follow: { pinned: Number(e.target.value) } })}>
              {!versions.some((v) => v.version === pinned) && <option value={pinned}>v{pinned}</option>}
              {versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.changelog ? ` · ${v.changelog}` : ''}</option>)}
            </Select>
          )}</Field>}
        </>}
      </div>
  );
  return bare ? body : <Card title="模板">{body}</Card>;
}
