import { parseContent, type LocalProxy } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import snapshots from '../../../core/test/__snapshots__/proxy-parse.test.ts.snap?raw';
import { getPath, otherFields, setPath } from '../components/schema.ts';
import { defaultsFor, PROXY_TYPES, schemaFor } from '../schemas/proxy.ts';
import { groupFromYaml, groupToYaml, parseProxyImport, proxyDraftFromYaml, proxyFormFromYaml, proxyFromYaml, proxyToYaml } from './proxyYaml.ts';

const node: LocalProxy = {
  name: '测试节点', type: 'vless', server: 'example.com', port: 443, uuid: 'uuid', tls: true,
  servername: 'tls.example.com', network: 'ws',
  'reality-opts': { 'public-key': 'key', 'short-id': '0012', future: true },
  'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.com', 'X-Test': 'keep' } },
  future: { list: [1, false, '值'], nested: { enabled: true } },
  dialer: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'upstream' }, match: { exact: '前置节点' } } },
};

describe('列表粘贴导入', () => {
  it('与单节点原始配置识别相同字段', () => {
    const text = proxyToYaml(node);
    const imported = parseProxyImport(text);
    const raw = proxyFromYaml(text);
    expect(raw.ok).toBe(true);
    expect(imported.failures).toEqual([]);
    expect(imported.proxies).toHaveLength(1);
    const { _source, _origName, _key, ...fields } = imported.proxies[0]!;
    if (raw.ok) expect(fields).toEqual(raw.value);
  });

  it.each([
    'name: [未闭合\ntype: vless',
    '- name: [未闭合\n  type: vless',
    'proxies:\n  - name: [未闭合',
    'name: 重复\nname: 键\ntype: vless',
    'proxies: 不是列表',
  ])('显示无效 YAML 的诊断，禁止导入：%s', (text) => {
    const result = parseProxyImport(text);
    expect(result.format).toBe('clash');
    expect(result.proxies).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).not.toBe('不是 URI');
  });
});

describe('节点 YAML 转换', () => {
  it('错误类型返回表单时清空，保留 UUID、扩展字段和现有前置', () => {
    const result = proxyFormFromYaml('name: 新名称\ntype: vless\nserver: {}\nport: wrong\nuuid: valid-uuid\ntls: wrong\nalpn: [h2, 123]\nfuture: { keep: true }', node);
    expect(result.value).toEqual({ name: '新名称', type: 'vless', server: '', port: 0, uuid: 'valid-uuid', alpn: ['h2'], future: { keep: true }, dialer: node.dialer });
    for (const key of ['server', 'port', 'tls', 'alpn[2]']) expect(result.notes.join()).toContain(key);
    expect(proxyFromYaml(proxyToYaml(result.value)).ok).toBe(false);
  });

  it('语法错误和未填写必填项不妨碍回表单，且不恢复旧字段', () => {
    const result = proxyFormFromYaml('name: 保留名称\nserver: [\nuuid: keep-uuid\n', node);
    expect(result.value).toEqual({ name: '保留名称', type: '', server: '', port: 0, uuid: 'keep-uuid', dialer: node.dialer });
    expect(result.notes.join()).toContain('server');
  });

  it('合法节点恢复后与原配置相等', () => {
    expect(proxyFormFromYaml(proxyToYaml(node), node)).toEqual({ value: node, notes: [] });
  });
  it('嵌套及未知字段往返不丢失，dialer 不导出且导入保留', () => {
    const text = proxyToYaml(node);
    expect(text).not.toContain('dialer:');
    expect(proxyFromYaml(text, node)).toEqual({ ok: true, value: node });
    const { dialer: _dialer, ...plain } = node;
    expect(proxyFromYaml(text)).toEqual({ ok: true, value: plain });
  });

  it('单节点改名保留前置，YAML 不能覆盖内部前置', () => {
    const text = proxyToYaml({ ...node, name: '新名字' }) + 'dialer: malicious\n';
    expect(proxyFromYaml(text, node)).toEqual({ ok: true, value: { ...node, name: '新名字' } });
  });

  it('分组重排按名称保留前置，新节点没有前置', () => {
    const second = { ...node, name: '另一个', dialer: undefined };
    const text = groupToYaml([second, node]);
    expect(text).not.toContain('dialer:');
    const result = groupFromYaml(text, [node]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value[0]).not.toHaveProperty('dialer');
    expect(result.value[1]).toEqual(node);
    expect(groupFromYaml('proxies: []', [node])).toEqual({ ok: true, value: [] });
  });

  it.each(['name', 'type', 'server', 'port'])('缺少 %s 时拒绝整个分组并报告序号', (key) => {
    const missing = Object.fromEntries(Object.entries(node).filter(([k]) => k !== key));
    const result = groupFromYaml(groupToYaml([node, missing as LocalProxy]), []);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`第 2 个节点`) });
    expect(result).toMatchObject({ error: expect.stringContaining(key) });
    expect(proxyFromYaml(proxyToYaml(missing as LocalProxy))).toMatchObject({ ok: false });
  });

  it.each(['"443"', '.nan', 'null', 'true'])('port=%s 不是有效数字', (port) => {
    expect(proxyFromYaml(`name: A\ntype: http\nserver: host\nport: ${port}`)).toMatchObject({ ok: false });
  });

  it.each(['[]', 'null', 'proxies: {}', 'proxies:\n  - invalid'])('拒绝非法分组结构 %s', (text) => {
    expect(groupFromYaml(text, [])).toMatchObject({ ok: false });
  });

  it('语法错误报告真实行号，重复键不能静默覆盖', () => {
    const result = proxyFromYaml('name: A\ntype: http\nserver: host\nport: 443\nport: 80');
    expect(result).toMatchObject({ ok: false, line: 5 });
    expect(proxyFromYaml('name: [')).toMatchObject({ ok: false, line: expect.any(Number) });
  });

  it('通过 schema 字段创建 vless + reality + grpc，输出 mihomo 字段', () => {
    let value: Record<string, unknown> = { ...defaultsFor('vless'), name: 'Reality', server: 'example.com' };
    const edits = { uuid: 'u', tls: true, servername: 'tls.example.com', 'client-fingerprint': 'chrome', network: 'grpc', 'reality-opts.public-key': 'pk', 'reality-opts.short-id': '0012', 'grpc-opts.grpc-service-name': 'svc' };
    const fields = schemaFor('vless').flatMap((group) => group.fields);
    for (const [key, item] of Object.entries(edits)) {
      expect(fields.some((field) => field.key === key)).toBe(true);
      value = setPath(value, key, item);
    }
    expect(fields.find((field) => field.key === 'grpc-opts.grpc-service-name')?.showIf?.(value)).toBe(true);
    expect(fields.find((field) => field.key === 'ws-opts.path')?.showIf?.(value)).toBe(false);
    expect(value).not.toHaveProperty('cipher');
    const result = proxyFromYaml(proxyToYaml(value as LocalProxy));
    expect(result).toEqual({ ok: true, value });
    expect(getPath(value, 'reality-opts.short-id')).toBe('0012');
  });
});

describe('节点 YAML 草稿与表单切换', () => {
  it('所有协议的未完成默认节点都可返回表单，严格导入仍拒绝空服务器', () => {
    for (const { value: type } of PROXY_TYPES) {
      const draft = { ...defaultsFor(type), name: '节点 1' };
      const text = proxyToYaml(draft);
      expect(proxyDraftFromYaml(text, draft)).toEqual({ ok: true, value: draft });
      expect(proxyFromYaml(text)).toMatchObject({ ok: false });
    }
  });

  it('未填或删除的字段转为表单空值，其他已填写内容和前置均保留', () => {
    const result = proxyDraftFromYaml('type: vless\nserver:\nuuid: new-uuid\nfuture: {nested: true}', node);
    expect(result).toEqual({ ok: true, value: { name: '', type: 'vless', server: '', port: 0, uuid: 'new-uuid', future: { nested: true }, dialer: node.dialer } });
  });

  it('补齐草稿后，表单与严格导入得到相同节点', () => {
    const text = proxyToYaml(node);
    expect(proxyDraftFromYaml(text, node)).toEqual(proxyFromYaml(text, node));
  });

  it('语法错误、重复键和不能由表单表示的字段类型仍阻止切换', () => {
    for (const text of ['name: [', 'name: A\nname: B', '[]', 'server: {host: example.com}', 'port: "443"']) {
      expect(proxyDraftFromYaml(text, node), text).toMatchObject({ ok: false });
    }
  });
});

// 直接读取 core 的快照样例，将其中的节点数组作为 YAML 交给内核重新解析。
const samples = [...snapshots.matchAll(/= `\n([\s\S]*?)\n`;/g)].flatMap((match) => {
  const parsed = parseContent(`proxies: ${match[1]}`, { type: 'local', id: 'schema-coverage' });
  if (parsed.failures.length) throw new Error(JSON.stringify(parsed.failures));
  return parsed.proxies.map((p) => Object.fromEntries(Object.entries(p).filter(([key]) => !key.startsWith('_'))));
});

describe('core 节点样例的 schema 覆盖', () => {
  it('确实读取到 core 的主流协议样例', () => {
    expect(new Set(samples.map((p) => p.type))).toEqual(new Set(['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'socks5']));
  });
  for (const { value: type } of PROXY_TYPES) {
    const proxies = samples.filter((p) => p.type === type);
    it.skipIf(!proxies.length)(`${type} 常用字段不落入其他字段`, () => {
      for (const proxy of proxies) {
        const extra = otherFields(proxy, schemaFor(type));
        for (const key of ['password', 'uuid', 'cipher', 'sni', 'servername', 'network', 'reality-opts']) expect(extra).not.toHaveProperty(key);
        expect(proxyFromYaml(proxyToYaml(proxy as LocalProxy))).toEqual({ ok: true, value: proxy });
      }
    });
  }
});
