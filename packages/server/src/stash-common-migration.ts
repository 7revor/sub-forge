// 只在数据库升级或旧种子导入时承接已退役的 Stash 公共层。
import { isDeepStrictEqual } from 'node:util';
import { mergeNativeObjects, parseNativeYaml } from '@sub-forge/core';
import { stringify } from 'yaml';

type Fields = Record<string, unknown>;
const object = (value: unknown): value is Fields => !!value && typeof value === 'object' && !Array.isArray(value);

/** 只去除公共层已经提供的值；列表整体比较，空映射仍遵守原有递归合并语义。 */
function differences(value: Fields, inherited: Fields): Fields {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (Object.hasOwn(inherited, key) && isDeepStrictEqual(item, inherited[key])) return [];
    if (object(item) && object(inherited[key])) {
      const child = differences(item, inherited[key]);
      return Object.keys(child).length ? [[key, child]] : [];
    }
    return [[key, item]];
  }));
}

export function retireStashCommon(original: Record<string, any>): Record<string, any> {
  if (!original.base?.kernels || !Object.hasOwn(original.base.kernels, 'stash')) return original;
  const doc = structuredClone(original), base = doc.base;
  const legacy: unknown = base.kernels.stash;
  if (typeof legacy !== 'string') throw new Error('旧 Stash 公共配置必须是原始文本');
  const notes = new Set<string>(doc.migrationNotes ?? []);
  let text = legacy;
  let inherited: Fields | undefined;
  if (legacy.trim()) {
    try {
      const value = parseNativeYaml(legacy);
      // Mihomo 草稿无效时无法判断重复项；保留完整 Stash 原文，生成时继续报告草稿错误。
      inherited = parseNativeYaml(base.kernels.mihomo ?? '');
      const diff = differences(value, inherited);
      text = Object.keys(diff).length ? isDeepStrictEqual(diff, value) ? legacy : stringify(diff, { lineWidth: 0 }) : '';
    } catch (error) {
      notes.add(`旧 Stash 公共配置无法按字段去重，已保留原文到客户端追加，请修复后预览：${(error as Error).message}`);
    }
    if (text.trim()) {
      base.clients ??= {};
      for (const app of ['stash-ios', 'stash-macos'] as const) {
        const later = base.clients[app];
        if (later !== undefined && typeof later !== 'string') throw new Error(`${app} 追加配置必须是原始文本`);
        if (!later?.trim()) base.clients[app] = text;
        else {
          try {
            const earlierFields = parseNativeYaml(text), laterFields = parseNativeYaml(later);
            const merged = mergeNativeObjects(earlierFields, laterFields);
            // 递归合并不满足结合律：例如公共映射 → null → 应用映射不能直接折叠。
            if (inherited && !isDeepStrictEqual(mergeNativeObjects(inherited, merged), mergeNativeObjects(mergeNativeObjects(inherited, earlierFields), laterFields))) {
              throw new Error('多层配置存在映射与非映射之间的覆盖，无法保持原结果自动折叠');
            }
            base.clients[app] = stringify(merged, { lineWidth: 0 });
          } catch (error) {
            base.clients[app] = text + '\n# 以下为原客户端追加，请修复后预览\n' + later;
            notes.add(`${app} 无法自动合并旧 Stash 公共配置，已保留两份原文，请修复后预览：${(error as Error).message}`);
          }
        }
      }
      notes.add('旧 Stash 公共层已移除，保留内容并入 Stash iOS/macOS 追加，已有客户端追加优先；原始文档已加密备份。');
    }
  }
  delete base.kernels.stash;
  if (notes.size) doc.migrationNotes = [...notes];
  return doc;
}
