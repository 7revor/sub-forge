/** 备份错误的文案可直接展示给管理员。 */
export class BackupError extends Error {
  constructor(readonly status: 400 | 409, message: string) {
    super(message);
  }
}
