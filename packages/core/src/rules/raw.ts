// RAW 只处理行边界与末尾选项，不限制客户端新增的规则类型或匹配语法。
export function rawRuleError(text: string): string | undefined {
  if (!text.trim()) return '请填写 RAW 规则。';
  if (/[\r\n\u2028\u2029]/.test(text)) return '每条 RAW 规则只能填写一行。';
  return undefined;
}

export function rawRuleParts(text: string): { text: string; noResolve?: boolean; src?: boolean } {
  let matching = text.trim();
  const flags: { noResolve?: boolean; src?: boolean } = {};
  for (let match; (match = /,\s*(no-resolve|src)\s*$/i.exec(matching));) {
    if (match[1]!.toLowerCase() === 'no-resolve') flags.noResolve = true;
    else flags.src = true;
    matching = matching.slice(0, match.index);
  }
  return { text: matching, ...flags };
}
