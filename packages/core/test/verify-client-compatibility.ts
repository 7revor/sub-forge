import { stringify as testYaml } from 'yaml';
// 生成可复核的矩阵及示例，只运行官方配置解析器，不启动代理。
// 从仓库根目录运行；完整命令见 research/verification/mihomo-portability-20261030/验收记录.md。
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { parseRuleLine, type Client, type Target } from '../src/index.ts';
import { commonInput, compatibilityCases, outputStatus, renderers, targets } from './fixtures/client-compatibility.ts';
import { routing } from './fixtures/ini-client.ts';

type Check = { status: 'passed' | 'failed' | 'not-run'; reason?: string; output?: string };
const output = resolve(process.argv[2] ?? 'research/verification/mihomo-portability-20261030');
const dir = mkdtempSync(join(tmpdir(), 'sub-forge-portability-'));
const mihomo = process.env.MIHOMO, surge = process.env.SURGE_BIN;
const mihomoBase = { 'geo-auto-update': false, 'geodata-mode': false, 'geox-url': { mmdb: 'http://127.0.0.1:9/mmdb', asn: 'http://127.0.0.1:9/asn', geosite: 'http://127.0.0.1:9/geosite' } };
function check(target: Client, text: string): Check {
  const binary = target === 'mihomo' ? mihomo : target === 'surge' ? surge : undefined;
  if (!binary) return { status: 'not-run', reason: '没有配置该客户端官方校验器' };
  if (process.platform !== 'darwin') throw new Error('本验证脚本要求 macOS sandbox-exec 禁止校验器联网');
  const file = join(dir, target === 'surge' ? 'surge.conf' : 'config.yaml');
  writeFileSync(file, text);
  const args = target === 'surge' ? ['--check', file] : ['-t', '-d', dir, '-f', file];
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', binary, ...args], { encoding: 'utf8', timeout: 15000 });
  if (result.error) throw result.error;
  return result.status === 0 ? { status: 'passed' } : { status: 'failed', output: (result.stdout + result.stderr).replaceAll(dir, '<临时目录>') };
}
try {
  if (mihomo) {
    if (!process.env.MIHOMO_GEO_DIR) throw new Error('配置 MIHOMO 时必须提供 MIHOMO_GEO_DIR，测试不会下载数据库');
    for (const file of ['Country.mmdb', 'ASN.mmdb', 'geoip.dat', 'geosite.dat']) copyFileSync(join(process.env.MIHOMO_GEO_DIR, file), join(dir, file));
  }
  const rows = compatibilityCases.map(c => {
    const results = targets.map(target => {
      const f = commonInput(); c.apply(f);
      if (target === 'mihomo') f.base = testYaml(mihomoBase);
      const out = renderers[target](f), status = outputStatus(out);
      // 不用仅剩 FINAL 的文件掩盖规则丢失，也不把不可发布的半成品送去校验。
      const official = ['error', 'omitted'].includes(status)
        ? { status: 'not-run' as const, reason: '生成失败或规则已被省略，不能验证原输入' }
        : check(target, out.yaml);
      return [target, { status, official, diagnostics: out.report.items.filter(i => i.code !== 'loon.rule-priority') }];
    });
    return { id: c.id, category: c.category, label: c.label, ...(c.caveat ? { caveat: c.caveat } : {}), targets: Object.fromEntries(results) };
  });
  const common = commonInput();
  common.nodeSets.locals.nodes!.proxies = ['ss-aes128', 'vmess-ws', 'trojan-tls'].map((id, i) => {
    const f = commonInput(); compatibilityCases.find(c => c.id === id)!.apply(f);
    return { ...f.nodeSets.locals.nodes!.proxies[0]!, name: ['SS 示例', 'VMess 示例', 'Trojan 示例'][i]! };
  });
  const exampleRules: [string, Target][] = [
    ['DOMAIN,ads.example.test', { kind: 'builtin' as const, name: 'REJECT' as const }],
    ['DOMAIN-SUFFIX,example.test', { kind: 'group' as const, groupId: 'all' }],
    ['IP-CIDR,192.0.2.0/24,no-resolve', { kind: 'builtin' as const, name: 'DIRECT' as const }],
  ];
  routing(common).rules = exampleRules.map(([line, target], i) => ({ id: String(i), matcher: { kind: 'rule', rule: parseRuleLine(line) }, target }));
  routing(common).final = { kind: 'group', groupId: 'all' };
  mkdirSync(output, { recursive: true });
  const examples: Record<string, Check> = {};
  for (const target of targets) {
    const out = renderers[target](common);
    if (outputStatus(out) !== 'ok') throw new Error('公共样例发生丢失或降级：' + target);
    const text = '# 虚构节点，仅用于验证格式；各客户端基础设置需另外配置。\n' + out.yaml;
    writeFileSync(join(output, `common-${target}.${target === 'surge' || target === 'loon' ? 'conf' : 'yaml'}`), text);
    examples[target] = check(target, target === 'mihomo' ? stringify({ ...out.config, ...mihomoBase }) : out.yaml);
  }
  // 负面对照：旧输出确实被 Surge 拒绝，不能误把无效文件的检查记为通过。
  const old = commonInput(); routing(old).rules = [{ id: 'old', matcher: { kind: 'rule', rule: parseRuleLine('DST-PORT,80/443') }, target: { kind: 'builtin', name: 'DIRECT' } }];
  const oldText = renderers.surge(old).yaml.replace('OR,((DEST-PORT,80),(DEST-PORT,443))', 'DEST-PORT,80/443');
  const negativeControl = check('surge', oldText);
  const summary = Object.fromEntries(targets.map(target => [target, {
    generator: Object.fromEntries(['ok', 'warning', 'omitted', 'error'].map(status => [status, rows.filter(r => r.targets[target].status === status).length])),
    official: Object.fromEntries(['passed', 'failed', 'not-run'].map(status => [status, rows.filter(r => r.targets[target].official.status === status).length])),
  }]));
  const metadata = { date: new Date().toISOString(), scope: '生成器及离线语法；没有真实连接验收；ok 不代表全部字段已获客户端语义确认', sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), surgeVersion: process.env.SURGE_VERSION ?? '未提供', mihomoVersion: mihomo ? spawnSync(mihomo, ['-v'], { encoding: 'utf8' }).stdout.trim() : '未提供' };
  writeFileSync(join(output, 'matrix.json'), JSON.stringify({ metadata, summary, examples, negativeControl, rows }, null, 2) + '\n');
  const labels: Record<string, string> = { ok: '生成接受', warning: '有省略警告', omitted: '规则省略', error: '阻止输出' };
  const lines = rows.map(row => `| ${row.category} | ${row.label.replaceAll('|', '\\|')} | ${targets.map(t => labels[row.targets[t].status] + (row.targets[t].official.status === 'passed' ? '；语法通过' : row.targets[t].official.status === 'failed' ? '；语法失败' : '')).join(' | ')} | ${row.caveat ?? ''} |`);
  writeFileSync(join(output, 'matrix.md'), '# 配置兼容性逐项矩阵\n\n由 verify-client-compatibility.ts 生成。生成接受不等于真机可用；Stash 部分参数直接透传，Loon 规则按类别分阶段匹配。详细判断见[验收记录](验收记录.md)。未标「语法通过」的项没有官方校验结果。\n\n| 类别 | 场景 | Mihomo | Surge | Loon | Stash | 注意事项 |\n| --- | --- | --- | --- | --- | --- | --- |\n' + lines.join('\n') + '\n');
  console.log(JSON.stringify({ cases: rows.length, summary, examples, negativeControl }, null, 2));
  if (rows.some(r => targets.some(t => r.targets[t].official.status === 'failed')) || Object.values(examples).some(c => c.status === 'failed') || negativeControl.status === 'passed') process.exitCode = 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
