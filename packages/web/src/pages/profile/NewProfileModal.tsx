import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../../modals/index.tsx';
import { Button, Field, Input, Select, cx } from '../../components/ui.tsx';
import { useSaveDoc, useTemplates, type ProfileDoc } from '../../hooks.ts';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group.tsx';
import { Label } from '../../components/ui/label.tsx';

/** 新建只选择名称与分流起点，创建成功后进入完整编辑工作区。 */
export const NewProfileModal = createModal<{ templateId?: string }, ProfileDoc>(function NewProfile({ data, modal }) {
  const [name, setName] = useModalDraft('');
  const [mode, setMode] = useModalDraft<'template' | 'blank'>(data.templateId ? 'template' : 'blank');
  const [templateId, setTemplateId] = useModalDraft(data.templateId ?? '');
  const templates = useModalPresentation(useTemplates().data ?? []);
  const save = useSaveDoc('profiles', true);
  const ready = !!name.trim() && (mode === 'blank' || !!templates.find(t => t.id === templateId));
  return <ModalContent className="sm:max-w-[440px]" aria-describedby={undefined}>
    <ModalHeader><ModalTitle>新建配置订阅</ModalTitle></ModalHeader>
    <div className="flex flex-col gap-4">
      <Field label="名称">{id => <Input id={id} autoFocus placeholder="例如：日常使用" value={name} onChange={event => setName(event.target.value)} />}</Field>
      <Field label="分流起点">{() => <RadioGroup aria-label="分流起点" value={mode} onValueChange={value => setMode(value as typeof mode)} className="flex gap-6">{([{ value: 'template', label: '跟随模板' }, { value: 'blank', label: '空白开始' }] as const).map(option => <Label key={option.value} className="cursor-pointer font-normal"><RadioGroupItem value={option.value} />{option.label}</Label>)}</RadioGroup>}</Field>
      {mode === 'template' && <Field label="模板">{id => <Select id={id} placeholder="选择作为分流起点的模板" value={templateId} onChange={event => setTemplateId(event.target.value)}>{templates.map(template => <option key={template.id} value={template.id}>{template.name} · {template.groups.length} 组 · {template.rules.length} 规则</option>)}</Select>}</Field>}
    </div>
    <ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!ready || modal.pending} onClick={() => modal.submit(() => save.mutateAsync({
      name: name.trim(), userinfo: { mode: 'sources', sourceIds: [] }, nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
      routing: mode === 'template' ? { mode: 'bound', templateId, groupAdditions: {} } : { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } },
    }))}>{modal.pending ? '创建中…' : '创建并编辑'}</Button></ModalFooter>
  </ModalContent>;
});
