// 渲染报告：降级、丢弃、解析失败、孤儿覆盖项、引用兜底、校验结果（docs/03 §3）。
// UI 预览与订阅访问日志共用同一份结构。

export type ReportLevel = 'error' | 'warn' | 'info';

export type ReportItem = {
  level: ReportLevel;
  /** 稳定的机器可读代码，如 ref.unresolved、group.empty */
  code: string;
  message: string;
  /** 定位信息：组 ID、规则 ID、节点集等 */
  where?: string;
  /** 关联的代理链，用于在对应卡片显示问题。 */
  chainIds?: string[];
  /** 规则解析详情：只携带来源序号、源文件行号和原因，不重复 URL。 */
  ruleIssues?: { source: number; line: number; kind: 'invalid' | 'unimplemented'; reason: string }[];
};

export class Report {
  readonly items: ReportItem[] = [];

  add(level: ReportLevel, code: string, message: string, where?: string, chainIds?: string[]): ReportItem {
    const item: ReportItem = { level, code, message, ...(where === undefined ? {} : { where }), ...(chainIds?.length ? { chainIds } : {}) };
    this.items.push(item);
    return item;
  }
  error(code: string, message: string, where?: string, chainIds?: string[]): ReportItem { return this.add('error', code, message, where, chainIds); }
  warn(code: string, message: string, where?: string, chainIds?: string[]): ReportItem { return this.add('warn', code, message, where, chainIds); }
  info(code: string, message: string, where?: string): ReportItem { return this.add('info', code, message, where); }

  get hasErrors(): boolean { return this.items.some((i) => i.level === 'error'); }
  byCode(code: string): ReportItem[] { return this.items.filter((i) => i.code === code); }
}
