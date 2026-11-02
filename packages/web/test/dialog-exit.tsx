// 仅供 Codex 内置浏览器验收，不进入生产构建；节点数据使用隔离验收服务。
import { observeDialogExits, type ExitRecord } from './observe-dialog-exit.ts';
import { RemoteRuleDialog } from '../src/components/RemoteRulePicker.tsx';
import { RuleEditDialog } from '../src/pages/template/RuleEditDialog.tsx';
import { ProfileInfoModal } from '../src/pages/profile/ProfileInfoModal.tsx';
import { RulesetSourceDialog } from '../src/components/RulesetSourceDialog.tsx';
import { RepositoryModal } from '../src/components/RepositoryModal.tsx';
import { NamedCreateDialog } from '../src/components/NamedCreateDialog.tsx';
import { NodeSetPickerDialog } from '../src/components/dialogs.tsx';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Link, useNavigate } from 'react-router';
import { Frame as FrameApi } from '../src/modals/Frame.tsx';
import { createModal, ModalRoot, ModalContent, ModalHeader, ModalTitle, useModalDraft, useModalPresentation } from '../src/modals/index.tsx';
import { ProfileGroupDialog } from '../src/pages/profile/ProfileGroupDialog.tsx';
import { ChainRuleModal } from '../src/pages/profile/ChainRuleModal.tsx';
import { exactNodeFilter } from '../src/pages/profile/memberModel.ts';
import type { ProfileModalData } from '../src/pages/profile/modalProfile.ts';
import { RuleSourcePreview } from '../src/components/RuleSourcePreview.tsx';
import { Button, Input } from '../src/components/ui.tsx';
import { TemplateGroupsEditor } from '../src/pages/template/TemplateGroupsEditor.tsx';
import type { TemplateBody } from '../src/convert/templateYaml.ts';
import '../src/index.css';

const nodeFixture = { nodeSet: { type: 'local' as const, id: 'self' }, name: '自建落地' };
const profileFixture: ProfileModalData = {
  profile: { id: 'exit-check', name: '代理链退场验收', nodeSets: [{ ref: nodeFixture.nodeSet, output: 'inline' }, { ref: { type: 'local', id: 'relay' }, output: 'provider' }], chains: [], routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } },
  nodeSets: [{ ref: nodeFixture.nodeSet, name: nodeFixture.name }, { ref: { type: 'local', id: 'relay' }, name: '中转机场' }],
};

const QueryModal = createModal<Record<string, never>>(function QueryBody({ modal }) {
  const [text, setText] = useState('初次读取的文件正文\n规则一\n规则二');
  const view = useModalPresentation(text);
  useEffect(() => { if (!modal.active) setText(''); }, [modal.active]);
  return <ModalContent><ModalHeader><ModalTitle>查询展示快照</ModalTitle></ModalHeader><pre>{view}</pre><Button onClick={() => setText('最新读取的正文\n新增规则一\n新增规则二\n新增规则三')}>更新打开时的结果</Button><Button onClick={modal.cancel}>关闭并清空查询结果</Button></ModalContent>;
});
const NestedModal = createModal<{ name: string }, string>(function NestedBody({ data, modal }) {
  const [name, setName] = useModalDraft(data.name);
  return <ModalContent><ModalHeader><ModalTitle>嵌套草稿与路由验收</ModalTitle></ModalHeader><Input placeholder="输入独立草稿名称" value={name} onChange={e => setName(e.target.value)} />
    <Button onClick={async () => { const result = await FrameApi.modal.prompt({ title: '子弹窗', initialValue: name, placeholder: '输入子弹窗草稿' }); if (result.status === 'confirmed') setName(result.data); }}>打开子弹窗</Button>
    <Button onClick={() => void QueryModal.show({})}>打开嵌套查询预览</Button>
    <Link to="/test/dialog-exit.html?route=next">切换路由</Link><Button onClick={modal.cancel}>取消</Button><Button onClick={() => modal.confirm(name)}>保存</Button></ModalContent>;
});

// 路由离开与 Host 真正卸载分开验证：卸载结果在 Host 外展示。
let hostOutcome: Promise<unknown> | undefined;
const HostUnmountModal = createModal<Record<string, never>>(function HostUnmountBody() {
  return <ModalContent><ModalHeader><ModalTitle>Host 卸载验收</ModalTitle></ModalHeader><Input placeholder="填写卸载前的草稿" defaultValue="不能残留的会话" /><Link to="/test/host-off">卸载弹窗 Host</Link></ModalContent>;
});
function HostOff() {
  const [result, setResult] = useState('等待取消结果');
  useEffect(() => { void hostOutcome?.then(value => setResult(JSON.stringify(value))); }, []);
  return <main className="p-8"><h1>Host 已卸载</h1><pre aria-label="Host 卸载结果">{result}</pre><Link to="/test/dialog-exit.html">重新挂载 Host</Link></main>;
}

function App() {
  const navigate = useNavigate();
  const [results, setResults] = useState<ExitRecord[]>([]);
  const [slow, setSlow] = useState(false);
  useEffect(() => observeDialogExits(record => setResults(items => [...items, record])), []);
  const [body, setBody] = useState<TemplateBody>({ groups: [{ id: 'first', name: '退场验收组', type: 'fallback', members: [{ kind: 'builtin', name: 'DIRECT' }], test: { interval: 300 } }], rules: [], final: { kind: 'builtin', name: 'DIRECT' } });
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const record = async (promise: Promise<unknown>) => { const result = await promise; setOutcomes(items => [...items, JSON.stringify(result)]); };
  const attempt = useRef(0);
  const [noAnimation, setNoAnimation] = useState(false);
  return <main className="mx-auto flex max-w-4xl flex-col gap-5 p-8">
    <h1 className="text-xl font-semibold">统一静态弹窗验收</h1>
    <p>在 StrictMode 下检查独立草稿、Promise、嵌套、异步与逐帧退场；底层使用 Radix Presence。</p>
    <label><input type="checkbox" checked={slow} onChange={event => setSlow(event.target.checked)} /> 放慢退场（仅本验收页）</label>
    <label><input type="checkbox" checked={noAnimation} onChange={event => setNoAnimation(event.target.checked)} /> 无动画（减少动态效果）</label>
    {slow && <style>{'[data-slot="dialog-content"][data-state="closed"], [data-slot="dialog-overlay"][data-state="closed"] { animation-duration: 2s !important; }'}</style>}
    {noAnimation && <style>{'[data-slot="dialog-content"], [data-slot="dialog-overlay"] { animation: none !important; }'}</style>}
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => void record(RemoteRuleDialog.show({ value: 'http://127.0.0.1:4187/rules.list' }))}>兼容远程链接</Button>
      <Button onClick={() => void record(RuleEditDialog.show({ rule: { id: 'audit', matcher: { kind: 'local', content: 'DOMAIN-SUFFIX,example.test' }, target: { kind: 'builtin', name: 'DIRECT' } }, index: 0, ctx: { rulesets: [] }, adding: true, bound: true, staticOnly: false, extendedOptions: true }))}>手写规则退场</Button>
      <Button onClick={() => void record(ProfileInfoModal.show({ name: '保持到最后一帧', note: '备注内容也应该保留' }))}>名称备注退场</Button>
      <Button onClick={() => void record(RulesetSourceDialog.show({ source: { id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,example.test\nDOMAIN-SUFFIX,example.org' }, adding: true }))}>规则来源退场</Button>
      <Button onClick={() => void record(RepositoryModal.show({}))}>仓库退场</Button>
      <Button onClick={() => void record(NamedCreateDialog.show({ title: '新建命名对象', placeholder: '填写验收对象名称', note: true }))}>命名对象退场</Button>
      <Button onClick={() => void record(NodeSetPickerDialog.show({ options: profileFixture.nodeSets, added: [] }))}>节点来源退场</Button>
      <Button onClick={() => void record(FrameApi.modal.error({ title: '错误提示验收', description: '此提示只验证布局与关闭，不触发后台操作。' }))}>错误提示退场</Button>
      <Button onClick={() => { hostOutcome = HostUnmountModal.show({}); }}>Host 卸载与重挂</Button>
      <Button onClick={() => setResults([])}>清空验收记录</Button>
      <Button onClick={() => void record(FrameApi.modal.confirm({ title: '删除第一份文档？', description: '被 3 个策略组引用，删除后引用将失效。', confirmLabel: '删除', danger: true }))}>删除确认一</Button>
      <Button onClick={() => void record(FrameApi.modal.confirm({ title: '删除第二份文档，名称较长以验证重开更新？', description: '第二份文档的独立说明。', danger: true }))}>删除确认二</Button>
      <Button onClick={() => void record(RuleSourcePreview.show({ matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'exit.example.test' } } }))}>静态规则预览</Button>
      <Button onClick={() => void record(ChainRuleModal.show({ ...profileFixture, title: '代理链退场验收', chain: { id: 'exit-chain', landing: { nodeSet: nodeFixture.nodeSet, filter: 'GCP', excludeFilter: '过期' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'relay' }, match: { regex: '日本' } } } } }))}>代理链列表退场</Button>
      <Button onClick={() => void record(ChainRuleModal.show({ ...profileFixture, title: '全部来源代理链退场', chain: { id: 'all-chain', landing: { nodeSet: { type: 'all', id: 'inline' } }, via: { kind: 'node', ref: { nodeSet: { type: 'all', id: 'provider' }, match: { regex: '' } } } } }))}>全部来源代理链退场</Button>
      <Button onClick={() => void record(ChainRuleModal.show({
        ...profileFixture,
        profile: { ...profileFixture.profile, routing: { mode: 'independent', config: {
          groups: [{ id: 'direct', name: '直连前置组', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }, { id: 'backup', name: '备用前置组', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }],
          rules: [], final: { kind: 'builtin', name: 'DIRECT' },
        } } },
        title: '直接点选代理链退场',
        chain: { id: 'click-chain', landing: { nodeSet: nodeFixture.nodeSet, filter: exactNodeFilter('🇺🇸 GCP [01]') }, via: { kind: 'node', ref: { nodeSet: nodeFixture.nodeSet, match: { exact: '🇸🇬 新加坡' } } } },
      }))}>直接点选代理链退场</Button>
      <Button onClick={() => void record(ProfileGroupDialog.show({ ...profileFixture, groupId: 'private', template: { id: 'tpl', name: '验收模板', version: 1, groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } }, profile: { ...profileFixture.profile, routing: { mode: 'bound', templateId: 'tpl', groupAdditions: {}, extraGroups: [{ id: 'private', name: '订阅独立机场', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'relay' } }] }] } } }))}>绑定订阅独立组退场</Button>
      <Button onClick={() => void record(QueryModal.show({}))}>查询结果弹窗</Button>
      <Button onClick={() => { attempt.current = 0; void record(FrameApi.modal.prompt({ title: '保存失败后重试', initialValue: '保留我的草稿', placeholder: '输入要保存的名称' }, { submit: async () => { if (++attempt.current === 1) throw new Error('模拟保存失败，请重试'); } })); }}>异步失败与重试</Button>
      <Button onClick={() => void record(NestedModal.show({ name: '外部原值' }))}>嵌套与路由</Button>
      <Button onClick={() => { void record(FrameApi.modal.alert({ title: '第一层提示' })); void record(FrameApi.modal.success({ title: '第二层提示' })); }}>连续打开</Button>
      <Button onClick={() => { for (const title of ['并发一', '并发二', '并发三']) void record(FrameApi.modal.alert({ title })); }}>同时打开三层</Button>
      <Button onClick={() => { void record(FrameApi.modal.alert({ title: '路由前的第一层' })); void record(FrameApi.modal.alert({ title: '尚未挂载的第二层' })); navigate('/test/dialog-exit.html?cancel=queued'); }}>打开后立即离开</Button>
    </div>
    <p aria-label="外部组名称">外部组名称：{body.groups[0]?.name}</p>
    <TemplateGroupsEditor value={body} onChange={setBody} report={[]} />
    <section aria-label="Promise 结果" className="rounded border p-4"><h2>Promise 结果：{outcomes.length} 项</h2><ol>{outcomes.map((item, i) => <li key={i}>{item}</li>)}</ol></section>
    <section aria-label="验收结果" className="rounded border p-4"><h2 className="font-semibold">退场验收：{results.length} 项</h2><ol className="list-decimal space-y-3 pl-5">{results.map((result, index) => <li key={index} className={result.passed ? 'text-green-800' : 'text-red-800'}>{result.passed ? '通过' : '失败'}：{result.title}；{result.mode}；{result.frames.length} 帧；高度 {result.baseline.height}px；{result.error ?? '标题、正文、输入、展开状态和布局一致'}</li>)}</ol></section>
    <pre id="dialog-motion-results" hidden>{JSON.stringify(results)}</pre>
  </main>;
}
const router = createBrowserRouter([{ path: '/test/host-off', element: <HostOff /> }, { element: <ModalRoot />, children: [{ path: '*', element: <App /> }] }]);
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
