import { useState } from 'react';
import { formatExtraValue, parseExtraValue } from './extraFields.ts';
import { Button, ErrorBox, Input } from './ui.tsx';

function ValueRow({ name, value, onChange, onRename, onRemove }: {
  name: string; value: unknown; onChange: (value: unknown) => void; onRename: (name: string) => string | undefined; onRemove: () => void;
}) {
  const [keyText, setKeyText] = useState(name);
  const [keyError, setKeyError] = useState<string>();
  const [draft, setDraft] = useState<{ source: unknown; text: string; error?: string }>();
  const text = draft && Object.is(draft.source, value) ? draft.text : formatExtraValue(value);
  const error = draft && Object.is(draft.source, value) ? draft.error : undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input aria-label={`${name} 的字段名称`} className="w-1/3 font-mono" value={keyText} aria-invalid={!!keyError}
          onChange={(e) => { setKeyText(e.target.value); setKeyError(undefined); }}
          onBlur={() => {
            if (keyText === name) return;
            if (error) { setKeyError('请先修复字段值的解析错误'); return; }
            setKeyError(onRename(keyText.trim()));
          }} />
        <Input aria-label={`${name} 的值`} className="font-mono" value={text} aria-invalid={!!error} onChange={(event) => {
          const text = event.target.value;
          const parsed = parseExtraValue(text);
          setDraft({ source: parsed.ok ? parsed.value : value, text, error: parsed.ok ? undefined : parsed.error });
          if (parsed.ok) onChange(parsed.value);
        }} />
        <Button size="sm" aria-label={`删除 ${name}`} onClick={onRemove}>删除</Button>
      </div>
      <ErrorBox error={keyError || error} />
    </div>
  );
}

export function ExtraFields({ value, onChange }: {
  value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void;
}) {
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-[13px] text-muted">其他字段 {Object.keys(value).length} 个</summary>
      <div className="mt-3 flex flex-col gap-2">
        {Object.entries(value).map(([name, item]) => (
          <ValueRow key={name} name={name} value={item}
            onChange={(next) => onChange({ ...value, [name]: next })}
            onRename={(next) => {
              if (!next || (next !== name && Object.hasOwn(value, next))) return '请填写未使用的字段名称';
              onChange(Object.fromEntries(Object.entries(value).map(([key, item]) => [key === name ? next : key, item])));
              return undefined;
            }}
            onRemove={() => onChange(Object.fromEntries(Object.entries(value).filter(([k]) => k !== name)))} />
        ))}
        <div className="flex items-center gap-2">
          <Input aria-label="新字段名称" placeholder="字段名称" value={key} onChange={(e) => setKey(e.target.value)} />
          <Input aria-label="新字段值" placeholder="YAML 值" className="font-mono" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" onClick={() => {
            const name = key.trim();
            if (!name || Object.hasOwn(value, name)) { setError('请填写未使用的字段名称'); return; }
            const parsed = parseExtraValue(text);
            if (!parsed.ok) { setError(parsed.error); return; }
            onChange({ ...value, [name]: parsed.value });
            setKey(''); setText(''); setError('');
          }}>添加</Button>
        </div>
        <ErrorBox error={error} />
      </div>
    </details>
  );
}
