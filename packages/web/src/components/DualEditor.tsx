import { alertError, notifySuccess } from '../feedback.ts';
import { YamlTextarea } from './YamlTextarea.tsx';
import { CopyButton } from './CopyButton.tsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FieldError, Segmented } from './ui.tsx';

export type EditorMode = 'form' | 'raw';
export type RawResult<T> = { ok: true; value: T; notes?: string[] } | { ok: false; error: string; line?: number };
export type FormRecovery<T> = { value: T; notes: string[] };

/** toRaw 可能因数据本身无法表达而抛错（如模板引用了已删除的组），转成可展示的错误 */
function tryRaw<T>(toRaw: (value: T) => string, value: T): { text: string } | { error: string } {
  try { return { text: toRaw(value) }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

export function DualEditor<T>({ value, onChange, renderForm, toRaw, fromRaw, recoverForm, fromPaste, rawHint, rawLabel = '原始配置', mode, onModeChange, onValidityChange }: {
  value: T; onChange: (value: T) => void; renderForm: () => ReactNode;
  toRaw: (value: T) => string; fromRaw: (text: string) => RawResult<T>;
  /** 返回表单时过滤错误字段，不以保存校验阻止切换。 */
  recoverForm: (text: string) => FormRecovery<T>;
  /** 完整配置粘贴时转换；返回 undefined 时保留普通文本粘贴。失败不覆盖当前草稿。 */
  fromPaste?: (text: string) => RawResult<T> | undefined;
  rawHint?: string;
  rawLabel?: string; mode?: EditorMode; onModeChange?: (mode: EditorMode) => void;
  /** 让外层保存按钮同步阻止提交尚未解析成功的原始配置。 */
  onValidityChange?: (valid: boolean) => void;
}) {
  const [localMode, setLocalMode] = useState<EditorMode>('form');
  const current = mode ?? localMode;
  const [text, setText] = useState(() => { const r = current === 'raw' ? tryRaw(toRaw, value) : undefined; return r && 'text' in r ? r.text : ''; });
  const [result, setResult] = useState<RawResult<T>>(() => { const r = current === 'raw' ? tryRaw(toRaw, value) : undefined; return r && 'text' in r ? fromRaw(r.text) : { ok: true, value }; });
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
      }
      emitted.current = undefined;
    }
    previous.current = { value, mode: current };
  }, [value, current, toRaw, fromRaw]);

  const error = !result.ok ? `${result.line !== undefined ? `第 ${result.line} 行：` : ''}${result.error}` : '';
  useEffect(() => { onValidityChange?.(current !== 'raw' || result.ok); }, [current, result.ok, onValidityChange]);
  const changeMode = (next: EditorMode) => {
    if (next === current) return;
    if (next === 'form') {
      const recovered = recoverForm(text);
      notifySuccess(recovered.notes.length ? `已返回表单，保留可识别的有效字段：\n${recovered.notes.join('\n')}` : '已返回表单');
      setResult({ ok: true, ...recovered });
      onChange(recovered.value);
      onValidityChange?.(true);
    }
    if (next === 'raw') {
      const raw = tryRaw(toRaw, value);
      if ('error' in raw) { alertError(`无法生成${rawLabel}：${raw.error}`); return; }
    }
    if (mode === undefined) setLocalMode(next);
    onModeChange?.(next);
  };
  return <div className="dual-editor flex flex-col gap-3">
    <Segmented label="编辑视图" size="sm" value={current} onChange={changeMode} options={[
      { value: 'form', label: '表单' },
      { value: 'raw', label: '原始配置' },
    ]} />
    <div className="editor-content flex flex-col gap-3">
      {current === 'form' ? renderForm() : <>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted">{rawLabel}</span>
          <CopyButton size="sm" text={text} />
        </div>
        {rawHint && <span className="text-[12px] leading-relaxed text-muted">{rawHint}</span>}
        <YamlTextarea aria-label={rawLabel} aria-invalid={!!error} rows={16} className="font-mono" spellCheck={false} value={text} onPaste={(event) => {
          const imported = fromPaste?.(event.clipboardData.getData('text/plain'));
          if (!imported) return;
          event.preventDefault();
          if (!imported.ok) { alertError(`未导入：${imported.error}`); return; }
          const canonical = tryRaw(toRaw, imported.value);
          if ('error' in canonical) { alertError(`未导入：${canonical.error}`); return; }
          setText(canonical.text); setResult(imported);
          emitted.current = { value: imported.value, canonical: canonical.text };
          onValidityChange?.(true);
          onChange(imported.value);
          notifySuccess(imported.notes?.join('；') || '已导入配置，保存后生效');
        }} onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
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
        <FieldError error={error && `${error}；可返回表单继续编辑，返回时将忽略错误内容。`} />
        {result.ok && !!result.notes?.length && <ul className="m-0 pl-5 text-[13px] text-muted">{result.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
      </>}
    </div>
  </div>;
}
