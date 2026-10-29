// class 合并工具：后传入的宽、高、字号类覆盖先前的同类 class。

// 宽、高、字号类在同一元素上冲突时，以后传入的为准（Tailwind 按样式表顺序而非 class 顺序生效）
const CONFLICT: [RegExp, string][] = [[/^w-/, 'w'], [/^h-/, 'h'], [/^text-(\[\d|xs$|sm$|base$|lg$|[2-9]?xl$)/, 'text-size']];
const conflictKey = (c: string) => {
  const i = c.lastIndexOf(':');
  const util = c.slice(i + 1);
  const hit = CONFLICT.find(([re]) => re.test(util));
  return hit && c.slice(0, i + 1) + hit[1];
};

export const cx = (...xs: (string | false | null | undefined)[]) => {
  const out: string[] = [];
  const at = new Map<string, number>();
  for (const c of xs.filter(Boolean).join(' ').split(/\s+/)) {
    if (!c) continue;
    const key = conflictKey(c);
    if (key && at.has(key)) { out[at.get(key)!] = c; continue; }
    if (key) at.set(key, out.length);
    out.push(c);
  }
  return out.join(' ');
};
