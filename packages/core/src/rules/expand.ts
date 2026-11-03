// 规则来源输入、标识与历史规则文本格式化；正式转换由 convertRuleDocuments 负责。

import type { ID, RuleIR, RuleSet, RuleSetSource } from '../types.ts';
import { lowerRule, composeRule } from './client.ts';

export type RuleSetInputs = {
  rulesets: Record<ID, RuleSet>;
  /** 远程来源的快照正文，键为 sourceKey(规则集 id, 来源 id)；本地来源读 content */
  snapshots: Record<string, string>;
};

/** 远程来源快照在渲染输入里的键 */
export const sourceKey = (rulesetId: ID, sourceId: ID): string => `${rulesetId}/${sourceId}`;

/** 诊断文案里的来源：远程用完整地址便于定位，本地用名称或「本地规则」 */
export const sourceLabel = (src: RuleSetSource): string => src.kind === 'remote' ? src.url ?? '远程地址' : src.name?.trim() || '本地规则';

/** 地址路径末段带扩展名时才算文件名；其他情况由调用方显示完整地址 */
function urlFileName(url: string): string | undefined {
  try {
    const file = new URL(url).pathname.split('/').at(-1) ?? '';
    return /\.[^./]+$/.test(file) ? decodeURIComponent(file) : undefined;
  } catch { return undefined; } // 编辑中的地址可能不完整，或含无效百分号编码。
}

/** 列表里的来源名：仓库和远程用文件名，本地用名称或「本地规则」 */
export function sourceDisplayName(src: RuleSetSource): string {
  if (src.kind === 'local') return sourceLabel(src);
  return src.repository?.path.split('/').at(-1) || (src.url && urlFileName(src.url)) || sourceLabel(src);
}

/**
 * 规则的 classical 文本（可被 parseRuleLine 读回，保留客户端专用规则）。
 * 用于把旧规则包里的单条规则迁移成本地来源。
 */
export function formatRuleLine(rule: RuleIR): string {
  for (const client of ['mihomo', 'surge', 'loon', 'stash'] as const) {
    const lowered = lowerRule(rule, { client });
    if (lowered.kind === 'ok') return composeRule(lowered);
  }
  return '# 无法表示的规则：' + JSON.stringify(rule);
}
