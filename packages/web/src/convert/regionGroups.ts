import type { GroupSpec, NodeSetID } from '@sub-forge/core';
import { newId } from './templateYaml.ts';

export const REGION_GROUPS = [
  { name: '🇭🇰 香港节点', filter: '(?i)港|HK|Hong Kong' },
  { name: '🇺🇸 美国节点', filter: '(?i)美|波特兰|达拉斯|俄勒冈|凤凰城|费利蒙|硅谷|拉斯维加斯|洛杉矶|圣何塞|圣克拉拉|西雅图|芝加哥|US|United States' },
  { name: '🇯🇵 日本节点', filter: '(?i)日本|川日|东京|大阪|泉日|埼玉|沪日|深日|[^-]日|JP|Japan' },
  { name: '🇸🇬 新加坡节点', filter: '(?i)新加坡|SG|Singapore' },
] as const;

/** 已有同名组保留用户设置；重复点击只补齐缺少的地区。 */
export function createRegionGroups(existing: Pick<GroupSpec, 'name'>[], nodeSet?: NodeSetID): GroupSpec[] {
  const names = new Set(existing.map(group => group.name));
  return REGION_GROUPS.filter(region => !names.has(region.name)).map(region => ({
    id: newId('g'), ...region, type: 'select', whenEmpty: 'reject', display: { hidden: true },
    members: nodeSet ? [{ kind: 'nodeset', ref: { ...nodeSet } }] : [],
  }));
}
