import { Checkbox } from './ui/checkbox.tsx';
import { RadioGroup, RadioGroupItem } from './ui/radio-group.tsx';

/** 整行可点的选项里使用的 shadcn 勾选 / 单选外观；交互与读屏语义由外层按钮提供。 */
export function SelectIndicator({ checked, multiple = false }: { checked: boolean; multiple?: boolean }) {
  return multiple
    ? <Checkbox checked={checked} tabIndex={-1} aria-hidden="true" className="pointer-events-none" />
    : <RadioGroup value={checked ? 'on' : ''} aria-hidden="true" className="pointer-events-none"><RadioGroupItem value="on" tabIndex={-1} /></RadioGroup>;
}
