import { commonBaseGroups } from '../schemas/commonBase.ts';
import { validateCommonBase } from '@sub-forge/core';
export type BaseClient = Client | 'common';
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

export const basePatchKey = (client: BaseClient) => client === 'common' ? 'common' : client === 'loon' ? 'loonPatch' : client === 'surge' ? 'surgePatch' : client === 'stash' ? 'stashPatch' : 'patch';
export function baseEditorFor(client: BaseClient) {
  const ini = client !== 'common' && isIniClient(client);
  const groups = client === 'common' ? commonBaseGroups : client === 'loon' ? loonBaseGroups : client === 'surge' ? surgeBaseGroups : client === 'stash' ? stashBaseGroups : mihomoBaseGroups;
  return {
    groups, format: ini ? 'INI' : 'YAML',
    toRaw: ini ? stringifyIniBase : baseToYaml,
    fromRaw: ini ? fromIni : (text: string): RawResult<Record<string, unknown>> => { const result = baseFromYaml(text); if (result.ok && client === 'common') try { validateCommonBase(result.value); } catch (error) { return { ok: false, error: (error as Error).message }; } return result; },
    recoverForm: (text: string, previous: Record<string, unknown>) => {
      if (client === 'common') {
        const result = baseFromYaml(text);
        try { if (!result.ok) throw new Error(result.error); validateCommonBase(result.value); return { value: result.value, notes: [] }; }
        catch (error) { return { value: previous, notes: ['公共项未应用，保留上次有效内容：' + (error as Error).message] }; }
      }
      if (!ini) return baseFormFromYaml(text, groups);
      const result = fromIni(text);
      return result.ok ? { value: result.value, notes: [] } : { value: previous, notes: ['INI 未应用，保留上次有效内容：' + result.error] };
    },
  };
}
