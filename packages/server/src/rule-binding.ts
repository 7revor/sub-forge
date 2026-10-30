/** 公共定义共享原文；直接远程引用随配置订阅或模板绑定，不能成为公共资源。 */
export function ruleBinding(id: string, context?: string): { id: string; scope: string } {
  if (!id.startsWith('remote:')) return { id, scope: 'public-rules' };
  if (!context) throw new Error('订阅专属规则缺少归属');
  return { id: `private-rule:${JSON.stringify([context, id])}`, scope: context };
}
