import { stringify as testYaml } from 'yaml';
import { expect, it } from 'vitest';
import { parseContent, renderMihomo, renderSurge, renderLoon, renderStash } from '../src/index.ts';
import { iniFixture, routing } from './fixtures/ini-client.ts';

it.each(['vless', 'vmess'])('Loon %s 的 SNI 变成 Mihomo 的 servername', type => {
  const credential = type === 'vmess' ? 'auto,"00000000-0000-4000-8000-000000000001"' : '"00000000-0000-4000-8000-000000000001"';
  const parsed = parseContent(`入口 = ${type},example.test,443,${credential},over-tls=true,sni=tls.example.test`, { type: 'local', id: 'nodes' });
  expect(parsed.failures).toEqual([]);
  expect(parsed.proxies[0]).toMatchObject({ servername: 'tls.example.test' });
  expect(parsed.proxies[0]).not.toHaveProperty('sni');
});
it('节点 QUIC 控制按客户端语义处理，不把被忽略字段当作成功', () => {
  const f = iniFixture(); f.base = ''; routing(f).rules = [];
  f.nodeSets.locals.nodes!.proxies = [{ name: '节点', type: 'ss', server: 'example.test', port: 443, cipher: 'aes-128-gcm', password: 'example', 'block-quic': true }];
  expect(renderSurge(f).yaml).toContain('block-quic=on');
  expect(renderLoon(f).yaml).toContain('block-quic=true');
  for (const render of [renderMihomo, renderStash]) expect(render(f).report.byCode('proxy.block-quic-unsupported')).toHaveLength(1);
  f.nodeSets.locals.nodes!.proxies[0]!['block-quic'] = false;
  expect(renderSurge(f).yaml).toContain('block-quic=off');
  expect(renderMihomo(f).report.hasErrors).toBe(false);
  for (const mode of ['on', 'off', 'auto', 'adaptive']) {
    const result = parseContent(`节点 = ss, example.test, 443, encrypt-method=aes-128-gcm, password=example, block-quic=${mode}`, { type: 'local', id: 'nodes' });
    expect(result.failures).toEqual([]); expect(result.proxies[0]!['block-quic']).toBe(mode);
  }
});
it('手工 VLESS SNI 别名也会规范化，冲突阻止输出', () => {
  const f = iniFixture(); f.base = ''; routing(f).rules = []; f.profile.nodeSets[0]!.output = 'inline';
  f.nodeSets.locals.nodes!.proxies = [{ name: '节点', type: 'vless', server: 'example.test', port: 443, uuid: '00000000-0000-4000-8000-000000000001', sni: 'tls.example.test' }];
  expect(renderMihomo(f).config.proxies).toEqual([expect.objectContaining({ servername: 'tls.example.test' })]);
  f.nodeSets.locals.nodes!.proxies[0]!.servername = 'different.example.test';
  expect(renderMihomo(f).report.byCode('proxy.sni-conflict')).toHaveLength(1);
});
