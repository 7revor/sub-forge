import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ErrorBox, Segmented, Textarea } from './ui.tsx';

export type EditorMode = 'form' | 'raw';
export type RawResult<T> = { ok: true; value: T; notes?: string[] } | { ok: false; error: string; line?: number };

/** toRaw 可能因数据本身无法表达而抛错（如模板引用了已删除的组），转成可展示的错误 */
function tryRaw<T>(toRaw: (value: T) => string, value: T): { text: string } | { error: string } {
  try { return { text: toRaw(value) }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

export function DualEditor<T>({ value, onChange, renderForm, toRaw, fromRaw, rawLabel = '原始配置', mode, onModeChange, onValidityChange }: {
  value: T; onChange: (value: T) => void; renderForm: () => ReactNode;
  toRaw: (value: T) => string; fromRaw: (text: string) => RawResult<T>;
  rawLabel?: string; mode?: EditorMode; onModeChange?: (mode: EditorMode) => void;
  /** 让外层保存按钮同步阻止提交尚未解析成功的原始配置。 */
  onValidityChange?: (valid: boolean) => void;
}) {
  const [localMode, setLocalMode] = useState<EditorMode>('form');
  const current = mode ?? localMode;
  const [text, setText] = useState(() => { const r = current === 'raw' ? tryRaw(toRaw, value) : undefined; return r && 'text' in r ? r.text : ''; });
  const [result, setResult] = useState<RawResult<T>>(() => { const r = current === 'raw' ? tryRaw(toRaw, value) : undefined; return r && 'text' in r ? fromRaw(r.text) : { ok: true, value }; });
  const [rawError, setRawError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const previous = useRef({ value, mode: current });
  const emitted = useRef<{ value: T; canonical: string } | undefined>(undefined);

  useEffect(() => {
    const entered = previous.current.mode !== 'raw' && current === 'raw';
    const changed = !Object.is(previous.current.value, value);
    if (current === 'raw' && (entered || changed)) {
      const own = emitted.current && (Object.is(emitted.current.value, value) || (() => { const r = tryRaw(toRaw, value); return 'text' in r && r.text === emitted.current.canonical; })());
      if (entered || !own) {
        const raw = tryRaw(toRaw, value);
        if ('text' in raw) {
          setText(raw.text);
          setResult(fromRaw(raw.text));
        }
        setCopyMessage('');
      }
      emitted.current = undefined;
    }
    previous.current = { value, mode: current };
  }, [value, current, toRaw, fromRaw]);

  const error = !result.ok ? `${result.line !== undefined ? `第 ${result.line} 行：` : ''}${result.error}` : '';
  useEffect(() => { onValidityChange?.(current !== 'raw' || result.ok); }, [current, result.ok, onValidityChange]);
  const changeMode = (next: EditorMode) => {
    if (next === 'form' && error) return;
    if (next === 'raw') {
      const raw = tryRaw(toRaw, value);
      if ('error' in raw) { setRawError(`无法生成${rawLabel}：${raw.error}`); return; }
    }
    setRawError('');
    if (mode === undefined) setLocalMode(next);
    onModeChange?.(next);
  };
  return <div className="flex flex-col gap-3">
    <Segmented label="编辑视图" size="sm" value={current} onChange={changeMode} options={[
      { value: 'form', label: '表单', disabled: current === 'raw' && !!error, ...(error ? { title: '请先修复原始配置中的错误' } : {}) },
      { value: 'raw', label: '原始配置' },
    ]} />
    <ErrorBox error={rawError} />
    {current === 'form' ? renderForm() : <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{rawLabel}</span>
        <Button size="sm" onClick={async () => {
          try { await navigator.clipboard.writeText(text); setCopyMessage('已复制'); }
          catch (error) { setCopyMessage(`复制失败：${error instanceof Error ? error.message : String(error)}`); }
        }}>复制</Button>
      </div>
      <Textarea aria-label={rawLabel} aria-invalid={!!error} rows={16} className="font-mono" spellCheck={false} value={text} onChange={(event) => {
        const raw = event.target.value;
        setText(raw); setCopyMessage('');
        const parsed = fromRaw(raw);
        setResult(parsed);
        onValidityChange?.(parsed.ok);
        if (parsed.ok) {
          const canonical = tryRaw(toRaw, parsed.value);
          if ('error' in canonical) {
            setResult({ ok: false, error: canonical.error });
            onValidityChange?.(false);
            return;
          }
          emitted.current = { value: parsed.value, canonical: canonical.text };
          onChange(parsed.value);
        }
      }} />
      <ErrorBox error={error && `${error}；修复后才能切回表单。`} />
      {result.ok && !!result.notes?.length && <ul className="m-0 pl-5 text-[13px] text-muted">{result.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
      {copyMessage && <span role="status" className="text-[12px] text-muted">{copyMessage}</span>}
    </>}
  </div>;
}
