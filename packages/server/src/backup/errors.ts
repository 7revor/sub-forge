/** 备份错误的文案可直接展示给管理员，不包含 WebDAV 凭据或备份口令。 */
export class BackupError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 502, message: string) {
    super(message);
  }
}
