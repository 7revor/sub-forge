import { useLayoutEffect, useMemo, useRef, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx.ts';
import { highlightYaml } from './yamlHighlight.ts';
import './yamlTextarea.css';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'wrap'> & { value: string; placeholder: string };

/** 保留原生输入、选择、撤销和粘贴事件，高亮层仅负责展示。 */
export function YamlTextarea({ value, className, onScroll, rows = 8, ...props }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLPreElement>(null);
  const segments = useMemo(() => highlightYaml(value), [value]);
  const sync = () => {
    if (!input.current || !backdrop.current) return;
    backdrop.current.style.width = `${input.current.clientWidth}px`;
    backdrop.current.style.height = `${input.current.clientHeight}px`;
    backdrop.current.scrollTop = input.current.scrollTop;
    backdrop.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(() => {
    const observer = new ResizeObserver(sync);
    if (input.current) observer.observe(input.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(sync, [value]);
  return <div className={cx('yaml-textarea', className)} data-disabled={props.disabled || undefined}>
    <pre ref={backdrop} aria-hidden="true" className="yaml-textarea-highlight">{segments.map((segment, index) =>
      <span key={index} className={segment.tone ? `yaml-${segment.tone}` : undefined}>{segment.text}</span>
    )}{'\n'}</pre>
    <textarea {...props} ref={input} value={value} rows={rows} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off"
      onScroll={event => { sync(); onScroll?.(event); }} />
  </div>;
}
