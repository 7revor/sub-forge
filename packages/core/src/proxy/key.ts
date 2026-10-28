import { stableHash } from '../util/hash.ts';

/** 参与 _key 的凭据字段，按优先级取第一个存在的 */
const CREDENTIAL_FIELDS = ['uuid', 'password', 'psk', 'private-key', 'token', 'auth-str', 'auth'] as const;

/**
 * 节点身份：协议 + 服务器 + 端口 + 凭据（SRC-10）。
 * 与名称无关，因此上游改名不影响去重与引用解析。
 */
export function proxyKey(p: { type: string; server: string; port: number; [k: string]: unknown }): string {
  let cred = '';
  for (const f of CREDENTIAL_FIELDS) {
    const v = p[f];
    if (typeof v === 'string' && v) { cred = `${f}=${v}`; break; }
  }
  if (!cred && typeof p.username === 'string') cred = `user=${p.username}`;
  return stableHash(`${p.type.toLowerCase()}|${p.server.toLowerCase()}|${p.port}|${cred}`);
}
