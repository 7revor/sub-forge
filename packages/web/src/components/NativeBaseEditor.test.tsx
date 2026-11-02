import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NativeBaseEditor } from './NativeBaseEditor.tsx';

describe('配置追加工作区', () => {
  const render = (value = {}) => renderToString(<NativeBaseEditor value={value} onChange={() => undefined} />);
  it('按内核分组列出公共配置与客户端，不再需要展开收起', () => {
    const html = render();
    for (const name of ['Mihomo 公共配置', 'Stash iOS', 'Stash macOS', 'Surge 公共配置', 'Surge iOS', 'Surge macOS', 'Loon 公共配置', 'Loon iOS', 'Loon macOS']) expect(html).toContain(`aria-label="${name}"`);
    expect(html).not.toContain('aria-expanded');
    expect(html).toContain('粘贴 Mihomo 公共配置的原始 YAML 配置');
  });
  it('已填写的目标显示行数，空白内容不算填写', () => {
    const html = render({ kernels: { mihomo: 'dns:\n  enable: true\n', surge: '  \n' } });
    expect(html).toContain('Mihomo 公共配置，已填写 2 行');
    expect(html).toContain('aria-label="Surge 公共配置"');
  });
  it('公共配置页不显示继承层，底部说明只出现一次', () => {
    const html = render({ kernels: { mihomo: 'port: 7890\n' } });
    expect(html).not.toContain('继承自');
    expect(html.match(/节点、策略组和规则由系统生成/g)).toHaveLength(1);
  });
});
