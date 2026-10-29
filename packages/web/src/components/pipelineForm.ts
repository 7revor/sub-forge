import { applyOperator, compileUserRegex, DEFAULT_USELESS_PATTERNS, type OperatorStep } from '@sub-forge/core';

export function setFieldsError(fields: Record<string, unknown>): string | undefined {
  try { applyOperator({ op: 'set', fields }, []); }
  catch (error) { return (error as Error).message; }
  return undefined;
}

export function regexError(pattern: string, flags = ''): string | undefined {
  try { compileUserRegex(pattern, flags); }
  catch (error) { return (error as Error).message; }
  return undefined;
}

export function updateSetField(fields: Record<string, unknown>, key: string, value: unknown) {
  const next = { ...fields };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** 编译用于计数的正则；空的或非法的返回 undefined（非法原因由 regexError 在输入框下方提示） */
function countable(pattern: string, flags = ''): RegExp | undefined {
  if (!pattern || regexError(pattern, flags)) return undefined;
  return compileUserRegex(pattern, flags);
}

/** 每条正则命中的节点数；空的或非法的正则为 undefined */
export function patternHits(patterns: string[], names: string[]): (number | undefined)[] {
  return patterns.map((p) => {
    const re = countable(p);
    return re && names.filter((n) => re.test(n)).length;
  });
}

type RenameRule = { pattern: string; flags?: string; replace: string };

/** 正则改名按顺序执行，返回每个名称依次命中的规则序号（0 起） */
function renameChain(rules: RenameRule[], name: string): number[] {
  const hit: number[] = [];
  let cur = name;
  rules.forEach((r, i) => {
    const flags = (r.flags ?? '').replace('g', '');
    const test = countable(r.pattern, flags);
    if (!test?.test(cur)) return;
    hit.push(i);
    cur = cur.replace(compileUserRegex(r.pattern, flags + 'g'), r.replace);
  });
  return hit;
}

/** 正则改名每条规则的命中数：上一条的结果交给下一条 */
export function renameHits(rules: RenameRule[], names: string[]): (number | undefined)[] {
  const counts: (number | undefined)[] = rules.map((r) => (countable(r.pattern, (r.flags ?? '').replace('g', '')) ? 0 : undefined));
  for (const name of names) for (const i of renameChain(rules, name)) counts[i] = (counts[i] ?? 0) + 1;
  return counts;
}

/** 预览 diff 行的「命中」列：这一行是被哪条规则改动的 */
export function rowHit(step: OperatorStep, from: string): string {
  const first = (patterns: string[], label: (i: number) => string) => {
    const i = patterns.findIndex((p) => countable(p)?.test(from));
    return i < 0 ? '未命中' : label(i);
  };
  switch (step.op) {
    case 'rename.regex': {
      const hit = renameChain(step.rules, from);
      return hit.length ? hit.map((i) => `#${i + 1}`).join('、') : '未命中';
    }
    case 'filter.regex':
    case 'rename.delete':
      return first(step.patterns, (i) => `#${i + 1}`);
    case 'filter.useless': {
      const patterns = step.patterns ?? DEFAULT_USELESS_PATTERNS;
      return first(patterns, (i) => patterns[i]!);
    }
    case 'sort.regex':
      return first(step.patterns, (i) => step.patterns[i]!);
    default:
      return '';
  }
}
