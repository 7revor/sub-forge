import { stringify as testYaml } from 'yaml';
import { expect, it } from 'vitest';
import { importLoonConfig, renderLoon, renderMihomo, resolveNativeBase, NodeSetResolver, Report } from '../src/index.ts';
import { loonFull } from './fixtures/loon-full.ts';
const plan = (text = loonFull) => importLoonConfig(text, { id: 'import', name: '导入样例' });
function fixture(result = plan()) {
  return { profile: result.profile, base: resolveNativeBase('loon', undefined, undefined, result.profile.base),
    nodeSets: { sources: Object.fromEntries(result.sources.map(s => [s.id,s])), collections: Object.fromEntries(result.collections.map(c => [c.id,c])), locals: Object.fromEntries(result.locals.map(l => [l.id,l])), snapshots: Object.fromEntries(result.sources.map(s => [s.id, ['香港远程 = Shadowsocks,hk.example.test,443,aes-128-gcm,"example"\n日本远程 = Shadowsocks,jp.example.test,443,aes-128-gcm,"example"']])) },
    rules: { rulesets: {}, snapshots: {} }, urls: { provider: () => 'https://example.test/p', ruleset: () => 'https://example.test/r' } };
}
it('导入全部配置段，保留原落地、两个独立命名链与 VLESS SNI', () => {
  const p = plan(); expect(p.report.filter(r => r.level === 'error')).toEqual([]);
  expect(p.profile.chains).toHaveLength(2); expect(p.locals[0]!.proxies.map(n => n.name)).toEqual(['入口', '落地', '命名链', '地区链']);
  expect(p.locals[0]!.proxies[0]).toHaveProperty('servername', 'tls.example.test');
  expect(p.profile.base.kernels?.loon).toContain('dns-server = 223.5.5.5');
  expect(p.profile.base.kernels?.loon).toContain('proxy-test-url = https://example.test/204');
  const f = fixture(p), before = JSON.stringify(f), out = renderLoon(f);
  expect(out.report.items.filter(r => r.level === 'error')).toEqual([]);
  expect(out.yaml).toContain('[Proxy Chain]\n命名链 = 入口, 命名链 · 链落地, udp=true');
  expect(out.yaml).toContain('地区链 = 香港节点, 地区链 · 链落地, udp=true');
  expect(out.yaml).toContain('落地 = Shadowsocks, exit.example.test');
  expect(out.yaml).toContain('香港节点 = select, 香港远程');
  expect(out.yaml).toContain('url=https://example.test/204');
  expect(Object.values(out.rulesets).some(r => r.text.includes('IP-CIDR,192.0.2.0/24,no-resolve'))).toBe(true);
  expect(out.yaml).not.toContain('IP-CIDR,');
  expect(JSON.stringify(f)).toBe(before);
  const mihomo = renderMihomo({ ...f, base: '' });
  expect(mihomo.report.byCode('proxy.block-quic-unsupported').length).toBeGreaterThan(0);
  const nodes = mihomo.config.proxies as Record<string,unknown>[];
  expect(nodes.find(n => n.name === '落地')).not.toHaveProperty('dialer-proxy');
  expect(nodes.find(n => n.name === '命名链')).toHaveProperty('dialer-proxy', '入口');
});
it('动态过滤仅包含远程来源，默认选项不覆写，VMess 设置限定协议', () => {
  const p = plan(), f = fixture(p), resolver = new NodeSetResolver(f.nodeSets, new Report());
  const nodes = resolver.resolve({ type: 'collection', id: p.collections[0]!.id });
  expect(nodes.map(n => n._origName)).toEqual(['香港远程']);
  expect(nodes[0]).not.toHaveProperty('alterId'); expect(nodes[0]).not.toHaveProperty('tfo');
  expect(nodes[0]).toMatchObject({ udp: true, 'skip-cert-verify': true, 'block-quic': true });
});
it('完整 Loon 输出可重新导入，保留链与规则，不把链当作普通直连节点', () => {
  const text = renderLoon(fixture()).yaml;
  const next = plan(text); expect(next.report.filter(r => r.level === 'error')).toEqual([]);
  expect(next.profile.chains).toHaveLength(2);
});
it.each([
  ['FINAL,科学上网', ''], ['科学上网 = select,命名链', '科学上网 = select,Test'],
  ['命名链 = 入口,落地', '命名链 = 入口,未知'], ['fast-open=default', 'fast-open=perhaps'],
  ['flexible-sni=false', 'flexible-sni=true'], ['[Rule]', '[Unknown]'],
  ['香港节点 = select,HK_Filter', '香港节点 = select,科学上网'],
])('不支持、缺失和循环引用不能静默丢弃：%s', (from, to) => {
  expect(plan(loonFull.replace(from, to)).report.some(r => r.level === 'error')).toBe(true);
});
it('缺少最终出口必须明确补充；停用来源不参与任何筛选器', () => {
  const p = importLoonConfig(loonFull.replace('FINAL,科学上网', '').replace('enabled=true', 'enabled=false').replace('香港节点 = select,HK_Filter', '香港节点 = select,DIRECT'), { id: 'i', name: '导入', final: 'REJECT' });
  expect(p.report.filter(r => r.level === 'error')).toEqual([]);
  expect(p.collections[0]!.members).toEqual([]); expect(p.profile.nodeSets.some(n => n.ref.type === 'source')).toBe(false);
});
it('Loon max-timeout 与全局 test-timeout 分开保留，其他端明确报告差异', () => {
  const p = plan(loonFull.replace('香港节点 = select,HK_Filter,url=', '香港节点 = fallback,HK_Filter,max-timeout=1500,url='));
  expect(p.report.filter(r => r.level === 'error')).toEqual([]);
  const f = fixture(p), out = renderLoon(f);
  expect(out.report.hasErrors).toBe(false); expect(out.yaml).toContain('test-timeout = 3'); expect(out.yaml).toContain('max-timeout=1500');
  expect(renderMihomo({ ...f, base: '' }).report.byCode('group.max-timeout-unsupported')).toHaveLength(1);
});
