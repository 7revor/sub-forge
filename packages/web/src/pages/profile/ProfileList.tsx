import { boundTemplateId, modeLabel } from './routing.ts';
// 配置订阅列表与七步新建向导入口（PRD 4.9）。

import { DocList } from '../../components/DocList.tsx';
import { Badge, listMono } from '../../components/ui.tsx';
import { useTemplates } from '../../hooks.ts';
import { useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { NewProfileModal } from './NewProfileModal.tsx';

export function ProfileList() {
  const location = useLocation();
  const navigate = useNavigate();
  const opened = useRef(false);
  const create = async (templateId?: string) => { const result = await NewProfileModal.show({ templateId }); if (result.status === 'confirmed') navigate(`/profiles/${result.data.id}`); };
  useEffect(() => { const state = location.state as { create?: boolean; templateId?: string } | null; if (!opened.current && state?.create) { opened.current = true; void create(state.templateId); } }, [location.key]);
  const templates = useTemplates().data ?? [];
  return (
    <DocList kind="profiles" title="配置订阅" onCreate={() => void create()} deleteBody="它的订阅链接会立即失效，客户端将无法更新。"
      columns={[
        { header: '名称', width: 280, cell: p => p.name },
        { header: '分流', width: 200, cell: p => <span className="block truncate">{modeLabel(p, templates.find(t => t.id === boundTemplateId(p))?.name)}</span> },
        { header: '节点来源', width: 140, cell: p => <span>{p.nodeSets.length} 个</span> },
      ]} />
  );
}

export function ProfileNew() {
  const [search] = useSearchParams();
  return <Navigate to="/profiles" replace state={{ create: true, templateId: search.get('template') ?? undefined }} />;
}
