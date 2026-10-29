import { describe, expect, it } from 'vitest';
import { parseRuleSourceContent, remoteRuleMatcher } from '../src/index.ts';

describe('远程规则身份与域名方言', () => {
  it('URL 派生键稳定且隔离完整查询参数，不生成系统规则集引用', () => {
    const a=remoteRuleMatcher(' https://example.com/rules?version=1#ignored ');
    expect(a).toEqual(remoteRuleMatcher('https://example.com/rules?version=1'));
    expect(a.id).not.toBe(remoteRuleMatcher('https://example.com/rules?version=2').id);
    expect(a.remote).toEqual({url:'https://example.com/rules?version=1'});
    expect(a.repository).toBeUndefined();
  });
  it('拒绝不完整地址、非 HTTP(S) 以及嵌入用户名密码的 URL', () => {
    for (const url of ['', 'example.com/list', 'file:///tmp/rules', 'https://user:pass@example.com/list']) expect(()=>remoteRuleMatcher(url)).toThrow();
  });
  it('MetaCubeX 的前导点仅匹配子域，普通 DOMAIN-SET 仍包含根域', () => {
    const text='.example.test\n+.suffix.test\nexact.test';
    const clash=parseRuleSourceContent(text,{format:'auto',url:'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/test.list'});
    const surge=parseRuleSourceContent(text,{format:'auto',url:'https://example.com/rules.list'});
    if(clash.passthrough || surge.passthrough) throw new Error('应为文本解析');
    expect(clash.rules.map(x=>x.rule)).toEqual([{type:'DOMAIN-WILDCARD',value:'*.example.test'},{type:'DOMAIN-SUFFIX',value:'suffix.test'},{type:'DOMAIN',value:'exact.test'}]);
    expect(surge.rules[0]!.rule).toEqual({type:'DOMAIN-SUFFIX',value:'example.test'});
  });
});
