// 只在历史文档导入/升级时运行；新文档始终保存原文，不经过字段映射。
import { CLIENT_APPS, mergeNativeIni, mergeNativeObjects, parseNativeYaml, CLIENTS, isIniClient, stringifyIniBase, type NativeBase, type Client } from '@sub-forge/core';
import { stringify } from 'yaml';
import { lowerCommonBase, mergeBase, type CommonBase } from './legacy-common-base.ts';

type Doc = Record<string, any>;
const patchKey = (kernel: Client) => kernel === 'mihomo' ? 'patch' : kernel + 'Patch';

function convert(common: CommonBase, native: Doc, notes: Set<string>): NativeBase {
  const result: NativeBase = { kernels: {}, clients: {} };
  if (common.testUrl !== undefined || common.testTimeoutMs !== undefined) notes.add('旧公共测速默认值已保留在 INI 原文；Mihomo/Stash 没有对应的基础全局项，请在策略组高级设置中确认测速 URL 和超时。原公共值已备份。');
  for (const kernel of CLIENTS) {
    const mapped = lowerCommonBase(common, kernel, kernel === 'surge' ? 'macos' : undefined, native[kernel] ?? {});
    mapped.report.filter(r => r.level !== 'info').forEach(r => notes.add('旧公共配置迁移：' + r.message));
    const merged = mergeBase(mapped.base, native[kernel] ?? {});
    if (kernel === 'surge' && (common.httpPort !== undefined || common.socksPort !== undefined || common.allowLan !== undefined)) {
      // 旧端口随平台生成，迁移到对应的客户端层，不能把桌面监听写到 iOS。
      for (const platform of ['ios', 'macos'] as const) {
        const ports = lowerCommonBase(Object.fromEntries(Object.entries({ httpPort: common.httpPort, socksPort: common.socksPort, allowLan: common.allowLan }).filter(([, value]) => value !== undefined)) as CommonBase, kernel, platform).base;
        result.clients!['surge-' + platform as 'surge-ios' | 'surge-macos'] = stringifyIniBase(mergeBase(ports, native.surge ?? {}));
      }
      if (merged.general) for (const key of ['http-listen', 'socks5-listen']) if (!Object.hasOwn(native.surge?.general ?? {}, key)) delete (merged.general as Doc)[key];
    }
    if (Object.keys(merged).length) result.kernels![kernel] = isIniClient(kernel) ? stringifyIniBase(merged) : stringify(merged, { lineWidth: 0 });
  }
  return result;
}

/** 平台限定不能直接删条件后扩大作用范围。旧规则停用并备份，明确提示重新确定内核改写。 */
function removePlatformOverrides(value: unknown, notes: Set<string>): unknown {
  if (Array.isArray(value)) return value.filter(item => {
    const override = item?.override ?? item;
    if (override?.when?.platform !== undefined && override?.action) {
      notes.add(`旧规则改写 ${override.when.client}/${override.when.platform} 已停用并备份；请按内核重新确认改写，未将其扩大到所有平台。`);
      return false;
    }
    return true;
  }).map(item => removePlatformOverrides(item, notes));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removePlatformOverrides(item, notes)]));
}

export function migrateNativeDocument(kind: string, original: Doc, preset?: Doc): Doc {
  const notes = new Set<string>(original.migrationNotes ?? []);
  const doc = removePlatformOverrides(structuredClone(original), notes) as Doc;
  if (kind === 'preset' && !doc.config) {
    doc.config = convert(doc.common ?? {}, Object.fromEntries(CLIENTS.map(k => [k, doc[k] ?? {}])), notes);
    for (const key of ['common', ...CLIENTS]) delete doc[key];
  }
  if (kind === 'profile' && doc.base && ['common', 'patch', 'stashPatch', 'surgePatch', 'loonPatch', 'raw'].some(k => Object.hasOwn(doc.base, k))) {
    const old = doc.base;
    const flatten = old.presetId && Object.keys(old.common ?? {}).length > 0 && preset && !preset.config;
    const common = flatten ? mergeBase(preset.common ?? {}, old.common) : old.common ?? {};
    const native = Object.fromEntries(CLIENTS.map(k => [k, mergeBase(flatten ? preset[k] ?? {} : {}, old[patchKey(k)] ?? {})]));
    doc.base = { ...convert(common, native, notes), ...(old.enabled !== undefined ? { enabled: old.enabled } : {}), ...(!flatten && old.presetId ? { presetId: old.presetId } : {}) };
    if (flatten) notes.add('旧订阅公共项与预设原生项存在交叉优先级，已按原有效配置展开为独立原文；原预设引用已备份。');
    if (typeof old.raw === 'string' && old.raw.trim()) {
      doc.base.kernels.mihomo = (doc.base.kernels.mihomo ?? '') + '\n' + old.raw;
      notes.add('旧版未输出的原样片段已保留到 Mihomo 原文末尾，请预览核对重复键后再发布。');
    }
  }
  if (notes.size) doc.migrationNotes = [...notes];
  return doc;
}

/** 退役预设时展开同层引用；只有一份原文时不重新排版，未完成语法保留并提示修复。 */
export function retireProfilePreset(original: Doc, preset?: Doc): Doc {
  if (original.base?.presetId === undefined) return original;
  const doc = structuredClone(original);
  const notes = new Set<string>(doc.migrationNotes ?? []);
  const { presetId, ...base } = doc.base;
  if (!preset) notes.add(`基础预设 ${presetId} 已不存在；已保留订阅原文，原引用已备份。`);
  else {
    for (const note of preset.migrationNotes ?? []) notes.add(note);
    for (const layer of ['kernels', 'clients'] as const) {
      const merged: Record<string, string> = { ...preset.config?.[layer], ...base[layer] };
      for (const id of Object.keys(merged)) {
        const earlier = preset.config?.[layer]?.[id], later = base[layer]?.[id];
        if (earlier === undefined || later === undefined || earlier === later) continue;
        if (!earlier.trim()) { merged[id] = later; continue; }
        if (!later.trim()) { merged[id] = earlier; continue; }
        const kernel = layer === 'kernels' ? id as Client : CLIENT_APPS.find(app => app.id === id)!.kernel;
        try {
          merged[id] = isIniClient(kernel) ? mergeNativeIni([earlier, later]) : stringify(mergeNativeObjects(parseNativeYaml(earlier), parseNativeYaml(later)), { lineWidth: 0 });
        } catch (error) {
          // 不能因草稿语法未完成而丢数据或阻止升级；输出生成仍会报告语法错误。
          merged[id] = earlier + '\n# 以下为原订阅追加，请修复后预览\n' + later;
          notes.add(`${id} 预设与订阅无法自动合并，已保留两份原文，请修复后预览：${(error as Error).message}`);
        }
      }
      if (Object.keys(merged).length) base[layer] = merged;
    }
    notes.add(`基础预设「${preset.name ?? presetId}」已并入本订阅的两层原文，原始文档已备份。`);
  }
  doc.base = base;
  doc.migrationNotes = [...notes];
  return doc;
}
