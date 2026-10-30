import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { addUser, client, setupApp } from './helpers.ts';

const mihomo = `# 用户原始配置：注释、空值和布尔值均保留
port: 7890
socks-port: 7891
allow-lan: true
mode: rule
log-level: info
external-controller: 0.0.0.0:9090
hosts:
tun:
  enable: true
  stack: mips
  auto-route: true
  strict-route: false
  auto-detect-interface: true
  dns-hijack:
    - any:53
dns:
  enable: true
  use-hosts: true
  ipv6: false
  respect-rules: true
  proxy-server-nameserver: [223.5.5.5]
  direct-nameserver: [223.5.5.5]
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "geosite:cn,private": 223.5.5.5
    "+.example.test": ["https://dns.example.test/dns-query#DIRECT"]
  nameserver: [223.5.5.5]
  fake-ip-filter: ["*.orb.local"]
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
`;
const surge = `[General]
ipv6 = false
dns-server = 223.5.5.5
encrypted-dns-server = h3://dns.example.test/dns-query
skip-proxy = *.orb.local
tun-excluded-routes = 192.168.0.0/16
[Host]
*.example.test = server:1.1.1.1
[URL Rewrite]
^https://example.test/foo https://example.test/bar 302
`;
const routing = { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } };
const draft = { name: '原文追加', nodeSets: [], chains: [], overlay: {}, routing };

it('原文逐字保存，四内核隔离；仅生成时合并，不把切换目标的结果回写源文档', async () => {
  const h = setupApp();
  try {
    await addUser(h.store, 'native', 'admin'); const api = client(h.app); await api.login('native');
    const config = { kernels: { mihomo, surge, stash: 'dns:\n  nameserver: [https://doh.pub/dns-query]\n', loon: '[General]\nip-mode = v4-only\n[Host]\n*.example.test = server:1.1.1.1\n' }, clients: { 'surge-ios': '[General]\nallow-wifi-access = false\n', 'surge-macos': '[General]\nsocks5-listen = 0.0.0.0:10001, 0.0.0.0:10002\n' } };
    const base = { ...config, clients: { ...config.clients, flclash: 'allow-lan: false\nport: 0\ndns:\n  nameserver: [9.9.9.9]\n  nameserver-policy:\n    "rule-set:custom": ["tls://1.1.1.1"]\n' } };
    const saved = await api.post('/api/profiles', { ...draft, base }); expect(saved.status, saved.text).toBe(201);
    const id = saved.json.item.id;
    for (const kernel of ['mihomo', 'stash', 'surge', 'loon'] as const) {
      const output = await h.renderer.render(id, { client: kernel, ...(kernel === 'mihomo' ? { app: 'flclash' as const } : {}) }); expect(output.ok, JSON.stringify(output.report)).toBe(true);
      if (!output.ok) throw new Error(output.message);
      if (kernel === 'mihomo') {
        const actual = parse(output.render.yaml);
        expect(actual).toMatchObject({ ...parse(mihomo), port: 0, 'allow-lan': false, dns: { ...parse(mihomo).dns, nameserver: ['9.9.9.9'] } });
        expect(actual.dns['nameserver-policy']['rule-set:custom']).toEqual(['tls://1.1.1.1']);
      } else { expect(output.render.yaml).not.toContain('fake-ip-range'); expect(output.render.yaml).not.toContain('mips'); }
    }
    const ios = await h.renderer.preview(id, { client: 'surge', app: 'surge-ios' });
    const mac = await h.renderer.preview(id, { client: 'surge', app: 'surge-macos' });
    expect(ios.yaml).toContain('allow-wifi-access = false'); expect(ios.yaml).not.toContain('socks5-listen');
    expect(mac.yaml).toContain('socks5-listen = 0.0.0.0:10001, 0.0.0.0:10002'); expect(mac.exportYaml).toContain('[URL Rewrite]');
    expect(h.store.get('profile', id)?.base).toEqual(base);
  } finally { await h.snapshots.settled(); h.store.close(); }
});

it('UA 和显式 app 匹配客户端追加；缓存、节点链接与预览使用同一个目标', async () => {
  const h = setupApp();
  try {
    const user = await addUser(h.store, 'app'); const api = client(h.app); await api.login('app');
    const saved = await api.post('/api/profiles', { ...draft, base: { kernels: { mihomo: 'port: 7890\n' }, clients: { flclash: 'port: 7892\n', 'clash-verge': 'port: 7893\n' } } });
    expect(saved.status).toBe(201); const id = saved.json.item.id, token = h.store.createToken(user.id).token;
    for (const [ua, app, port] of [['FlClash/1.0 Platform/macos', 'flclash', 7892], ['clash-verge/v2.4 Platform/windows', 'clash-verge', 7893], ['mihomo/1.19', undefined, 7890]] as const) {
      const response = await h.app.request(`/subs/profile?token=${token}&id=${id}`, { headers: { 'user-agent': ua } }); expect(response.status).toBe(200);
      expect(parse(await response.text()).port).toBe(port);
      const preview = await api.post(`/api/profiles/${id}/preview`, { client: 'mihomo', ...(app ? { app } : {}) });
      expect(parse(preview.json.yaml).port).toBe(port);
    }
    expect((await h.app.request(`/subs/profile?token=${token}&id=${id}&target=surge&app=flclash`)).status).toBe(400);
    const disabled = { ...saved.json.item, base: { ...saved.json.item.base, enabled: false } };
    expect((await api.put('/api/profiles/' + id, disabled)).status).toBe(200);
    const preview = await api.post(`/api/profiles/${id}/preview`, { client: 'mihomo', app: 'flclash' });
    expect(parse(preview.json.yaml)).not.toHaveProperty('port');
    expect(h.store.get('profile', id)?.base?.kernels?.mihomo).toBe('port: 7890\n');
  } finally { await h.snapshots.settled(); h.store.close(); }
});

it('格式错误仍原样保存，生成时明确失败；非当前内核的错误不影响输出', async () => {
  const h = setupApp();
  try {
    await addUser(h.store, 'invalid'); const api = client(h.app); await api.login('invalid');
    const base = { kernels: { mihomo: 'dns: [尚未写完', surge } };
    const saved = await api.post('/api/profiles', { ...draft, base }); expect(saved.status).toBe(201);
    const id = saved.json.item.id;
    expect(h.store.get('profile', id)?.base).toEqual(base);
    expect((await h.renderer.preview(id, { client: 'mihomo' })).ok).toBe(false);
    expect((await h.renderer.preview(id, { client: 'surge' })).ok).toBe(true);
    expect((await api.put('/api/profiles/' + id, { ...saved.json.item, base: { common: { dnsIpv6: false } } })).status).toBe(400);
  } finally { await h.snapshots.settled(); h.store.close(); }
});

it('同内核规则产物在所有客户端间共享，进程与逻辑规则保持完整', async () => {
  const h = setupApp();
  try {
    h.store.put('ruleset', { id: 'r', name: '进程', sources: [{ id: 's', kind: 'local', format: 'auto', content: 'PROCESS-NAME,Example\nNOT,((PROCESS-NAME,Example))' }] });
    const reference = { matcher: { kind: 'ruleset' as const, id: 'r' } };
    for (const kernel of ['surge', 'stash', 'loon'] as const) {
      const ios = { client: kernel, platform: 'ios', app: kernel + '-ios' }, mac = { client: kernel, platform: 'macos', app: kernel + '-macos' };
      expect(h.renderer.sharedRules.key(reference, ios)).toBe(h.renderer.sharedRules.key(reference, mac));
      const text = await h.renderer.sharedRules.readReference(reference, ios);
      expect(text).toContain('PROCESS-NAME,Example'); expect(text).toContain('NOT,((PROCESS-NAME,Example))');
      expect(text).not.toContain('不支持进程');
    }
    expect(h.store.listSharedRules()).toHaveLength(3);
  } finally { await h.snapshots.settled(); h.store.close(); }
});


it('旧平台规则条件及互相矛盾的客户端参数明确拒绝', async () => {
  const h = setupApp();
  try {
    await addUser(h.store, 'validation'); const api = client(h.app); await api.login('validation');
    const withRule = { ...draft, routing: { mode: 'independent', config: { ...routing.config, rules: [{ id: 'r', matcher: { kind: 'local', content: 'PROCESS-NAME,Example', overrides: [{ when: { client: 'surge', platform: 'ios' }, action: { drop: true } }] }, target: { kind: 'builtin', name: 'DIRECT' } }] } } };
    expect((await api.post('/api/profiles', withRule)).status).toBe(400);
    expect((await api.post('/api/profiles/preview', { profile: draft, client: 'surge', app: 'surge-ios', platform: 'macos' })).status).toBe(400);
  } finally { await h.snapshots.settled(); h.store.close(); }
});
