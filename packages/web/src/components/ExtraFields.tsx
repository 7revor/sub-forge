import { alertError } from '../feedback.ts';
import { YamlTextarea } from './YamlTextarea.tsx';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { RoutingCard } from './RoutingCard.tsx';
import { extraNameError, formatExtraValue, parseExtraValue } from './extraFields.ts';
import { Button, FieldError, Input } from './ui.tsx';

function ValueRow({ name, value, onChange, onRename, onRemove, card = false }: {
  card?: boolean; name: string; value: unknown; onChange: (value: unknown) => void; onRename: (name: string) => string | undefined; onRemove: () => void;
}) {
  const [keyText, setKeyText] = useState(name);
  const [keyError, setKeyError] = useState<string>();
  const [draft, setDraft] = useState<{ source: unknown; text: string; error?: string }>();
  const text = draft && Object.is(draft.source, value) ? draft.text : formatExtraValue(value);
  const error = draft && Object.is(draft.source, value) ? draft.error : undefined;
  const body = (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={card ? "grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" : "flex items-center gap-2"}>
        <Input placeholder="原生配置中的字段名称" aria-label={`${name} 的字段名称`} className={card ? "font-mono" : "w-1/3 font-mono"} value={keyText} aria-invalid={!!keyError}
          onChange={(e) => { setKeyText(e.target.value); setKeyError(undefined); }}
          onBlur={() => {
            if (keyText === name) return;
            if (error) { setKeyError('请先修复字段值的解析错误'); return; }
            setKeyError(onRename(keyText.trim()));
          }} />
        <YamlTextarea placeholder="填写字段值，支持 YAML 字符串、列表或对象" rows={1} aria-label={`${name} 的值`} className="font-mono" value={text} aria-invalid={!!error} onChange={(event) => {
          const text = event.target.value;
          const parsed = parseExtraValue(text);
          setDraft({ source: value, text, error: parsed.ok ? undefined : parsed.error });
        }} onBlur={() => {
          // 失焦时才提交，避免每次按键都触发预览
          if (!draft || !Object.is(draft.source, value) || draft.error) return;
          const parsed = parseExtraValue(draft.text);
          if (parsed.ok) onChange(parsed.value);
        }} />
        <Button size="sm" aria-label={`删除 ${name}`} onClick={onRemove}>删除</Button>
      </div>
      <FieldError error={keyError || error} />
    </div>
  );
  return card ? <RoutingCard>{body}</RoutingCard> : body;
}

export function ExtraFields({ value, onChange, validateName, layout = 'default' }: {
  value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void;
  validateName?: (name: string) => string | undefined;
  layout?: 'default' | 'cards';
}) {
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const addForm = (
    <div className={layout === 'cards' ? "grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" : "flex items-center gap-2"}>
      <Input aria-label="新字段名称" placeholder="字段名称" value={key} onChange={(e) => setKey(e.target.value)} />
      <YamlTextarea rows={1} aria-label="新字段值" placeholder="YAML 值" className="font-mono" value={text} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" onClick={() => {
        const name = key.trim();
        const error = extraNameError(value, name, undefined, validateName);
        if (error) { alertError(error); return; }
        const parsed = parseExtraValue(text);
        if (!parsed.ok) { alertError(parsed.error); return; }
        onChange({ ...value, [name]: parsed.value });
        setKey(''); setText('');
      }}>{layout === 'cards' && <Plus size={14} />}添加</Button>
    </div>
  );
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-[13px] text-ink-muted">其他字段 {Object.keys(value).length} 个</summary>
      <div className="mt-3 flex flex-col gap-2">
        {layout === 'cards' && addForm}
        {Object.entries(value).map(([name, item]) => (
          <ValueRow key={name} card={layout === 'cards'} name={name} value={item}
            onChange={(next) => onChange({ ...value, [name]: next })}
            onRename={(next) => {
              const error = extraNameError(value, next, name, validateName);
              if (error) return error;
              onChange(Object.fromEntries(Object.entries(value).map(([key, item]) => [key === name ? next : key, item])));
              return undefined;
            }}
            onRemove={() => onChange(Object.fromEntries(Object.entries(value).filter(([k]) => k !== name)))} />
        ))}
        {layout === 'default' && addForm}
      </div>
    </details>
  );
}
