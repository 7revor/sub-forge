/** 引用权限失效不能通过旧成功配置兜底，否则会继续下发已撤销权限的内容。 */
export class ResourceAccessError extends Error {
  constructor() { super('引用资源不存在或已无权访问'); }
}
