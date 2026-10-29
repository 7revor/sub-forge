import type { RuleSetFormat } from '@sub-forge/core';
import { bad } from '../api/common.ts';

export type GenericOptions = { directory: string; include: string[]; exclude: string[]; format: RuleSetFormat };
export type CustomRepoInput = GenericOptions & { name: string; owner: string; repo: string; ref?: string };
const FORMATS = new Set(['auto', 'classical', 'domain-set', 'ipcidr']);
const DEFAULT_INCLUDE = ['**/*.list', '**/*.txt'];

/** 仅支持路径通配符 *、**、?；不执行仓库脚本或用户正则。 */
export function pathGlob(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { out += '(?:.*/)?'; i++; }
      else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$');
}

export const isIndexedRuleFile = (path: string): boolean => /\.(list|txt)$/i.test(path);

export function matchesGeneric(path: string, options: GenericOptions): boolean {
  const prefix = options.directory ? options.directory + '/' : '';
  if (!path.startsWith(prefix)) return false;
  const relative = path.slice(prefix.length);
  // 本期仅托管文本规则；扩展名只是候选筛选，内容在预览和导入时校验。
  if (!isIndexedRuleFile(relative) || /^(?:readme|license|licence|changelog)(?:\.|$)/i.test(relative.split('/').at(-1)!)) return false;
  return options.include.some(p => pathGlob(p).test(relative)) && !options.exclude.some(p => pathGlob(p).test(relative));
}

export function parseCustomRepo(body: Record<string, unknown>): CustomRepoInput {
  if (typeof body.url !== 'string' || body.url.length > 300) throw bad('请填写 GitHub 仓库地址');
  let url: URL;
  try { url = new URL(body.url.trim()); } catch { throw bad('请填写 https://github.com/owner/repo 格式的地址'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw bad('仅支持不含凭据和参数的公开 GitHub 仓库地址');
  const match = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(url.pathname);
  if (!match) throw bad('仓库地址应为 https://github.com/owner/repo，不包含分支或文件路径');
  const owner = match[1]!;
  const repo = match[2]!.replace(/\.git$/, '');
  if (!repo || /^\.+$/.test(repo)) throw bad('仓库名称不合法');
  const string = (key: string, fallback: string, limit: number) => {
    const value = body[key] ?? fallback;
    if (typeof value !== 'string' || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) throw bad(`${key} 必须是长度不超过 ${limit} 的文本`);
    return value.trim();
  };
  const name = string('name', '', 120) || `${owner}/${repo}`;
  const ref = string('ref', '', 200);
  if (ref && (/\s|\.\.|@\{|[~^:?*\[\\]/.test(ref) || ref.startsWith('/') || ref.endsWith('/') || ref.includes('//') || ref.endsWith('.lock'))) throw bad('分支名称不合法');
  const rawDirectory = string('directory', '', 300);
  if (rawDirectory.startsWith('/')) throw bad('扫描目录必须是仓库内的相对路径');
  const directory = rawDirectory.replace(/\/$/, '');
  if (directory.startsWith('/') || directory.includes('\\') || directory.split('/').some(p => p === '.' || p === '..') || directory.includes('//')) throw bad('扫描目录必须是仓库内的相对路径');
  const patterns = (key: string, fallback: string[]) => {
    const value = body[key] ?? fallback;
    if (!Array.isArray(value) || value.length > 20 || (key === 'include' && !value.length)) throw bad(`${key} 需填写${key === 'include' ? '至少 1 个、' : ''}最多 20 个路径模式`);
    return value.map(p => {
      if (typeof p === 'string') p = p.trim();
      if (typeof p !== 'string' || !p.trim() || p.length > 200 || /[\x00-\x1f\x7f\\[\]{}]/.test(p) || p.startsWith('/') || p.split('/').some(x => x === '..' || x === '.') || p.includes('***')) throw bad(`${key} 路径模式不合法，仅支持 *、**、? 通配符`);
      return p.trim();
    });
  };
  const format = body.format ?? 'auto';
  if (typeof format !== 'string' || !FORMATS.has(format)) throw bad('请选择自动识别、classical、域名列表或 CIDR 格式');
  return { name, owner, repo, ...(ref ? { ref } : {}), directory, include: patterns('include', DEFAULT_INCLUDE), exclude: patterns('exclude', []), format: format as RuleSetFormat };
}
