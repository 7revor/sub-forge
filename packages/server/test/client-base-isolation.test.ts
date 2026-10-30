import { expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseIniBase } from '@sub-forge/core';
const readConfig = (target: string, text: string): Record<string, unknown> => target === 'surge' || target === 'loon' ? parseIniBase(text.split('[Proxy]')[0]!) : parseYaml(text);
import { addUser, client, setupApp } from './helpers.ts';

it('Mihomo 的 DNS/TUN/端口不会自动转换；各端只合并自己的预设和覆盖', async () => {
  const h = setupApp();
  try {
    const user = await addUser(h.store, 'compatibility'), api = client(h.app); await api.login('compatibility');
    const preset = { id: 'base', name: '隔离基础设置', version: 1, mihomo: {
      'mixed-port': 7890, 'allow-lan': true, dns: { enable: true, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16', nameserver: ['1.1.1.1'] },
      tun: { enable: true, stack: 'mixed', 'auto-route': true }, sniffer: { enable: true },
    } };
    h.store.put('preset', preset, user.id);
    h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '示例', type: 'trojan', server: 'node.example.test', port: 443, password: 'example' }] }, user.id);
    const saved = await api.post('/api/profiles', {
      name: '兼容性', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'inline' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' },
      base: { presetId: 'base', patch: { 'mixed-port': 0, 'allow-lan': false } },
      routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] }], rules: [], final: { kind: 'group', groupId: 'g' } } },
    });
    expect(saved.status, saved.text).toBe(201);
    const profile = saved.json.item;
    for (const target of ['mihomo', 'surge', 'loon', 'stash'] as const) {
      const out = await h.renderer.render(profile.id, { client: target, platform: 'ios' });
      expect(out.ok, JSON.stringify(out.report)).toBe(true);
      if (!out.ok) throw new Error('基础配置测试渲染失败');
      if (target === 'mihomo') expect(readConfig(target, out.render.yaml)).toMatchObject({ ...preset.mihomo, 'mixed-port': 0, 'allow-lan': false });
      else for (const key of ['mixed-port', 'allow-lan', 'dns', 'tun', 'sniffer']) expect(readConfig(target, out.render.yaml)).not.toHaveProperty(key);
    }
    h.store.put('preset', { ...preset, surge: { general: { ipv6: false, 'dns-server': ['1.1.1.1'] } }, loon: { general: { 'ip-mode': 'v4-only', 'dns-server': ['1.0.0.1'] } }, stash: { dns: { nameserver: ['9.9.9.9'] } } }, user.id);
    h.store.put('profile', { ...profile, base: { ...profile.base, surgePatch: { general: { 'test-timeout': 5 } }, loonPatch: { general: { 'allow-wifi-access': false } }, stashPatch: { dns: { 'follow-rule': false } } } }, user.id);
    for (const target of ['surge', 'loon', 'stash'] as const) {
      const out = await h.renderer.render(profile.id, { client: target, platform: 'ios' });
      expect(out.ok, JSON.stringify(out.report)).toBe(true);
      if (!out.ok) throw new Error('客户端独立基础配置渲染失败');
      const expected = target === 'surge' ? { general: { ipv6: false, 'dns-server': ['1.1.1.1'], 'test-timeout': 5 } }
        : target === 'loon' ? { general: { 'ip-mode': 'v4-only', 'dns-server': ['1.0.0.1'], 'allow-wifi-access': false } }
        : { dns: { nameserver: ['9.9.9.9'], 'follow-rule': false } };
      expect(readConfig(target, out.render.yaml)).toMatchObject(expected);
      expect(readConfig(target, out.render.yaml)).not.toHaveProperty('tun');
      expect(readConfig(target, out.render.yaml)).not.toHaveProperty('dns.enhanced-mode');
    }
  } finally { await h.snapshots.settled(); h.store.close(); }
});
