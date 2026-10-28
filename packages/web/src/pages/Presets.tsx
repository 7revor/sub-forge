// 基础设置预设（BS-03）：管理员维护，配置订阅引用；首期只有 mihomo 段，用 JSON 编辑。

import { useEffect, useState } from 'react';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { Card, ErrorBox, Field, Input, Textarea } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import type { PresetDoc } from '../hooks.ts';

export function PresetList() {
  return (
    <DocList kind="presets" title="基础设置预设" intro="通用、DNS、TUN、嗅探等设置。预设更新会同步到引用它的配置订阅，它们自己覆盖的项保持不变。"
      columns={[
        { header: '名称', cell: (p) => p.name },
        { header: '版本', cell: (p) => <span className="font-mono">v{p.version}</span> },
        { header: '字段', cell: (p) => <span className="font-mono text-[12.5px] text-muted">{Object.keys(p.mihomo).join(', ')}</span> },
      ]} />
  );
}

const EMPTY: PresetDoc = { id: '', name: '', version: 1, mihomo: { 'mixed-port': 7890, mode: 'rule', 'log-level': 'warning' } };

export function PresetEdit() {
  const e = useDocEditor('presets', EMPTY);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (e.draft) setText(JSON.stringify(e.draft.mihomo, null, 2)); }, [e.doc.data, e.isNew]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;

  return (
    <DetailShell listPath="/presets" listLabel="基础设置预设" isNew={e.isNew} name={d.name} dirty={e.dirty && !err} saving={e.save.isPending}
      onSave={() => e.submit((x) => ({ ...x, version: e.isNew ? 1 : x.version + 1 }))} saveError={e.save.error} onDelete={() => e.remove(d.name)} deleteError={e.del.error}>
      <Card title="预设">
        <div className="flex flex-col gap-3.5">
          <Field label="名称" hint={e.isNew ? undefined : `当前 v${d.version}，保存后版本号加一`}>{(id) => <Input id={id} value={d.name} onChange={(x) => e.setDraft({ ...d, name: x.target.value })} />}</Field>
          <Field label="mihomo 段（JSON）" hint={err ? <span className="text-err">JSON 无效：{err}</span> : '直接写 mihomo 配置顶层字段，如 dns、tun、sniffer'}>
            {(id) => <Textarea id={id} rows={22} spellCheck={false} className="font-mono text-[12.5px] leading-[1.6]" value={text} onChange={(x) => {
              setText(x.target.value);
              try {
                const v = JSON.parse(x.target.value) as unknown;
                if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('需要 JSON 对象');
                setErr('');
                e.setDraft({ ...d, mihomo: v as Record<string, unknown> });
              } catch (y) { setErr((y as Error).message); }
            }} />}
          </Field>
        </div>
      </Card>
    </DetailShell>
  );
}
