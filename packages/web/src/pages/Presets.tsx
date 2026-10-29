// 基础设置预设（BS-03）：管理员维护，配置订阅引用；mihomo 段使用表单与 YAML 编辑。

import { useState } from 'react';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { Card, ErrorBox, Field, Input } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { DualEditor } from '../components/DualEditor.tsx';
import { SchemaForm } from '../components/SchemaForm.tsx';
import { baseFormFromYaml, baseFromYaml, baseToYaml } from '../convert/baseYaml.ts';
import { baseFromForm, baseToForm, mihomoBaseGroups } from '../schemas/mihomoBase.ts';
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
  const [rawValid, setRawValid] = useState(true);
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;

  return (
    <DetailShell listPath="/presets" listLabel="基础设置预设" isNew={e.isNew} name={d.name} dirty={e.dirty || !rawValid} saving={e.save.isPending} saveDisabled={!rawValid}
      onSave={() => rawValid && e.submit((x) => ({ ...x, version: e.isNew ? 1 : x.version + 1 }))} saveError={e.save.error} onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}>
      <p className="m-0 text-[13px] text-muted">Surge 段在 M2 提供</p>
      <Card title="预设">
        <div className="flex flex-col gap-3.5">
          <Field label="名称" hint={e.isNew ? undefined : `当前 v${d.version}，保存后版本号加一`}>{(id) => <Input id={id} value={d.name} onChange={(x) => e.setDraft({ ...d, name: x.target.value })} />}</Field>
          <DualEditor value={d.mihomo} onChange={(mihomo) => e.setDraft({ ...d, mihomo })}
            toRaw={baseToYaml} fromRaw={baseFromYaml} recoverForm={baseFormFromYaml} onValidityChange={setRawValid} rawLabel="mihomo YAML"
            renderForm={() => <SchemaForm groups={mihomoBaseGroups} value={baseToForm(d.mihomo)} extra
              onChange={(value) => e.setDraft({ ...d, mihomo: baseFromForm(value, d.mihomo) })} />} />
        </div>
      </Card>
    </DetailShell>
  );
}
