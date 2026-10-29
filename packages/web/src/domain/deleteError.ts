/** 删除确认对话框里的原因：被引用时附上引用方 */
export function deleteErrorText(err: unknown): string | undefined {
  if (!err) return undefined;
  const e = err as { message?: string; details?: { referrers?: string[] } };
  return e.details?.referrers ? `${e.message}：${e.details.referrers.join('、')}` : e.message;
}
