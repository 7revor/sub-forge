import type { ReportItem } from '@sub-forge/core';
import { useEffect, useState } from 'react';
import { DualEditor, type EditorMode } from '../../components/DualEditor.tsx';
import { templateFormFromYaml, templateFromYaml, templateToYaml, type ConvertCtx, type TemplateBody } from '../../convert/templateYaml.ts';
import { TemplateGroupsEditor } from './TemplateGroupsEditor.tsx';
import { TemplateRulesEditor } from './TemplateRulesEditor.tsx';

export function TemplateEditor({ value, onChange, ctx, report, focus, onValidityChange, step, onStepChange }: {
  step: number; onStepChange: (step: number) => void;
  value: TemplateBody; onChange: (body: TemplateBody) => void; ctx: ConvertCtx; report: ReportItem[];
  focus: { where: string } | undefined; onValidityChange: (valid: boolean) => void;
}) {
  const [mode, setMode] = useState<EditorMode>('form');
  const [group, setGroup] = useState<string>();
  const [rule, setRule] = useState<string>();
  useEffect(() => {
    if (!focus) return;
    const colon = focus.where.indexOf(':');
    const kind = focus.where.slice(0, colon);
    const id = focus.where.slice(colon + 1);
    if (kind === 'group') { setGroup(id); onStepChange(0); }
    if (kind === 'rule') { setRule(id); onStepChange(1); }
    setMode('form');
  }, [focus]);
  useEffect(() => {
    if (!focus || mode !== 'form') return;
    const frame = requestAnimationFrame(() => document.getElementById(`template-${focus.where.replace(':', '-')}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [focus, group, rule, mode, step]);
  return <DualEditor value={value} onChange={onChange} rawLabel="mihomo YAML" mode={mode} onModeChange={setMode} onValidityChange={onValidityChange}
    toRaw={(body) => templateToYaml(body, ctx)} fromRaw={(text) => templateFromYaml(text, value, ctx)}
    recoverForm={(text) => templateFormFromYaml(text, value, ctx)} renderForm={() => <>
      {step === 0 && <TemplateGroupsEditor value={value} onChange={onChange} selected={group} onSelect={setGroup} report={report} />}
      {step === 1 && <TemplateRulesEditor value={value} onChange={onChange} selected={rule} onSelect={setRule} ctx={ctx} report={report} />}
    </>} />;
}
