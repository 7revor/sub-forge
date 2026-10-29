import { describe, expect, it } from 'vitest';
import { highlightYaml } from './yamlHighlight.ts';

describe('YAML 输入高亮', () => {
  it('区分键、字符串、数值、字面量、注释和锚点，保留特殊字符', () => {
    const text = '# 注释\nport: 7890\nenabled: true\nempty: null\nname: "节点 #1"\nurl: https://example.com/#path\nbase: &base { key: 0xFF }\ncopy: *base\n';
    const segments = highlightYaml(text);
    expect(segments.map(item => item.text).join('')).toBe(text);
    for (const [text, tone] of [['# 注释', 'comment'], ['port', 'key'], ['7890', 'number'], ['true', 'literal'], ['null', 'literal'], ['"节点 #1"', 'string'], ['https://example.com/#path', 'string'], ['&base', 'meta'], ['*base', 'meta'], ['0xFF', 'number']]) {
      expect(segments).toContainEqual({ text, tone });
    }
  });

  it('块字符串中的冒号和井号不被当成键与注释', () => {
    const text = 'script: |\n  echo "a: b"\n  # 正文\nnext: false\n';
    const segments = highlightYaml(text);
    expect(segments.map(item => item.text).join('')).toBe(text);
    expect(segments).toContainEqual({ text: '  echo "a: b"\n  # 正文\n', tone: 'string' });
    expect(segments).toContainEqual({ text: 'next', tone: 'key' });
  });

  it.each(['', '\n\n', 'a: [true,', 'a: "未闭合', 'a:\n\twrong: true\n', 'a: 1\na: 2\n', '%YAML 1.2\n---\na: 1\n...\n---\nb: 2\n', 'name: "<script>alert(1)</script>"\r\n', 'x: >-\n  中文 😀\n\n'])('不完整或特殊输入原文不丢失：%j', text => {
    expect(highlightYaml(text).map(item => item.text).join('')).toBe(text);
  });
});
