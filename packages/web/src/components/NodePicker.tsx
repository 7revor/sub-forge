import type { Builtin, NodeRef, NodeSetID } from '@sub-forge/core';
import { useNodeList } from '../hooks.ts';
import { resolveRef } from './nodeMatch.ts';
import { NodeSetSelect } from './pickers.tsx';
import { Combobox, Input, Segmented, Select } from './ui.tsx';

/** exclude：当前节点集里不可选的节点名（本地节点设置前置时排除节点自己，含改名前的名称） */
export function NodePicker({ nodeSets, value, onChange, label, exclude }: {
  nodeSets: { ref: NodeSetID; name: string }[]; value: NodeRef; onChange: (ref: NodeRef) => void; label: string; exclude?: { nodeSet: NodeSetID; names: string[] };
}) {
  const { data, isLoading, error } = useNodeList(value.nodeSet);
  const exact = 'exact' in value.match;
  const text = 'exact' in value.match ? value.match.exact : value.match.regex;
  const result = resolveRef(data?.nodes ?? [], value.match);
  const self = exclude && exclude.nodeSet.type === value.nodeSet.type && exclude.nodeSet.id === value.nodeSet.id ? new Set(exclude.names.filter(Boolean)) : undefined;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="w-auto min-w-44"><NodeSetSelect label={`${label}所在节点集`} value={value.nodeSet} options={nodeSets} onChange={(nodeSet) => onChange({ ...value, nodeSet })} /></div>
      <Segmented label={`${label}匹配方式`} value={exact ? 'exact' : 'regex'} options={[{ value: 'exact', label: '精确' }, { value: 'regex', label: '正则' }]}
        onChange={(mode) => onChange({ ...value, match: mode === 'exact' ? { exact: text } : { regex: text } })} />
      {exact
        ? <Combobox aria-label={`${label}节点名称`} className="w-auto min-w-44 flex-1 font-mono" placeholder="搜索或输入节点名称（处理链之后）" value={text}
            options={(data?.nodes ?? []).filter((n) => !self?.has(n.name)).map((n) => ({ value: n.name, hint: `${n.type} · ${n.server}:${n.port}` }))}
            empty={isLoading ? '节点列表加载中…' : text ? '没有匹配的节点，可直接使用输入的名称' : '节点集中没有节点'}
            onChange={(v) => onChange({ ...value, match: { exact: v } })} />
        : <Input aria-label={`${label}节点正则`} className="w-auto min-w-44 font-mono" placeholder="节点名称正则，支持 (?i)" value={text}
            onChange={(e) => onChange({ ...value, match: { regex: e.target.value } })} />}
      <span className="text-[12px] text-muted">找不到时</span>
      <Select aria-label={`${label}兜底`} className="w-auto" value={value.fallback === 'error' || !value.fallback ? 'error' : value.fallback.kind === 'builtin' ? value.fallback.name : 'error'}
        onChange={(e) => onChange({ ...value, fallback: e.target.value === 'error' ? 'error' : { kind: 'builtin', name: e.target.value as Builtin } })}>
        <option value="REJECT">REJECT</option><option value="DIRECT">DIRECT</option><option value="error">报错</option>
      </Select>
      <div className="flex w-full flex-col gap-1 text-[12px]" aria-live="polite">
        {!value.nodeSet.id && <span className="text-muted">请选择节点集</span>}
        {isLoading && <span className="text-muted">节点列表加载中…</span>}
        {error && <span className="text-err">节点列表加载失败：{error.message}</span>}
        {result.error && <span className="text-err">{result.error}</span>}
        {self && result.node && self.has(result.node.name) && <span className="text-err">命中的是节点自己，会形成前置环，请换一个节点</span>}
        {data && !error && !result.error && <span className={result.count ? 'text-muted' : 'text-err'}>{data.truncated ? '当前列表：' : ''}{result.node ? `命中 ${result.count} 个，使用：${result.node.name}` : '没有命中'}</span>}
        {data && !error && exact && text && !result.count && <span className="text-[#6b3406]">当前列表中没有这个节点，上游恢复后会重新解析</span>}
        {data?.truncated && <span className="text-[#6b3406]">节点列表已截断：当前 {data.nodes.length} / 总数 {data.total}，命中数与首个节点仅基于当前列表，最终以完整列表解析为准。</span>}
        {data?.report.map((item, i) => <span key={i} className={item.level === 'error' ? 'text-err' : 'text-muted'}>{item.message}</span>)}
      </div>
    </div>
  );
}
