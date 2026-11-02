/** 原始配置解析结果，供当前 YAML 编辑器与导入逻辑共用。 */
export type RawResult<T> = { ok: true; value: T; notes?: string[] } | { ok: false; error: string; line?: number };
