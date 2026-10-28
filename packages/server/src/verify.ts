// 可选的 mihomo -t 校验。-t 只解析配置，不启动代理；但 GEOIP 规则会在此阶段加载 MMDB，
// 工作目录里没有时 mihomo 会尝试下载。需要离线运行时，把 Country.mmdb 放进 workDir。

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Verifier } from './render.ts';

export function mihomoVerifier(bin: string, workDir?: string, timeoutMs = 15_000): Verifier {
  return async (yaml) => {
    const dir = workDir ?? (await mkdtemp(join(tmpdir(), 'sf-verify-')));
    const file = join(dir, `config-${process.pid}-${Date.now()}.yaml`);
    try {
      await writeFile(file, yaml);
      return await new Promise((resolve) => {
        execFile(bin, ['-t', '-d', dir, '-f', file], { timeout: timeoutMs }, (err, stdout, stderr) => {
          resolve({ ok: !err, output: `${stdout}${stderr}${err && !stdout && !stderr ? err.message : ''}` });
        });
      });
    } finally {
      await (workDir ? rm(file, { force: true }) : rm(dir, { recursive: true, force: true }));
    }
  };
}
