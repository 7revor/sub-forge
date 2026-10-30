import { useModalPresentation } from '../modals/index.tsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import type { Builtin, NodeRef, NodeSetID } from '@sub-forge/core';
import { useNodeList } from '../hooks.ts';
import { resolveRef } from './nodeMatch.ts';
import { NodeSetSelect } from './pickers.tsx';
import { Combobox, Input, Segmented, Select } from './ui.tsx';

export function NodePicker({ nodeSets, value, onChange, label }: {
  nodeSets: { ref: NodeSetID; name: string }[]; value: NodeRef; onChange: (ref: NodeRef) => void; label: string;
}) {
  const exact = 'exact' in value.match;
  const text = 'exact' in value.match ? value.match.exact : value.match.regex;
  const query = useDebouncedValue(exact ? text : '', 200);
  const { data, isLoading, error } = useModalPresentation(useNodeList(value.nodeSet, query));
  const result = resolveRef(data?.nodes ?? [], value.match);
  return (
    <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="w-auto min-w-0 flex-[1_1_176px]"><NodeSetSelect label={`${label}所在节点集`} value={value.nodeSet} options={nodeSets} onChange={(nodeSet) => onChange({ ...value, nodeSet })} /></div>
        <Segmented label={`${label}匹配方式`} value={exact ? 'exact' : 'regex'} options={[{ value: 'exact', label: '精确' }, { value: 'regex', label: '正则' }]}
          onChange={(mode) => onChange({ ...value, match: mode === 'exact' ? { exact: text } : { regex: text } })} />
        {exact
          ? <Combobox aria-label={`${label}节点名称`} className="w-auto min-w-0 flex-[2_1_176px] font-mono" placeholder="搜索或输入节点名称（处理链之后）" value={text}
              options={(data?.nodes ?? []).map((n) => ({ value: n.name, hint: `${n.type.toUpperCase()} · ${n.server}:${n.port}` }))}
              empty={isLoading ? '节点列表加载中…' : text ? '没有匹配的节点，可直接使用输入的名称' : '节点集中没有节点'}
              onChange={(v) => onChange({ ...value, match: { exact: v } })} />
          : <Input aria-label={`${label}节点正则`} className="w-auto min-w-0 flex-[2_1_176px] font-mono" placeholder="节点名称正则，支持 (?i)" value={text}
              onChange={(e) => onChange({ ...value, match: { regex: e.target.value } })} />}
        <div className="flex shrink-0 items-center gap-2">
          <span className="whitespace-nowrap text-[12px] text-ink-muted">找不到时</span>
          <Select placeholder="选择节点未匹配时采用的处理方式" aria-label={`${label}兜底`} className="w-auto" value={value.fallback === 'error' || !value.fallback ? 'error' : value.fallback.kind === 'builtin' ? value.fallback.name : 'error'}
            onChange={(e) => onChange({ ...value, fallback: e.target.value === 'error' ? 'error' : { kind: 'builtin', name: e.target.value as Builtin } })}>
            <option value="REJECT">REJECT</option><option value="DIRECT">DIRECT</option><option value="error">报错</option>
          </Select>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1 break-words text-[12px]" aria-live="polite">
        {!value.nodeSet.id && <span className="text-ink-muted">请选择节点集</span>}
        {isLoading && <span className="text-ink-muted">节点列表加载中…</span>}
        {error && <span className="text-err">节点列表加载失败：{error.message}</span>}
        {result.error && <span className="text-err">{result.error}</span>}
        {data && !!text.trim() && !error && !result.error && <span className={result.count ? 'text-ink-muted' : 'text-err'}>{data.truncated ? '当前列表：' : ''}{result.node ? `命中 ${result.count} 个，使用：${result.node.name}` : '没有命中'}</span>}
        {data && !error && exact && text && !result.count && <span className="text-[#6b3406]">当前列表中没有这个节点，上游恢复后会重新解析</span>}
        {data?.truncated && <span className="text-[#6b3406]">节点列表已截断：当前 {data.nodes.length} / 总数 {data.total}，命中数与首个节点仅基于当前列表，最终以完整列表解析为准。</span>}
        {data?.report.map((item, i) => <span key={i} className={item.level === 'error' ? 'text-err' : 'text-ink-muted'}>{item.message}</span>)}
      </div>
    </div>
  );
}
