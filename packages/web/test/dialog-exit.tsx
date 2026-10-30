// 仅供 Codex 内置浏览器验收，不进入生产构建，不访问业务服务。
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeleteDialog } from '../src/components/DetailActions.tsx';
import { RuleSourcePreview } from '../src/components/RuleSourcePreview.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../src/components/ui/dialog.tsx';
import { Button } from '../src/components/ui.tsx';
import { TemplateGroupsEditor } from '../src/pages/template/TemplateGroupsEditor.tsx';
import { useDialogPresentation } from '../src/hooks/useDialogPresentation.ts';
import type { TemplateBody } from '../src/convert/templateYaml.ts';
import '../src/index.css';

type Frame = { height: number; text: string; inputs: string[] };
const readFrame = (element: HTMLElement): Frame => ({
  // offsetHeight 排除官方 zoom 退场的 transform，仅检查内容是否被清空导致布局收缩。
  height: element.offsetHeight,
  text: element.textContent ?? '',
  inputs: [...element.querySelectorAll<HTMLInputElement>('input, textarea')].map(input => input.value),
});
function App() {
  const [results, setResults] = useState<string[]>([]);
  const before = useRef<Frame | undefined>(undefined);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const capture = () => {
      const element = document.querySelector<HTMLElement>('[data-slot$="dialog-content"][data-state="open"]');
      if (element) before.current = readFrame(element);
    };
    const pending = new Set<number>();
    const sample = (event: AnimationEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !element.matches('[data-slot$="dialog-content"][data-state="closed"]')) return;
      const expected = before.current;
      if (!expected) { setResults(items => [...items, '失败：缺少关闭前的 DOM 记录']); return; }
      let frames = 0;
      let mismatch: Frame | undefined;
      const inspect = () => {
        if (!element.isConnected || element.dataset.state !== 'closed') {
          const passed = frames > 0 && !mismatch;
          setResults(items => [...items, `${passed ? '通过' : '失败'}：${expected.text.slice(0, 36)}；${frames} 帧；高度 ${expected.height}px${mismatch ? ` → ${mismatch.height}px，内容发生变化` : '，标题、正文、输入值保持一致'}`]);
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
    document.addEventListener('pointerdown', capture, true);
    document.addEventListener('keydown', capture, true);
    document.addEventListener('animationstart', sample);
    return () => {
      document.removeEventListener('pointerdown', capture, true);
      document.removeEventListener('keydown', capture, true);
      document.removeEventListener('animationstart', sample);
      pending.forEach(cancelAnimationFrame);
    };
  }, []);
  const [deleting, setDeleting] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const [queryResult, setQueryResult] = useState('初次读取的文件正文\n规则一\n规则二');
  const queryView = useDialogPresentation(queryOpen, queryResult);
  const [selected, setSelected] = useState<string>();
  const [body, setBody] = useState<TemplateBody>({ groups: [{ id: 'first', name: '退场验收组', type: 'fallback', members: [{ kind: 'builtin', name: 'DIRECT' }], test: { interval: 300 } }], rules: [], final: { kind: 'builtin', name: 'DIRECT' } });
  return <main className="mx-auto flex max-w-4xl flex-col gap-5 p-8">
    <h1 className="text-xl font-semibold">弹窗退场回归验收</h1>
    <p>复用实际业务组件；清空选中项后逐帧比较 DOM，沿用 Radix 退场与卸载。</p>
    <label><input type="checkbox" checked={slow} onChange={event => setSlow(event.target.checked)} /> 放慢退场（仅本验收页，便于截图）</label>
    {slow && <style>{'[data-slot$="dialog-content"][data-state="closed"], [data-slot$="dialog-overlay"][data-state="closed"] { animation-duration: 4s !important; }'}</style>}
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => setDeleting('第一份文档')}>删除确认一</Button>
      <Button onClick={() => setDeleting('第二份文档，名称较长以验证重开更新')}>删除确认二</Button>
      <Button onClick={() => setPreview(true)}>静态规则预览</Button>
      <Button onClick={() => { setQueryResult('初次读取的文件正文\n规则一\n规则二'); setQueryOpen(true); }}>查询结果弹窗</Button>
    </div>
    <TemplateGroupsEditor value={body} onChange={setBody} selected={selected} onSelect={setSelected} report={[]} />
    <DeleteDialog open={!!deleting} title={`删除「${deleting ?? ''}」？`} onClose={() => setDeleting(undefined)} onConfirm={() => setDeleting(undefined)}>
      {deleting && <><p>文件：{deleting}</p><p>被 3 个策略组引用，删除后引用将失效。</p></>}
    </DeleteDialog>
    <RuleSourcePreview matcher={preview ? { kind: 'rule', rule: { type: 'DOMAIN', value: 'exit.example.test' } } : undefined} onClose={() => setPreview(false)} />
    <Dialog open={queryOpen} onOpenChange={setQueryOpen}><DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>查询展示快照</DialogTitle></DialogHeader>
      <pre>{queryView}</pre>
      <Button onClick={() => setQueryResult('最新读取的正文\n新增规则一\n新增规则二\n新增规则三')}>更新打开时的结果</Button>
      <Button onClick={() => { setQueryOpen(false); setQueryResult(''); }}>关闭并清空查询结果</Button>
    </DialogContent></Dialog>
    <section aria-label="验收结果" className="rounded border p-4">
      <h2 className="font-semibold">验收结果：{results.length} 项</h2>
      <ol className="list-decimal space-y-3 pl-5">{results.map((result, index) => <li key={index} className={result.startsWith('通过') ? 'text-green-800' : 'text-red-800'}>{result}</li>)}</ol>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
