import { readFile } from 'node:fs/promises';
import { zstdCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeRuleBytes } from '../src/net/mrs.ts';
import { createUpstreamFetcher } from '../src/net/upstream.ts';
import { parseAllowList } from '../src/net/ssrf.ts';
import { RuleConverter } from '../src/rule-converter.ts';
import { setupApp } from './helpers.ts';

const n64 = (value: number | bigint) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(value)); return b; };
const frame = (behavior: number, content: Buffer) => zstdCompressSync(Buffer.concat([Buffer.from([77,82,83,1,behavior]),n64(1),n64(0),content]));
const fixture = (ext: string) => readFile(new URL(`./fixtures/meta-geosite/bilibili.${ext}`, import.meta.url));
const active = (lines: string[]) => lines.filter(x => x.trim() && !x.startsWith('#')).sort();

describe('MRS 转统一 LIST', () => {
  it('MetaCubeX 真实域名样本 LIST、YAML、MRS 的输出集合完全一致', async () => {
    const converter = new RuleConverter();
    const outputs = await Promise.all(['list','yaml','mrs'].map(async ext => {
      const content = await decodeRuleBytes(await fixture(ext));
      const result = converter.convert([{source:{id:'s',kind:'remote',format:'auto',url:`https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/bilibili.${ext}`},content}],{}, {client:'mihomo'});
      if (ext === 'mrs') expect(result.delivery.mode).toBe('managed');
      expect(result.stats.output).toBe(53); expect(result.stats.rejected).toBe(0);
      return active(result.lines);
    }));
    expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0]);
  });

  it('按魔数解码无后缀 URL，进入正式快照和 GET 转换前使用相同的读取链路', async () => {
    const binary = await fixture('mrs');
    const fetcher=createUpstreamFetcher({allow:parseAllowList([]),fetchImpl:async()=>({status:200,headers:{get:()=>null},text:async()=>{throw new Error('二进制不能按 UTF-8 读取');},arrayBuffer:async()=>new Uint8Array(binary).buffer})});
    const h=setupApp({fetcher});
    try {
      const saved=await h.snapshots.get('ruleset','remote','https://example.com/download',{format:'auto',ttlSec:86400});
      expect(saved.error).toBeUndefined(); expect(saved.snapshot?.body).toContain('DOMAIN-SUFFIX,bilibili.com');
      const draft=await h.snapshots.peekRuleContent('https://example.com/download');
      expect(draft.body).toBe(saved.snapshot?.body);
    } finally {h.store.close();}
  });

  it('IP 区间恢复为 IPv4/IPv6 CIDR，保留范围边界', async () => {
    const ip=(s:string)=>Buffer.from(s.replaceAll(':',''),'hex');
    const data=Buffer.concat([Buffer.from([1]),n64(2),
      ip('00000000000000000000ffff0a000000'),ip('00000000000000000000ffff0a0000ff'),
      ip('20010db8000000000000000000000000'),ip('20010db8000000000000000000000003')]);
    expect(await decodeRuleBytes(frame(1,data))).toContain('IP-CIDR,10.0.0.0/24\nIP-CIDR6,2001:db8:0:0:0:0:0:0/126\n');
  });

  it('独立子域通配不扩大为包含根域的后缀匹配', async () => {
    // 官方 LOUDS 布局表示反转字符串 t.a.+，没有 a.t 的精确叶子。
    const data=Buffer.concat([Buffer.from([1]),n64(1),n64(32),n64(1),n64(1706),n64(5),Buffer.from('t.a.+')]);
    expect(await decodeRuleBytes(frame(0,data))).toContain('DOMAIN-WILDCARD,*.a.t\n');
  });

  it('拒绝损坏版本、越界长度、截断、SRS 与压缩膨胀，不产生伪成功文本', async () => {
    await expect(decodeRuleBytes(Buffer.from('SRS\x01binary'))).rejects.toThrow('SRS');
    await expect(decodeRuleBytes(zstdCompressSync(Buffer.from('invalid')))).rejects.toThrow('MRS');
    await expect(decodeRuleBytes(frame(0,Buffer.concat([Buffer.from([1]),n64(2**40)])))).rejects.toThrow('MRS');
    await expect(decodeRuleBytes(frame(1,Buffer.concat([Buffer.from([1]),n64(1)])))).rejects.toThrow('MRS');
    await expect(decodeRuleBytes((await fixture('mrs')).subarray(0,12))).rejects.toThrow();
    await expect(decodeRuleBytes(zstdCompressSync(Buffer.alloc(33*1024*1024)))).rejects.toThrow();
  });
});
