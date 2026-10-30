// 仅供 Codex 内置浏览器验收，不进入生产构建，不访问业务服务。
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Link } from 'react-router';
import { Frame as FrameApi } from '../src/modals/Frame.tsx';
import { createModal, ModalRoot, ModalContent, ModalHeader, ModalTitle, useModalDraft, useModalPresentation } from '../src/modals/index.tsx';
import { RuleSourcePreview } from '../src/components/RuleSourcePreview.tsx';
import { Button, Input } from '../src/components/ui.tsx';
import { TemplateGroupsEditor } from '../src/pages/template/TemplateGroupsEditor.tsx';
import type { TemplateBody } from '../src/convert/templateYaml.ts';
import '../src/index.css';

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
    <Link to="/test/dialog-exit.html?route=next">切换路由</Link><Button onClick={modal.cancel}>取消</Button><Button onClick={() => modal.confirm(name)}>保存</Button></ModalContent>;
});

type Frame = { height: number; text: string; inputs: string[] };
const readFrame = (element: HTMLElement): Frame => ({
  // offsetHeight 排除官方 zoom 退场的 transform，仅检查内容是否被清空导致布局收缩。
  height: element.offsetHeight,
  text: element.textContent ?? '',
  inputs: [...element.querySelectorAll<HTMLInputElement>('input, textarea')].map(input => input.value),
});
function App() {
  const [results, setResults] = useState<string[]>([]);
  const before = useRef(new WeakMap<HTMLElement, Frame>());
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const capture = () => {
      document.querySelectorAll<HTMLElement>('[data-slot$="dialog-content"][data-state="open"]').forEach(element => before.current.set(element, readFrame(element)));
    };
    const pending = new Set<number>();
    const sample = (event: AnimationEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !element.matches('[data-slot$="dialog-content"][data-state="closed"]')) return;
      const expected = before.current.get(element);
      if (!expected) { setResults(items => [...items, '失败：缺少关闭前的 DOM 记录']); return; }
      let frames = 0;
      let mismatch: Frame | undefined;
      const inspect = () => {
        if (!element.isConnected || element.dataset.state !== 'closed') {
          const passed = frames > 0 && !mismatch;
          setResults(items => [...items, `${passed ? '通过' : '失败'}：${expected.text.slice(0, 36)}；${frames} 帧；高度 ${expected.height}px${mismatch ? ` → ${mismatch.height}px，内容发生变化：${mismatch.text}` : '，标题、正文、输入值保持一致'}`]);
          return;
        }
        frames += 1;
        const frame = readFrame(element);
        if (JSON.stringify(frame) !== JSON.stringify(expected)) mismatch = frame;
        const id = requestAnimationFrame(() => { pending.delete(id); inspect(); });
        pending.add(id);
      };
      inspect();
    };
    // 异步提交会先展示处理中；比较最后一帧 open，而非点击提交前的旧文案。
    const observer = new MutationObserver(capture);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener('pointerdown', capture, true);
    document.addEventListener('keydown', capture, true);
    document.addEventListener('animationstart', sample);
    return () => {
      document.removeEventListener('pointerdown', capture, true);
      document.removeEventListener('keydown', capture, true);
      document.removeEventListener('animationstart', sample);
      observer.disconnect();
      pending.forEach(cancelAnimationFrame);
    };
  }, []);
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
      <Button onClick={() => void record(FrameApi.modal.confirm({ title: '删除第一份文档？', description: '被 3 个策略组引用，删除后引用将失效。', confirmLabel: '删除', danger: true }))}>删除确认一</Button>
      <Button onClick={() => void record(FrameApi.modal.confirm({ title: '删除第二份文档，名称较长以验证重开更新？', description: '第二份文档的独立说明。', danger: true }))}>删除确认二</Button>
      <Button onClick={() => void record(RuleSourcePreview.show({ matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'exit.example.test' } } }))}>静态规则预览</Button>
      <Button onClick={() => void record(QueryModal.show({}))}>查询结果弹窗</Button>
      <Button onClick={() => { attempt.current = 0; void record(FrameApi.modal.prompt({ title: '保存失败后重试', initialValue: '保留我的草稿', placeholder: '输入要保存的名称' }, { submit: async () => { if (++attempt.current === 1) throw new Error('模拟保存失败，请重试'); } })); }}>异步失败与重试</Button>
      <Button onClick={() => void record(NestedModal.show({ name: '外部原值' }))}>嵌套与路由</Button>
      <Button onClick={() => { void record(FrameApi.modal.alert({ title: '第一层提示' })); void record(FrameApi.modal.success({ title: '第二层提示' })); }}>连续打开</Button>
    </div>
    <p aria-label="外部组名称">外部组名称：{body.groups[0]?.name}</p>
    <TemplateGroupsEditor value={body} onChange={setBody} report={[]} />
    <section aria-label="Promise 结果" className="rounded border p-4"><h2>Promise 结果：{outcomes.length} 项</h2><ol>{outcomes.map((item, i) => <li key={i}>{item}</li>)}</ol></section>
    <section aria-label="验收结果" className="rounded border p-4"><h2 className="font-semibold">退场验收：{results.length} 项</h2><ol className="list-decimal space-y-3 pl-5">{results.map((result, index) => <li key={index} className={result.startsWith('通过') ? 'text-green-800' : 'text-red-800'}>{result}</li>)}</ol></section>
  </main>;
}
const router = createBrowserRouter([{ element: <ModalRoot />, children: [{ path: '*', element: <App /> }] }]);
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
