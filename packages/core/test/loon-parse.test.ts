import { describe, expect, it } from 'vitest';
import { parseContent, parseLoonLine, renderLoon } from '../src/index.ts';
import { iniFixture } from './fixtures/ini-client.ts';
describe('Loon 节点输入', () => {
  it('读取完整 INI 中的节点，保留位置密码、布尔值、Reality 和传输设置', () => {
    const out = parseContent('[General]\nip-mode = dual\n[Proxy]\nSS = Shadowsocks,ss.example.test,443,aes-128-gcm,"a,b=c",fast-open=false,udp=false\nVLESS = VLESS,v.example.test,443,"example-uuid",transport=ws,path=/ws,host=cdn.example.test,over-tls=true,public-key=example-key,short-id=abcdef,tls-profile=chrome\n[Rule]\nFINAL,DIRECT', { type: 'source', id: 's' });
    expect(out.format).toBe('loon'); expect(out.failures).toEqual([]);
    expect(out.proxies[0]).toMatchObject({ type: 'ss', password: 'a,b=c', tfo: false, udp: false });
    expect(out.proxies[1]).toMatchObject({ type: 'vless', tls: true, network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.test' } }, 'reality-opts': { 'public-key': 'example-key', 'short-id': 'abcdef' }, 'client-fingerprint': 'chrome' });
  });
  it('Hysteria2 跳跃端口、带宽、混淆可重新导出，不能丢失凭据', () => {
    const node = parseLoonLine('HY2 = Hysteria2,hy.example.test,443,"a,b=c",server-ports="20000:20100,30000",hop-interval=30,download-bandwidth=100,salamander-password=example,sni=cdn.example.test');
    expect(node).toMatchObject({ password: 'a,b=c', ports: '20000-20100,30000', down: '100 Mbps', obfs: 'salamander', 'obfs-password': 'example' });
    const f = iniFixture(); f.base = {};
    f.nodeSets.locals.nodes!.proxies = [node];
    const out = renderLoon(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    const parsed = parseContent(out.yaml, { type: 'source', id: 's' });
    expect(parsed.failures).toEqual([]);
    expect(parsed.proxies[0]).toMatchObject(node);
  });
  it('未知参数和缺少密码不能解析成表面成功的节点', () => {
    expect(() => parseLoonLine('SS = Shadowsocks,example.test,443,aes-128-gcm')).toThrow('password');
    expect(() => parseLoonLine('T = Trojan,example.test,443,"example",unknown-option=1')).toThrow('unknown-option');
    expect(parseContent('T = Trojan,example.test,443,"example",udp=maybe', { type: 'source', id: 's' }).failures).toHaveLength(1);
  });
});
