import { compileUserRegex, type NodeRef } from '@sub-forge/core';
import type { NodeBrief } from '../api.ts';

export function filterNodes(nodes: NodeBrief[], filters: { filter?: string; excludeFilter?: string; excludeType?: string }): { nodes: NodeBrief[]; error?: string } {
  try {
    const inc = filters.filter ? compileUserRegex(filters.filter) : undefined;
    const exc = filters.excludeFilter ? compileUserRegex(filters.excludeFilter) : undefined;
    const types = filters.excludeType ? new Set(filters.excludeType.split('|').map((t) => t.trim().toLowerCase())) : undefined;
    return { nodes: nodes.filter((n) => (!inc || inc.test(n.name)) && (!exc || !exc.test(n.name)) && (!types || !types.has(n.type.toLowerCase()))) };
  } catch (error) {
    return { nodes: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function resolveRef(nodes: NodeBrief[], match: NodeRef['match']): { node?: NodeBrief; count: number; error?: string } {
  try {
    const regex = 'regex' in match ? compileUserRegex(match.regex) : undefined;
    const matches = nodes.filter((n) => 'exact' in match ? n.name === match.exact : regex!.test(n.name));
    return { node: matches[0], count: matches.length };
  } catch (error) {
    return { count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
