import { parseIniBase, stringifyIniBase, isIniClient, type Client } from '@sub-forge/core';
import type { RawResult } from '../components/DualEditor.tsx';
import { mihomoBaseGroups } from '../schemas/mihomoBase.ts';
import { stashBaseGroups } from '../schemas/stashBase.ts';
import { loonBaseGroups } from '../schemas/loonBase.ts';
import { surgeBaseGroups } from '../schemas/surgeBase.ts';
import { baseFormFromYaml, baseFromYaml, baseToYaml } from './baseYaml.ts';

const fromIni = (text: string): RawResult<Record<string, unknown>> => {
  try { return { ok: true, value: parseIniBase(text) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'INI 格式错误' }; }
};

export const basePatchKey = (client: Client) => client === 'loon' ? 'loonPatch' : client === 'surge' ? 'surgePatch' : client === 'stash' ? 'stashPatch' : 'patch';
export function baseEditorFor(client: Client) {
  const ini = isIniClient(client);
  const groups = client === 'loon' ? loonBaseGroups : client === 'surge' ? surgeBaseGroups : client === 'stash' ? stashBaseGroups : mihomoBaseGroups;
  return {
    groups, format: ini ? 'INI' : 'YAML',
    toRaw: ini ? stringifyIniBase : baseToYaml,
    fromRaw: ini ? fromIni : baseFromYaml,
    recoverForm: (text: string, previous: Record<string, unknown>) => {
      if (!ini) return baseFormFromYaml(text, groups);
      const result = fromIni(text);
      return result.ok ? { value: result.value, notes: [] } : { value: previous, notes: ['INI 未应用，保留上次有效内容：' + result.error] };
    },
  };
}
