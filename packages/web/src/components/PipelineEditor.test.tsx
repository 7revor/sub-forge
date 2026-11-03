import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PipelineEditor } from './PipelineEditor.tsx';

const render = (loading: boolean) => renderToStaticMarkup(<PipelineEditor steps={[]} onChange={() => {}} loading={loading} />);

describe('处理链总览的预览状态', () => {
  it('首次加载只提示一次预览中', () => {
    const html = render(true);
    expect(html.split('预览中…')).toHaveLength(2);
    expect(html).not.toContain('保存后可预览');
  });
  it('没有预览且未在加载时提示保存后可预览', () => {
    const html = render(false);
    expect(html).toContain('保存后可预览');
    expect(html).not.toContain('预览中…');
  });
});
